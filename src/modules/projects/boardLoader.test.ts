import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchBoardData, loadLatestBoard, type BoardLoadDeps } from './boardLoader'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Cada fetch fica pendente até o teste resolver, na ordem que quiser.
function harness(initialBoard: string) {
  const screen = { board: initialBoard }
  const sequence = { current: 0 }
  const pending: { board: string; resolve: (v: string) => void; reject: (e: unknown) => void }[] = []
  const applied: string[] = []
  const failed: [string, boolean][] = []
  const loading: boolean[] = []
  const deps: BoardLoadDeps<string> = {
    fetch: board => {
      const d = deferred<string>()
      pending.push({ board, resolve: d.resolve, reject: d.reject })
      return d.promise
    },
    isActive: board => board === screen.board,
    apply: (_board, data) => applied.push(data),
    fail: (board, _error, silent) => failed.push([board, silent]),
    setLoading: value => loading.push(value),
  }
  const load = (board: string, silent = false) => loadLatestBoard(sequence, deps, board, silent)
  return { screen, pending, applied, failed, loading, load }
}

describe('loadLatestBoard (latências invertidas)', () => {
  it('A lento e B rápido: só B é aplicado', async () => {
    const h = harness('A')
    const a = h.load('A')
    h.screen.board = 'B'
    const b = h.load('B')
    h.pending[1].resolve('dados-B')
    await b
    h.pending[0].resolve('dados-A') // chega depois e não sobrescreve
    await a
    expect(h.applied).toEqual(['dados-B'])
    expect(h.loading.at(-1)).toBe(false)
  })

  it('dois pedidos do mesmo quadro: vale o mais novo, em qualquer ordem de chegada', async () => {
    const h = harness('A')
    const older = h.load('A')
    const newer = h.load('A', true)
    h.pending[1].resolve('novo')
    h.pending[0].resolve('velho')
    await Promise.all([older, newer])
    expect(h.applied).toEqual(['novo'])

    const h2 = harness('A')
    const older2 = h2.load('A')
    const newer2 = h2.load('A', true)
    h2.pending[0].resolve('velho')
    await older2
    expect(h2.applied).toEqual([])
    h2.pending[1].resolve('novo')
    await newer2
    expect(h2.applied).toEqual(['novo'])
  })

  it('recarga atrasada do quadro anterior não entra na sequência nem derruba a do atual', async () => {
    const h = harness('B')
    const b = h.load('B')
    const stale = h.load('A', true) // handler que capturou "A" antes de um await
    await stale
    expect(h.pending.map(p => p.board)).toEqual(['B'])
    h.pending[0].resolve('dados-B')
    await b
    expect(h.applied).toEqual(['dados-B'])
  })

  it('troca de quadro durante o pedido: a resposta é descartada', async () => {
    const h = harness('A')
    const a = h.load('A')
    h.screen.board = 'C'
    h.pending[0].resolve('dados-A')
    await a
    expect(h.applied).toEqual([])
  })

  it('erro visível chama fail(…, false) e encerra o loading', async () => {
    const h = harness('A')
    const a = h.load('A')
    h.pending[0].reject(new Error('rede'))
    await a
    expect(h.failed).toEqual([['A', false]])
    expect(h.applied).toEqual([])
    expect(h.loading).toEqual([true, false])
  })

  it('erro silencioso chama fail(…, true) sem ligar o loading', async () => {
    const h = harness('A')
    const a = h.load('A', true)
    h.pending[0].reject(new Error('rede'))
    await a
    expect(h.failed).toEqual([['A', true]])
    expect(h.loading).toEqual([false])
  })

  it('erro de um pedido antigo não aparece', async () => {
    const h = harness('A')
    const older = h.load('A')
    const newer = h.load('A', true)
    h.pending[0].reject(new Error('rede'))
    h.pending[1].resolve('novo')
    await Promise.all([older, newer])
    expect(h.failed).toEqual([])
    expect(h.applied).toEqual(['novo'])
  })

  it('recarga silenciosa que substitui uma visível encerra o loading', async () => {
    const h = harness('A')
    const visible = h.load('A')
    const silent = h.load('A', true)
    h.pending[0].resolve('velho')
    await visible
    expect(h.loading).toEqual([true]) // o antigo não apaga o "carregando"
    h.pending[1].resolve('novo')
    await silent
    expect(h.loading).toEqual([true, false])
  })
})

type Result = { data?: unknown; error?: { message: string } | null }

// Cliente falso: cada `from(tabela)` devolve uma promise encadeável com o
// resultado configurado; guarda os argumentos de `.in()` para conferir.
function fakeClient(results: Record<string, Result>) {
  const inArgs: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      const res = results[table] ?? {}
      const query = Promise.resolve({ data: res.data ?? null, error: res.error ?? null })
      const chain = Object.assign(query, {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        in: (_column: string, values: unknown[]) => { inArgs[table] = values; return chain },
        range: () => chain,
      })
      return chain
    },
  }
  return { client: client as unknown as SupabaseClient, inArgs }
}

const TABLES = ['project_columns', 'project_cards', 'project_card_queue', 'project_shares', 'profiles']

describe('fetchBoardData', () => {
  it('junta as 5 consultas e normaliza os cards', async () => {
    const { client, inArgs } = fakeClient({
      project_columns: { data: [{ id: 'col-1' }] },
      project_cards: { data: [{ id: 'card-1', labels: null, checklist: null, links: null, attachments: null, assignee: [{ email: 'a@x.dev' }] }] },
      project_card_queue: { data: [{ id: 'q-1' }] },
      project_shares: { data: [{ shared_with_user_id: 'u-2' }] },
      profiles: { data: [{ id: 'u-1' }, { id: 'u-2' }] },
    })
    const data = await fetchBoardData(client, 'board-1', ['u-1', null, undefined, 'u-1'])
    expect(data.columns).toEqual([{ id: 'col-1' }])
    expect(data.cards).toEqual([{ id: 'card-1', labels: [], checklist: [], links: [], attachments: [], assignee_profile: { email: 'a@x.dev' } }])
    expect(data.queueRows).toEqual([{ id: 'q-1' }])
    expect(data.members).toEqual([{ id: 'u-1' }, { id: 'u-2' }])
    expect(inArgs.profiles).toEqual(['u-1', 'u-2'])
  })

  it.each(TABLES)('erro em %s é lançado, não vira quadro vazio', async table => {
    const { client } = fakeClient({ [table]: { error: { message: `falhou ${table}` } } })
    await expect(fetchBoardData(client, 'board-1', ['u-1'])).rejects.toThrow(`falhou ${table}`)
  })
})
