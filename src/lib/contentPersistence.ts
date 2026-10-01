// Leitura e autosave seguros para o NoteEditor e o DrawingCanvas (REL-002).
//
// Antes, um erro de rede na leitura virava "conteúdo vazio" e o próximo
// autosave gravava vazio por cima do real; saves com erro sumiam em silêncio; e
// a última edição se perdia ao trocar de página (o unmount só cancelava o timer).

export type LoadResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }

/**
 * Resposta de `.maybeSingle()` → o que o editor deve fazer. Só `empty` (página
 * nova, sem linha) pode montar o editor vazio; `error` NÃO pode, senão o
 * autosave apaga o conteúdo real.
 */
export function classifyLoad<T>({ data, error }: {
  data: T | null
  error: { code?: string; message: string } | null
}): LoadResult<T> {
  if (error) {
    // PGRST116 = nenhuma linha em `.single()`; tratado como página nova.
    if (error.code === 'PGRST116') return { kind: 'empty' }
    return { kind: 'error', message: error.message }
  }
  return data == null ? { kind: 'empty' } : { kind: 'ok', data }
}

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict'

export type SaveResult =
  | { ok: true; at: string | null }
  | { ok: false; error: string; conflict?: false }
  /** REL-009: outra pessoa salvou depois da versão que este editor conhece. */
  | { ok: false; error: string; conflict: true }

export interface DebouncedSaver<T> {
  /** Guarda o valor mais recente e (re)agenda o save. */
  schedule(value: T): void
  /**
   * Salva agora o que estiver pendente (unmount, pagehide, "tentar de novo").
   * `force` (REL-009, "manter a minha") grava por cima de uma versão mais nova.
   */
  flush(options?: { force?: boolean }): Promise<void>
  /** Troca o callback de sucesso (componentes o registram num efeito, onde podem usar refs). */
  setOnSaved(cb: ((at: string | null, stillDirty: boolean) => void) | undefined): void
  /**
   * Descarta a edição pendente (REL-009, "carregar a versão salva"): sem isto,
   * o flush do unmount gravaria por cima a versão que a pessoa acabou de
   * descartar.
   */
  discard(): void
  /**
   * REL-009: a versão (`updated_at`) sobre a qual o próximo save grava. O saver
   * a atualiza sozinho a cada save que dá certo; o editor chama isto ao aplicar
   * uma versão que chegou pelo realtime.
   */
  setVersion(version: string | null): void
  readonly status: SaveStatus
}

/**
 * Autosave com debounce que só dá o conteúdo por salvo quando o save dá certo.
 * Em erro, o último valor continua guardado (status `error`) para o próximo
 * `flush()`. `onSaved(at, stillDirty)` avisa se já há uma edição mais nova
 * esperando — o modo colaborativo não pode se considerar "limpo" nesse caso.
 */
export function createDebouncedSaver<T>({ delayMs, save, onStatus, onSaved, version: initialVersion = null }: {
  delayMs: number
  save: (value: T, options: { force: boolean; version: string | null }) => Promise<SaveResult>
  /** A versão carregada do banco (REL-009). */
  version?: string | null
  onStatus?: (status: SaveStatus) => void
  onSaved?: (at: string | null, stillDirty: boolean) => void
}): DebouncedSaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { value: T } | null = null
  let inFlight: Promise<void> | null = null
  let status: SaveStatus = 'idle'
  let onSavedCb = onSaved
  let version = initialVersion

  const setStatus = (next: SaveStatus) => {
    if (status === next) return
    status = next
    onStatus?.(next)
  }

  const run = async (force = false): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null }
    if (inFlight) {
      await inFlight
      if (pending) return run(force)
      return
    }
    if (!pending) return

    const { value } = pending
    pending = null
    setStatus('saving')

    let result = { ok: false, error: 'unknown' } as SaveResult
    inFlight = (async () => {
      try {
        result = await save(value, { force, version })
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })()
    await inFlight
    inFlight = null

    if (!result.ok && result.conflict) {
      // REL-009: não tenta de novo sozinho (daria conflito de novo). Guarda a
      // edição até a pessoa escolher: carregar a versão salva ou manter a sua.
      if (!pending) pending = { value }
      setStatus('conflict')
      return
    }

    if (result.ok) {
      if (result.at) version = result.at
      onSavedCb?.(result.at, pending !== null)
      if (pending) {
        setStatus('dirty')
        // Editado durante o save: se o debounce já disparou, salva agora.
        if (!timer) return run()
        return
      }
      setStatus('saved')
    } else {
      // Mantém o valor para o retry; uma edição mais nova (se houver) vence.
      if (!pending) pending = { value }
      setStatus('error')
    }
  }

  return {
    schedule(value: T) {
      pending = { value }
      // Em conflito, só guarda a edição mais nova; salvar espera a escolha.
      if (status === 'conflict') return
      if (status !== 'saving') setStatus('dirty')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void run() }, delayMs)
    },
    flush: options => run(options?.force ?? false),
    setOnSaved(cb) { onSavedCb = cb },
    discard() {
      if (timer) { clearTimeout(timer); timer = null }
      pending = null
      setStatus('idle')
    },
    setVersion(next) { version = next },
    get status() { return status },
  }
}

// ── REL-009: save condicional pela versão ────────────────────────────────────

/** O cliente do supabase, só com o que o save versionado usa (testável com um falso). */
interface VersionedClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

type ContentTable = 'note_contents' | 'drawing_contents'

/**
 * Grava o conteúdo só se a linha ainda estiver na versão (`updated_at`) que
 * este editor conhece. Antes era um upsert do documento inteiro: quem salvava
 * por último apagava a edição do outro, sem aviso.
 *
 * - com versão: `update … where page_id and updated_at = expected`. Zero linhas
 *   com a linha existindo = alguém salvou depois (conflito);
 * - sem versão (página nova): `insert`; se outra pessoa criou antes (23505),
 *   é conflito também;
 * - `force` ("manter a minha"): update sem a condição de versão.
 */
export async function saveVersionedContent(client: VersionedClient, { table, pageId, values, expected, force = false }: {
  table: ContentTable
  pageId: string
  values: Record<string, unknown>
  expected: string | null
  force?: boolean
}): Promise<SaveResult> {
  const conflict = { ok: false, conflict: true, error: 'conflict' } as const

  const insert = async (): Promise<SaveResult> => {
    const { data, error } = await client.from(table).insert({ page_id: pageId, ...values }).select('updated_at').single()
    if (error?.code === '23505') return conflict
    return error ? { ok: false, error: error.message } : { ok: true, at: data?.updated_at ?? null }
  }

  if (expected === null && !force) return insert()

  let update = client.from(table).update(values).eq('page_id', pageId)
  if (!force && expected !== null) update = update.eq('updated_at', expected)
  const { data, error } = await update.select('updated_at')
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as { updated_at: string | null }[]
  if (rows.length > 0) return { ok: true, at: rows[0].updated_at ?? null }

  // Zero linhas: a versão mudou, a linha não existe, ou o RLS recusou.
  const { data: current, error: readError } = await client.from(table).select('updated_at').eq('page_id', pageId).maybeSingle()
  if (readError) return { ok: false, error: readError.message }
  if (!current) return insert()
  return force ? { ok: false, error: 'No rows affected' } : conflict
}

/**
 * `a` é mais novo que `b`? Compara o instante, não o texto: o realtime e o
 * PostgREST podem formatar o mesmo `updated_at` de jeitos diferentes.
 */
export function isNewer(a: string | null, b: string | null): boolean {
  if (!a) return false
  if (!b) return true
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b
  return ta > tb
}

// ── REL-009: versão da cena do desenho ───────────────────────────────────────

/**
 * Soma do `version` dos elementos, a mesma conta do `getSceneVersion` do
 * Excalidraw: cada edição incrementa o `version` do elemento (apagar também,
 * via `isDeleted`). O `onChange` do Excalidraw dispara ao montar, em pan/zoom e
 * depois de cada `updateScene`, sempre com um array novo; comparar a versão, e
 * não a referência, é o que separa edição de eco.
 */
export function sceneVersion(elements: readonly { version: number }[]): number {
  return elements.reduce((sum, el) => sum + el.version, 0)
}
