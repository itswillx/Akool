import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectBoard } from '../types'

// A rede de documentos: quadros, colunas, cards e compartilhamentos em lotes
// de 200 ids (o .in() vai na URL), JSONB nulo vira lista e as pessoas do grafo
// saem dos responsáveis, compartilhamentos e donos de quadro, sem você.

const db = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {}
  return { boards: [] as unknown[], rows, queries: [] as { table: string; columns: string; col: string; ids: string[] }[] }
})

vi.mock('./projectImport', () => ({ fetchAccessibleBoards: async () => db.boards }))
vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        in: (col: string, ids: string[]) => {
          db.queries.push({ table, columns, col, ids })
          const data = (db.rows[table] ?? []).filter(r => ids.includes(String(r[col])))
          return Promise.resolve({ data: data.length ? data : null, error: null })
        },
      }),
    }),
  },
}))

const { fetchDocsGraphData } = await import('./docsGraphData')

const board = (id: string, extra: Partial<ProjectBoard> = {}) => ({ id, user_id: 'me', name: id, is_shared: false, ...extra }) as ProjectBoard

beforeEach(() => {
  db.boards = []
  db.rows = {}
  db.queries = []
})

describe('fetchDocsGraphData', () => {
  it('sem quadros nem páginas não consulta nada', async () => {
    const out = await fetchDocsGraphData('me', [])
    expect(db.queries).toEqual([])
    expect(out).toMatchObject({ boards: [], columns: [], cards: [], pageShares: [], boardShares: [] })
    expect(out.profiles.size).toBe(0)
  })

  it('só páginas: consulta os compartilhamentos delas e os perfis de quem recebeu', async () => {
    db.rows.page_shares = [{ page_id: 'p1', shared_with_user_id: 'ana' }]
    db.rows.profiles = [{ id: 'ana', email: 'ana@example.com' }]
    const out = await fetchDocsGraphData('me', ['p1', 'p2'])
    expect(db.queries.map(q => q.table)).toEqual(['page_shares', 'profiles'])
    expect(db.queries[0]).toMatchObject({ col: 'page_id', ids: ['p1', 'p2'] })
    expect(out.pageShares).toEqual([{ page_id: 'p1', shared_with_user_id: 'ana' }])
    expect(out.profiles.get('ana')).toEqual({ id: 'ana', email: 'ana@example.com' })
  })

  it('mais de 200 quadros: consulta em lotes de 200 e junta os resultados', async () => {
    db.boards = Array.from({ length: 450 }, (_, i) => board(`b${i}`))
    db.rows.project_columns = [{ id: 'col1', board_id: 'b0', name: 'A fazer' }, { id: 'col2', board_id: 'b449', name: 'Feito' }]
    const out = await fetchDocsGraphData('me', [])
    const columnBatches = db.queries.filter(q => q.table === 'project_columns').map(q => q.ids.length)
    expect(columnBatches).toEqual([200, 200, 50])
    expect(db.queries.filter(q => q.table === 'project_cards')).toHaveLength(3)
    expect(db.queries.filter(q => q.table === 'project_shares')).toHaveLength(3)
    expect(out.columns.map(c => c.id)).toEqual(['col1', 'col2'])
    expect(db.queries.some(q => q.table === 'page_shares' || q.table === 'profiles')).toBe(false)
  })

  it('JSONB nulo nos cards vira lista vazia; o que veio preenchido fica', async () => {
    db.boards = [board('b1')]
    db.rows.project_cards = [
      { id: 'c1', board_id: 'b1', labels: null, checklist: null, attachments: null, links: null, depends_on: null },
      { id: 'c2', board_id: 'b1', labels: ['x'], checklist: [{ id: 'i', text: 't', completed: true }], attachments: [], links: [], depends_on: ['c1'] },
    ]
    const out = await fetchDocsGraphData('me', [])
    expect(out.cards[0]).toMatchObject({ labels: [], checklist: [], attachments: [], links: [], depends_on: [] })
    expect(out.cards[1]).toMatchObject({ labels: ['x'], depends_on: ['c1'] })
    expect(out.cards[1].checklist).toHaveLength(1)
  })

  it('pessoas do grafo: responsáveis, compartilhamentos e donos de quadro compartilhado comigo, sem mim', async () => {
    db.boards = [board('mine'), board('theirs', { user_id: 'dono', is_shared: true })]
    db.rows.project_cards = [
      { id: 'c1', board_id: 'mine', assignee_user_id: 'resp' },
      { id: 'c2', board_id: 'mine', assignee_user_id: 'me' },
      { id: 'c3', board_id: 'theirs', assignee_user_id: null },
    ]
    db.rows.project_shares = [{ board_id: 'mine', shared_with_user_id: 'colega' }, { board_id: 'theirs', shared_with_user_id: 'me' }]
    db.rows.page_shares = [{ page_id: 'p1', shared_with_user_id: 'leitora' }]
    db.rows.profiles = ['resp', 'colega', 'leitora', 'dono'].map(id => ({ id, email: `${id}@example.com` }))
    const out = await fetchDocsGraphData('me', ['p1'])
    const asked = db.queries.find(q => q.table === 'profiles')!
    expect([...asked.ids].sort()).toEqual(['colega', 'dono', 'leitora', 'resp'])
    expect(asked.columns).toBe('id, email, display_name, avatar_emoji, avatar_color, avatar_url')
    expect([...out.profiles.keys()].sort()).toEqual(['colega', 'dono', 'leitora', 'resp'])
    expect(out.profiles.has('me')).toBe(false)
    expect(out.boardShares).toHaveLength(2)
  })
})
