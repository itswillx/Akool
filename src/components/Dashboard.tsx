import { useEffect, useMemo, useState, useRef } from 'react'
import {
  FileText, Pencil, Layers, CheckSquare, Star, ArrowRight,
  TrendingUp, Wallet, Bell, Check, X, Users, FolderKanban,
} from 'lucide-react'
import QuickNotes from './QuickNotes'
import DashboardProjects, { useDashboardProjects } from './DashboardProjects'
import type { Page, PageType, Todo, FinanceAccount, FinanceTransaction, FinanceCategory } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useAuth } from '../contexts/AuthContext'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import { useNotifications } from '../contexts/NotificationsContext'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageContext'
import ErrorBoundary from './ErrorBoundary'
import { formatBRL } from '../lib/money'

interface DashboardProps {
  isMobile?: boolean
}

function flatPages(ps: Page[]): Page[] {
  return ps.flatMap(p => [p, ...flatPages(p.children ?? [])])
}

function currentYM(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function last6Months(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number)
  const result: string[] = []
  for (let i = 5; i >= 0; i--) {
    let month = m - i
    let year = y
    while (month < 1) { month += 12; year-- }
    result.push(`${year}-${String(month).padStart(2, '0')}`)
  }
  return result
}

function monthLabel(ym: string, locale = 'pt-BR'): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1).toLocaleString(locale, { month: 'long', year: 'numeric' })
}

function shortMonthLabel(ym: string, locale = 'pt-BR'): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1).toLocaleString(locale, { month: 'short' })
}

// Stored amounts are integer cents; format via the shared helper.
function fmtCurrency(cents: number): string {
  return formatBRL(cents)
}

interface FinanceStats {
  totalBalance: number
  monthIncome: number
  monthExpense: number
  topCategories: { id: string; name: string; amount: number; color: string; emoji: string }[]
  monthlyData: { month: string; income: number; expense: number }[]
  savingsRate: number
  loaded: boolean
}

function useDashboardFinance(userId: string | undefined, enabled: boolean): FinanceStats {
  const [stats, setStats] = useState<FinanceStats>({
    totalBalance: 0, monthIncome: 0, monthExpense: 0,
    topCategories: [], monthlyData: [], savingsRate: 0, loaded: false,
  })

  useEffect(() => {
    // In "projects" mode finance is hidden, so skip the finance_* queries entirely.
    if (!userId || !enabled) return
    const ym = currentYM()
    const months = last6Months(ym)

    Promise.all([
      supabase.from('finance_accounts').select('*').eq('user_id', userId),
      supabase.from('finance_transactions').select('*').eq('user_id', userId),
      supabase.from('finance_categories').select('*').eq('user_id', userId),
    ]).then(([accRes, txRes, catRes]) => {
      const accounts: FinanceAccount[] = (accRes.data ?? []) as FinanceAccount[]
      const transactions: FinanceTransaction[] = (txRes.data ?? []) as FinanceTransaction[]
      const categories: FinanceCategory[] = (catRes.data ?? []) as FinanceCategory[]

      const totalAccountsBalance = accounts.reduce((s, a) => s + a.initial_balance, 0)
      const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      const totalBalance = totalAccountsBalance + totalIncome - totalExpense

      const monthTx = transactions.filter(t => t.date.startsWith(ym))
      const monthIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const monthExpense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      const savingsRate = monthIncome > 0 ? Math.round(((monthIncome - monthExpense) / monthIncome) * 100) : 0

      const catExpenseMap: Record<string, number> = {}
      monthTx.filter(t => t.type === 'expense' && t.category_id).forEach(t => {
        catExpenseMap[t.category_id!] = (catExpenseMap[t.category_id!] ?? 0) + t.amount
      })
      const topCategories = categories
        .filter(c => c.type === 'expense' && catExpenseMap[c.id])
        .map(c => ({ id: c.id, name: c.name, amount: catExpenseMap[c.id] ?? 0, color: c.color || '#6366f1', emoji: c.icon || '' }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 4)

      const monthlyData = months.map(m => {
        const mTx = transactions.filter(t => t.date.startsWith(m))
        return {
          month: m,
          income: mTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0),
          expense: mTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
        }
      })

      setStats({ totalBalance, monthIncome, monthExpense, topCategories, monthlyData, savingsRate, loaded: true })
    })
  }, [userId, enabled])

  return stats
}

export default function Dashboard({ isMobile = false }: DashboardProps) {
  const { pages, createPage, setActivePage, setActivePanel } = usePages()
  const { user, profile } = useAuth()
  const { mode } = useWorkspaceMode()
  const { t } = useLanguage()
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications()
  const [todos, setTodos] = useState<Todo[]>([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef<HTMLDivElement>(null)
  const ym = currentYM()
  // Finance widgets only appear in the "all" (everything) view; in "projects"
  // and "documents" modes they are hidden and their queries are skipped.
  const showFinance = mode === 'all'
  const finance = useDashboardFinance(user?.id, showFinance)
  const showProjects = mode !== 'finance'
  const projects = useDashboardProjects(user?.id, showProjects)

  useEffect(() => {
    if (!notifOpen) return
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifOpen])

  useEffect(() => {
    if (!user) return
    supabase
      .from('todos').select('*').eq('user_id', user.id)
      .order('completed', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => setTodos((data as Todo[]) ?? []))
  // Dashboard remounts when reopened, so fetching once per user is enough;
  // depending on `pages` caused a full todos refetch on every page edit.
  }, [user])

  const flat = useMemo(() => flatPages(pages), [pages])

  const stats = useMemo(() => {
    let note = 0, drawing = 0, both = 0, todo = 0
    flat.forEach(p => {
      if (p.type === 'note') note++
      else if (p.type === 'drawing') drawing++
      else if (p.type === 'both') both++
      else if (p.type === 'todo') todo++
    })
    return { note, drawing, both, todo }
  }, [flat])

  const recent = useMemo(() => [...flat].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 5), [flat])
  const favorites = useMemo(() => flat.filter(p => p.is_favorite).slice(0, 4), [flat])

  const todoStats = useMemo(() => {
    const open = todos.filter(t => !t.completed)
    const done = todos.length - open.length
    const today = new Date().toISOString().slice(0, 10)
    const completion = todos.length === 0 ? 0 : Math.round((done / todos.length) * 100)
    return { open: open.length, done, total: todos.length, completion,
      overdue: open.filter(t => t.due_date && t.due_date < today).length }
  }, [todos])

  const upcoming = useMemo(() =>
    todos.filter(t => !t.completed)
      .sort((a, b) => {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return a.due_date.localeCompare(b.due_date)
      }).slice(0, 6),
    [todos])

  const handleCreate = async (type: PageType) => {
    const page = await createPage({ type })
    if (page) setActivePage(page)
  }

  const openPage = (id: string) => {
    const p = flat.find(x => x.id === id)
    if (p) setActivePage(p)
  }

  const displayName = profile?.display_name ?? user?.email?.split('@')[0] ?? ''

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', backgroundColor: 'var(--color-bg-tertiary)' }}>
      <div style={{ maxWidth: 1160, margin: '0 auto', padding: isMobile ? '20px 16px 60px' : '32px 32px 80px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 28, fontWeight: 700, color: 'var(--color-text)' }}>
              {t('dashboard_hello')}, {displayName}! 👋
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
              {monthLabel(ym)}
            </p>
          </div>
          <div ref={notifRef} style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
            <button
              onClick={() => setNotifOpen(o => !o)}
              title={t('notif_title')}
              style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: notifOpen ? 'var(--color-hover)' : 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'background-color 0.15s' }}
            >
              <Bell size={14} />
              {unreadCount > 0 && (
                <span style={{ position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 999, backgroundColor: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', lineHeight: 1 }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {notifOpen && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 340, maxHeight: 420, overflowY: 'auto', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', zIndex: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px 8px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>{t('notif_title')}</span>
                  {unreadCount > 0 && (
                    <button onClick={() => markAllRead()} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#6366f1', fontWeight: 600, padding: '2px 6px' }}>
                      {t('notif_mark_all_read')}
                    </button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{t('notif_empty')}</div>
                ) : (
                  notifications.slice(0, 20).map(n => (
                    <NotificationItem key={n.id} notification={n} onRead={markAsRead} onClose={() => setNotifOpen(false)} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Ações Rápidas ── */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {t('dashboard_quick_actions')}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <QuickAction onClick={() => handleCreate('note')} icon={<FileText size={13} />} label={t('dashboard_new_note')} />
            <QuickAction onClick={() => handleCreate('drawing')} icon={<Pencil size={13} />} label={t('dashboard_new_drawing')} />
            <QuickAction onClick={() => handleCreate('both')} icon={<Layers size={13} />} label={t('dashboard_note_drawing')} />
            <QuickAction onClick={() => handleCreate('todo')} icon={<CheckSquare size={13} />} label={t('dashboard_new_todo')} primary />
          </div>
        </div>

        {/* ── Top stat cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 12 }}>
          {showFinance && (
            <StatCard
              onClick={() => { localStorage.setItem('finance_active_tab', 'overview'); setActivePanel('finance') }}
              icon={<Wallet size={15} />} iconColor="#6366f1"
              label={t('sidebar_finance')} sub={t('dashboard_finance_balance')}
              value={fmtCurrency(finance.totalBalance)}
              valueColor={finance.totalBalance < 0 ? 'var(--color-error)' : 'var(--color-text)'}
              sparkline={finance.monthlyData}
              sparklineKey="expense"
            />
          )}
          <StatCard
            icon={<FileText size={15} />} iconColor="#0ea5e9"
            label={t('dashboard_activity')} sub={t('dashboard_stat_notes')}
            value={String(stats.note + stats.both)}
          />
          <StatCard
            icon={<Pencil size={15} />} iconColor="#8b5cf6"
            label={t('dashboard_projects')} sub={t('dashboard_stat_drawings')}
            value={String(stats.drawing + stats.both)}
          />
          <StatCard
            icon={<CheckSquare size={15} />} iconColor="#f59e0b"
            label={t('dashboard_tasks_label')} sub={t('dashboard_tasks_stat')}
            value={`${todoStats.completion}%`}
            secondaryValue={`${todoStats.done}/${todoStats.total}`}
          />
          {showProjects && (
            <StatCard
              onClick={() => setActivePanel('projects')}
              icon={<FolderKanban size={15} />} iconColor="#6366f1"
              label={t('dashboard_projects_section')} sub={t('dashboard_stat_projects')}
              value={String(projects.boards.length)}
              secondaryValue={`${projects.totalOpen}/${projects.totalCards}`}
            />
          )}
        </div>

        {/* ── Notas rápidas (sticky notes) ── */}
        <div style={{ marginTop: 20 }}>
          <QuickNotes isMobile={isMobile} />
        </div>

        {/* ── Visão de projetos ── */}
        {showProjects && <DashboardProjects data={projects} isMobile={isMobile} />}

        {showFinance && (<ErrorBoundary>
        {/* ── Finance overview cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginBottom: 20 }}>
          <FinanceCard
            label={t('dashboard_finance_income')}
            value={fmtCurrency(finance.monthIncome)}
            color="#10b981"
            icon={<TrendingUp size={14} />}
          />
          <FinanceCard
            label={t('dashboard_finance_expense')}
            value={fmtCurrency(finance.monthExpense)}
            color="#ef4444"
            icon={<TrendingUp size={14} style={{ transform: 'rotate(180deg)' }} />}
          />
        </div>

        {/* ── Charts row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14, marginBottom: 14 }}>
          {/* Monthly evolution */}
          <Panel title={t('dashboard_monthly_evolution')} icon={<TrendingUp size={13} />}>
            <MonthlyChart data={finance.monthlyData} />
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <LegendDot color="#10b981" label={t('finance_month_income')} />
              <LegendDot color="#ef4444" label={t('finance_month_expense')} />
            </div>
          </Panel>

          {/* Right column: top categories + donut */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {finance.topCategories.length > 0 ? (
              <>
                <Panel title={t('dashboard_top_categories')} icon={<Star size={13} />}>
                  <TopCategoriesBar categories={finance.topCategories} />
                </Panel>
                <Panel title={t('dashboard_expense_by_category')} icon={<Wallet size={13} />}>
                  <DonutSection categories={finance.topCategories} />
                </Panel>
              </>
            ) : (
              <Panel title={t('dashboard_top_categories')} icon={<Star size={13} />}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>{t('dashboard_no_finance_data')}</p>
              </Panel>
            )}
          </div>
        </div>

        {/* ── Savings rate ── */}
        <div style={{ marginBottom: 14 }}>
          <Panel title={t('dashboard_savings_rate')} icon={<TrendingUp size={13} />}>
            <SavingsRateBar rate={finance.savingsRate} />
          </Panel>
        </div>
        </ErrorBoundary>)}

        {/* ── Bottom row: recent + upcoming ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14 }}>
          <Panel title={t('dashboard_recent_favorites')} icon={<FileText size={13} />}>
            {recent.length === 0 && favorites.length === 0 ? (
              <Empty text={t('dashboard_empty_recent')} />
            ) : (
              <ul style={listStyle}>
                {favorites.slice(0, 3).map(p => <PageRow key={`fav-${p.id}`} page={p} onClick={() => openPage(p.id)} badge="Favorito" />)}
                {recent.filter(p => !p.is_favorite).slice(0, 4).map(p => (
                  <PageRow key={p.id} page={p} onClick={() => openPage(p.id)} badge={p.type === 'note' ? 'Nota' : p.type === 'drawing' ? 'Desenho' : p.type === 'todo' ? 'Lista' : 'Nota'} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Próximas Tarefas" icon={<CheckSquare size={13} />}>
            {upcoming.length === 0 ? (
              <Empty text={t('dashboard_empty_upcoming')} />
            ) : (
              <ul style={listStyle}>
                {upcoming.map(todo => {
                  const parent = flat.find(p => p.id === todo.page_id)
                  const today = new Date().toISOString().slice(0, 10)
                  const overdue = todo.due_date && todo.due_date < today
                  return (
                    <li
                      key={todo.id}
                      onClick={() => parent && setActivePage(parent)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, cursor: 'pointer', transition: 'background-color 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: overdue ? '#ef4444' : 'var(--color-primary)', flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {todo.text || t('dashboard_untitled_task')}
                      </span>
                      {todo.due_date && (
                        <span style={{ fontSize: 11, color: overdue ? '#ef4444' : 'var(--color-text-muted)', flexShrink: 0 }}>{todo.due_date}</span>
                      )}
                      {parent && (
                        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {parent.icon} {parent.title}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        </div>

      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

export const listStyle: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 1 }

function NotificationItem({ notification: n, onRead, onClose }: {
  notification: import('../types').AppNotification
  onRead: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [hov, setHov] = useState(false)
  const [acting, setActing] = useState(false)
  const [acted, setActed] = useState(false)
  const inviteId = (n.data as Record<string, string>)?.invite_id
  const showInviteActions = n.type === 'workspace_invite' && !!inviteId && !acted

  const handleAction = async (action: 'accept' | 'decline') => {
    if (!inviteId) return
    setActing(true)
    try {
      if (action === 'accept') {
        await supabase.rpc('accept_workspace_invite', { p_invite_id: inviteId })
      } else {
        await supabase.rpc('decline_workspace_invite', { p_invite_id: inviteId })
      }
      await onRead(n.id)
      setActed(true)
    } catch { /* ignore */ }
    setActing(false)
    onClose()
    window.location.reload()
  }

  const handleRowClick = () => {
    if (showInviteActions) return
    if (!n.read) onRead(n.id)
  }

  const iconColor = n.type === 'workspace_invite' ? '#6366f1'
    : n.type === 'invite_accepted' || n.type === 'member_joined' ? '#22c55e'
    : n.type === 'invite_declined' ? '#f59e0b'
    : '#ef4444'

  const ago = (() => {
    const ms = Date.now() - new Date(n.created_at).getTime()
    const min = Math.floor(ms / 60000)
    if (min < 1) return 'agora'
    if (min < 60) return `${min}m`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
  })()

  return (
    <div
      onClick={handleRowClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', gap: 10, padding: '10px 14px', cursor: (n.read || showInviteActions) ? 'default' : 'pointer', backgroundColor: hov ? 'var(--color-hover)' : (!n.read ? 'var(--color-bg-secondary)' : 'transparent'), borderBottom: '1px solid var(--color-border)', transition: 'background-color 0.1s' }}
    >
      <div style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${iconColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Users size={13} color={iconColor} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: n.read ? 400 : 600, color: 'var(--color-text)', lineHeight: 1.35 }}>{n.title}</p>
        {n.body && <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.3 }}>{n.body}</p>}
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{ago}</span>
        {showInviteActions && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button disabled={acting} onClick={(e) => { e.stopPropagation(); handleAction('accept') }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 6, border: 'none', backgroundColor: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
              <Check size={12} /> Aceitar
            </button>
            <button disabled={acting} onClick={(e) => { e.stopPropagation(); handleAction('decline') }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
              <X size={12} /> Recusar
            </button>
          </div>
        )}
      </div>
      {!n.read && <div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: '#6366f1', flexShrink: 0, marginTop: 4 }} />}
    </div>
  )
}


function QuickAction({ onClick, icon, label, primary }: { onClick: () => void; icon: React.ReactNode; label: string; primary?: boolean }) {
  const [hov, setHov] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 7, border: primary ? 'none' : '1px solid var(--color-border)', backgroundColor: primary ? (hov ? 'var(--color-btn-primary-hover)' : 'var(--color-btn-primary)') : (hov ? 'var(--color-hover)' : 'var(--color-bg)'), color: primary ? 'var(--color-btn-primary-text)' : 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer', transition: 'background-color 0.15s' }}
    >
      {icon}{label}
    </button>
  )
}

interface StatCardProps {
  icon: React.ReactNode
  iconColor: string
  label: string
  sub: string
  value: string
  valueColor?: string
  secondaryValue?: string
  sparkline?: { month: string; income: number; expense: number }[]
  sparklineKey?: 'income' | 'expense'
  onClick?: () => void
}

function StatCard({ icon, iconColor, label, sub, value, valueColor, secondaryValue, sparkline, sparklineKey, onClick }: StatCardProps) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: hov && onClick ? 'var(--color-hover)' : 'var(--color-surface)', cursor: onClick ? 'pointer' : 'default', transition: 'background-color 0.1s' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{sub}</span>
        </div>
        <span style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: `${iconColor}20`, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'space-between' }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: valueColor ?? 'var(--color-text)' }}>{value}</span>
        {secondaryValue && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{secondaryValue}</span>}
      </div>
      {sparkline && sparklineKey && (
        <MiniSparkline data={sparkline.map(d => d[sparklineKey!])} color={sparklineKey === 'income' ? '#10b981' : '#ef4444'} />
      )}
    </div>
  )
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1)
  const w = 80, h = 24
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - (v / max) * h
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={w} height={h} style={{ marginTop: 6, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

function FinanceCard({ label, value, color, icon }: { label: string; value: string; color: string; icon: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: `${color}20`, color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      <div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 700, color }}>{value}</p>
      </div>
    </div>
  )
}

export function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', minWidth: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, color: 'var(--color-text)' }}>
        {icon}
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</h3>
      </div>
      {children}
    </div>
  )
}

function MonthlyChart({ data }: { data: { month: string; income: number; expense: number }[] }) {
  const { t } = useLanguage()
  if (data.length === 0) return <div style={{ height: 80 }} />
  const max = Math.max(...data.flatMap(d => [d.income, d.expense]), 1)
  const chartH = 80

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: chartH + 18 }}>
      {data.map(d => {
        const incH = Math.max((d.income / max) * chartH, d.income > 0 ? 2 : 0)
        const expH = Math.max((d.expense / max) * chartH, d.expense > 0 ? 2 : 0)
        const lbl = shortMonthLabel(d.month)
        return (
          <div key={d.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, gap: 0 }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: chartH }}>
              <div title={`${t('finance_month_income')}: ${fmtCurrency(d.income)}`} style={{ width: 9, height: incH, backgroundColor: '#10b981', borderRadius: '2px 2px 0 0', transition: 'height 0.3s' }} />
              <div title={`${t('finance_month_expense')}: ${fmtCurrency(d.expense)}`} style={{ width: 9, height: expH, backgroundColor: '#ef4444', borderRadius: '2px 2px 0 0', transition: 'height 0.3s' }} />
            </div>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'capitalize', marginTop: 3 }}>{lbl}</span>
          </div>
        )
      })}
    </div>
  )
}

function TopCategoriesBar({ categories }: { categories: { name: string; amount: number; color: string; emoji: string }[] }) {
  const max = Math.max(...categories.map(c => c.amount), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {categories.map((cat, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text)' }}>{cat.emoji} {cat.name}</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500 }}>{fmtCurrency(cat.amount)}</span>
          </div>
          <div style={{ height: 5, backgroundColor: 'var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(cat.amount / max) * 100}%`, backgroundColor: cat.color, borderRadius: 999, transition: 'width 0.3s' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function DonutSection({ categories }: { categories: { name: string; amount: number; color: string; emoji: string }[] }) {
  const total = categories.reduce((s, c) => s + c.amount, 0)
  if (total === 0) return null

  let cumDeg = 0
  const segments = categories.map(c => {
    const deg = (c.amount / total) * 360
    const start = cumDeg
    cumDeg += deg
    return { ...c, start, deg }
  })

  const gradient = segments.map(s => `${s.color} ${s.start}deg ${s.start + s.deg}deg`).join(', ')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ position: 'relative', width: 70, height: 70, flexShrink: 0 }}>
        <div style={{ width: 70, height: 70, borderRadius: '50%', background: `conic-gradient(${gradient})` }} />
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 42, height: 42, borderRadius: '50%', backgroundColor: 'var(--color-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontWeight: 600 }}>Total</span>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {categories.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--color-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{Math.round((c.amount / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SavingsRateBar({ rate }: { rate: number }) {
  const pct = Math.min(Math.abs(rate), 100)
  const color = rate >= 0 ? '#10b981' : '#ef4444'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>% de receita</span>
        <span style={{ fontSize: 14, fontWeight: 700, color }}>{rate > 0 ? '+' : ''}{rate}%</span>
      </div>
      <div style={{ height: 12, backgroundColor: 'var(--color-border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 999, transition: 'width 0.4s', minWidth: pct > 0 ? 4 : 0 }} />
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', padding: '6px 0' }}>{text}</p>
}

function PageRow({ page, onClick, badge }: { page: Page; onClick: () => void; badge?: string }) {
  const [hov, setHov] = useState(false)
  const typeIcon = page.type === 'drawing' ? '🎨' : page.type === 'both' ? '⚡' : page.type === 'todo' ? '✅' : '📄'
  return (
    <li
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 7, cursor: 'pointer', backgroundColor: hov ? 'var(--color-hover)' : 'transparent', transition: 'background-color 0.1s' }}
    >
      <span style={{ fontSize: 15, flexShrink: 0 }}>{page.icon || typeIcon}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {page.title || 'Untitled'}
      </span>
      {badge && (
        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)', flexShrink: 0 }}>{badge}</span>
      )}
      <ArrowRight size={12} color="var(--color-text-muted)" style={{ opacity: hov ? 1 : 0, flexShrink: 0 }} />
    </li>
  )
}
