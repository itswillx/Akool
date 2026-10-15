import { describe, expect, it } from 'vitest'
import {
  barsRange, buildLinks, buildTree, cardProgress, daySegments, endOfMonth, flattenTree, isoWeek, linkPath, monthSegments,
  nodeBar, startOfMonth, startOfWeek, weekSegments, yearSegments, type GanttNode,
} from './ganttLayout'
import type { ProjectCard } from '../types'

function makeCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: '1',
    board_id: 'b1',
    column_id: 'c1',
    title: 'Test card',
    description: '',
    priority: 'medium',
    start_date: null,
    due_date: null,
    estimated_days: 1,
    assignee_user_id: null,
    labels: [],
    linked_page_id: null,
    parent_card_id: null,
    depends_on: [],
    completed: false,
    checklist: [],
    attachments: [],
    links: [],
    sort_order: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('buildLinks', () => {
  it('creates a dep link from depends_on', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', depends_on: ['a'] }),
    ]
    expect(buildLinks(cards)).toEqual([{ from: 'a', to: 'b', kind: 'dep' }])
  })

  it('creates a parent link from parent_card_id', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', parent_card_id: 'a' }),
    ]
    expect(buildLinks(cards)).toEqual([{ from: 'a', to: 'b', kind: 'parent' }])
  })

  it('keeps only the dep link when a pair is both parent and dependency', () => {
    const cards = [
      makeCard({ id: 'a' }),
      makeCard({ id: 'b', parent_card_id: 'a', depends_on: ['a'] }),
    ]
    expect(buildLinks(cards)).toEqual([{ from: 'a', to: 'b', kind: 'dep' }])
  })

  it('ignores links whose endpoint is missing from the set', () => {
    const cards = [
      makeCard({ id: 'b', depends_on: ['ghost'], parent_card_id: 'ghost' }),
    ]
    expect(buildLinks(cards)).toEqual([])
  })

  it('ignores self references', () => {
    const cards = [makeCard({ id: 'a', depends_on: ['a'], parent_card_id: 'a' })]
    expect(buildLinks(cards)).toEqual([])
  })
})

function node(card: Partial<ProjectCard>, children: GanttNode[] = []): GanttNode {
  return { card: makeCard(card), children }
}

describe('nodeBar', () => {
  it('extends a parent bar to its own start when earlier than the child', () => {
    const tree = node(
      { id: 'p', start_date: '2026-06-28', due_date: '2026-07-01' },
      [node({ id: 'c', start_date: '2026-07-01', due_date: '2026-08-03' })],
    )
    expect(nodeBar(tree)).toEqual({ start: '2026-06-28', end: '2026-08-03', isMilestone: false, progress: 0 })
  })

  it('rolls up across multiple nesting levels (grandparent -> parent -> child)', () => {
    const tree = node(
      { id: 'g', start_date: '2026-06-27' }, // own milestone, no due
      [node(
        { id: 'p', start_date: '2026-06-28', due_date: '2026-07-01' },
        [node({ id: 'c', start_date: '2026-07-01', due_date: '2026-08-03' })],
      )],
    )
    // grandparent extends to its own 27/06 and covers the deepest end 03/08
    expect(nodeBar(tree)).toEqual({ start: '2026-06-27', end: '2026-08-03', isMilestone: false, progress: 0 })
    // the intermediate parent stays staggered at 28/06
    expect(nodeBar(tree.children[0])).toEqual({ start: '2026-06-28', end: '2026-08-03', isMilestone: false, progress: 0 })
  })

  it('falls back to the children span when the parent has no own dates', () => {
    const tree = node(
      { id: 'p' }, // no start/due
      [
        node({ id: 'a', start_date: '2026-07-01', due_date: '2026-07-05' }),
        node({ id: 'b', start_date: '2026-07-10', due_date: '2026-07-12' }),
      ],
    )
    const bar = nodeBar(tree)
    expect(bar?.start).toBe('2026-07-01')
    expect(bar?.end).toBe('2026-07-12')
  })
})

describe('linkPath', () => {
  it('uses a forward elbow when the successor starts well ahead', () => {
    const d = linkPath({ x1: 0, y1: 10, x2: 100, y2: 40, rowH: 38, gap: 9 })
    expect(d).toBe('M 0 10 H 91 V 40 H 100')
  })

  it('routes around (does not go straight back) when bars overlap', () => {
    const d = linkPath({ x1: 100, y1: 10, x2: 40, y2: 48, rowH: 38, gap: 9 })
    // out to the right of x1, down into the row gutter, then back to x2
    expect(d).toBe('M 100 10 H 109 V 29 H 31 V 48 H 40')
  })

  it('routes upward when the successor sits above the predecessor', () => {
    const d = linkPath({ x1: 100, y1: 48, x2: 40, y2: 10, rowH: 38, gap: 9 })
    expect(d).toBe('M 100 48 H 109 V 29 H 31 V 10 H 40')
  })
})

// Datas, árvore e faixas do cabeçalho da linha do tempo (GanttView).

describe('datas do calendário', () => {
  it('início e fim do mês, inclusive fevereiro de ano bissexto', () => {
    expect(startOfMonth('2026-07-19')).toBe('2026-07-01')
    expect(endOfMonth('2026-07-19')).toBe('2026-07-31')
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2026-12-05')).toBe('2026-12-31')
  })

  it('a semana começa na segunda', () => {
    expect(startOfWeek('2026-07-19')).toBe('2026-07-13') // domingo → segunda anterior
    expect(startOfWeek('2026-07-13')).toBe('2026-07-13')
  })

  it('semana ISO-8601 nas viradas de ano', () => {
    expect(isoWeek('2026-01-01')).toBe(1) // quinta-feira: já é a semana 1
    expect(isoWeek('2021-01-03')).toBe(53) // domingo: ainda na última de 2020
    expect(isoWeek('2024-12-30')).toBe(1) // segunda: já na semana 1 de 2025
    expect(isoWeek('2026-07-15')).toBe(29)
  })
})

describe('cardProgress', () => {
  const item = (completed: boolean) => ({ id: completed ? 'feito' : 'aberto', text: 'x', completed })
  it('feito vale 100; sem checklist, 0; senão a fração arredondada', () => {
    expect(cardProgress(makeCard({ completed: true, checklist: [item(false)] }))).toBe(100)
    expect(cardProgress(makeCard({ checklist: [] }))).toBe(0)
    expect(cardProgress(makeCard({ checklist: null as unknown as [] }))).toBe(0)
    expect(cardProgress(makeCard({ checklist: [item(true), item(false), item(false)] }))).toBe(33)
  })
})

describe('buildTree e flattenTree', () => {
  const cards = [
    makeCard({ id: 'b', sort_order: 2 }),
    makeCard({ id: 'a', sort_order: 1 }),
    makeCard({ id: 'a2', parent_card_id: 'a', sort_order: 2 }),
    makeCard({ id: 'a1', parent_card_id: 'a', sort_order: 1 }),
    makeCard({ id: 'a1x', parent_card_id: 'a1' }),
    makeCard({ id: 'orphan', parent_card_id: 'ghost', sort_order: 3 }),
  ]

  it('monta a floresta por sort_order; filho de pai ausente vira raiz', () => {
    const tree = buildTree(cards)
    expect(tree.map(n => n.card.id)).toEqual(['a', 'b', 'orphan'])
    expect(tree[0].children.map(n => n.card.id)).toEqual(['a1', 'a2'])
    expect(tree[0].children[0].children.map(n => n.card.id)).toEqual(['a1x'])
  })

  it('achata com a profundidade e esconde os descendentes do recolhido', () => {
    const tree = buildTree(cards)
    expect(flattenTree(tree, new Set()).map(r => `${r.card.id}:${r.depth}`)).toEqual(['a:0', 'a1:1', 'a1x:2', 'a2:1', 'b:0', 'orphan:0'])
    const folded = flattenTree(tree, new Set(['a1']))
    expect(folded.map(r => r.card.id)).toEqual(['a', 'a1', 'a2', 'b', 'orphan'])
    expect(folded.find(r => r.card.id === 'a1')).toMatchObject({ hasChildren: true, collapsed: true })
    expect(folded.find(r => r.card.id === 'b')).toMatchObject({ hasChildren: false, collapsed: false })
  })
})

describe('nodeBar (folhas e progresso)', () => {
  it('só prazo ou só início vira marco; datas invertidas se ajeitam; sem datas não tem barra', () => {
    expect(nodeBar(node({ due_date: '2026-07-10' }))).toEqual({ start: '2026-07-10', end: '2026-07-10', isMilestone: true, progress: 0 })
    expect(nodeBar(node({ start_date: '2026-07-03', completed: true }))).toEqual({ start: '2026-07-03', end: '2026-07-03', isMilestone: true, progress: 100 })
    expect(nodeBar(node({ start_date: '2026-07-20', due_date: '2026-07-10' }))).toMatchObject({ start: '2026-07-10', end: '2026-07-20', isMilestone: false })
    expect(nodeBar(node({}))).toBeNull()
  })

  it('pai com filhos sem datas fica com a própria barra', () => {
    const tree = node({ id: 'p', start_date: '2026-07-01', due_date: '2026-07-02' }, [node({ id: 'c' })])
    expect(nodeBar(tree)).toEqual({ start: '2026-07-01', end: '2026-07-02', isMilestone: false, progress: 0 })
  })

  it('o progresso do pai pesa a duração de cada filho', () => {
    const tree = node({ id: 'p' }, [
      node({ id: 'long', start_date: '2026-07-01', due_date: '2026-07-09', completed: true }), // 9 dias, 100%
      node({ id: 'short', start_date: '2026-07-10', due_date: '2026-07-10' }), // 1 dia, 0%
    ])
    expect(nodeBar(tree)?.progress).toBe(90)
  })
})

describe('barsRange', () => {
  it('vazio dá null; senão o menor início e o maior fim', () => {
    expect(barsRange([])).toBeNull()
    expect(barsRange([
      { start: '2026-07-05', end: '2026-07-06', isMilestone: false, progress: 0 },
      { start: '2026-07-01', end: '2026-07-02', isMilestone: false, progress: 0 },
      { start: '2026-07-03', end: '2026-08-01', isMilestone: false, progress: 0 },
    ])).toEqual({ start: '2026-07-01', end: '2026-08-01' })
  })
})

describe('faixas do cabeçalho', () => {
  // Só início (offset), chave e data: o `days` de meses, anos e semanas sai
  // errado hoje (pega o maior fim em vez do menor) e fica para um conserto à parte.
  const starts = (segs: { offset: number; key: string; date: string }[]) => segs.map(s => [s.offset, s.key, s.date])

  it('meses: o primeiro começa no início da faixa, os outros no dia 1', () => {
    expect(starts(monthSegments('2026-01-20', '2026-03-05'))).toEqual([
      [0, '2026-01-01', '2026-01-01'],
      [12, '2026-02-01', '2026-02-01'],
      [40, '2026-03-01', '2026-03-01'],
    ])
  })

  it('anos: o primeiro começa no início da faixa, os outros em 1º de janeiro', () => {
    expect(starts(yearSegments('2025-12-30', '2027-01-02'))).toEqual([
      [0, '2025', '2025-12-30'],
      [2, '2026', '2026-01-01'],
      [367, '2027', '2027-01-01'],
    ])
  })

  it('semanas: chave na segunda; a primeira começa no início da faixa', () => {
    expect(starts(weekSegments('2026-07-15', '2026-07-28'))).toEqual([
      [0, '2026-07-13', '2026-07-13'],
      [5, '2026-07-20', '2026-07-20'],
      [12, '2026-07-27', '2026-07-27'],
    ])
  })

  it('dias: um por data, inclusive nas duas pontas', () => {
    expect(daySegments('2026-02-27', '2026-03-01').map(s => [s.offset, s.date])).toEqual([[0, '2026-02-27'], [1, '2026-02-28'], [2, '2026-03-01']])
    expect(daySegments('2026-03-01', '2026-02-27')).toEqual([])
  })
})
