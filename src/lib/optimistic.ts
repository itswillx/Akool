import type { TranslationKey } from '../i18n/translations'

// Encanamento compartilhado das mutacoes otimistas (REL-002).
//
// supabase-js NUNCA lanca em falha de statement: todo builder resolve para
// { data, error }. Um `await supabase.from(...).update(...)` com resultado
// descartado perde a falha em silencio — foi assim que o estado local do study
// e do PagesContext passaram a divergir do banco.
//
// O contrato de rollback aqui NAO e "restaurar o snapshot da colecao inteira".
// Entre o apply otimista e o rollback pode entrar outra mutacao (o autosave do
// StudyCardItem dispara de ~12 pontos) ou um refresh de realtime; restaurar o
// array inteiro desfaria essas edicoes. Todo `revert` abaixo e escopado a UM id
// e SOMENTE aos campos que o write falho tocou, e e guardado para virar no-op
// quando um write mais novo ja pousou.

export type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string

export interface WriteError {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

/** Estruturalmente compativel com PostgrestResponse / PostgrestSingleResponse. */
export interface WriteResult<T = unknown> {
  data?: T | null
  error: WriteError | null
}

export function firstError(results: readonly (WriteResult | undefined)[]): WriteError | null {
  for (const r of results) if (r?.error) return r.error
  return null
}

/**
 * `.update()`/`.delete()` que casa ZERO linhas (RLS) resolve com error: null.
 * Quem anexar `.select('id')` usa isto para transformar "0 linhas escritas" em
 * falha de verdade em vez de sucesso fantasma.
 */
export function requireRows<T>(result: WriteResult<T[]>): WriteResult<T[]> {
  if (result.error) return result
  if (Array.isArray(result.data) && result.data.length === 0) {
    return { data: result.data, error: { message: 'No rows affected', code: 'PGRST_NO_ROWS' } }
  }
  return result
}

function toWriteError(thrown: unknown): WriteError {
  return { message: thrown instanceof Error ? thrown.message : String(thrown) }
}

export interface OptimisticRun {
  /** Muta o estado local imediatamente. */
  apply: () => void
  /** A(s) chamada(s) de persistencia. O builder do supabase e PromiseLike, nao Promise. */
  write: () => PromiseLike<WriteResult | WriteResult[]>
  /** Desfaz — escopado a id + campos, jamais restaurando a colecao inteira. */
  revert: (error: WriteError) => void | Promise<void>
  /** Feedback ao usuario (toast). */
  onError?: (error: WriteError) => void
  /** Prefixo do console.error; mantem a falha grepavel em producao. */
  label?: string
}

/** Aplica, persiste e — so em falha — reverte e reporta. `true` = write gravou. */
export async function runOptimistic(run: OptimisticRun): Promise<boolean> {
  run.apply()
  let error: WriteError | null = null
  try {
    const res = await run.write()
    error = Array.isArray(res) ? firstError(res) : (res?.error ?? null)
  } catch (thrown) {
    // Defensivo: o supabase-js nao lanca, mas um transport custom ou um
    // TypeError sincrono nao pode escapar e pular o rollback.
    error = toWriteError(thrown)
  }
  if (!error) return true
  if (run.label) console.error(`[optimistic] ${run.label}`, error)
  await run.revert(error)
  run.onError?.(error)
  return false
}

export type GuardedResult<T> = { ok: true; data: T | null } | { ok: false; error: WriteError }

/** Variante server-first: sem apply local, so normaliza o erro e reporta. */
export async function runGuarded<T>(
  write: () => PromiseLike<WriteResult<T>>,
  opts: { onError?: (error: WriteError) => void; label?: string } = {},
): Promise<GuardedResult<T>> {
  let error: WriteError | null = null
  let data: T | null = null
  try {
    const res = await write()
    error = res.error ?? null
    data = res.data ?? null
  } catch (thrown) {
    error = toWriteError(thrown)
  }
  if (error) {
    if (opts.label) console.error(`[optimistic] ${opts.label}`, error)
    opts.onError?.(error)
    return { ok: false, error }
  }
  return { ok: true, data }
}

// ── Rollback por id, em lista ────────────────────────────────────────────────

/** true quando a linha ainda contem exatamente os valores que aplicamos. */
export function fieldsUnchanged<T extends object>(current: T, applied: Partial<T>): boolean {
  return (Object.keys(applied) as (keyof T)[]).every(key => current[key] === applied[key])
}

/**
 * Reaplica `fields` na linha `id` — e so nela. `onlyIf` e o guard de corrida:
 * sem ele, um revert atrasado sobrescreveria uma edicao mais nova.
 * Devolve a MESMA referencia quando nada muda (evita re-render a toa).
 */
export function revertFields<T extends { id: string }>(
  list: T[],
  id: string,
  fields: Partial<T>,
  opts?: { onlyIf?: (current: T) => boolean },
): T[] {
  let changed = false
  const next = list.map(item => {
    if (item.id !== id) return item
    if (opts?.onlyIf && !opts.onlyIf(item)) return item
    changed = true
    return { ...item, ...fields }
  })
  return changed ? next : list
}

/** Reinsere uma linha removida na posicao original; no-op se o id ja voltou. */
export function reinsertAt<T extends { id: string }>(list: T[], row: T, index: number): T[] {
  if (list.some(item => item.id === row.id)) return list
  const at = Math.max(0, Math.min(index, list.length))
  return [...list.slice(0, at), row, ...list.slice(at)]
}

/** Copia de `source` so as chaves presentes em `shape` (+ `extra`). O snapshot. */
export function pickFields<T extends object>(
  source: T,
  shape: object,
  extra: readonly (keyof T)[] = [],
): Partial<T> {
  const out: Partial<T> = {}
  for (const key of [...Object.keys(shape), ...extra.map(String)]) {
    if (key in source) out[key as keyof T] = source[key as keyof T]
  }
  return out
}

/** Localiza uma linha dentro de Record<groupId, rows[]> — cardsByTopic/logsByTopic. */
export function findInGroups<T extends { id: string }>(
  groups: Record<string, T[]>,
  id: string,
): { groupId: string; index: number; row: T } | null {
  for (const [groupId, rows] of Object.entries(groups)) {
    const index = rows.findIndex(row => row.id === id)
    if (index !== -1) return { groupId, index, row: rows[index] }
  }
  return null
}

// ── Mensagem ─────────────────────────────────────────────────────────────────

/**
 * Mapeia o erro do Postgrest para uma chave i18n. As duas camadas: quando a
 * causa e reconhecivel o usuario ve o "por que" (rede caiu / sem permissao),
 * senao cai na mensagem especifica da operacao.
 */
export function mapWriteError(error: WriteError, t: TFn, fallbackKey: TranslationKey): string {
  const code = error.code ?? ''
  const message = error.message ?? ''
  if (
    code === '42501' || code === 'PGRST301' || code === 'PGRST_NO_ROWS' ||
    /row-level security|permission denied|not authorized|jwt/i.test(message)
  ) {
    return t('toast_error_permission')
  }
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|aborted/i.test(message)) {
    return t('toast_error_network')
  }
  return t(fallbackKey)
}
