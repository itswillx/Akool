// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_KEYS } from '../../lib/localKeys'
import { render, screen, userEvent, waitFor } from '../../test/rtl'
import type { ProjectBoard, ProjectCard, ProjectColumn } from '../../types'

// ARCH-002: o quadro inteiro monta depois da divisão em hooks e arquivos —
// carga (useBoardData), gravações (useBoardActions), arrastar (useBoardDnd),
// visões e o modal de card. Dados falsos; o que importa é nada quebrar.

const board: ProjectBoard = {
  id: 'b1', user_id: 'u1', name: 'Quadro teste', icon: '🚀', color: '#6366f1', description: '', sort_order: 0,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
}
const column = (id: string, name: string, sort: number): ProjectColumn =>
  ({ id, board_id: 'b1', name, color: '#94a3b8', wip_limit: null, sort_order: sort, created_at: '' })
const card = (id: string, title: string, columnId: string): ProjectCard => ({
  id, board_id: 'b1', column_id: columnId, title, description: '', priority: 'medium', start_date: null, due_date: null,
  estimated_days: 1, assignee_user_id: null, labels: [], linked_page_id: null, parent_card_id: null, depends_on: [],
  completed: false, checklist: [], attachments: [], links: [], sort_order: 0, created_at: '', updated_at: '2026-09-01T00:00:00Z',
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    channel: () => ({ on() { return this }, subscribe() { return this } }),
    removeChannel: () => Promise.resolve(),
  },
}))
vi.mock('../../lib/data/projects', async importOriginal => {
  const ok = () => Promise.resolve({ data: null, error: null })
  const stubbed: Record<string, unknown> = {}
  for (const k of Object.keys(await importOriginal<typeof import('../../lib/data/projects')>())) stubbed[k] = ok
  return stubbed
})
vi.mock('./boardLoader', async importOriginal => ({
  ...(await importOriginal<typeof import('./boardLoader')>()),
  fetchBoardData: () => Promise.resolve({
    columns: [column('c1', 'A Fazer', 0), column('c2', 'Fazendo', 1), column('c3', 'Concluído', 2)],
    cards: [card('k1', 'Primeiro card', 'c1'), card('k2', 'Card em andamento', 'c2')],
    queueRows: [],
    members: [],
  }),
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'eu@example.com' } }) }))
vi.mock('../../contexts/PagesContext', () => ({ usePages: () => ({ pages: [], sharedPages: [], setActivePage: () => {} }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

// listOwnBoards precisa devolver o quadro (o mock acima responde vazio a tudo).
const projectsData = await import('../../lib/data/projects')
;(projectsData as { listOwnBoards: unknown }).listOwnBoards = () => Promise.resolve({ data: [board], error: null })

import ProjectsPanel from './ProjectsPanel'

beforeEach(() => { localStorage.clear() })

describe('ProjectsPanel (montagem completa)', () => {
  it('carrega o quadro, troca de visão e abre o card', async () => {
    const user = userEvent.setup()
    render(<ProjectsPanel />)
    expect(await screen.findByRole('group', { name: 'A Fazer' })).toBeTruthy()
    expect(screen.getByText('Primeiro card')).toBeTruthy()

    for (const view of ['list', 'overview', 'compact', 'kanban']) {
      await user.click(screen.getAllByRole('button', { name: `projects_view_${view}` })[0])
      await waitFor(() => expect(localStorage.getItem(LOCAL_KEYS.projectsView)).toBe(view))
    }

    await user.click(screen.getByText('Primeiro card'))
    expect(await screen.findByPlaceholderText('projects_card_title_placeholder')).toHaveProperty('value', 'Primeiro card')
  })
})
