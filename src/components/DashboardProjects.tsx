import { useQuery } from '@tanstack/react-query'
import { LOCAL_KEYS } from '../lib/localKeys'
import { localDateKey } from '../lib/localDate'
import { FolderKanban, CalendarClock } from 'lucide-react'
import { loadDashboardProjects, type DashboardBoardRow, type DashboardCardRow } from '../lib/data/dashboard'
import { dashboardKeys } from '../lib/queryClient'
import { usePages } from '../contexts/PagesContext'
import { setDocsSelection } from '../lib/docsNavigation'
import { activateProps } from '../lib/a11y'
import { useLanguage } from '../i18n/LanguageContext'
import { Panel, Empty, listStyle } from './Dashboard'

export interface DashboardBoard {
  id: string
  name: string
  icon: string
  color: string
  is_shared: boolean
  openCards: number
  totalCards: number
}

export interface DashboardDueCard {
  cardId: string
  boardId: string
  boardName: string
  title: string
  due_date: string
  overdue: boolean
}

export interface DashboardProjectsData {
  boards: DashboardBoard[]
  dueSoon: DashboardDueCard[]
  totalOpen: number
  totalCards: number
  loaded: boolean
}

const EMPTY_DATA: DashboardProjectsData = { boards: [], dueSoon: [], totalOpen: 0, totalCards: 0, loaded: false }

/** Resumo dos quadros e prazos, calculado ao carregar (o "hoje" é o da carga). */
function summarizeDashboardProjects(
  { boards: allBoards, cards }: { boards: DashboardBoardRow[]; cards: DashboardCardRow[] },
  now: number,
): DashboardProjectsData {
  const boardName = new Map(allBoards.map(b => [b.id, b.name]))
  // REL-007: dias pelo relógio local, não pela data UTC.
  const today = localDateKey(new Date(now))
  const horizon = localDateKey(new Date(now + 7 * 86400000))

  const boards: DashboardBoard[] = allBoards.map(b => {
    const list = cards.filter(c => c.board_id === b.id)
    return {
      id: b.id, name: b.name, icon: b.icon, color: b.color, is_shared: b.is_shared,
      openCards: list.filter(c => !c.completed).length,
      totalCards: list.length,
    }
  })

  const dueSoon: DashboardDueCard[] = cards
    .filter((c): c is typeof c & { due_date: string } => !c.completed && !!c.due_date && c.due_date <= horizon)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6)
    .map(c => ({
      cardId: c.id, boardId: c.board_id, boardName: boardName.get(c.board_id) ?? '',
      title: c.title, due_date: c.due_date, overdue: c.due_date < today,
    }))

  return {
    boards, dueSoon,
    totalOpen: cards.filter(c => !c.completed).length,
    totalCards: cards.length,
    loaded: true,
  }
}

export function useDashboardProjects(userId: string | undefined, enabled: boolean): DashboardProjectsData {
  // PERF-015: em cache (react-query); o realtime de project_cards invalida.
  const { data } = useQuery({
    queryKey: dashboardKeys.projects(userId),
    queryFn: async () => {
      try {
        return summarizeDashboardProjects(await loadDashboardProjects(userId!), Date.now())
      } catch (err) {
        console.error('dashboard projects:', err)
        throw err
      }
    },
    enabled: !!userId && enabled,
  })
  return data ?? EMPTY_DATA
}

export default function DashboardProjects({ data, isMobile = false }: { data: DashboardProjectsData; isMobile?: boolean }) {
  const { t } = useLanguage()
  const { setActivePanel } = usePages()

  // Chaves gravadas ANTES da troca de seleção: o ProjectsPanel lê
  // projects_active_board num inicializador de useState e projects_open_card
  // num efeito de mount — ele monta dentro do DocumentsPanel logo em seguida.
  const openBoard = (boardId: string) => {
    localStorage.setItem(LOCAL_KEYS.projectsActiveBoard, boardId)
    setDocsSelection({ kind: 'projects' })
    setActivePanel('documents')
  }

  // UX-012: sem quadro, o botão leva ao painel de Projetos, que tem o "Criar quadro".
  const openProjects = () => {
    setDocsSelection({ kind: 'projects' })
    setActivePanel('documents')
  }

  const openCard = (boardId: string, cardId: string) => {
    localStorage.setItem(LOCAL_KEYS.projectsActiveBoard, boardId)
    localStorage.setItem(LOCAL_KEYS.projectsOpenCard, cardId)
    setDocsSelection({ kind: 'projects' })
    setActivePanel('documents')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14, marginBottom: 20 }}>
      <Panel title={t('dashboard_projects_boards')} icon={<FolderKanban size={13} />}>
        {data.boards.length === 0 ? (
          <Empty text={t('dashboard_projects_empty_boards')} action={{ label: t('dashboard_cta_new_board'), onClick: openProjects }} />
        ) : (
          <ul style={listStyle}>
            {data.boards.map(b => <BoardRow key={b.id} board={b} onClick={() => openBoard(b.id)} />)}
          </ul>
        )}
      </Panel>

      <Panel title={t('dashboard_projects_due_soon')} icon={<CalendarClock size={13} />}>
        {data.dueSoon.length === 0 ? (
          <Empty text={t('dashboard_projects_empty_due')} />
        ) : (
          <ul style={listStyle}>
            {data.dueSoon.map(c => (
              <li
                key={c.cardId}
                {...activateProps(() => openCard(c.boardId, c.cardId))}
                onClick={() => openCard(c.boardId, c.cardId)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, cursor: 'pointer', transition: 'background-color 0.1s', minWidth: 0 }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: c.overdue ? '#ef4444' : 'var(--color-primary)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                <span style={{ fontSize: 11, color: c.overdue ? '#ef4444' : 'var(--color-text-muted)', flexShrink: 0 }}>{c.due_date}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.boardName}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function BoardRow({ board: b, onClick }: { board: DashboardBoard; onClick: () => void }) {
  const { t } = useLanguage()
  const done = b.totalCards - b.openCards
  const pct = b.totalCards === 0 ? 0 : Math.round((done / b.totalCards) * 100)
  return (
    <li
      {...activateProps(onClick)}
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px', borderRadius: 7, cursor: 'pointer', transition: 'background-color 0.1s', minWidth: 0 }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <span style={{ fontSize: 15, flexShrink: 0 }}>{b.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
          {b.is_shared && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)', flexShrink: 0 }}>
              {t('projects_shared_badge')}
            </span>
          )}
        </div>
        <div style={{ height: 4, backgroundColor: 'var(--color-border)', borderRadius: 999, overflow: 'hidden', marginTop: 5 }}>
          <div style={{ height: '100%', width: `${pct}%`, backgroundColor: b.color || 'var(--color-accent)', borderRadius: 999, transition: 'width 0.3s' }} />
        </div>
      </div>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>
        {t('dashboard_projects_open_total').replace('{open}', String(b.openCards)).replace('{total}', String(b.totalCards))}
      </span>
    </li>
  )
}
