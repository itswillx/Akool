// @vitest-environment happy-dom
// PERF-011: o kanban não pode redesenhar o quadro inteiro a cada render do
// painel. O useLanguage falso conta os renders de Column, SortableCard e
// CardView (os três o chamam uma vez por render).
import { DndContext } from '@dnd-kit/core'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '../../../test/rtl'
import type { ProjectCard, ProjectCardPriority, ProjectColumn } from '../../../types'
import { SortableColumn } from './Column'

const useLanguage = vi.hoisted(() => vi.fn(() => ({ t: (key: string) => key, lang: 'pt-BR' as const })))
vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage }))

afterEach(cleanup)

const column: ProjectColumn = {
  id: 'col-1', board_id: 'b1', name: 'A fazer', color: '#888', sort_order: 0, wip_limit: null, created_at: '', updated_at: '',
} as ProjectColumn

function card(i: number): ProjectCard {
  return {
    id: `card-${i}`, board_id: 'b1', column_id: 'col-1', title: `Card ${i}`, description: '', priority: 'medium',
    start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null, labels: [], linked_page_id: null,
    parent_card_id: null, depends_on: [], completed: false, checklist: [], attachments: [], links: [],
    sort_order: i, created_at: '', updated_at: '',
  }
}

const CARDS = Array.from({ length: 100 }, (_, i) => card(i))
const pLabel = (p: ProjectCardPriority) => p
const stable = { onAddCard: () => {}, onCardClick: () => {}, onRename: () => {}, onDelete: () => {} }

// Painel de mentira: estado próprio (como abrir os filtros) e, opcionalmente,
// handlers recriados a cada render, como o ProjectsPanel passava antes.
function Panel({ unstableHandlers = false }: { unstableHandlers?: boolean }) {
  const [, setTick] = useState(0)
  const [cards, setCards] = useState(CARDS)
  const handlers = unstableHandlers
    ? { onAddCard: () => {}, onCardClick: () => {}, onRename: () => {}, onDelete: () => {} }
    : stable
  return (
    <DndContext>
      <button type="button" onClick={() => setTick(n => n + 1)}>painel</button>
      <button type="button" onClick={() => setCards(prev => prev.map(c => c.id === 'card-5' ? { ...c, title: 'Editado' } : c))}>editar</button>
      <SortableColumn column={column} cards={cards} canEdit priorityLabel={pLabel} {...handlers} />
    </DndContext>
  )
}

describe('kanban com 100 cards (PERF-011)', () => {
  it('estado do painel que não toca os cards não redesenha nenhum card', () => {
    render(<Panel />)
    useLanguage.mockClear()
    fireEvent.click(screen.getByText('painel'))
    expect(useLanguage).toHaveBeenCalledTimes(0)
  })

  it('editar um card redesenha só ele (e a coluna)', () => {
    render(<Panel />)
    useLanguage.mockClear()
    fireEvent.click(screen.getByText('editar'))
    // Column + SortableCard + CardView do card editado.
    expect(useLanguage).toHaveBeenCalledTimes(3)
    expect(screen.getByText('Editado')).toBeTruthy()
  })

  it('referência: com handlers recriados (como o painel passava antes), os 100 cards redesenham', () => {
    render(<Panel unstableHandlers />)
    useLanguage.mockClear()
    fireEvent.click(screen.getByText('painel'))
    // Column (1) + SortableCard de cada card (100); o CardView, com memo, não.
    // Sem nenhum memo, eram 201 (Column + SortableCard e CardView de cada card).
    expect(useLanguage).toHaveBeenCalledTimes(101)
  })
})
