import { describe, it, expect } from 'vitest'
import type { Page, ProfileBadge, ProjectBoard, ProjectCard, QuickNote } from '../types'
import {
  DEFAULT_DOCS_FILTERS, boardNodeId, buildDocsGraph, cardNodeId, listIsolated,
  neighborKindCounts, noteNodeId, pageAncestors, pageNodeId, personNodeId,
  quickNoteLabel, rankByDegree, type DocsGraphSource,
} from './docsGraph'

const page = (id: string, title: string, parent: string | null = null): Page => ({
  id, user_id: 'me', title, icon: '📄', type: 'note', parent_id: parent,
  sort_order: 0, is_favorite: false, created_at: '2026-01-01', updated_at: '2026-01-01',
})
const board = (id: string, name: string): ProjectBoard => ({
  id, user_id: 'me', name, icon: '📋', color: '#3b82f6', description: '',
  sort_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01',
})
const card = (id: string, boardId: string, title: string, extra: Partial<ProjectCard> = {}): ProjectCard => ({
  id, board_id: boardId, column_id: 'col1', title, description: '', priority: 'medium',
  start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null, labels: [],
  linked_page_id: null, parent_card_id: null, depends_on: [], completed: false,
  checklist: [], attachments: [], links: [], sort_order: 0,
  created_at: '2026-01-01', updated_at: '2026-01-01', ...extra,
})
const note = (id: string, content: string, linked: QuickNote['linked_items'] = []): QuickNote => ({
  id, user_id: 'me', content, color: 'yellow', linked_items: linked,
  created_at: '2026-01-01', updated_at: '2026-01-01',
})
const profile = (email: string, name: string | null = null): ProfileBadge => ({ email, display_name: name })

// 5 páginas em 2 níveis, 2 quadros, 6 cards, 2 notas, 2 pessoas.
const pages = [
  page('p1', 'Raiz'),
  page('p2', 'Filha A', 'p1'),
  page('p3', 'Filha B', 'p1'),
  page('p4', 'Neta', 'p2'),
  page('p5', 'Órfã'),
]
const boards = [board('b1', 'Produto'), board('b2', 'Casa')]
const cards = [
  card('c1', 'b1', 'Especificar', { linked_page_id: 'p2', assignee_user_id: 'u1' }),
  card('c2', 'b1', 'Implementar', { parent_card_id: 'c1', depends_on: ['c1'] }),
  card('c3', 'b1', 'Revisar', { depends_on: ['c9'] }),           // depends_on inexistente (RLS)
  card('c4', 'b2', 'Pintar', { linked_page_id: 'pX' }),           // página inexistente
  card('c5', 'b2', 'Comprar tinta', { assignee_user_id: 'u2' }),
  card('c6', 'b2', 'Solto', { assignee_user_id: 'me' }),          // usuário logado: sem perfil
]
const notes = [
  note('n1', '\n  Lembrar de revisar\nsegunda linha', [
    { id: 'l1', type: 'page', targetId: 'p2', title: 'Filha A' },
    { id: 'l2', type: 'card', targetId: 'c1', title: 'Especificar' },
  ]),
  note('n2', 'Sem vínculos'),
]
const source: DocsGraphSource = {
  pages, boards, cards, notes,
  columns: [{ id: 'col1', board_id: 'b1', name: 'A fazer' }],
  pageShares: [{ page_id: 'p1', shared_with_user_id: 'u1' }],
  boardShares: [{ board_id: 'b2', shared_with_user_id: 'u2' }],
  // O usuário logado ('me') nunca entra neste mapa — é o contrato do loader.
  profiles: new Map([['u1', profile('ana@x.com', 'Ana')], ['u2', profile('bob@x.com')]]),
}

const build = (over: Partial<typeof DEFAULT_DOCS_FILTERS> = {}) =>
  buildDocsGraph(source, { kinds: DEFAULT_DOCS_FILTERS.kinds, boardId: null, ...over })

describe('quickNoteLabel', () => {
  it('takes the first non-empty line', () => {
    expect(quickNoteLabel('\n  \n Olá mundo \nsegunda')).toBe('Olá mundo')
  })
  it('truncates long lines and handles empty content', () => {
    expect(quickNoteLabel('a'.repeat(60), 10)).toBe(`${'a'.repeat(9)}…`)
    expect(quickNoteLabel('')).toBe('')
    expect(quickNoteLabel('\n \n')).toBe('')
  })
})

describe('buildDocsGraph — nós', () => {
  it('prefixes ids per table', () => {
    const g = build()
    expect(g.nodes.find(n => n.id === pageNodeId('p1'))).toBeDefined()
    expect(g.nodes.find(n => n.id === boardNodeId('b1'))).toBeDefined()
    expect(g.nodes.find(n => n.id === cardNodeId('c1'))).toBeDefined()
    expect(g.nodes.find(n => n.id === noteNodeId('n1'))).toBeDefined()
    expect(g.nodes.find(n => n.id === personNodeId('u1'))).toBeDefined()
  })
  it('never emits the signed-in user as a node', () => {
    const g = build()
    expect(g.nodes.find(n => n.id === personNodeId('me'))).toBeUndefined()
    // ...e a aresta de assignee dele também não existe
    expect(g.edges.some(e => e.source === personNodeId('me') || e.target === personNodeId('me'))).toBe(false)
  })
  it('omits people with no visible profile row', () => {
    const noProfiles = buildDocsGraph({ ...source, profiles: new Map() }, { kinds: DEFAULT_DOCS_FILTERS.kinds, boardId: null })
    expect(noProfiles.nodes.some(n => n.kind === 'person')).toBe(false)
  })
  it('uses the owning board colour for cards and the type colour for pages', () => {
    const g = build()
    expect(g.nodes.find(n => n.id === cardNodeId('c1'))!.color).toBe('#3b82f6')
    expect(g.nodes.find(n => n.id === pageNodeId('p1'))!.color).toBe('#3b82f6')
  })
})

describe('buildDocsGraph — arestas', () => {
  it('collapses parallel relations into one edge carrying every kind', () => {
    const g = build()
    // c1 → p2 é card-page; a nota n1 aponta para os dois, mas isso são arestas
    // n1—p2 e n1—c1, não paralelas. Paralela de verdade: c1—c2 (parent + depends).
    const e = g.edges.find(x => x.id === `${cardNodeId('c1')}|${cardNodeId('c2')}`)!
    expect(e.kinds.sort()).toEqual(['card-depends', 'card-parent'])
    expect(e.weight).toBe(2)
    expect(e.kind).toBe('card-parent') // prioridade fixa define a cor
  })
  it('drops relations pointing at items outside the graph', () => {
    const g = build()
    expect(g.edges.some(e => e.kinds.includes('card-depends') && (e.source === cardNodeId('c3') || e.target === cardNodeId('c3')))).toBe(false)
    expect(g.edges.some(e => e.source === cardNodeId('c4') && e.kinds.includes('card-page'))).toBe(false)
  })
  it('links hierarchy, board→card, note→target, shares and assignees', () => {
    const g = build()
    const has = (a: string, b: string) => g.edges.some(e => e.id === (a < b ? `${a}|${b}` : `${b}|${a}`))
    expect(has(pageNodeId('p1'), pageNodeId('p2'))).toBe(true)
    expect(has(boardNodeId('b1'), cardNodeId('c1'))).toBe(true)
    expect(has(noteNodeId('n1'), pageNodeId('p2'))).toBe(true)
    expect(has(pageNodeId('p1'), personNodeId('u1'))).toBe(true)
    expect(has(boardNodeId('b2'), personNodeId('u2'))).toBe(true)
    expect(has(cardNodeId('c1'), personNodeId('u1'))).toBe(true)
  })
  it('never leaves a dangling endpoint', () => {
    const g = build()
    const ids = new Set(g.nodes.map(n => n.id))
    for (const e of g.edges) {
      expect(ids.has(e.source)).toBe(true)
      expect(ids.has(e.target)).toBe(true)
    }
  })
})

describe('buildDocsGraph — grau e filtros de tipo', () => {
  it('sets value from the distinct-neighbour count', () => {
    const g = build()
    for (const n of g.nodes) expect(n.value).toBe(n.degree)
    // p1: filhas p2 e p3 + share com u1
    expect(g.nodes.find(n => n.id === pageNodeId('p1'))!.degree).toBe(3)
    expect(g.nodes.find(n => n.id === pageNodeId('p5'))!.degree).toBe(0)
  })
  it('recomputes degree when a kind is hidden', () => {
    const g = build({ kinds: { ...DEFAULT_DOCS_FILTERS.kinds, person: false } })
    // p1 perde o share com u1: 3 → 2
    expect(g.nodes.find(n => n.id === pageNodeId('p1'))!.degree).toBe(2)
    expect(g.nodes.some(n => n.kind === 'person')).toBe(false)
  })
  it('filters by board, dropping its cards and members too', () => {
    const g = build({ boardId: 'b1' })
    expect(g.nodes.find(n => n.id === boardNodeId('b2'))).toBeUndefined()
    expect(g.nodes.find(n => n.id === cardNodeId('c5'))).toBeUndefined()
    expect(g.nodes.find(n => n.id === personNodeId('u2'))).toBeUndefined() // só via b2
    expect(g.nodes.find(n => n.id === personNodeId('u1'))).toBeDefined()   // via p1 e c1
  })
})

describe('helpers do painel', () => {
  it('counts neighbours by kind', () => {
    const counts = neighborKindCounts(build(), pageNodeId('p2'))
    expect(counts).toEqual({ page: 2, board: 0, card: 1, note: 1, person: 0 }) // p1, p4, c1, n1
  })
  it('walks page ancestors root-first', () => {
    expect(pageAncestors(pages, 'p4').map(p => p.id)).toEqual(['p1', 'p2'])
    expect(pageAncestors(pages, 'p1')).toEqual([])
  })
  it('survives a parent cycle without hanging', () => {
    const cyclic = [page('x', 'X', 'y'), page('y', 'Y', 'x')]
    expect(pageAncestors(cyclic, 'x').map(p => p.id)).toEqual(['y'])
  })
  it('ranks by degree and lists isolated nodes', () => {
    const g = build()
    const top = rankByDegree(g, 3)
    expect(top[0].degree).toBeGreaterThanOrEqual(top[1].degree)
    expect(top.every(n => n.degree > 0)).toBe(true)
    expect(rankByDegree(g, 5, 'person').every(n => n.kind === 'person')).toBe(true)

    const isolated = listIsolated(g, 10).map(n => n.label)
    expect(isolated).toContain('Órfã')
    expect(isolated).toContain('Sem vínculos')
  })
})
