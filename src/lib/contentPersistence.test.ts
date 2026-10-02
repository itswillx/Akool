import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyLoad, createDebouncedSaver, isNewer, saveVersionedContent, sceneVersion, type SaveResult } from './contentPersistence'

describe('classifyLoad (REL-002)', () => {
  it('linha existente → ok', () => {
    expect(classifyLoad({ data: { content: [1] }, error: null })).toEqual({ kind: 'ok', data: { content: [1] } })
  })

  it('sem linha (página nova) → empty', () => {
    expect(classifyLoad({ data: null, error: null })).toEqual({ kind: 'empty' })
    expect(classifyLoad({ data: null, error: { code: 'PGRST116', message: 'no rows' } })).toEqual({ kind: 'empty' })
  })

  it('falha de leitura → error (o editor não pode montar vazio)', () => {
    expect(classifyLoad({ data: null, error: { message: 'Failed to fetch' } })).toEqual({ kind: 'error', message: 'Failed to fetch' })
  })
})

describe('createDebouncedSaver (REL-002)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function setup(results: Array<SaveResult | Error> = []) {
    const saved: string[] = []
    const statuses: string[] = []
    const onSaved = vi.fn()
    const save = vi.fn(async (value: string) => {
      const next = results.shift() ?? { ok: true as const, at: `t-${value}` }
      if (next instanceof Error) throw next
      if (next.ok) saved.push(value)
      return next
    })
    const saver = createDebouncedSaver<string>({ delayMs: 1000, save, onStatus: s => statuses.push(s), onSaved })
    return { saver, save, saved, statuses, onSaved }
  }

  it('várias edições viram um save só, com o último valor', async () => {
    const { saver, save, saved } = setup()
    saver.schedule('a')
    saver.schedule('ab')
    saver.schedule('abc')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saved).toEqual(['abc'])
    expect(saver.status).toBe('saved')
  })

  it('save com erro: fica "não salvo", guarda o valor e o retry salva', async () => {
    const { saver, saved, onSaved } = setup([{ ok: false, error: 'network' }])
    saver.schedule('texto')
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('error')
    expect(onSaved).not.toHaveBeenCalled()
    expect(saved).toEqual([])

    await saver.flush()
    expect(saved).toEqual(['texto'])
    expect(saver.status).toBe('saved')
    expect(onSaved).toHaveBeenCalledWith('t-texto', false)
  })

  it('exceção no save é tratada como erro, sem perder o valor', async () => {
    const { saver, saved } = setup([new Error('boom')])
    saver.schedule('x')
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('error')
    await saver.flush()
    expect(saved).toEqual(['x'])
  })

  it('troca rápida de página: o flush do unmount salva na hora, antes do debounce', async () => {
    const { saver, save, saved } = setup()
    saver.schedule('rascunho')
    await vi.advanceTimersByTimeAsync(300)
    await saver.flush()
    expect(saved).toEqual(['rascunho'])
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('edição durante um save em andamento é salva em seguida e avisa que ainda está sujo', async () => {
    let release!: () => void
    const saved: string[] = []
    const onSaved = vi.fn()
    const saver = createDebouncedSaver<string>({
      delayMs: 1000,
      onSaved,
      save: async value => {
        if (saved.length === 0) await new Promise<void>(r => { release = r })
        saved.push(value)
        return { ok: true, at: `t-${value}` }
      },
    })
    saver.schedule('v1')
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('saving')
    saver.schedule('v2')
    await vi.advanceTimersByTimeAsync(1000)
    release()
    await vi.advanceTimersByTimeAsync(0)
    await saver.flush()
    expect(saved).toEqual(['v1', 'v2'])
    expect(onSaved).toHaveBeenNthCalledWith(1, 't-v1', true)
    expect(onSaved).toHaveBeenLastCalledWith('t-v2', false)
    expect(saver.status).toBe('saved')
  })

  it('flush sem nada pendente não chama o save', async () => {
    const { saver, save } = setup()
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
    expect(saver.status).toBe('idle')
  })
})

describe('createDebouncedSaver: conflito de edição (REL-009)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function setup(results: SaveResult[]) {
    const saved: string[] = []
    const save = vi.fn(async (value: string) => {
      const next = results.shift() ?? { ok: true as const, at: `t-${value}` }
      if (next.ok) saved.push(value)
      return next
    })
    return { saver: createDebouncedSaver<string>({ delayMs: 1000, save }), save, saved }
  }

  it('para em conflict, guarda a edição e não tenta de novo sozinho', async () => {
    const { saver, save, saved } = setup([{ ok: false, conflict: true, error: 'conflict' }])
    saver.schedule('minha')
    await vi.advanceTimersByTimeAsync(1000)
    expect(saver.status).toBe('conflict')

    saver.schedule('minha, editada de novo')
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saver.status).toBe('conflict')

    // "Manter a minha": o flush grava a edição mais nova.
    await saver.flush()
    expect(saved).toEqual(['minha, editada de novo'])
    expect(saver.status).toBe('saved')
  })

  it('passa a versão ao save, avança a cada save e aceita a versão remota', async () => {
    const seen: (string | null)[] = []
    const saver = createDebouncedSaver<string>({
      delayMs: 1000,
      version: 'v1',
      save: async (_value, { version }) => { seen.push(version); return { ok: true, at: `v${seen.length + 1}` } },
    })
    saver.schedule('a')
    await vi.advanceTimersByTimeAsync(1000)
    saver.schedule('b')
    await vi.advanceTimersByTimeAsync(1000)
    saver.setVersion('remota')
    saver.schedule('c')
    await vi.advanceTimersByTimeAsync(1000)
    expect(seen).toEqual(['v1', 'v2', 'remota'])
  })

  it('discard ("carregar a versão salva") faz o flush do unmount não gravar nada', async () => {
    const { saver, save } = setup([{ ok: false, conflict: true, error: 'conflict' }])
    saver.schedule('minha')
    await vi.advanceTimersByTimeAsync(1000)
    saver.discard()
    await saver.flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(saver.status).toBe('idle')
  })
})

// Cliente falso: cada cadeia termina num resultado conforme a operação
// (update, insert ou a leitura da versão atual) e registra os filtros.
function fakeClient(script: {
  update?: { data: unknown; error: { message: string; code?: string } | null }
  insert?: { data: unknown; error: { message: string; code?: string } | null }
  read?: { data: unknown; error: { message: string; code?: string } | null }
}) {
  const calls: string[] = []
  const client = {
    from(table: string) {
      let op = 'read'
      const filters: string[] = []
      const b = {
        insert: () => { op = 'insert'; return b },
        update: () => { op = 'update'; return b },
        select: () => b,
        single: () => b,
        maybeSingle: () => b,
        eq: (column: string, value: string) => { filters.push(`${column}=${value}`); return b },
        // Genérico: o `then` do VersionedThenable (QA-005) tipa o valor pelo resultado.
        then: <T,>(resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) => {
          calls.push(`${op} ${table} ${filters.join('&')}`.trim())
          const result = script[op as 'update' | 'insert' | 'read'] ?? { data: null, error: null }
          return Promise.resolve(result as T).then(resolve, reject)
        },
      }
      return b
    },
  }
  return { client, calls }
}

describe('saveVersionedContent (REL-009)', () => {
  const base = { table: 'note_contents' as const, pageId: 'p1', values: { content: [] } }

  it('grava só sobre a versão conhecida e devolve a nova', async () => {
    const { client, calls } = fakeClient({ update: { data: [{ updated_at: 'v2' }], error: null } })
    expect(await saveVersionedContent(client, { ...base, expected: 'v1' })).toEqual({ ok: true, at: 'v2' })
    expect(calls).toEqual(['update note_contents page_id=p1&updated_at=v1'])
  })

  it('zero linhas com a linha existindo = alguém salvou antes (conflito)', async () => {
    const { client } = fakeClient({ update: { data: [], error: null }, read: { data: { updated_at: 'v9' }, error: null } })
    expect(await saveVersionedContent(client, { ...base, expected: 'v1' })).toEqual({ ok: false, conflict: true, error: 'conflict' })
  })

  it('zero linhas sem a linha = cria', async () => {
    const { client, calls } = fakeClient({
      update: { data: [], error: null }, read: { data: null, error: null }, insert: { data: { updated_at: 'v1' }, error: null },
    })
    expect(await saveVersionedContent(client, { ...base, expected: 'v0' })).toEqual({ ok: true, at: 'v1' })
    expect(calls.at(-1)).toBe('insert note_contents')
  })

  it('página nova: insert; se outra pessoa criou antes (23505), é conflito', async () => {
    const ok = fakeClient({ insert: { data: { updated_at: 'v1' }, error: null } })
    expect(await saveVersionedContent(ok.client, { ...base, expected: null })).toEqual({ ok: true, at: 'v1' })
    const taken = fakeClient({ insert: { data: null, error: { message: 'duplicate', code: '23505' } } })
    expect(await saveVersionedContent(taken.client, { ...base, expected: null })).toEqual({ ok: false, conflict: true, error: 'conflict' })
  })

  it('force ("manter a minha") grava sem a condição de versão', async () => {
    const { client, calls } = fakeClient({ update: { data: [{ updated_at: 'v3' }], error: null } })
    expect(await saveVersionedContent(client, { ...base, expected: 'v1', force: true })).toEqual({ ok: true, at: 'v3' })
    expect(calls).toEqual(['update note_contents page_id=p1'])
  })

  it('force com zero linhas e a linha existindo é recusa (RLS), não conflito', async () => {
    const { client } = fakeClient({ update: { data: [], error: null }, read: { data: { updated_at: 'v9' }, error: null } })
    expect(await saveVersionedContent(client, { ...base, expected: 'v1', force: true })).toEqual({ ok: false, error: 'No rows affected' })
  })

  it('erro do banco volta como erro', async () => {
    const { client } = fakeClient({ update: { data: null, error: { message: 'Failed to fetch' } } })
    expect(await saveVersionedContent(client, { ...base, expected: 'v1' })).toEqual({ ok: false, error: 'Failed to fetch' })
  })
})

describe('isNewer (REL-009)', () => {
  it('compara o instante, não o texto', () => {
    expect(isNewer('2026-09-28T18:55:57.061699+00:00', '2026-09-28T18:55:56.000000+00:00')).toBe(true)
    expect(isNewer('2026-09-28T15:55:57-03:00', '2026-09-28T18:55:57.500+00:00')).toBe(false)
    expect(isNewer('2026-09-28T18:00:00Z', null)).toBe(true)
    expect(isNewer(null, '2026-09-28T18:00:00Z')).toBe(false)
  })
})

describe('sceneVersion (REL-009)', () => {
  const a = { id: 'a', version: 3 }
  const b = { id: 'b', version: 5 }

  it('os mesmos elementos em arrays diferentes têm a mesma versão (carga, pan/zoom, eco do realtime)', () => {
    expect(sceneVersion([a, b])).toBe(sceneVersion([{ ...a }, { ...b }]))
  })

  it('editar um elemento (version incrementado) muda a versão', () => {
    expect(sceneVersion([{ ...a, version: 4 }, b])).not.toBe(sceneVersion([a, b]))
  })

  it('apagar um elemento também incrementa o version dele, então muda a versão', () => {
    const deleted = { ...b, version: 6, isDeleted: true }
    expect(sceneVersion([a, deleted])).toBe(sceneVersion([a, b]) + 1)
  })

  it('cena vazia é 0', () => {
    expect(sceneVersion([])).toBe(0)
  })
})

// REL-012: sem conexão (ou com a rede caindo no meio), o pendente vai para o
// rascunho local e o status é `offline`; a volta da conexão envia e limpa.
import { chooseInitialContent } from './contentPersistence'

describe('createDebouncedSaver: sem conexão (REL-012)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function offlineSetup(results: SaveResult[], online: { value: boolean }) {
    const persist = vi.fn(async () => {})
    const clear = vi.fn(async () => {})
    const statuses: string[] = []
    const save = vi.fn(async () => results.shift() ?? { ok: true as const, at: 'v1' })
    const saver = createDebouncedSaver<string>({
      delayMs: 100, save, version: 'v0', onStatus: s => statuses.push(s),
      draft: { persist, clear }, offline: () => !online.value,
    })
    return { saver, save, persist, clear, statuses }
  }

  it('sem conexão não chama o save: guarda o rascunho com a versão e fica em offline; a volta envia e limpa', async () => {
    const online = { value: false }
    const o = offlineSetup([], online)
    o.saver.schedule('a')
    await vi.advanceTimersByTimeAsync(100)
    expect(o.save).not.toHaveBeenCalled()
    expect(o.persist).toHaveBeenCalledWith('a', 'v0')
    expect(o.statuses).toEqual(['dirty', 'offline'])

    online.value = true
    await o.saver.flush()
    expect(o.save).toHaveBeenCalledWith('a', { force: false, version: 'v0' })
    expect(o.clear).toHaveBeenCalledTimes(1)
    expect(o.statuses.at(-1)).toBe('saved')
  })

  it('erro de rede com a conexão "ligada" também vira offline com rascunho; outro erro fica em error', async () => {
    const o = offlineSetup([{ ok: false, error: 'TypeError: Failed to fetch' }, { ok: false, error: 'permission denied' }], { value: true })
    o.saver.schedule('a')
    await vi.advanceTimersByTimeAsync(100)
    expect(o.statuses.at(-1)).toBe('offline')
    expect(o.persist).toHaveBeenCalledTimes(1)
    await o.saver.flush()
    expect(o.statuses.at(-1)).toBe('error')
    expect(o.persist).toHaveBeenCalledTimes(1)
    expect(o.clear).not.toHaveBeenCalled()
  })

  it('discard ("carregar a versão salva") apaga o rascunho', () => {
    const o = offlineSetup([], { value: false })
    o.saver.schedule('a')
    o.saver.discard()
    expect(o.clear).toHaveBeenCalledTimes(1)
    expect(o.statuses.at(-1)).toBe('idle')
  })
})

describe('chooseInitialContent (REL-012)', () => {
  it('sem rascunho abre o remoto; com rascunho abre o rascunho e a versão sobre a qual ele foi feito', () => {
    expect(chooseInitialContent({ value: 'remoto', version: 'v2' }, null)).toEqual({ value: 'remoto', version: 'v2', fromDraft: false })
    expect(chooseInitialContent({ value: 'remoto', version: 'v2' }, { value: 'meu', version: 'v1' })).toEqual({ value: 'meu', version: 'v1', fromDraft: true })
    expect(chooseInitialContent({ value: [], version: null }, { value: ['novo'], version: null })).toEqual({ value: ['novo'], version: null, fromDraft: true })
  })
})
