import { describe, expect, it } from 'vitest'
import {
  blockedCardIds,
  effortRank,
  emptyQueueFilter,
  externalIdFromTitle,
  formatCardMarkdown,
  formatQueueLines,
  previewQueueOrder,
  queueBadges,
  type ApiCard,
  type CardQueueItem,
} from './cardQueue'
import type { ProjectCard } from '../types'

function makeCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: '1',
    board_id: 'b1',
    column_id: 'col-sec',
    title: 'SEC-001 — Card',
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
    created_at: '2026-09-25T00:00:00Z',
    updated_at: '2026-09-25T00:00:00Z',
    ...overrides,
  }
}

const COLUMNS = [
  { id: 'col-todo', sort_order: 0 },
  { id: 'col-sec', sort_order: 3 },
  { id: 'col-perf', sort_order: 4 },
]

describe('externalIdFromTitle', () => {
  it('extracts the backlog ID from the card title', () => {
    expect(externalIdFromTitle('SEC-002 — Shares permitem re-apontar')).toBe('SEC-002')
    expect(externalIdFromTitle('PERF-010 - Comprimir imagens')).toBe('PERF-010')
  })

  it('returns null for titles without a backlog ID', () => {
    expect(externalIdFromTitle('Revisar layout')).toBeNull()
    expect(externalIdFromTitle('SEC-0012 — longo demais')).toBeNull()
  })
})

describe('previewQueueOrder', () => {
  const cards = [
    makeCard({ id: 'perf-low', column_id: 'col-perf', priority: 'low', labels: ['performance'] }),
    makeCard({ id: 'sec-p2', column_id: 'col-sec', priority: 'medium', sort_order: 1, labels: ['segurança'] }),
    makeCard({ id: 'sec-p0', column_id: 'col-sec', priority: 'urgent', sort_order: 5, labels: ['segurança', 'rls'] }),
    makeCard({ id: 'perf-p0', column_id: 'col-perf', priority: 'urgent', labels: ['performance'] }),
    makeCard({ id: 'sec-done', column_id: 'col-sec', priority: 'urgent', completed: true }),
  ]

  it('returns nothing for an empty filter', () => {
    expect(previewQueueOrder(cards, COLUMNS, emptyQueueFilter(), new Set())).toEqual([])
  })

  it('orders by priority, then column, then card position', () => {
    const filter = { ...emptyQueueFilter(), columnIds: ['col-sec', 'col-perf'] }
    const ids = previewQueueOrder(cards, COLUMNS, filter, new Set()).map(c => c.id)
    expect(ids).toEqual(['sec-p0', 'perf-p0', 'sec-p2', 'perf-low'])
  })

  it('combines filters with AND and skips completed or already queued cards', () => {
    const filter = { ...emptyQueueFilter(), columnIds: ['col-sec'], priorities: ['urgent' as const, 'medium' as const] }
    const ids = previewQueueOrder(cards, COLUMNS, filter, new Set(['sec-p2'])).map(c => c.id)
    expect(ids).toEqual(['sec-p0'])
  })

  it('adds explicit cards (OR) to the filtered ones', () => {
    const filter = { ...emptyQueueFilter(), cardIds: ['perf-low'], priorities: ['urgent' as const] }
    const ids = previewQueueOrder(cards, COLUMNS, filter, new Set()).map(c => c.id)
    expect(ids).toEqual(['sec-p0', 'perf-p0', 'perf-low'])
  })

  it('matches any of the given labels', () => {
    const filter = { ...emptyQueueFilter(), labels: ['rls'] }
    expect(previewQueueOrder(cards, COLUMNS, filter, new Set()).map(c => c.id)).toEqual(['sec-p0'])
  })
})

describe('fila priorizada', () => {
  it('effortRank: S antes de M, M antes de L; sem label conta como M', () => {
    expect(effortRank(['segurança', 'esforço:s'])).toBe(0)
    expect(effortRank(['esforço:m'])).toBe(1)
    expect(effortRank([])).toBe(1)
    expect(effortRank(null)).toBe(1)
    expect(effortRank(['esforço:l'])).toBe(2)
  })

  it('dentro da mesma prioridade, esforço decide antes da coluna', () => {
    const cards = [
      makeCard({ id: 'sec-m', column_id: 'col-sec', priority: 'medium', labels: ['esforço:m'] }),
      makeCard({ id: 'perf-s', column_id: 'col-perf', priority: 'medium', labels: ['esforço:s'] }),
      makeCard({ id: 'sec-l', column_id: 'col-sec', priority: 'medium', labels: ['esforço:l'] }),
      makeCard({ id: 'perf-urgent-l', column_id: 'col-perf', priority: 'urgent', labels: ['esforço:l'] }),
    ]
    const filter = { ...emptyQueueFilter(), priorities: ['urgent' as const, 'medium' as const] }
    expect(previewQueueOrder(cards, COLUMNS, filter, new Set()).map(c => c.id))
      .toEqual(['perf-urgent-l', 'perf-s', 'sec-m', 'sec-l'])
  })

  it('bloqueado não volta por filtro, só escolhido por id', () => {
    const cards = [
      makeCard({ id: 'a', priority: 'medium' }),
      makeCard({ id: 'b', priority: 'medium', sort_order: 1 }),
    ]
    const byPriority = { ...emptyQueueFilter(), priorities: ['medium' as const] }
    expect(previewQueueOrder(cards, COLUMNS, byPriority, new Set(), new Set(['b'])).map(c => c.id)).toEqual(['a'])
    const byId = { ...byPriority, cardIds: ['b'] }
    expect(previewQueueOrder(cards, COLUMNS, byId, new Set(), new Set(['b'])).map(c => c.id)).toEqual(['a', 'b'])
  })

  it('blockedCardIds considera só a passagem mais recente de cada card', () => {
    const blocked = blockedCardIds([
      { card_id: 'a', status: 'blocked', created_at: '2026-09-25T10:00:00Z' },
      { card_id: 'b', status: 'blocked', created_at: '2026-09-25T10:00:00Z' },
      { card_id: 'b', status: 'queued', created_at: '2026-09-25T11:00:00Z' },
      { card_id: 'c', status: 'done', created_at: '2026-09-25T10:00:00Z' },
    ])
    expect([...blocked]).toEqual(['a'])
  })
})

describe('queueBadges', () => {
  it('marks the card in progress and ranks the waiting ones by position', () => {
    const badges = queueBadges([
      { id: 'q1', card_id: 'a', position: 7, status: 'queued' },
      { id: 'q2', card_id: 'b', position: 2, status: 'in_progress' },
      { id: 'q3', card_id: 'c', position: 3, status: 'queued' },
      { id: 'q4', card_id: 'd', position: 1, status: 'done' },
    ])
    expect(badges.get('b')).toEqual({ kind: 'working', phase: null })
    expect(badges.get('c')).toEqual({ kind: 'queued', rank: 1 })
    expect(badges.get('a')).toEqual({ kind: 'queued', rank: 2 })
    expect(badges.has('d')).toBe(false)
  })
})

describe('fases do fluxo (Avaliação → Plano → Desenvolvimento)', () => {
  it('o selo do card em andamento carrega a fase', () => {
    const badges = queueBadges([
      { id: 'q1', card_id: 'a', position: 1, status: 'in_progress', phase: 'plano' },
    ])
    expect(badges.get('a')).toEqual({ kind: 'working', phase: 'plano' })
  })

  it('a listagem e o card mostram a fase só quando o card está em andamento', () => {
    const base: Omit<CardQueueItem, 'id' | 'card_id' | 'status' | 'position' | 'title'> = {
      source: 'api', created_at: '', started_at: null, finished_at: null, note: null,
      external_id: null, priority: 'high', column: 'Fazendo', labels: [],
    }
    const [working, waiting] = formatQueueLines([
      { ...base, id: 'q1', card_id: 'a', status: 'in_progress', position: 1, title: 'REL-001 — A', phase: 'avaliacao' },
      { ...base, id: 'q2', card_id: 'b', status: 'queued', position: 2, title: 'SEC-004 — B', phase: null },
    ])
    expect(working).toContain('· avaliação')
    expect(waiting).not.toContain('·  ')

    const md = formatCardMarkdown({
      id: 'u1', board_id: 'b1', external_id: 'REL-001', title: 'REL-001 — Backup', column_id: 'c', column: 'Fazendo',
      priority: 'urgent', labels: [], completed: false, description: '', checklist: [],
      queue: { id: 'q1', status: 'in_progress', phase: 'plano', position: 1, started_at: null, finished_at: null, note: null },
    })
    expect(md).toContain('fase: plano (aguardando aprovação)')
  })
})

describe('CLI formatting', () => {
  const apiCard: ApiCard = {
    id: 'uuid-1',
    board_id: 'b1',
    external_id: 'SEC-002',
    title: 'SEC-002 — Shares re-apontáveis',
    column_id: 'col-doing',
    column: 'Fazendo',
    priority: 'high',
    labels: ['segurança', 'rls'],
    completed: false,
    description: '**Problema:** shares podem ser re-apontadas.',
    checklist: [
      { id: 'i1', text: 'Revogar UPDATE', completed: true },
      { id: 'i2', text: 'Trigger BEFORE UPDATE', completed: false },
    ],
    queue: { id: 'q1', status: 'in_progress', position: 1, started_at: '2026-09-25T10:00:00Z', finished_at: null, note: null },
  }

  it('renders a card as Markdown with numbered subtasks', () => {
    const md = formatCardMarkdown(apiCard)
    expect(md).toContain('# SEC-002 — Shares re-apontáveis')
    expect(md).toContain('**Prioridade:** P1 (high)')
    expect(md).toContain('**Fila:** em andamento desde 2026-09-25T10:00:00Z')
    expect(md).toContain('1. [x] Revogar UPDATE')
    expect(md).toContain('2. [ ] Trigger BEFORE UPDATE')
  })

  it('numbers only the waiting items in the queue listing', () => {
    const base: Omit<CardQueueItem, 'id' | 'card_id' | 'status' | 'position' | 'title'> = {
      source: 'api', created_at: '', started_at: null, finished_at: null, note: null,
      external_id: null, priority: 'urgent', column: 'Segurança', labels: [],
    }
    const lines = formatQueueLines([
      { ...base, id: 'q1', card_id: 'a', status: 'in_progress', position: 1, title: 'SEC-001 — A' },
      { ...base, id: 'q2', card_id: 'b', status: 'queued', position: 2, title: 'SEC-002 — B' },
      { ...base, id: 'q3', card_id: 'c', status: 'blocked', position: 3, title: 'SEC-003 — C', note: 'precisa de deploy\nmais' },
    ])
    expect(lines[0]).toMatch(/^▶\s+em andamento/)
    expect(lines[1]).toMatch(/^#1\s+na fila/)
    expect(lines[2]).toContain('aguardando você')
    expect(lines[2]).toContain('— precisa de deploy')
    expect(lines[2]).not.toContain('mais')
  })

  it('reports an empty queue', () => {
    expect(formatQueueLines([])).toEqual(['Fila vazia.'])
  })
})

describe('fluxo v2 (Validação e Aguardando você)', () => {
  const base: Omit<CardQueueItem, 'id' | 'card_id' | 'status' | 'position' | 'title'> = {
    source: 'api', created_at: '', started_at: null, finished_at: null, note: null,
    external_id: null, priority: 'medium', column: 'Validação', labels: [],
  }

  it('selos: validação pendente e aguardando o usuário', () => {
    const badges = queueBadges([
      { id: 'q1', card_id: 'a', position: 0, status: 'review' },
      { id: 'q2', card_id: 'b', position: 0, status: 'blocked' },
      { id: 'q3', card_id: 'c', position: 4, status: 'queued' },
    ])
    expect(badges.get('a')).toEqual({ kind: 'review' })
    expect(badges.get('b')).toEqual({ kind: 'waiting' })
    expect(badges.get('c')).toEqual({ kind: 'queued', rank: 1 })
  })

  it('listagem: em validação com a nota e aguardando você com os itens pendentes', () => {
    const [review, waiting] = formatQueueLines([
      { ...base, id: 'q1', card_id: 'a', status: 'review', position: 0, title: 'SEC-006 — A', note: 'Pronto: revogar sessões\ndetalhes' },
      { ...base, id: 'q2', card_id: 'b', status: 'blocked', position: 0, title: 'SEC-001 — B', column: 'Aguardando você', user_pending: 2 },
    ])
    expect(review).toMatch(/^·\s+em validação/)
    expect(review).toContain('— Pronto: revogar sessões')
    expect(review).not.toContain('detalhes')
    expect(waiting).toContain('aguardando você')
    expect(waiting).toContain('· 2 item(ns) seu(s)')
  })

  it('card: marca os itens do usuário e a fase de plano aprovado', () => {
    const md = formatCardMarkdown({
      id: 'u1', board_id: 'b1', external_id: 'SEC-006', title: 'SEC-006 — Sessões', column_id: 'c', column: 'Plano',
      priority: 'medium', labels: [], completed: false, description: '',
      checklist: [
        { id: 'i1', text: 'Corrigir o revoke', completed: true },
        { id: 'i2', text: 'Trocar a senha', completed: false, owner: 'user' },
      ],
      queue: { id: 'q1', status: 'in_progress', phase: 'aprovado', position: 1, started_at: null, finished_at: null, note: null },
    })
    expect(md).toContain('fase: plano aprovado')
    expect(md).toContain('1. [x] Corrigir o revoke\n')
    expect(md).toContain('2. [ ] Trocar a senha _(você)_')
  })
})
