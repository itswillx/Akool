import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { ChevronLeft, ChevronRight, X, Trash2, Pencil, TrendingUp, TrendingDown, Wallet, Plus, Target, ChevronDown, CheckCircle2, XCircle, Users, User, Link2, FileDown, Camera, Download, BarChart2, List, CreditCard, Star, Tag, RefreshCw, MoreHorizontal, Search, Zap, PanelLeft, PanelTop } from 'lucide-react'
import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceBudget, FinanceTxType, FinanceGoal, FinanceGoalContribution, FinanceGoalShare, FinanceRecurring, FinanceRecurringEntry, FinanceWorkspace, FinanceWorkspaceMember, FinanceWorkspaceInvite } from '../../types'
import { supabase } from '../../lib/supabase'
import { toCents, fromCents, formatBRL } from '../../lib/money'
import { sanitizeIlikeTerm } from '../../lib/profileSearch'
import { downloadTransactionsCsv } from '../../lib/financeCsv'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { useIsMobile } from '../../hooks/useIsMobile'

// ─── Mobile context ────────────────────────────────────────────────────────────
// Lets nested components (modals, tabs) adapt their layout without threading an
// `isMobile` prop through every call site.

const FinanceMobileContext = createContext(false)
const useFinanceMobile = () => useContext(FinanceMobileContext)

// Height reserved for the fixed mobile bottom navigation (incl. elevated FAB).
const MOBILE_NAV_HEIGHT = 64

type TabId = 'overview' | 'transactions' | 'budgets' | 'accounts' | 'goals' | 'categories' | 'recurring'

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Amounts are stored and summed as integer cents; render via the shared formatter.
function fmt(cents: number) {
  return formatBRL(cents)
}

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function currentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function last6Months(base: string): string[] {
  const months: string[] = []
  let cur = base
  for (let i = 5; i >= 0; i--) {
    const [y, m] = cur.split('-').map(Number)
    const d = new Date(y, m - 1 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

const ACCOUNT_TYPE_ICONS: Record<string, string> = {
  checking: '🏦',
  savings: '🐷',
  credit: '💳',
  cash: '💵',
}

// ─── Input styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 14,
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  outline: 'none',
  boxSizing: 'border-box',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
  display: 'block',
}

// ─── Finance palette ────────────────────────────────────────────────────────
// Maps the "Controle Financeiro" design tokens onto the site's CSS variables so
// the module keeps the same contrast as the rest of the app (decision: graphite
// accent, income green, expense red). Use these instead of hardcoded hexes.
const FIN_ACCENT = 'var(--color-btn-primary)'          // primary buttons / active emphasis (graphite)
const FIN_ACCENT_TEXT = 'var(--color-btn-primary-text)'
const FIN_POS = 'var(--color-done)'                    // income
const FIN_NEG = 'var(--color-error)'                   // expense
const FIN_POS_SOFT = 'rgba(16,185,129,0.13)'
const FIN_NEG_SOFT = 'rgba(239,68,68,0.13)'
const FIN_WARN = '#f59e0b'                             // attention / overdue (kept semantic)

// Numeric figures use tabular-nums so columns of money align (design parity).
const tabularNums: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' }

// ─── Segmented control (pill toggle) ──────────────────────────────────────────
// Matches the design's Família/Individual, Lateral/Topo, Todos/Receitas/Despesas
// toggles: a subtle track with a raised "surface" pill for the active option.
const segTrackStyle: React.CSSProperties = {
  display: 'inline-flex',
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 3,
}

function segBtnStyle(active: boolean, opts?: { wide?: boolean }): React.CSSProperties {
  return {
    flex: opts?.wide ? 1 : undefined,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    border: 'none',
    background: active ? 'var(--color-surface)' : 'transparent',
    color: active ? 'var(--color-text)' : 'var(--color-text-subtle)',
    fontSize: opts?.wide ? 13.5 : 12.5,
    fontWeight: active ? 600 : 500,
    padding: opts?.wide ? '8px 12px' : '5px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
    transition: 'background 0.12s, color 0.12s',
  }
}

// Primary (graphite) call-to-action button.
const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: 'none',
  background: FIN_ACCENT,
  color: FIN_ACCENT_TEXT,
  fontSize: 13,
  fontWeight: 600,
  padding: '9px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// Subtle/secondary outlined button.
const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-surface)',
  color: 'var(--color-text-subtle)',
  fontSize: 13,
  fontWeight: 500,
  padding: '8px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

// Card surface used across the redesigned tabs.
const cardSurfaceStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 12,
}

// Uppercase section caption (e.g. "EVOLUÇÃO MENSAL").
const sectionCaptionStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--color-text-muted)',
  margin: 0,
}

// ─── Modal wrapper ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const isMobile = useFinanceMobile()

  if (isMobile) {
    return (
      <div
        className="finance-sheet-overlay"
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
      >
        <div
          className="finance-sheet-panel finance-safe-bottom"
          onClick={e => e.stopPropagation()}
          style={{ backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '8px 18px 20px', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 -8px 32px rgba(0,0,0,0.3)', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}
        >
          {/* Drag handle */}
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 12px' }}>
            <div style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: 'var(--color-border)' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, position: 'sticky', top: 0 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
            <button onClick={onClose} style={{ border: 'none', background: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, width: 36, height: 36, flexShrink: 0 }}>
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      className="finance-sheet-overlay"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' }}
    >
      <div
        className="finance-modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, width: 420, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, padding: 4 }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── Right-side drawer (desktop transaction create/edit) ──────────────────────

function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div
      className="finance-drawer-overlay"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(16,20,24,0.4)', display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        className="finance-drawer-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: 430, maxWidth: '100%', height: '100%', background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', boxShadow: '-14px 0 44px rgba(0,0,0,0.22)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{title}</div>
          <button onClick={onClose} style={{ width: 32, height: 32, border: 'none', background: 'transparent', borderRadius: 7, color: 'var(--color-text-subtle)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
        {footer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 22px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

// ─── Emoji Input ──────────────────────────────────────────────────────────────

const EMOJI_QUICK_PICKS = [
  '🍔','🍕','☕','🛒','🍺','🍽️','🥗','🍰',
  '🚗','✈️','🚌','⛽','🚂','🛵','🚲','🛺',
  '🏠','💡','🔑','🛋️','🧹','🏡','🪴','🛁',
  '❤️','💊','🏥','💪','🧘','🏋️','🩺','🧬',
  '🎮','🎬','🎵','📺','🎸','🎭','🎲','🃏',
  '📚','🎓','💻','📝','🔬','📐','🖊️','📖',
  '👕','👟','💍','🛍️','👜','🧴','🧣','💄',
  '💰','💵','💳','📈','🐷','🏦','💼','📊',
  '🎯','🏆','🌴','🚀','⭐','🌟','🎁','🎊',
  '📦','🌿','🧩','🎪','🪙','🔧','🏗️','⚡',
]

function EmojiInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, backgroundColor: 'var(--color-surface)', flexShrink: 0 }}>
          {value || '?'}
        </div>
        <input
          style={{ ...inputStyle, flex: 1 }}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value.trim())}
          placeholder={t('finance_emoji_placeholder')}
          maxLength={8}
        />
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 12, flexShrink: 0 }}
        >
          {open ? '▲' : '▼'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--color-text-muted)', fontWeight: 600 }}>{t('finance_emoji_suggestions')}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {EMOJI_QUICK_PICKS.map(em => (
              <button
                key={em}
                type="button"
                onClick={() => { onChange(em); setOpen(false) }}
                style={{ width: 32, height: 32, border: value === em ? '2px solid var(--color-text)' : '1px solid var(--color-border)', borderRadius: 6, backgroundColor: value === em ? 'var(--color-active)' : 'transparent', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Recurring entry generation ───────────────────────────────────────────────

async function ensureRecurringEntries(
  items: FinanceRecurring[],
  existing: FinanceRecurringEntry[],
  userId: string,
): Promise<number> {
  const existingKeys = new Set(existing.map(e => `${e.recurring_id}|${e.due_date}`))
  const now = new Date()
  const toInsert: Omit<FinanceRecurringEntry, 'id' | 'created_at'>[] = []

  for (const item of items) {
    if (!item.active) continue
    const existingCount = existing.filter(e => e.recurring_id === item.id).length
    for (let offset = 0; offset <= 1; offset++) {
      const insertedForItem = toInsert.filter(e => e.recurring_id === item.id).length
      if (item.total_installments != null && existingCount + insertedForItem >= item.total_installments) break
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      const lastDay = new Date(year, month, 0).getDate()
      const day = Math.min(item.day_of_month, lastDay)
      const dueDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const key = `${item.id}|${dueDate}`
      if (!existingKeys.has(key)) {
        toInsert.push({ user_id: userId, recurring_id: item.id, due_date: dueDate, status: 'pending', amount: null, transaction_id: null })
      }
    }
  }

  if (toInsert.length > 0) {
    await supabase.from('finance_recurring_entries').insert(toInsert)
  }
  return toInsert.length
}

// ─── Partner profile type ─────────────────────────────────────────────────────

interface PartnerProfile { id: string; email: string; display_name: string | null }

// ─── Data hook ────────────────────────────────────────────────────────────────

function useFinanceData() {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [categories, setCategories] = useState<FinanceCategory[]>([])
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([])
  const [budgets, setBudgets] = useState<FinanceBudget[]>([])
  const [goals, setGoals] = useState<FinanceGoal[]>([])
  const [contributions, setContributions] = useState<FinanceGoalContribution[]>([])
  const [goalShares, setGoalShares] = useState<FinanceGoalShare[]>([])
  const [incomingGoalShares, setIncomingGoalShares] = useState<FinanceGoalShare[]>([])
  const [sharedTransactions, setSharedTransactions] = useState<FinanceTransaction[]>([])
  const [sharedBudgets, setSharedBudgets] = useState<FinanceBudget[]>([])
  const [partnerProfiles, setPartnerProfiles] = useState<PartnerProfile[]>([])
  const [recurring, setRecurring] = useState<FinanceRecurring[]>([])
  const [recurringEntries, setRecurringEntries] = useState<FinanceRecurringEntry[]>([])
  const [workspace, setWorkspace] = useState<FinanceWorkspace | null>(null)
  const [workspaceMembers, setWorkspaceMembers] = useState<FinanceWorkspaceMember[]>([])
  const [workspaceInvites, setWorkspaceInvites] = useState<FinanceWorkspaceInvite[]>([])
  const [pendingInvitesForMe, setPendingInvitesForMe] = useState<FinanceWorkspaceInvite[]>([])
  const [familyTransactions, setFamilyTransactions] = useState<FinanceTransaction[]>([])
  const [familyBudgets, setFamilyBudgets] = useState<FinanceBudget[]>([])
  const [familyAccounts, setFamilyAccounts] = useState<FinanceAccount[]>([])
  const [familyCategories, setFamilyCategories] = useState<FinanceCategory[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    await supabase.rpc('bootstrap_finance_categories', { p_user_id: user.id })
    const [accs, cats, txs, buds, gls, ctbs, recs, rEnts, ownedShares, incShares, shTxs, shBuds] = await Promise.all([
      supabase.from('finance_accounts').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('finance_categories').select('*').eq('user_id', user.id).is('workspace_id', null).order('type').order('name'),
      supabase.from('finance_transactions').select('*').eq('user_id', user.id).order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('finance_budgets').select('*').eq('user_id', user.id),
      supabase.from('finance_goals').select('*').order('deadline'),
      supabase.from('finance_goal_contributions').select('*').order('date', { ascending: false }),
      supabase.from('finance_recurring').select('*').eq('user_id', user.id).order('created_at'),
      supabase.from('finance_recurring_entries').select('*').eq('user_id', user.id).order('due_date'),
      supabase.from('finance_goal_shares').select('*').eq('owner_id', user.id),
      supabase.from('finance_goal_shares').select('*').eq('shared_with_user_id', user.id),
      supabase.from('finance_transactions').select('*').eq('shared_with_user_id', user.id).order('date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('finance_budgets').select('*').eq('shared_with_user_id', user.id),
    ])

    // Load workspace data
    const { data: memberRow } = await supabase
      .from('finance_workspace_members')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

    let ws: FinanceWorkspace | null = null
    let wsMembers: FinanceWorkspaceMember[] = []
    let wsInvites: FinanceWorkspaceInvite[] = []
    let wsTxs: FinanceTransaction[] = []
    let wsBuds: FinanceBudget[] = []
    let wsAccs: FinanceAccount[] = []
    let wsCats: FinanceCategory[] = []

    if (memberRow) {
      const wsId = (memberRow as FinanceWorkspaceMember).workspace_id
      await supabase.rpc('bootstrap_workspace_categories', { p_workspace_id: wsId })
      const [wsRes, membersRes, invitesRes, wsTxsRes, wsBudsRes, wsAccsRes, wsCatsRes] = await Promise.all([
        supabase.from('finance_workspaces').select('*').eq('id', wsId).single(),
        supabase.from('finance_workspace_members').select('*').eq('workspace_id', wsId),
        supabase.from('finance_workspace_invites').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }),
        supabase.from('finance_transactions').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId).order('date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('finance_budgets').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId),
        supabase.from('finance_accounts').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId).order('created_at'),
        supabase.from('finance_categories').select('*').not('workspace_id', 'is', null).eq('workspace_id', wsId).order('type').order('name'),
      ])
      ws = (wsRes.data as FinanceWorkspace) ?? null
      wsMembers = (membersRes.data as FinanceWorkspaceMember[]) ?? []
      wsInvites = (invitesRes.data as FinanceWorkspaceInvite[]) ?? []
      wsTxs = (wsTxsRes.data as FinanceTransaction[]) ?? []
      wsBuds = (wsBudsRes.data as FinanceBudget[]) ?? []
      wsAccs = (wsAccsRes.data as FinanceAccount[]) ?? []
      wsCats = (wsCatsRes.data as FinanceCategory[]) ?? []
    }

    // Load pending invites for current user (even if not in a workspace yet)
    const { data: myPendingInvites } = await supabase
      .from('finance_workspace_invites')
      .select('*')
      .eq('status', 'pending')
      .or(`invited_user_id.eq.${user.id},invited_email.eq.${user.email}`)

    // Collect all partner IDs (include workspace members)
    const partnerIdSet = new Set<string>()
    ;(ownedShares.data ?? []).forEach((s: Record<string, string>) => partnerIdSet.add(s.shared_with_user_id))
    ;(incShares.data ?? []).forEach((s: Record<string, string>) => partnerIdSet.add(s.owner_id))
    ;(ctbs.data ?? []).forEach((c: Record<string, string>) => { if (c.user_id !== user.id) partnerIdSet.add(c.user_id) })
    ;(shTxs.data ?? []).forEach((tx: Record<string, string>) => partnerIdSet.add(tx.user_id))
    ;(shBuds.data ?? []).forEach((b: Record<string, string>) => partnerIdSet.add(b.user_id))
    wsMembers.forEach(m => { if (m.user_id !== user.id) partnerIdSet.add(m.user_id) })
    wsTxs.forEach(tx => { if (tx.user_id !== user.id) partnerIdSet.add(tx.user_id) })
    wsInvites.forEach(inv => { if (inv.invited_by !== user.id) partnerIdSet.add(inv.invited_by) })
    partnerIdSet.delete(user.id)

    let profilesMap = new Map<string, PartnerProfile>()
    if (partnerIdSet.size > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, email, display_name').in('id', [...partnerIdSet])
      ;(profs ?? []).forEach((p: PartnerProfile) => profilesMap.set(p.id, p))
    }

    setAccounts((accs.data as FinanceAccount[]) ?? [])
    setCategories((cats.data as FinanceCategory[]) ?? [])
    setTransactions((txs.data as FinanceTransaction[]) ?? [])
    setBudgets((buds.data as FinanceBudget[]) ?? [])
    setGoals((gls.data as FinanceGoal[]) ?? [])
    setContributions(
      ((ctbs.data ?? []) as FinanceGoalContribution[]).map(c =>
        ({ ...c, contributor_profile: c.user_id !== user.id ? (profilesMap.get(c.user_id) ?? undefined) : undefined })
      )
    )
    setGoalShares(
      ((ownedShares.data ?? []) as FinanceGoalShare[]).map(s =>
        ({ ...s, profile: profilesMap.get(s.shared_with_user_id) ?? undefined })
      )
    )
    setIncomingGoalShares((incShares.data as FinanceGoalShare[]) ?? [])
    setSharedTransactions((shTxs.data as FinanceTransaction[]) ?? [])
    setSharedBudgets((shBuds.data as FinanceBudget[]) ?? [])
    setPartnerProfiles([...profilesMap.values()])

    setWorkspace(ws)
    setWorkspaceMembers(wsMembers.map(m => ({ ...m, profile: m.user_id === user.id ? { email: user.email ?? '', display_name: null } : (profilesMap.get(m.user_id) ?? undefined) })))
    setWorkspaceInvites(wsInvites.map(inv => ({ ...inv, inviter_profile: profilesMap.get(inv.invited_by) ?? undefined })))
    setPendingInvitesForMe((myPendingInvites as FinanceWorkspaceInvite[]) ?? [])
    setFamilyTransactions(wsTxs)
    setFamilyBudgets(wsBuds)
    setFamilyAccounts(wsAccs)
    setFamilyCategories(wsCats)

    const recItems = (recs.data as FinanceRecurring[]) ?? []
    setRecurring(recItems)
    let entries = (rEnts.data as FinanceRecurringEntry[]) ?? []
    if (recItems.length > 0) {
      const added = await ensureRecurringEntries(recItems, entries, user.id)
      if (added > 0) {
        const { data: fresh } = await supabase.from('finance_recurring_entries').select('*').eq('user_id', user.id).order('due_date')
        entries = (fresh as FinanceRecurringEntry[]) ?? entries
      }
    }
    setRecurringEntries(entries)
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  return { accounts, categories, transactions, budgets, goals, contributions, goalShares, incomingGoalShares, sharedTransactions, sharedBudgets, partnerProfiles, recurring, recurringEntries, workspace, workspaceMembers, workspaceInvites, pendingInvitesForMe, familyTransactions, familyBudgets, familyAccounts, familyCategories, loading, reload: load }
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

// ─── User Picker (reusable for goal/tx/budget sharing) ────────────────────────────

function UserPicker({ label, value, onChange, knownPartners }: {
  label: string
  value: string
  onChange: (id: string) => void
  knownPartners: PartnerProfile[]
}) {
  const { t } = useLanguage()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PartnerProfile[]>([])
  const [searching, setSearching] = useState(false)
  const selected = knownPartners.find(p => p.id === value) ?? (value ? { id: value, email: value, display_name: null } : null)

  const displayName = (p: PartnerProfile) => p.display_name || p.email

  const doSearch = useCallback(async (q: string) => {
    const s = sanitizeIlikeTerm(q)
    if (s.length < 2) { setResults([]); return }
    setSearching(true)
    const { data } = await supabase.from('profiles').select('id, email, display_name').or(`email.ilike.%${s}%,display_name.ilike.%${s}%`).limit(6)
    setResults((data as PartnerProfile[]) ?? [])
    setSearching(false)
  }, [])

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, backgroundColor: 'var(--color-bg)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--color-text)', flexShrink: 0 }}>
            {displayName(selected).charAt(0).toUpperCase()}
          </div>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{displayName(selected)}</span>
          <button type="button" onClick={() => onChange('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4, padding: 2 }}><X size={14} /></button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {knownPartners.length > 0 && !query && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {knownPartners.map(p => (
                <button type="button" key={p.id} onClick={() => onChange(p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', fontSize: 12, color: 'var(--color-text)' }}>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--color-text)' }}>
                    {displayName(p).charAt(0).toUpperCase()}
                  </div>
                  {displayName(p)}
                </button>
              ))}
            </div>
          )}
          <input style={inputStyle} type="text" value={query} onChange={e => { setQuery(e.target.value); doSearch(e.target.value) }} placeholder={t('finance_share_search_placeholder')} />
          {searching && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_searching')}</p>}
          {results.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden', marginTop: 2 }}>
              {results.map(p => (
                <button type="button" key={p.id} onClick={() => { onChange(p.id); setQuery(''); setResults([]) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--color-text)', flexShrink: 0 }}>
                    {displayName(p).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{displayName(p)}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{p.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {query.length >= 2 && !searching && results.length === 0 && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_no_results')}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Invite autocomplete (workspace) ──────────────────────────────────────────
// Lets the workspace owner invite by email OR nick (display_name). As they type,
// matching users are suggested; selecting one fills the email behind the scenes.
// A raw email that matches no profile can still be typed and sent.

function InviteAutocomplete({ value, onChange, onSubmit, sending, excludeIds }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  sending: boolean
  excludeIds: string[]
}) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [results, setResults] = useState<PartnerProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  const doSearch = useCallback(async (q: string) => {
    const term = sanitizeIlikeTerm(q)
    if (term.length < 2) { setResults([]); setSearching(false); return }
    setSearching(true)
    const { data } = await supabase.from('profiles').select('id, email, display_name')
      .or(`email.ilike.%${term}%,display_name.ilike.%${term}%`).limit(10)
    const filtered = ((data as PartnerProfile[]) ?? []).filter(p => p.id !== user?.id && !excludeIds.includes(p.id))
    setResults(filtered.slice(0, 6))
    setSearching(false)
  }, [excludeIds, user?.id])

  const handleChange = (v: string) => {
    onChange(v)
    setOpen(true)
    doSearch(v)
  }

  const pick = (p: PartnerProfile) => {
    onChange(p.email)
    setResults([])
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} type="text" value={value}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { if (value.trim().length >= 2) setOpen(true) }}
          onBlur={() => { setTimeout(() => setOpen(false), 150) }}
          placeholder={t('finance_workspace_invite_placeholder')}
          onKeyDown={e => { if (e.key === 'Enter') { setOpen(false); onSubmit() } }} />
        <button onClick={onSubmit} disabled={sending || !value.trim()}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: sending || !value.trim() ? 'not-allowed' : 'pointer', opacity: sending || !value.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
          {t('finance_workspace_invite_send')}
        </button>
      </div>
      {open && value.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden', marginTop: 2 }}>
          {searching && <p style={{ margin: 0, padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_searching')}</p>}
          {!searching && results.map(p => (
            <button type="button" key={p.id} onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--color-text)', flexShrink: 0 }}>
                {(p.display_name || p.email).charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.display_name || p.email}</p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</p>
              </div>
            </button>
          ))}
          {!searching && results.length === 0 && (
            <p style={{ margin: 0, padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_no_results')}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface TxForm {
  type: FinanceTxType
  amount: string
  description: string
  date: string
  account_id: string
  category_id: string
  shared_with_user_id: string
  share_with_family: boolean
}

function TransactionModal({
  tx, personalAccounts, familyAccounts, personalCategories, familyCategories, partners, userId, workspace, defaultShareWithFamily, onClose, onSave, onDelete,
}: {
  tx?: FinanceTransaction
  personalAccounts: FinanceAccount[]
  familyAccounts: FinanceAccount[]
  personalCategories: FinanceCategory[]
  familyCategories: FinanceCategory[]
  partners: PartnerProfile[]
  userId: string
  workspace?: FinanceWorkspace | null
  defaultShareWithFamily?: boolean
  onClose: () => void
  onSave: (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState<TxForm>({
    type: tx?.type ?? 'expense',
    amount: tx ? String(fromCents(tx.amount)) : '',
    description: tx?.description ?? '',
    date: tx?.date ?? today,
    account_id: tx?.account_id ?? '',
    category_id: tx?.category_id ?? '',
    shared_with_user_id: tx?.shared_with_user_id ?? '',
    share_with_family: tx ? !!(tx.workspace_id && workspace) : !!(defaultShareWithFamily && workspace),
  })
  // Categories/accounts depend on whether the transaction is shared with the family (workspace-scoped) or personal
  const categories = form.share_with_family ? familyCategories : personalCategories
  const accounts = form.share_with_family ? familyAccounts : personalAccounts
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [showMore, setShowMore] = useState(false)

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(tx?.photo_url ?? null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  const [confirmRemovePhoto, setConfirmRemovePhoto] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const filteredCats = categories.filter(c => c.type === form.type)

  const handlePhotoChange = (file: File) => {
    if (!file.type.startsWith('image/')) return
    setPhotoFile(file)
    setPhotoRemoved(false)
    setConfirmRemovePhoto(false)
    const reader = new FileReader()
    reader.onload = e => setPhotoPreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handlePhotoRemove = () => {
    setPhotoFile(null)
    setPhotoPreview(null)
    setPhotoRemoved(true)
    setConfirmRemovePhoto(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const handlePhotoDownload = async () => {
    if (!photoPreview) return
    try {
      const res = await fetch(photoPreview)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `comprovante_${Date.now()}.${blob.type.split('/')[1] ?? 'jpg'}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(photoPreview, '_blank')
    }
  }

  const handleSave = async () => {
    const amt = toCents(form.amount)
    if (!amt || amt <= 0) return
    setSaving(true)
    setSaveError(null)

    let photoUrl: string | null | undefined = undefined
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() ?? 'jpg'
      const path = `${userId}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('transaction-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: false })
      if (uploadErr) {
        setSaveError(t('finance_photo_upload_error'))
        setSaving(false)
        return
      }
      const { data } = supabase.storage.from('transaction-photos').getPublicUrl(path)
      photoUrl = data.publicUrl
    } else if (photoRemoved) {
      photoUrl = null
    } else {
      photoUrl = tx?.photo_url ?? null
    }

    try {
      await onSave({
        type: form.type,
        amount: amt,
        description: form.description.trim(),
        date: form.date,
        account_id: form.account_id || null,
        category_id: form.category_id || null,
        shared_with_user_id: form.share_with_family ? null : (form.shared_with_user_id || null),
        workspace_id: (form.share_with_family && workspace) ? workspace.id : null,
        photo_url: photoUrl ?? null,
      })
      onClose()
    } catch {
      setSaveError(t('finance_save_error'))
    } finally {
      setSaving(false)
    }
  }

  const accent = form.type === 'income' ? FIN_POS : FIN_NEG

  const photoSection = (
    <div>
      <label style={labelStyle}>{t('finance_tx_receipt')}</label>
      {photoPreview ? (
        <div>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={photoPreview}
              alt={t('finance_tx_receipt')}
              style={{ display: 'block', maxHeight: 120, maxWidth: '100%', borderRadius: 8, border: '1px solid var(--color-border)', objectFit: 'contain', backgroundColor: '#000' }}
            />
            <div style={{ position: 'absolute', top: 5, right: 5, display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={handlePhotoDownload}
                title={t('finance_photo_download')}
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemovePhoto(true)}
                title={t('finance_photo_remove')}
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {confirmRemovePhoto && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: '#dc2626' }}>{t('finance_photo_remove_confirm')}</span>
              <button type="button" onClick={handlePhotoRemove}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                {t('finance_remove')}
              </button>
              <button type="button" onClick={() => setConfirmRemovePhoto(false)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', fontSize: 12, cursor: 'pointer' }}>
                {t('finance_cancel')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderRadius: 8, border: '1.5px dashed var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 14, width: '100%', justifyContent: 'center' }}
        >
          <Camera size={16} />
          {t('finance_tx_attach_receipt')}
        </button>
      )}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoChange(f) }}
      />
    </div>
  )

  // ─── Mobile: quick-entry bottom sheet ───────────────────────────────────────
  if (isMobile) {
    return (
      <Modal title={tx ? t('finance_edit') : t('finance_new_transaction')} onClose={onClose}>
        {/* Type toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {(['expense', 'income'] as FinanceTxType[]).map(tp => (
            <button
              key={tp}
              onClick={() => setForm(f => ({ ...f, type: tp, category_id: '' }))}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 12, border: '2px solid',
                borderColor: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-border)',
                backgroundColor: form.type === tp ? (tp === 'income' ? FIN_POS_SOFT : '#ef444422') : 'transparent',
                color: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-text-muted)',
                cursor: 'pointer', fontWeight: 700, fontSize: 15,
              }}
            >
              {tp === 'income' ? t('finance_tx_income') : t('finance_tx_expense')}
            </button>
          ))}
        </div>

        {/* Big amount */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0 18px' }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text-muted)' }}>R$</span>
          <input
            inputMode="decimal"
            type="text"
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value.replace(/[^0-9.,]/g, '') }))}
            placeholder="0,00"
            style={{ width: '60%', border: 'none', outline: 'none', backgroundColor: 'transparent', fontSize: 44, fontWeight: 800, color: accent, textAlign: 'center', padding: 0 }}
          />
        </div>

        {/* Category chips */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t('finance_tx_category')}</label>
          <div className="finance-hide-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
            <button type="button" onClick={() => setForm(f => ({ ...f, category_id: '' }))}
              style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 20, border: '1.5px solid', borderColor: !form.category_id ? 'var(--color-text)' : 'var(--color-border)', backgroundColor: !form.category_id ? 'var(--color-active)' : 'var(--color-surface)', color: !form.category_id ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', minHeight: 40 }}>
              {t('finance_tx_none_category')}
            </button>
            {filteredCats.map(c => {
              const sel = form.category_id === c.id
              return (
                <button key={c.id} type="button" onClick={() => setForm(f => ({ ...f, category_id: c.id }))}
                  style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 20, border: '1.5px solid', borderColor: sel ? c.color : 'var(--color-border)', backgroundColor: sel ? `${c.color}22` : 'var(--color-surface)', color: sel ? c.color : 'var(--color-text)', cursor: 'pointer', fontSize: 13, fontWeight: sel ? 700 : 500, whiteSpace: 'nowrap', minHeight: 40 }}>
                  <span style={{ fontSize: 16 }}>{c.icon}</span>{c.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Description */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>{t('finance_tx_description')}</label>
          <input style={{ ...inputStyle, padding: '12px 12px', fontSize: 15 }} type="text" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder={form.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')} />
        </div>

        {/* More options (collapsed) */}
        <button type="button" onClick={() => setShowMore(s => !s)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '10px 0', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 13, fontWeight: 600 }}>
          <ChevronDown size={15} style={{ transform: showMore ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          {t('finance_more_options')}
        </button>
        {showMore && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
            <div>
              <label style={labelStyle}>{t('finance_tx_date')}</label>
              <input style={{ ...inputStyle, padding: '12px 12px', fontSize: 15 }} type="date" value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t('finance_tx_account')}</label>
              <select style={{ ...inputStyle, padding: '12px 12px', fontSize: 15 }} value={form.account_id}
                onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
                <option value="">{t('finance_tx_none_account')}</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
                ))}
              </select>
            </div>
            {workspace ? (
              <div>
                <label style={labelStyle}>{t('finance_share_family')}</label>
                <button type="button" onClick={() => setForm(f => ({ ...f, share_with_family: !f.share_with_family, category_id: '', account_id: '' }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: form.share_with_family ? 'var(--color-active)' : 'var(--color-bg)', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: form.share_with_family ? FIN_ACCENT : 'var(--color-border)', position: 'relative', transition: 'background-color 0.2s', flexShrink: 0 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', top: 2, left: form.share_with_family ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                  </div>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{workspace.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                      {form.share_with_family ? '✓ Compartilhado' : 'Apenas individual'}
                    </span>
                  </div>
                </button>
              </div>
            ) : (
              <UserPicker
                label={t('finance_share_with')}
                value={form.shared_with_user_id}
                onChange={id => setForm(f => ({ ...f, shared_with_user_id: id }))}
                knownPartners={partners}
              />
            )}
            {photoSection}
          </div>
        )}

        {/* Sticky footer actions */}
        <div style={{ position: 'sticky', bottom: 0, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20, paddingTop: 12, backgroundColor: 'var(--color-bg)' }}>
          {saveError && (
            <div style={{ padding: '10px 12px', borderRadius: 10, backgroundColor: '#ef44441a', color: '#ef4444', fontSize: 13, fontWeight: 600 }}>
              {saveError}
            </div>
          )}
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '15px 16px', borderRadius: 12, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
            {t('finance_save')}
          </button>
          {tx && onDelete && (
            confirming ? (
              <button onClick={async () => { await onDelete?.(); onClose() }}
                style={{ padding: '13px 16px', borderRadius: 12, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
                {t('finance_confirm_delete')}
              </button>
            ) : (
              <button onClick={() => setConfirming(true)}
                style={{ padding: '13px 16px', borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Trash2 size={15} />{t('finance_delete')}
              </button>
            )
          )}
        </div>
      </Modal>
    )
  }

  // ─── Desktop: right-side drawer ──────────────────────────────────────────────
  return (
    <Drawer
      title={tx ? t('finance_edit') : t('finance_new_transaction')}
      onClose={onClose}
      footer={
        <>
          {tx && onDelete && (
            confirming ? (
              <button onClick={async () => { await onDelete?.(); onClose() }}
                style={{ border: 'none', background: FIN_NEG, color: '#fff', fontSize: 13, fontWeight: 600, padding: '9px 14px', borderRadius: 8, cursor: 'pointer' }}>
                {t('finance_confirm_delete')}
              </button>
            ) : (
              <button onClick={() => setConfirming(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${FIN_NEG}`, background: 'var(--color-surface)', color: FIN_NEG, fontSize: 13, fontWeight: 600, padding: '9px 13px', borderRadius: 8, cursor: 'pointer' }}>
                <Trash2 size={15} />{t('finance_delete')}
              </button>
            )
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtnStyle}>{t('finance_cancel')}</button>
          <button onClick={handleSave} disabled={saving} style={{ ...primaryBtnStyle, padding: '10px 18px', opacity: saving ? 0.7 : 1 }}>{t('finance_save')}</button>
        </>
      }
    >
      {/* Type toggle */}
      <div style={{ ...segTrackStyle, display: 'flex' }}>
        <button onClick={() => setForm(f => ({ ...f, type: 'expense', category_id: '' }))} style={segBtnStyle(form.type === 'expense', { wide: true })}>{t('finance_tx_expense')}</button>
        <button onClick={() => setForm(f => ({ ...f, type: 'income', category_id: '' }))} style={segBtnStyle(form.type === 'income', { wide: true })}>{t('finance_tx_income')}</button>
      </div>

      <div>
        <label style={labelStyle}>{t('finance_tx_amount')}</label>
        <input style={inputStyle} type="number" min="0" step="0.01" value={form.amount}
          onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
      </div>
      <div>
        <label style={labelStyle}>{t('finance_tx_description')}</label>
        <input style={inputStyle} type="text" value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder={form.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')} />
      </div>
      <div>
        <label style={labelStyle}>{t('finance_tx_category')}</label>
        <select style={inputStyle} value={form.category_id}
          onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
          <option value="">{t('finance_tx_none_category')}</option>
          {filteredCats.map(c => (
            <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>{t('finance_tx_account')}</label>
        <select style={inputStyle} value={form.account_id}
          onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
          <option value="">{t('finance_tx_none_account')}</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>{t('finance_tx_date')}</label>
        <input style={inputStyle} type="date" value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
      </div>
      {workspace ? (
        <div>
          <label style={labelStyle}>{t('finance_share_family')}</label>
          <button type="button" onClick={() => setForm(f => ({ ...f, share_with_family: !f.share_with_family, category_id: '', account_id: '' }))}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: form.share_with_family ? 'var(--color-active)' : 'var(--color-surface)', cursor: 'pointer', transition: 'all 0.15s' }}>
            <div style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: form.share_with_family ? FIN_ACCENT : 'var(--color-border)', position: 'relative', transition: 'background-color 0.2s', flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', position: 'absolute', top: 2, left: form.share_with_family ? 18 : 2, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{workspace.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                {form.share_with_family ? '✓ Compartilhado' : 'Apenas individual'}
              </span>
            </div>
          </button>
        </div>
      ) : (
        <UserPicker
          label={t('finance_share_with')}
          value={form.shared_with_user_id}
          onChange={id => setForm(f => ({ ...f, shared_with_user_id: id }))}
          knownPartners={partners}
        />
      )}

      {photoSection}

      {saveError && (
        <div style={{ padding: '10px 12px', borderRadius: 8, background: FIN_NEG_SOFT, color: FIN_NEG, fontSize: 13, fontWeight: 600 }}>
          {saveError}
        </div>
      )}
    </Drawer>
  )
}

// ─── Account Modal ────────────────────────────────────────────────────────────

const ACCOUNT_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316']

function AccountModal({
  account, onClose, onSave, onDelete,
}: {
  account?: FinanceAccount
  onClose: () => void
  onSave: (data: Omit<FinanceAccount, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    name: account?.name ?? '',
    type: account?.type ?? 'checking' as FinanceAccount['type'],
    initial_balance: account ? String(fromCents(account.initial_balance)) : '0',
    color: account?.color ?? '#6366f1',
    icon: account?.icon ?? '🏦',
  })

  const handleTypeChange = (accType: FinanceAccount['type']) => {
    setForm(f => ({ ...f, type: accType, icon: ACCOUNT_TYPE_ICONS[accType] ?? '🏦' }))
  }
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    await onSave({
      name: form.name.trim(),
      type: form.type,
      initial_balance: toCents(form.initial_balance),
      color: form.color,
      icon: form.icon || ACCOUNT_TYPE_ICONS[form.type] || '🏦',
    })
    setSaving(false)
    onClose()
  }

  const typeLabels: Record<string, string> = {
    checking: t('finance_account_type_checking'),
    savings: t('finance_account_type_savings'),
    credit: t('finance_account_type_credit'),
    cash: t('finance_account_type_cash'),
  }

  return (
    <Modal title={account ? t('finance_edit') : t('finance_new_account')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_account_name')}</label>
          <input style={inputStyle} type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_account_type')}</label>
          <select style={inputStyle} value={form.type}
            onChange={e => handleTypeChange(e.target.value as FinanceAccount['type'])}>
            {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t('finance_account_balance')}</label>
          <input style={inputStyle} type="number" step="0.01" value={form.initial_balance}
            onChange={e => setForm(f => ({ ...f, initial_balance: e.target.value }))} />
        </div>
        <EmojiInput label={t('finance_goal_icon')} value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        <div>
          <label style={labelStyle}>{t('finance_account_color')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ACCOUNT_COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width: 28, height: 28, borderRadius: '50%', border: form.color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        {account && onDelete && !confirming && (
          <button onClick={() => setConfirming(true)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Trash2 size={13} />{t('finance_delete')}
          </button>
        )}
        {confirming && (
          <button onClick={async () => { await onDelete?.(); onClose() }}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 14 }}>
            {t('finance_confirm_delete')}
          </button>
        )}
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Budget Modal ─────────────────────────────────────────────────────────────

function BudgetModal({
  categories, month, existing, partners, onClose, onSave,
}: {
  categories: FinanceCategory[]
  month: string
  existing: FinanceBudget[]
  partners: PartnerProfile[]
  onClose: () => void
  onSave: (data: { category_id: string; month: string; amount_limit: number; shared_with_user_id: string | null }) => Promise<void>
}) {
  const { t } = useLanguage()
  const expenseCats = categories.filter(c => c.type === 'expense')
  const usedIds = new Set(existing.map(b => b.category_id))
  const available = expenseCats.filter(c => !usedIds.has(c.id))
  const [catId, setCatId] = useState(available[0]?.id ?? '')
  const [limit, setLimit] = useState('')
  const [sharedWith, setSharedWith] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const amt = toCents(limit)
    if (!catId || !amt || amt <= 0) return
    setSaving(true)
    await onSave({ category_id: catId, month, amount_limit: amt, shared_with_user_id: sharedWith || null })
    setSaving(false)
    onClose()
  }

  if (available.length === 0) {
    return (
      <Modal title={t('finance_new_budget')} onClose={onClose}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{t('finance_all_categories_budgeted')}</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>{t('finance_cancel')}</button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={t('finance_new_budget')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_budget_category')}</label>
          <select style={inputStyle} value={catId} onChange={e => setCatId(e.target.value)}>
            {available.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>{t('finance_budget_limit')}</label>
          <input style={inputStyle} type="number" min="0" step="0.01" value={limit}
            onChange={e => setLimit(e.target.value)} />
        </div>
        <UserPicker
          label={t('finance_share_with')}
          value={sharedWith}
          onChange={setSharedWith}
          knownPartners={partners}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ transactions, categories, month, recurring, recurringEntries, accounts, budgets, goals, contributions, onMarkPaid, onSkipEntry, onNavigate }: {
  transactions: FinanceTransaction[]
  categories: FinanceCategory[]
  month: string
  recurring: FinanceRecurring[]
  recurringEntries: FinanceRecurringEntry[]
  accounts: FinanceAccount[]
  budgets: FinanceBudget[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  onMarkPaid: (entry: FinanceRecurringEntry, rec: FinanceRecurring) => void
  onSkipEntry: (entryId: string) => void
  onNavigate: (tab: TabId) => void
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const [confirm, setConfirm] = useState<{ entryId: string; action: 'pay' | 'skip' } | null>(null)
  const monthTxs = transactions.filter(tx => tx.date.startsWith(month))

  const income = monthTxs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
  const expense = monthTxs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
  const balance = income - expense

  // Previous-month totals power the "vs. mês anterior" deltas.
  const prevYM = prevMonth(month)
  const prevTxs = transactions.filter(tx => tx.date.startsWith(prevYM))
  const prevIncome = prevTxs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
  const prevExpense = prevTxs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)

  // Expense breakdown by category (donut + legend)
  const catMap = new Map(categories.map(c => [c.id, c]))
  const expenseBycat: Record<string, number> = {}
  monthTxs.filter(tx => tx.type === 'expense' && tx.category_id).forEach(tx => {
    expenseBycat[tx.category_id!] = (expenseBycat[tx.category_id!] ?? 0) + tx.amount
  })
  const topCats = Object.entries(expenseBycat).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const donutTotal = topCats.reduce((s, [, v]) => s + v, 0)
  let donutAcc = 0
  const donutStops = topCats.map(([catId, amount]) => {
    const c = catMap.get(catId)
    const start = (donutAcc / donutTotal) * 100
    donutAcc += amount
    const end = (donutAcc / donutTotal) * 100
    return `${c?.color ?? '#9b9a97'} ${start.toFixed(2)}% ${end.toFixed(2)}%`
  })
  const donutGradient = donutTotal > 0 ? `conic-gradient(${donutStops.join(',')})` : 'var(--color-border)'

  // Last 6 months evolution
  const months6 = last6Months(month)
  const monthStats = months6.map(m => {
    const mTxs = transactions.filter(tx => tx.date.startsWith(m))
    return {
      month: m,
      label: new Date(parseInt(m.split('-')[0]), parseInt(m.split('-')[1]) - 1, 1)
        .toLocaleDateString('pt-BR', { month: 'short' }),
      income: mTxs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0),
      expense: mTxs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0),
    }
  })
  const maxBar = Math.max(...monthStats.flatMap(m => [m.income, m.expense]), 1)

  // Upcoming bills — next 15 days + overdue pending entries
  const todayDate = new Date()
  todayDate.setHours(0, 0, 0, 0)
  const horizon = new Date(todayDate)
  horizon.setDate(todayDate.getDate() + 15)
  const recMap = new Map(recurring.map(r => [r.id, r]))
  const upcomingEntries = recurringEntries
    .filter(e => {
      if (e.status !== 'pending') return false
      const due = new Date(e.due_date + 'T12:00:00')
      return due <= horizon
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  // ─── Sector mini-summaries ──────────────────────────────────────────────────
  const accountsBalance = accounts.reduce((sum, acc) => {
    const txs = transactions.filter(tx => tx.account_id === acc.id)
    const inc = txs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
    const exp = txs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
    return sum + acc.initial_balance + inc - exp
  }, 0)

  const activeGoals = goals.filter(g => g.status === 'active')
  const goalsTarget = activeGoals.reduce((s, g) => s + g.target_amount, 0)
  const goalsAccumulated = activeGoals.reduce((s, g) =>
    s + contributions.filter(c => c.goal_id === g.id).reduce((cs, c) => cs + c.amount, 0), 0)
  const goalsPct = goalsTarget > 0 ? Math.min((goalsAccumulated / goalsTarget) * 100, 100) : 0

  const monthBudgets = budgets.filter(b => b.month === month)
  const spentPerCat: Record<string, number> = {}
  monthTxs.filter(tx => tx.type === 'expense' && tx.category_id).forEach(tx => {
    spentPerCat[tx.category_id!] = (spentPerCat[tx.category_id!] ?? 0) + tx.amount
  })
  const budgetsOver = monthBudgets.filter(b => (spentPerCat[b.category_id] ?? 0) > b.amount_limit).length
  const budgetMini = monthBudgets.map(b => {
    const cat = catMap.get(b.category_id)
    const spent = spentPerCat[b.category_id] ?? 0
    const pct = b.amount_limit > 0 ? Math.min((spent / b.amount_limit) * 100, 100) : 0
    return { id: b.id, name: cat?.name ?? '—', spent, limit: b.amount_limit, pct, over: spent > b.amount_limit }
  }).slice(0, 5)

  const deltaNode = (cur: number, prev: number, higherIsBad: boolean) => {
    if (!prev) return <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>—</span>
    const d = ((cur - prev) / prev) * 100
    const up = d >= 0
    const good = higherIsBad ? !up : up
    return <span style={{ color: good ? FIN_POS : FIN_NEG, fontWeight: 600, ...tabularNums }}>{up ? '+' : '−'}{Math.abs(d).toFixed(1).replace('.', ',')}%</span>
  }

  const summaryCard = (label: string, value: number, icon: React.ReactNode, chipBg: string, chipColor: string, valueColor: string, sub: React.ReactNode) => (
    <div style={{ ...cardSurfaceStyle, padding: '16px 18px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{label}</span>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: chipBg, color: chipColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: valueColor, ...tabularNums }}>{fmt(value)}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, fontSize: 12.5, color: 'var(--color-text-subtle)' }}>{sub}</div>
    </div>
  )

  const sectorCard = (key: string, icon: React.ReactNode, label: string, value: React.ReactNode, sub: string, tab: TabId) => (
    <button key={key} onClick={() => onNavigate(tab)}
      style={{ textAlign: 'left', ...cardSurfaceStyle, padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-text-subtle)' }}>
          <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>{icon}</span>{label}
        </span>
        <ChevronRight size={16} style={{ color: 'var(--color-text-muted)' }} />
      </div>
      <div style={{ fontSize: 19, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{sub}</div>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 14 }}>
        {summaryCard(t('finance_month_income'), income, <TrendingUp size={17} />, FIN_POS_SOFT, FIN_POS, 'var(--color-text)',
          <><span>{deltaNode(income, prevIncome, false)}</span><span>{t('finance_vs_prev_month')}</span></>)}
        {summaryCard(t('finance_month_expense'), expense, <TrendingDown size={17} />, FIN_NEG_SOFT, FIN_NEG, 'var(--color-text)',
          <><span>{deltaNode(expense, prevExpense, true)}</span><span>{t('finance_vs_prev_month')}</span></>)}
        {summaryCard(t('finance_month_balance'), balance, <Wallet size={17} />, 'var(--color-active)', 'var(--color-text)', balance >= 0 ? 'var(--color-text)' : FIN_NEG,
          <span>{t('finance_balance_sub')}</span>)}
      </div>

      {/* Sector shortcuts */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 14 }}>
        {sectorCard('accounts', <CreditCard size={16} />, t('finance_tab_accounts'),
          fmt(accountsBalance),
          accounts.length === 1 ? t('finance_overview_accounts_sub', { n: accounts.length }) : t('finance_overview_accounts_sub_plural', { n: accounts.length }),
          'accounts')}
        {sectorCard('goals', <Star size={16} />, t('finance_tab_goals'),
          activeGoals.length > 0 ? `${goalsPct.toFixed(0)}%` : '—',
          activeGoals.length === 1 ? t('finance_overview_goals_sub', { n: activeGoals.length }) : t('finance_overview_goals_sub_plural', { n: activeGoals.length }),
          'goals')}
        {sectorCard('budgets', <Target size={16} />, t('finance_tab_budgets'),
          monthBudgets.length > 0 ? (budgetsOver > 0 ? t('finance_overview_budgets_over', { n: budgetsOver }) : t('finance_overview_budgets_ok')) : '—',
          monthBudgets.length === 1 ? t('finance_overview_budgets_sub', { n: monthBudgets.length }) : t('finance_overview_budgets_sub_plural', { n: monthBudgets.length }),
          'budgets')}
        {sectorCard('recurring', <RefreshCw size={16} />, t('finance_tab_recurring'),
          upcomingEntries.length > 0 ? String(upcomingEntries.length) : '—',
          upcomingEntries.length === 1 ? t('finance_overview_recurring_sub', { n: upcomingEntries.length }) : t('finance_overview_recurring_sub_plural', { n: upcomingEntries.length }),
          'recurring')}
      </div>

      {/* Monthly evolution */}
      <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 style={sectionCaptionStyle}>{t('finance_monthly_evolution')}</h3>
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-subtle)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: FIN_POS }} />{t('finance_month_income')}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: FIN_NEG }} />{t('finance_month_expense')}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 172 }}>
          {monthStats.map(ms => (
            <div key={ms.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, height: '100%', justifyContent: 'flex-end' }}>
              <div title={`${t('finance_tx_income')}: ${fmt(ms.income)} · ${t('finance_tx_expense')}: ${fmt(ms.expense)}`} style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: '100%', width: '100%', justifyContent: 'center' }}>
                <div style={{ width: 15, background: FIN_POS, borderRadius: '3px 3px 0 0', height: `${(ms.income / maxBar) * 100}%`, minHeight: ms.income > 0 ? 3 : 0, transition: 'height 0.4s ease' }} />
                <div style={{ width: 15, background: FIN_NEG, borderRadius: '3px 3px 0 0', height: `${(ms.expense / maxBar) * 100}%`, minHeight: ms.expense > 0 ? 3 : 0, transition: 'height 0.4s ease' }} />
              </div>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{ms.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Gastos por categoria (donut) + Orçamentos do mês */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
        <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
          <h3 style={{ ...sectionCaptionStyle, marginBottom: 14 }}>{t('finance_overview_donut_title')}</h3>
          {donutTotal > 0 ? (
            <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', width: 130, height: 130, flexShrink: 0 }}>
                <div style={{ width: 130, height: 130, borderRadius: '50%', background: donutGradient }} />
                <div style={{ position: 'absolute', inset: 19, background: 'var(--color-surface)', borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_chart_total')}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{fmt(donutTotal)}</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, minWidth: 150 }}>
                {topCats.map(([catId, amount]) => {
                  const cat = catMap.get(catId)
                  if (!cat) return null
                  return (
                    <div key={catId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, flexShrink: 0, background: cat.color }} />
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.icon} {cat.name}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', width: 34, textAlign: 'right' }}>{Math.round((amount / donutTotal) * 100)}%</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', textAlign: 'right', ...tabularNums }}>{fmt(amount)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ padding: '28px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_no_transactions')}</div>
          )}
        </div>

        <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={sectionCaptionStyle}>{t('finance_budgets_of_month')}</h3>
            <button onClick={() => onNavigate('budgets')} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('finance_see_all')}</button>
          </div>
          {budgetMini.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {budgetMini.map(b => (
                <div key={b.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: 8 }}>{b.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-subtle)', whiteSpace: 'nowrap', flexShrink: 0, ...tabularNums }}>{fmt(b.spent)} / {fmt(b.limit)}</span>
                  </div>
                  <div style={{ height: 7, background: 'var(--color-bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${b.pct}%`, background: b.over ? FIN_NEG : FIN_ACCENT, borderRadius: 5, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_no_budgets')}</div>
          )}
        </div>
      </div>

      {/* Upcoming bills (kept — actionable) */}
      {upcomingEntries.length > 0 && (
        <div style={{ ...cardSurfaceStyle, padding: '18px 20px' }}>
          <h3 style={{ ...sectionCaptionStyle, marginBottom: 14 }}>{t('finance_upcoming_bills')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcomingEntries.map(entry => {
              const rec = recMap.get(entry.recurring_id)
              if (!rec) return null
              const due = new Date(entry.due_date + 'T12:00:00')
              const diffDays = Math.round((due.getTime() - todayDate.getTime()) / 86400000)
              const badgeColor = diffDays < 0 ? FIN_NEG : diffDays <= 7 ? FIN_WARN : FIN_POS
              const badgeLabel = diffDays < 0 ? t('finance_upcoming_overdue') : diffDays === 0 ? t('finance_upcoming_today') : diffDays === 1 ? t('finance_upcoming_days_left', { n: diffDays }) : t('finance_upcoming_days_left_plural', { n: diffDays })
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{rec.is_variable ? '📋' : rec.type === 'income' ? '💰' : '💸'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.description}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {new Date(entry.due_date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                      {rec.is_variable ? ` · ${t('finance_upcoming_variable')}` : rec.amount != null ? ` · ${fmt(rec.amount)}` : ''}
                    </p>
                  </div>
                  <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, backgroundColor: `${badgeColor}22`, color: badgeColor, fontWeight: 700, flexShrink: 0 }}>{badgeLabel}</span>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {confirm?.entryId === entry.id ? (
                      <>
                        <button onClick={() => { if (confirm.action === 'pay') onMarkPaid(entry, rec); else onSkipEntry(entry.id); setConfirm(null) }}
                          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: confirm.action === 'pay' ? FIN_POS : FIN_NEG, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          ✓ {t('finance_confirm')}
                        </button>
                        <button onClick={() => setConfirm(null)}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setConfirm({ entryId: entry.id, action: 'pay' })}
                          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', backgroundColor: FIN_POS, color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
                          {t('finance_recurring_mark_paid')}
                        </button>
                        <button onClick={() => setConfirm({ entryId: entry.id, action: 'skip' })}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}>
                          {t('finance_recurring_skip')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────

function TransactionsTab({ transactions, partnerTransactions, partnerProfiles, accounts, categories, month, onAdd, onEdit, onQuickAdd, onBulkDelete }: {
  transactions: FinanceTransaction[]
  partnerTransactions: FinanceTransaction[]
  partnerProfiles: PartnerProfile[]
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  month: string
  onAdd: () => void
  onEdit: (tx: FinanceTransaction) => void
  onQuickAdd: (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onBulkDelete: (ids: string[]) => Promise<void>
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const [filterType, setFilterType] = useState<'all' | FinanceTxType>('all')
  const [filterCat, setFilterCat] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))
  const catMap = new Map(categories.map(c => [c.id, c]))
  const accMap = new Map(accounts.map(a => [a.id, a]))

  // Quick add ("Lançamento rápido")
  const [qaType, setQaType] = useState<FinanceTxType>('expense')
  const [qaDesc, setQaDesc] = useState('')
  const [qaAmount, setQaAmount] = useState('')
  const [qaCat, setQaCat] = useState('')
  const [qaAcc, setQaAcc] = useState('')
  const [qaSaving, setQaSaving] = useState(false)
  const qaCats = categories.filter(c => c.type === qaType)
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()

  const submitQuickAdd = async () => {
    const cents = toCents(qaAmount)
    if (!qaDesc.trim() || cents <= 0 || qaSaving) return
    setQaSaving(true)
    try {
      await onQuickAdd({
        type: qaType,
        amount: cents,
        description: qaDesc.trim(),
        date: today,
        category_id: (qaCat || qaCats[0]?.id) ?? null,
        account_id: (qaAcc || accounts[0]?.id) ?? null,
        shared_with_user_id: null,
      })
      setQaDesc('')
      setQaAmount('')
    } finally {
      setQaSaving(false)
    }
  }

  const filtered = transactions.filter(tx => {
    if (filterType !== 'all' && tx.type !== filterType) return false
    if (filterCat && tx.category_id !== filterCat) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const cat = tx.category_id ? catMap.get(tx.category_id) : null
      if (!(tx.description?.toLowerCase().includes(q) || cat?.name.toLowerCase().includes(q))) return false
    }
    return true
  })

  const grouped: { date: string; txs: FinanceTransaction[] }[] = []
  filtered.forEach(tx => {
    const last = grouped[grouped.length - 1]
    if (last && last.date === tx.date) last.txs.push(tx)
    else grouped.push({ date: tx.date, txs: [tx] })
  })

  const toggleSel = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const doBulkDelete = async () => { const ids = selected; setSelected([]); await onBulkDelete(ids) }

  const fieldStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)', outline: 'none' }
  const iconActionStyle: React.CSSProperties = { width: 28, height: 28, border: 'none', background: 'transparent', borderRadius: 6, color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={segTrackStyle}>
          {(['all', 'income', 'expense'] as const).map(f => (
            <button key={f} onClick={() => setFilterType(f)} style={segBtnStyle(filterType === f)}>
              {f === 'all' ? t('finance_filter_all') : f === 'income' ? t('finance_filter_income') : t('finance_filter_expense')}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flex: isMobile ? 1 : 'none' }}>
          <Search size={16} style={{ position: 'absolute', left: 9, color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('finance_search_placeholder')}
            style={{ ...fieldStyle, padding: '8px 10px 8px 32px', width: isMobile ? '100%' : 210 }} />
        </div>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
          <option value="">{t('finance_all_categories')}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => downloadTransactionsCsv(filtered, categories, accounts, month)} style={ghostBtnStyle}>
          <Download size={16} />{!isMobile && t('finance_export')}
        </button>
        <button onClick={onAdd} style={primaryBtnStyle}>
          <Plus size={16} />{t('finance_new_transaction')}
        </button>
      </div>

      {/* Quick add */}
      <div style={{ ...cardSurfaceStyle, padding: '13px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
          <Zap size={16} style={{ color: FIN_ACCENT }} />
          <span style={{ ...sectionCaptionStyle, fontSize: 11.5 }}>{t('finance_quick_add')}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={segTrackStyle}>
            <button onClick={() => setQaType('expense')} style={segBtnStyle(qaType === 'expense')}>{t('finance_filter_expense')}</button>
            <button onClick={() => setQaType('income')} style={segBtnStyle(qaType === 'income')}>{t('finance_filter_income')}</button>
          </div>
          <input value={qaDesc} onChange={e => setQaDesc(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd() }} placeholder={t('finance_tx_description')}
            style={{ ...fieldStyle, flex: 2, minWidth: 150 }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <span style={{ position: 'absolute', left: 10, fontSize: 12.5, color: 'var(--color-text-muted)', pointerEvents: 'none' }}>R$</span>
            <input value={qaAmount} onChange={e => setQaAmount(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitQuickAdd() }} inputMode="decimal" placeholder="0,00"
              style={{ ...fieldStyle, width: 118, padding: '8px 10px 8px 32px', ...tabularNums }} />
          </div>
          <select value={qaCat || qaCats[0]?.id || ''} onChange={e => setQaCat(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer', maxWidth: 150 }}>
            {qaCats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <select value={qaAcc || accounts[0]?.id || ''} onChange={e => setQaAcc(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
          <button onClick={submitQuickAdd} disabled={qaSaving} style={{ ...primaryBtnStyle, opacity: qaSaving ? 0.6 : 1 }}>
            <Plus size={16} />{t('finance_add')}
          </button>
        </div>
      </div>

      {/* Bulk selection bar */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--color-active)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 14px' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_selected_count', { n: selected.length })}</span>
          <div style={{ flex: 1 }} />
          <button onClick={doBulkDelete} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${FIN_NEG}`, background: 'var(--color-surface)', color: FIN_NEG, fontSize: 12.5, fontWeight: 600, padding: '6px 11px', borderRadius: 7, cursor: 'pointer' }}>
            <Trash2 size={14} />{t('finance_delete')}
          </button>
          <button onClick={() => setSelected([])} style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}>{t('finance_clear')}</button>
        </div>
      )}

      {/* Transaction list */}
      {filtered.length === 0 ? (
        <div style={{ ...cardSurfaceStyle, padding: '48px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: 'var(--color-text-subtle)' }}>{t('finance_no_transactions')}</div>
        </div>
      ) : (
        <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
          {grouped.map(group => {
            const net = group.txs.reduce((s, tx) => s + (tx.type === 'income' ? tx.amount : -tx.amount), 0)
            return (
              <div key={group.date}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'capitalize' }}>
                    {new Date(group.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
                  </span>
                  <span style={{ fontSize: 12, color: net >= 0 ? FIN_POS : FIN_NEG, fontWeight: 600, ...tabularNums }}>{net >= 0 ? '+' : '−'}{fmt(Math.abs(net))}</span>
                </div>
                {group.txs.map(tx => {
                  const cat = tx.category_id ? catMap.get(tx.category_id) : null
                  const acc = tx.account_id ? accMap.get(tx.account_id) : null
                  const isSel = selected.includes(tx.id)
                  return (
                    <div key={tx.id} onClick={() => onEdit(tx)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', background: isSel ? 'var(--color-hover)' : 'transparent', transition: 'background 0.1s' }}
                      onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                      onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>
                      <input type="checkbox" checked={isSel} onClick={e => e.stopPropagation()} onChange={() => toggleSel(tx.id)}
                        style={{ width: 15, height: 15, accentColor: 'var(--color-text)', cursor: 'pointer', flexShrink: 0 }} />
                      <span style={{ width: 34, height: 34, borderRadius: 9, background: cat ? `${cat.color}22` : 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
                        {cat ? cat.icon : (tx.type === 'income' ? '💰' : '💸')}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tx.description || (cat?.name ?? (tx.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')))}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{cat?.name ?? t('finance_tx_none_category')}</div>
                      </div>
                      {acc && <span style={{ fontSize: 11.5, color: 'var(--color-text-subtle)', background: 'var(--color-bg-secondary)', borderRadius: 6, padding: '3px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}>{acc.icon} {acc.name}</span>}
                      {tx.photo_url && <Camera size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
                      <span style={{ fontSize: 14, fontWeight: 600, color: tx.type === 'income' ? FIN_POS : FIN_NEG, textAlign: 'right', flexShrink: 0, ...tabularNums }}>
                        {tx.type === 'income' ? '+' : '−'}{fmt(tx.amount)}
                      </span>
                      <div style={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                        <button title={t('finance_edit')} onClick={e => { e.stopPropagation(); onEdit(tx) }} style={iconActionStyle}><Pencil size={15} /></button>
                        <button title={t('finance_delete')} onClick={e => { e.stopPropagation(); onBulkDelete([tx.id]) }} style={iconActionStyle}><Trash2 size={15} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {/* Partner shared transactions */}
      {partnerTransactions.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link2 size={11} />{t('finance_tx_shared_partner')}
          </p>
          <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
            {partnerTransactions.map(tx => {
              const cat = tx.category_id ? catMap.get(tx.category_id) : null
              const owner = profileMap.get(tx.user_id)
              return (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, background: cat ? `${cat.color}22` : 'var(--color-bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>
                    {cat ? cat.icon : (tx.type === 'income' ? '💰' : '💸')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.description || (cat?.name ?? (tx.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {t('finance_tx_shared_by')} {owner?.display_name || owner?.email || '?'}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, background: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)', fontWeight: 600, flexShrink: 0 }}>{t('finance_shared_badge')}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: tx.type === 'income' ? FIN_POS : FIN_NEG, flexShrink: 0, ...tabularNums }}>
                    {tx.type === 'income' ? '+' : '−'}{fmt(tx.amount)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Budgets Tab ──────────────────────────────────────────────────────────────

function BudgetsTab({ budgets, sharedBudgets, transactions, partnerTransactions, partnerProfiles, categories, month, onAdd, onDeleteBudget }: {
  budgets: FinanceBudget[]
  sharedBudgets: FinanceBudget[]
  transactions: FinanceTransaction[]
  partnerTransactions: FinanceTransaction[]
  partnerProfiles: PartnerProfile[]
  categories: FinanceCategory[]
  month: string
  onAdd: () => void
  onDeleteBudget: (id: string) => Promise<void>
}) {
  const { t } = useLanguage()
  const catMap = new Map(categories.map(c => [c.id, c]))
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))
  const monthBudgets = budgets.filter(b => b.month === month)
  const monthSharedBudgets = sharedBudgets.filter(b => b.month === month)

  const spentPerCat: Record<string, number> = {}
  transactions.filter(tx => tx.date.startsWith(month) && tx.type === 'expense' && tx.category_id).forEach(tx => {
    spentPerCat[tx.category_id!] = (spentPerCat[tx.category_id!] ?? 0) + tx.amount
  })

  const partnerSpentPerCat: Record<string, number> = {}
  partnerTransactions.filter(tx => tx.date.startsWith(month) && tx.type === 'expense' && tx.category_id).forEach(tx => {
    partnerSpentPerCat[tx.category_id!] = (partnerSpentPerCat[tx.category_id!] ?? 0) + tx.amount
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onAdd}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_new_budget')}
        </button>
      </div>

      {monthBudgets.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>{t('finance_no_budgets')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {monthBudgets.map(budget => {
            const cat = catMap.get(budget.category_id)
            const spent = spentPerCat[budget.category_id] ?? 0
            const pct = Math.min((spent / budget.amount_limit) * 100, 100)
            const over = spent > budget.amount_limit
            const remaining = budget.amount_limit - spent
            const barColor = over ? '#ef4444' : pct > 80 ? '#f59e0b' : (cat?.color ?? '#6366f1')

            return (
              <div key={budget.id} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18 }}>{cat?.icon ?? '📦'}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{cat?.name ?? budget.category_id}</span>
                    {over && <span style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', backgroundColor: '#ef444422', padding: '2px 6px', borderRadius: 10 }}>{t('finance_budget_over')}</span>}
                  </div>
                  <button onClick={() => onDeleteBudget(budget.id)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.4s ease' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                  <span>{t('finance_budget_spent')}: <strong style={{ color: over ? '#ef4444' : 'var(--color-text)' }}>{fmt(spent)}</strong></span>
                  <span>{t('finance_budget_limit')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(budget.amount_limit)}</strong></span>
                  <span>{over ? t('finance_budget_over') : t('finance_budget_remaining')}: <strong style={{ color: over ? FIN_NEG : FIN_POS }}>{fmt(Math.abs(remaining))}</strong></span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Shared budgets from partner */}
      {monthSharedBudgets.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link2 size={11} />{t('finance_shared_badge')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {monthSharedBudgets.map(budget => {
              const cat = catMap.get(budget.category_id)
              const owner = profileMap.get(budget.user_id)
              const ownSpent = spentPerCat[budget.category_id] ?? 0
              const partnerSpent = partnerSpentPerCat[budget.category_id] ?? 0
              const combinedSpent = ownSpent + partnerSpent
              const pct = Math.min((combinedSpent / budget.amount_limit) * 100, 100)
              const over = combinedSpent > budget.amount_limit
              const barColor = over ? '#ef4444' : pct > 80 ? '#f59e0b' : 'var(--color-text)'
              return (
                <div key={budget.id} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{cat?.icon ?? '📦'}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{cat?.name ?? budget.category_id}</span>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 700 }}>{t('finance_shared_badge')}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('finance_budget_shared_by')} {owner?.display_name || owner?.email}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <span>{t('finance_budget_combined_spent')}: <strong style={{ color: over ? '#ef4444' : 'var(--color-text)' }}>{fmt(combinedSpent)}</strong></span>
                    <span>{t('finance_budget_limit')}: <strong>{fmt(budget.amount_limit)}</strong></span>
                    <span>{over ? t('finance_budget_over') : t('finance_budget_remaining')}: <strong style={{ color: over ? FIN_NEG : FIN_POS }}>{fmt(Math.abs(budget.amount_limit - combinedSpent))}</strong></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Accounts Tab ─────────────────────────────────────────────────────────────

function AccountsTab({ accounts, transactions, onAdd, onEdit }: {
  accounts: FinanceAccount[]
  transactions: FinanceTransaction[]
  onAdd: () => void
  onEdit: (acc: FinanceAccount) => void
}) {
  const { t } = useLanguage()

  const accBalance = (acc: FinanceAccount) => {
    const txs = transactions.filter(tx => tx.account_id === acc.id)
    const income = txs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
    const expense = txs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
    return acc.initial_balance + income - expense
  }

  const typeLabel: Record<string, string> = {
    checking: t('finance_account_type_checking'),
    savings: t('finance_account_type_savings'),
    credit: t('finance_account_type_credit'),
    cash: t('finance_account_type_cash'),
  }

  const totalBalance = accounts.reduce((sum, acc) => sum + accBalance(acc), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {accounts.length > 0 && (
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            {t('finance_balance_total')}: <strong style={{ color: totalBalance >= 0 ? FIN_POS : FIN_NEG }}>{fmt(totalBalance)}</strong>
          </div>
        )}
        <button onClick={onAdd}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_new_account')}
        </button>
      </div>

      {accounts.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>{t('finance_no_accounts')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {accounts.map(acc => {
            const bal = accBalance(acc)
            return (
              <div key={acc.id} onClick={() => onEdit(acc)}
                style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, padding: '18px 20px', cursor: 'pointer', borderTop: `4px solid ${acc.color}`, transition: 'background-color 0.1s' }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <span style={{ fontSize: 24 }}>{acc.icon}</span>
                  <div>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{acc.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>{typeLabel[acc.type]}</p>
                  </div>
                  <Pencil size={12} style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }} />
                </div>
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: bal >= 0 ? FIN_POS : FIN_NEG }}>{fmt(bal)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Category Modal ───────────────────────────────────────────────────────────

const CATEGORY_COLORS = ['#f97316','#3b82f6','#8b5cf6','#ef4444','#ec4899','#06b6d4','#22c55e','#84cc16','#f59e0b','#10b981','#a855f7','#6b7280']

function CategoryModal({
  category, transactions, onClose, onSave, onDelete,
}: {
  category?: FinanceCategory
  transactions: FinanceTransaction[]
  onClose: () => void
  onSave: (data: Omit<FinanceCategory, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    name: category?.name ?? '',
    type: category?.type ?? 'expense' as FinanceTxType,
    icon: category?.icon ?? '📦',
    color: category?.color ?? '#6b7280',
    is_default: category?.is_default ?? false,
  })
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const inUse = category ? transactions.some(tx => tx.category_id === category.id) : false

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    await onSave({ name: form.name.trim(), type: form.type, icon: form.icon || '📦', color: form.color, is_default: form.is_default })
    setSaving(false)
    onClose()
  }

  return (
    <Modal title={category ? t('finance_cat_edit') : t('finance_cat_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_cat_name')}</label>
          <input style={inputStyle} type="text" value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_cat_type')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['expense', 'income'] as FinanceTxType[]).map(tp => (
              <button key={tp} onClick={() => setForm(f => ({ ...f, type: tp }))}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8, border: '2px solid',
                  borderColor: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-border)',
                  backgroundColor: form.type === tp ? (tp === 'income' ? FIN_POS_SOFT : '#ef444422') : 'transparent',
                  color: form.type === tp ? (tp === 'income' ? FIN_POS : FIN_NEG) : 'var(--color-text-muted)',
                  cursor: 'pointer', fontWeight: 600, fontSize: 14,
                }}>
                {tp === 'income' ? t('finance_tx_income') : t('finance_tx_expense')}
              </button>
            ))}
          </div>
        </div>
        <EmojiInput label={t('finance_cat_icon')} value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        <div>
          <label style={labelStyle}>{t('finance_cat_color')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORY_COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width: 28, height: 28, borderRadius: '50%', border: form.color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end', alignItems: 'center' }}>
        {category && onDelete && !confirming && (
          inUse ? (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1 }}>{t('finance_cat_in_use')}</span>
          ) : (
            <button onClick={() => setConfirming(true)}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Trash2 size={13} />{t('finance_delete')}
            </button>
          )
        )}
        {confirming && (
          <button onClick={async () => { await onDelete?.(); onClose() }}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 14 }}>
            {t('finance_confirm_delete')}
          </button>
        )}
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Categories Tab ───────────────────────────────────────────────────────────

function CategoriesTab({ categories, transactions, onAdd, onEdit }: {
  categories: FinanceCategory[]
  transactions: FinanceTransaction[]
  onAdd: () => void
  onEdit: (c: FinanceCategory) => void
}) {
  const { t } = useLanguage()
  const expenses = categories.filter(c => c.type === 'expense')
  const incomes = categories.filter(c => c.type === 'income')

  const txCount = (id: string) => transactions.filter(tx => tx.category_id === id).length

  const renderList = (cats: FinanceCategory[]) => cats.map(cat => (
    <div key={cat.id}
      onClick={() => onEdit(cat)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'background-color 0.1s' }}
      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
    >
      <div style={{ width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, backgroundColor: `${cat.color}22` }}>
        {cat.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>{cat.name}</p>
        {txCount(cat.id) > 0 && (
          <span style={{ fontSize: 11, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)', borderRadius: 10, padding: '2px 8px' }}>{txCount(cat.id)}x</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: cat.color, flexShrink: 0 }} />
        <Pencil size={13} color="var(--color-text-muted)" />
      </div>
    </div>
  ))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onAdd}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_cat_new')}
        </button>
      </div>
      {categories.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>{t('finance_cat_no_categories')}</p>
      ) : (
        <>
          {expenses.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_expenses')} ({expenses.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{renderList(expenses)}</div>
            </div>
          )}
          {incomes.length > 0 && (
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: FIN_POS, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_income')} ({incomes.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{renderList(incomes)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Goal helpers ────────────────────────────────────────────────────────────

function daysUntil(deadline: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(deadline + 'T00:00:00'); d.setHours(0,0,0,0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

const GOAL_COLORS = ['#6366f1','#22c55e','#f59e0b','#ef4444','#ec4899','#06b6d4','#8b5cf6','#f97316','#14b8a6']

// ─── Goal Modal ───────────────────────────────────────────────────────────────

function GoalModal({ goal, accounts, onClose, onSave }: {
  goal?: FinanceGoal
  accounts: FinanceAccount[]
  onClose: () => void
  onSave: (data: Omit<FinanceGoal, 'id' | 'user_id' | 'created_at'>) => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState({
    name: goal?.name ?? '',
    icon: goal?.icon ?? '🎯',
    color: goal?.color ?? '#6366f1',
    target_amount: goal ? String(fromCents(goal.target_amount)) : '',
    deadline: goal?.deadline ?? '',
    account_id: goal?.account_id ?? '',
    status: goal?.status ?? 'active' as FinanceGoal['status'],
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const amt = toCents(form.target_amount)
    if (!form.name.trim() || !amt || !form.deadline) return
    setSaving(true)
    await onSave({
      name: form.name.trim(),
      icon: form.icon,
      color: form.color,
      target_amount: amt,
      deadline: form.deadline,
      account_id: form.account_id || null,
      status: form.status,
    })
    setSaving(false)
    onClose()
  }

  return (
    <Modal title={goal ? t('finance_edit') : t('finance_goal_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_goal_name')}</label>
          <input style={inputStyle} type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        </div>
        <EmojiInput label={t('finance_goal_icon')} value={form.icon} onChange={v => setForm(f => ({ ...f, icon: v }))} />
        <div>
          <label style={labelStyle}>{t('finance_goal_color')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {GOAL_COLORS.map(c => (
              <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                style={{ width: 28, height: 28, borderRadius: '50%', border: form.color === c ? '3px solid var(--color-text)' : '2px solid transparent', backgroundColor: c, cursor: 'pointer' }} />
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>{t('finance_goal_target')}</label>
          <input style={inputStyle} type="number" min="0" step="0.01" value={form.target_amount}
            onChange={e => setForm(f => ({ ...f, target_amount: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_goal_deadline')}</label>
          <input style={inputStyle} type="date" value={form.deadline}
            onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_goal_linked_account')}</label>
          <select style={inputStyle} value={form.account_id}
            onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
            <option value="">{t('finance_tx_none_account')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Contribution Modal ───────────────────────────────────────────────────────

function ContributionModal({ goal, onClose, onSave }: {
  goal: FinanceGoal
  onClose: () => void
  onSave: (data: { goal_id: string; amount: number; note: string; date: string }) => Promise<void>
}) {
  const { t } = useLanguage()
  const today = new Date().toISOString().split('T')[0]
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const amt = toCents(amount)
    if (!amt || amt <= 0) return
    setSaving(true)
    await onSave({ goal_id: goal.id, amount: amt, note: note.trim(), date })
    setSaving(false)
    onClose()
  }

  return (
    <Modal title={t('finance_goal_add_contribution')} onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', backgroundColor: `${goal.color}22`, borderRadius: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 22 }}>{goal.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{goal.name}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <label style={labelStyle}>{t('finance_goal_contribution_amount')}</label>
          <input style={inputStyle} type="number" min="0" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} autoFocus />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_goal_contribution_date')}</label>
          <input style={inputStyle} type="date" value={date}
            onChange={e => setDate(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>{t('finance_goal_contribution_note')}</label>
          <input style={inputStyle} type="text" value={note}
            onChange={e => setNote(e.target.value)} placeholder={t('finance_contribution_note_placeholder')} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: goal.color, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Goal Share Modal ────────────────────────────────────────────────────────────────

function GoalShareModal({ goal, shares, onClose, onAddShare, onRemoveShare, partnerProfiles }: {
  goal: FinanceGoal
  shares: FinanceGoalShare[]
  onClose: () => void
  onAddShare: (goalId: string, userId: string) => Promise<void>
  onRemoveShare: (shareId: string) => Promise<void>
  partnerProfiles: PartnerProfile[]
}) {
  const { t } = useLanguage()
  const [selectedUserId, setSelectedUserId] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    if (!selectedUserId) return
    setSaving(true)
    await onAddShare(goal.id, selectedUserId)
    setSelectedUserId('')
    setSaving(false)
  }

  return (
    <Modal title={`${t('finance_goal_share_title')}: ${goal.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Current collaborators */}
        <div>
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_goal_collaborators')}</p>
          {shares.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_goal_no_collaborators')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shares.map(s => {
                const p = s.profile
                const name = p?.display_name || p?.email || s.shared_with_user_id
                return (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--color-text)', flexShrink: 0 }}>
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{name}</p>
                      {p?.email && p.display_name && <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{p.email}</p>}
                    </div>
                    <button onClick={() => onRemoveShare(s.id)}
                      style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12 }}>
                      {t('finance_goal_remove_collaborator')}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Add new collaborator */}
        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
          <UserPicker
            label={t('finance_goal_add_collaborator')}
            value={selectedUserId}
            onChange={setSelectedUserId}
            knownPartners={partnerProfiles.filter(p => !shares.some(s => s.shared_with_user_id === p.id))}
          />
          {selectedUserId && (
            <button onClick={handleAdd} disabled={saving}
              style={{ marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
              {saving ? '...' : t('finance_goal_add_collaborator')}
            </button>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Goals Tab ────────────────────────────────────────────────────────────────

function GoalsTab({ goals, contributions, accounts, goalShares, incomingGoalShares, partnerProfiles, onNewGoal, onEditGoal, onDeleteGoal, onAddContribution, onDeleteContribution, onUpdateStatus, onShareGoal }: {
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  accounts: FinanceAccount[]
  goalShares: FinanceGoalShare[]
  incomingGoalShares: FinanceGoalShare[]
  partnerProfiles: PartnerProfile[]
  onNewGoal: () => void
  onEditGoal: (g: FinanceGoal) => void
  onDeleteGoal: (id: string) => Promise<void>
  onAddContribution: (g: FinanceGoal) => void
  onDeleteContribution: (id: string) => Promise<void>
  onUpdateStatus: (id: string, status: FinanceGoal['status']) => Promise<void>
  onShareGoal: (g: FinanceGoal) => void
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [confirmDeleteContrib, setConfirmDeleteContrib] = useState<string | null>(null)

  const accMap = new Map(accounts.map(a => [a.id, a]))
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))
  const sharedGoalIds = new Set(incomingGoalShares.map(s => s.goal_id))
  const sharerMap = new Map(incomingGoalShares.map(s => [s.goal_id, profileMap.get(s.owner_id)]))

  const getContributions = (goalId: string) =>
    contributions.filter(c => c.goal_id === goalId).sort((a, b) => b.date.localeCompare(a.date))

  const getAccumulated = (goalId: string) =>
    contributions.filter(c => c.goal_id === goalId).reduce((s, c) => s + c.amount, 0)

  const getEffectiveStatus = (goal: FinanceGoal): 'active' | 'completed' | 'cancelled' | 'overdue' => {
    if (goal.status === 'completed') return 'completed'
    if (goal.status === 'cancelled') return 'cancelled'
    const days = daysUntil(goal.deadline)
    if (days < 0) return 'overdue'
    return 'active'
  }

  const statusBadge = (status: ReturnType<typeof getEffectiveStatus>) => {
    const configs = {
      completed: { bg: FIN_POS_SOFT, color: FIN_POS, label: t('finance_goal_status_completed') },
      cancelled:  { bg: '#6b728022', color: '#6b7280', label: t('finance_goal_status_cancelled') },
      overdue:    { bg: '#ef444422', color: '#ef4444', label: t('finance_goal_status_overdue') },
      active:     { bg: 'var(--color-active)', color: 'var(--color-text)', label: t('finance_goal_status_active') },
    }
    const c = configs[status]
    return (
      <span style={{ fontSize: 11, fontWeight: 700, backgroundColor: c.bg, color: c.color, padding: '2px 8px', borderRadius: 10 }}>
        {c.label}
      </span>
    )
  }

  const deadlineLabel = (goal: FinanceGoal, status: ReturnType<typeof getEffectiveStatus>) => {
    if (status === 'completed' || status === 'cancelled') {
      return new Date(goal.deadline + 'T00:00:00').toLocaleDateString('pt-BR')
    }
    const days = Math.abs(daysUntil(goal.deadline))
    const raw = daysUntil(goal.deadline)
    if (raw < 0) {
      return <span style={{ color: '#ef4444', fontWeight: 600 }}>{days === 1 ? t('finance_goal_overdue', { n: days }) : t('finance_goal_overdue_plural', { n: days })}</span>
    }
    if (raw === 0) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>{t('finance_goal_due_today')}</span>
    return <span style={{ color: raw <= 30 ? '#f59e0b' : FIN_POS, fontWeight: 600 }}>{days === 1 ? t('finance_goal_days_left', { n: days }) : t('finance_goal_days_left_plural', { n: days })}</span>
  }

  const ownedGoals = goals.filter(g => !sharedGoalIds.has(g.id))
  const sharedGoals = goals.filter(g => sharedGoalIds.has(g.id))
  const active = ownedGoals.filter(g => g.status !== 'cancelled')
  const cancelled = ownedGoals.filter(g => g.status === 'cancelled')

  const renderGoal = (goal: FinanceGoal, isOwned = true) => {
    const accumulated = getAccumulated(goal.id)
    const pctRaw = goal.target_amount > 0 ? (accumulated / goal.target_amount) * 100 : 0
    const pct = Math.min(pctRaw, 100)
    const status = getEffectiveStatus(goal)
    const goalContribs = getContributions(goal.id)
    const isExpanded = expanded[goal.id] ?? false
    const barColor = status === 'overdue' ? '#ef4444' : status === 'completed' ? FIN_POS : pct >= 80 ? '#f59e0b' : goal.color
    const acc = goal.account_id ? accMap.get(goal.account_id) : null
    const sharer = sharerMap.get(goal.id)
    const sharesForGoal = goalShares.filter(s => s.goal_id === goal.id)

    return (
      <div key={goal.id} style={{ backgroundColor: 'var(--color-surface)', border: `1px solid var(--color-border)`, borderRadius: 14, overflow: 'hidden', borderTop: `4px solid ${goal.color}` }}>
        {/* Card header */}
        <div style={{ padding: '16px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: `${goal.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              {goal.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{goal.name}</span>
                {statusBadge(status)}
                {!isOwned && sharer && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={10} />{t('finance_goal_shared_by')} {sharer.display_name || sharer.email}
                  </span>
                )}
                {isOwned && sharesForGoal.length > 0 && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={10} />{sharesForGoal.length}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {t('finance_goal_deadline')}: {deadlineLabel(goal, status)}
                {acc && <span> · {acc.icon} {acc.name}</span>}
              </div>
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {status !== 'cancelled' && (
                <button onClick={() => onAddContribution(goal)} title={t('finance_goal_add_contribution')}
                  style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${goal.color}`, backgroundColor: `${goal.color}22`, color: goal.color, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {t('finance_goal_add_contribution')}
                </button>
              )}
              {isOwned && (
                <button onClick={() => onShareGoal(goal)} title={t('finance_goal_share_btn')}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                  <Users size={12} />
                </button>
              )}
              {isOwned && (
                <button onClick={() => onEditGoal(goal)}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                  <Pencil size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Progress */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {t('finance_goal_accumulated')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(accumulated)}</strong>
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {t('finance_goal_target')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(goal.target_amount)}</strong>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 5, backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 5, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <span style={{ fontWeight: 600, color: barColor }}>{pctRaw.toFixed(1)}%</span>
              {status !== 'completed' && (
                <span>{t('finance_goal_remaining')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(Math.max(goal.target_amount - accumulated, 0))}</strong></span>
              )}
              {status === 'completed' && (
                <span style={{ color: FIN_POS, fontWeight: 700 }}>{t('finance_goal_completed_badge')}</span>
              )}
            </div>
          </div>

          {/* Status actions + expand */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isOwned && status === 'active' && accumulated >= goal.target_amount && (
              <button onClick={() => onUpdateStatus(goal.id, 'completed')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: FIN_POS_SOFT, color: FIN_POS, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <CheckCircle2 size={12} />{t('finance_goal_mark_completed')}
              </button>
            )}
            {isOwned && status === 'completed' && (
              <button onClick={() => onUpdateStatus(goal.id, 'active')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-active)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {t('finance_goal_mark_active')}
              </button>
            )}
            {isOwned && status !== 'cancelled' && status !== 'completed' && (
              confirmCancel === goal.id ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_goal_cancel_goal')}?</span>
                  <button onClick={() => { onUpdateStatus(goal.id, 'cancelled'); setConfirmCancel(null) }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', backgroundColor: '#6b728033', color: '#6b7280', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {t('finance_confirm_delete')}
                  </button>
                  <button onClick={() => setConfirmCancel(null)}
                    style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
                    {t('finance_cancel')}
                  </button>
                </div>
              ) : (
                <button onClick={() => { setConfirmCancel(goal.id); setConfirmDelete(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: '#6b728022', color: '#6b7280', cursor: 'pointer', fontSize: 12 }}>
                  <XCircle size={12} />{t('finance_goal_cancel_goal')}
                </button>
              )
            )}
            <button
              onClick={() => setExpanded(e => ({ ...e, [goal.id]: !e[goal.id] }))}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
              <span>{t('finance_goal_contributions_title')} ({goalContribs.length})</span>
              <ChevronDown size={12} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
          </div>
        </div>

        {/* Contributions panel */}
        {isExpanded && (
          <div style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', padding: '12px 18px' }}>
            {goalContribs.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_goal_no_contributions')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {goalContribs.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: goal.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)', minWidth: 80 }}>
                      {new Date(c.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: goal.color }}>{fmt(c.amount)}</span>
                    {c.note && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note}</span>}
                  {c.contributor_profile && (
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 600, flexShrink: 0 }}>
                      {t('finance_goal_contribution_by')} {c.contributor_profile.display_name || c.contributor_profile.email}
                    </span>
                  )}
                    {confirmDeleteContrib === c.id ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        <button onClick={() => { onDeleteContribution(c.id); setConfirmDeleteContrib(null) }}
                          style={{ width: 22, height: 22, borderRadius: 4, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                          ✓
                        </button>
                        <button onClick={() => setConfirmDeleteContrib(null)}
                          style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => { setConfirmDeleteContrib(c.id); setConfirmCancel(null) }}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 3, borderRadius: 4, flexShrink: 0 }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete goal — owner only */}
        {isOwned && (
          <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 18px', display: 'flex', justifyContent: 'flex-end' }}>
            {confirmDelete === goal.id ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_goal_delete_confirm')}</span>
                <button onClick={() => { onDeleteGoal(goal.id); setConfirmDelete(null) }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
                  {t('finance_confirm_delete')}
                </button>
                <button onClick={() => setConfirmDelete(null)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
                  {t('finance_cancel')}
                </button>
              </div>
            ) : (
              <button onClick={() => { setConfirmDelete(goal.id); setConfirmCancel(null); setConfirmDeleteContrib(null) }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 6px', borderRadius: 6 }}>
                <Trash2 size={11} />{t('finance_delete')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onNewGoal}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_goal_new')}
        </button>
      </div>

      {goals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Target size={40} color="var(--color-text-muted)" strokeWidth={1.5} />
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>{t('finance_goal_no_goals')}</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {active.map(g => renderGoal(g, true))}
            </div>
          )}
          {cancelled.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_goal_cancelled_section')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: 0.6 }}>
                {cancelled.map(g => renderGoal(g, true))}
              </div>
            </div>
          )}
          {sharedGoals.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={11} />{t('finance_goal_shared_section')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sharedGoals.map(g => renderGoal(g, false))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Recurring Modal ──────────────────────────────────────────────────────────

interface RecurringForm {
  type: FinanceTxType
  description: string
  is_variable: boolean
  amount: string
  category_id: string
  account_id: string
  day_of_month: number
  active: boolean
  total_installments: string
}

function RecurringModal({ item, categories, accounts, onClose, onSave, onDelete }: {
  item?: FinanceRecurring
  categories: FinanceCategory[]
  accounts: FinanceAccount[]
  onClose: () => void
  onSave: (data: Omit<FinanceRecurring, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const { t } = useLanguage()
  const [form, setForm] = useState<RecurringForm>({
    type: item?.type ?? 'expense',
    description: item?.description ?? '',
    is_variable: item?.is_variable ?? false,
    amount: item?.amount != null ? String(fromCents(item.amount)) : '',
    category_id: item?.category_id ?? '',
    account_id: item?.account_id ?? '',
    day_of_month: item?.day_of_month ?? 1,
    active: item?.active ?? true,
    total_installments: item?.total_installments != null ? String(item.total_installments) : '',
  })
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const cats = categories.filter(c => c.type === form.type)

  const handleSave = async () => {
    if (!form.description.trim()) return
    if (!form.is_variable && toCents(form.amount) <= 0) return
    setSaving(true)
    await onSave({
      type: form.type,
      description: form.description.trim(),
      is_variable: form.is_variable,
      amount: form.is_variable ? null : toCents(form.amount),
      category_id: form.category_id || null,
      account_id: form.account_id || null,
      day_of_month: form.day_of_month,
      active: form.active,
      total_installments: form.total_installments && !isNaN(Number(form.total_installments)) && Number(form.total_installments) > 0 ? Number(form.total_installments) : null,
    })
    setSaving(false)
    onClose()
  }

  const toggleStyle = (on: boolean, color: string): React.CSSProperties => ({
    width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
    backgroundColor: on ? color : 'var(--color-border)', position: 'relative',
    flexShrink: 0, transition: 'background-color 0.2s',
  })
  const thumbStyle = (on: boolean): React.CSSProperties => ({
    position: 'absolute', top: 2, left: on ? 18 : 2,
    width: 16, height: 16, borderRadius: '50%', backgroundColor: '#fff',
    transition: 'left 0.2s',
  })

  return (
    <Modal title={item ? t('finance_recurring_edit') : t('finance_recurring_new')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['expense', 'income'] as FinanceTxType[]).map(tp => (
            <button key={tp} type="button"
              onClick={() => setForm(f => ({ ...f, type: tp, category_id: '' }))}
              style={{
                flex: 1, padding: '8px 0', borderRadius: 8,
                border: `2px solid ${form.type === tp ? (tp === 'expense' ? FIN_NEG : FIN_POS) : 'var(--color-border)'}`,
                backgroundColor: form.type === tp ? (tp === 'expense' ? '#ef444422' : FIN_POS_SOFT) : 'transparent',
                color: form.type === tp ? (tp === 'expense' ? FIN_NEG : FIN_POS) : 'var(--color-text-muted)',
                cursor: 'pointer', fontSize: 14, fontWeight: 600,
              }}>
              {tp === 'expense' ? t('finance_tx_expense') : t('finance_tx_income')}
            </button>
          ))}
        </div>

        <div>
          <label style={labelStyle}>{t('finance_recurring_description')}</label>
          <input style={inputStyle} type="text" value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder={form.type === 'expense' ? 'Ex: Aluguel, Internet...' : 'Ex: Salário, Freelance...'} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="button" onClick={() => setForm(f => ({ ...f, is_variable: !f.is_variable, amount: '' }))}
            style={toggleStyle(form.is_variable, 'var(--color-btn-primary)')}>
            <span style={thumbStyle(form.is_variable)} />
          </button>
          <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{t('finance_recurring_variable_bill')}</span>
        </div>

        {!form.is_variable && (
          <div>
            <label style={labelStyle}>{t('finance_recurring_fixed_amount')}</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
        )}

        <div>
          <label style={labelStyle}>{t('finance_recurring_day_of_month')}</label>
          <select style={inputStyle} value={form.day_of_month}
            onChange={e => setForm(f => ({ ...f, day_of_month: Number(e.target.value) }))}>
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_tx_category')}</label>
          <select style={inputStyle} value={form.category_id}
            onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
            <option value="">{t('finance_tx_none_category')}</option>
            {cats.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_tx_account')}</label>
          <select style={inputStyle} value={form.account_id}
            onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
            <option value="">{t('finance_tx_none_account')}</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t('finance_recurring_installments_label')}</label>
          <input style={inputStyle} type="number" min="1" step="1"
            value={form.total_installments}
            onChange={e => setForm(f => ({ ...f, total_installments: e.target.value }))}
            placeholder={t('finance_recurring_installments_placeholder')} />
        </div>

        {item && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={() => setForm(f => ({ ...f, active: !f.active }))}
              style={toggleStyle(form.active, FIN_POS)}>
              <span style={thumbStyle(form.active)} />
            </button>
            <span style={{ fontSize: 13, color: 'var(--color-text)' }}>
              {form.active ? t('finance_recurring_active') : t('finance_recurring_inactive')}
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        {onDelete && !confirming && (
          <button onClick={() => setConfirming(true)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #ef444488', backgroundColor: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 13, marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Trash2 size={13} />{t('finance_delete')}
          </button>
        )}
        {confirming && (
          <button onClick={async () => { await onDelete!(); onClose() }}
            style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, marginRight: 'auto' }}>
            {t('finance_confirm_delete')}
          </button>
        )}
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Pay Amount Modal ──────────────────────────────────────────────────────────

function PayAmountModal({ entry, recurring, onClose, onSave }: {
  entry: FinanceRecurringEntry
  recurring: FinanceRecurring
  onClose: () => void
  onSave: (amount: number) => Promise<void>
}) {
  const { t } = useLanguage()
  const [amount, setAmount] = useState(recurring.amount != null ? String(fromCents(recurring.amount)) : '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const v = toCents(amount)
    if (!v || v <= 0) return
    setSaving(true)
    await onSave(v)
    setSaving(false)
    onClose()
  }

  return (
    <Modal title={t('finance_recurring_mark_paid')} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
          {recurring.description} · {new Date(entry.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
        </p>
        <div>
          <label style={labelStyle}>{t('finance_recurring_enter_amount')}</label>
          <input style={inputStyle} type="number" min="0" step="0.01" value={amount}
            onChange={e => setAmount(e.target.value)} autoFocus />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        <button onClick={onClose}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
          {t('finance_cancel')}
        </button>
        <button onClick={handleSave} disabled={saving || !amount}
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: (saving || !amount) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: (saving || !amount) ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Recurring Tab ─────────────────────────────────────────────────────────────

function RecurringTab({ recurring, recurringEntries, categories, month, onAdd, onEdit, onMarkPaid, onSkip }: {
  recurring: FinanceRecurring[]
  recurringEntries: FinanceRecurringEntry[]
  categories: FinanceCategory[]
  month: string
  onAdd: () => void
  onEdit: (item: FinanceRecurring) => void
  onMarkPaid: (entry: FinanceRecurringEntry, rec: FinanceRecurring) => void
  onSkip: (entryId: string) => void
}) {
  const { t } = useLanguage()
  const [confirm, setConfirm] = useState<{ entryId: string; action: 'pay' | 'skip' } | null>(null)
  const catMap = new Map(categories.map(c => [c.id, c]))

  const entryByRecurring = new Map<string, FinanceRecurringEntry>()
  recurringEntries.filter(e => e.due_date.startsWith(month)).forEach(e => {
    entryByRecurring.set(e.recurring_id, e)
  })

  const expenses = recurring.filter(r => r.type === 'expense')
  const incomes = recurring.filter(r => r.type === 'income')

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const getEntryBadge = (entry: FinanceRecurringEntry | undefined, dueDate: string) => {
    if (!entry) return null
    if (entry.status === 'paid') return { label: t('finance_entry_paid'), color: FIN_POS }
    if (entry.status === 'skipped') return { label: t('finance_entry_skipped'), color: '#9ca3af' }
    const due = new Date(dueDate + 'T12:00:00')
    if (due < today) return { label: t('finance_entry_overdue'), color: '#ef4444' }
    return { label: t('finance_entry_pending'), color: '#f59e0b' }
  }

  const renderItem = (item: FinanceRecurring) => {
    const cat = item.category_id ? catMap.get(item.category_id) : null
    const [year, mon] = month.split('-').map(Number)
    const lastDay = new Date(year, mon, 0).getDate()
    const day = Math.min(item.day_of_month, lastDay)
    const dueDate = `${month}-${String(day).padStart(2, '0')}`
    const entry = entryByRecurring.get(item.id)
    const badge = getEntryBadge(entry, dueDate)

    // Installment progress
    const itemEntries = item.total_installments != null
      ? recurringEntries.filter(e => e.recurring_id === item.id).sort((a, b) => a.due_date.localeCompare(b.due_date))
      : null
    const paidCount = itemEntries ? itemEntries.filter(e => e.status === 'paid').length : 0
    const currentInstallment = itemEntries && entry
      ? itemEntries.findIndex(e => e.id === entry.id) + 1
      : (itemEntries ? itemEntries.length : 0)
    const isFullyPaid = item.total_installments != null && paidCount >= item.total_installments

    return (
      <div key={item.id} style={{ borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', overflow: 'hidden', opacity: item.active ? 1 : 0.6 }}>
        <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, backgroundColor: cat ? `${cat.color}22` : 'var(--color-border)' }}>
            {cat ? cat.icon : (item.type === 'income' ? '💰' : '💸')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>{item.description}</span>
              {!item.active && !isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: 'var(--color-border)', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                  {t('finance_recurring_inactive')}
                </span>
              )}
              {isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: FIN_POS_SOFT, color: FIN_POS, fontWeight: 600 }}>
                  {t('finance_recurring_installments_done')}
                </span>
              )}
              {item.total_installments != null && !isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: 'var(--color-active)', color: 'var(--color-text-subtle)', fontWeight: 600 }}>
                  {t('finance_recurring_installment_badge').replace('{current}', String(currentInstallment)).replace('{total}', String(item.total_installments))}
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Dia {item.day_of_month}
              {cat ? ` · ${cat.name}` : ''}
              {item.is_variable
                ? ` · ${t('finance_upcoming_variable')}`
                : item.amount != null ? ` · ${fmt(item.amount)}` : ''}
              {item.total_installments != null && ` · ${paidCount}/${item.total_installments} pagas`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {badge && (
              <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, backgroundColor: `${badge.color}22`, color: badge.color, fontWeight: 600 }}>
                {badge.label}
              </span>
            )}
            <button onClick={() => onEdit(item)}
              style={{ padding: '5px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
              <Pencil size={12} />
            </button>
          </div>
        </div>

        {entry && entry.status === 'pending' && item.active && (
          <div style={{ display: 'flex', gap: 6, padding: '8px 14px 12px', borderTop: '1px solid var(--color-border)' }}>
            {confirm?.entryId === entry.id ? (
              <>
                <button onClick={() => { if (confirm.action === 'pay') onMarkPaid(entry, item); else onSkip(entry.id); setConfirm(null) }}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', backgroundColor: confirm.action === 'pay' ? FIN_POS : FIN_NEG, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  ✓ Confirmar
                </button>
                <button onClick={() => setConfirm(null)}
                  style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setConfirm({ entryId: entry.id, action: 'pay' })}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', backgroundColor: FIN_POS, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  {t('finance_recurring_mark_paid')}
                </button>
                <button onClick={() => setConfirm({ entryId: entry.id, action: 'skip' })}
                  style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13 }}>
                  {t('finance_recurring_skip')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onAdd}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_recurring_new')}
        </button>
      </div>

      {recurring.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>
          {t('finance_recurring_list_empty')}
        </p>
      ) : (
        <>
          {expenses.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_expenses')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{expenses.map(renderItem)}</div>
            </div>
          )}
          {incomes.length > 0 && (
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_income')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{incomes.map(renderItem)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Mobile bottom navigation ──────────────────────────────────────────────────

// Shared tab definition (icon is static; label/subtitle resolved via i18n).
const FINANCE_NAV: { id: TabId; icon: React.ReactNode }[] = [
  { id: 'overview', icon: <BarChart2 size={18} /> },
  { id: 'transactions', icon: <List size={18} /> },
  { id: 'budgets', icon: <Target size={18} /> },
  { id: 'accounts', icon: <CreditCard size={18} /> },
  { id: 'goals', icon: <Star size={18} /> },
  { id: 'categories', icon: <Tag size={18} /> },
  { id: 'recurring', icon: <RefreshCw size={18} /> },
]

function tabLabelKey(id: TabId): `finance_tab_${TabId}` {
  return `finance_tab_${id}`
}

// ─── Desktop left navigation (Lateral layout) ─────────────────────────────────

function FinanceSideNavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const bg = active ? 'var(--color-active)' : hov ? 'var(--color-hover)' : 'transparent'
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', backgroundColor: bg, color: active ? 'var(--color-text)' : 'var(--color-text-subtle)', fontSize: 13.5, fontWeight: active ? 600 : 500, textAlign: 'left', transition: 'background-color 0.1s' }}
    >
      <span style={{ display: 'flex', flexShrink: 0, color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function FinanceSidebar({ tab, onSelect, accountsBalance, accountCount }: {
  tab: TabId
  onSelect: (t: TabId) => void
  accountsBalance: number
  accountCount: number
}) {
  const { t } = useLanguage()
  return (
    <aside style={{ width: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 18px 16px' }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: FIN_ACCENT, color: FIN_ACCENT_TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Wallet size={17} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--color-text)', letterSpacing: '-0.01em' }}>{t('finance_title')}</div>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 10px', flex: 1, overflowY: 'auto' }}>
        {FINANCE_NAV.map(item => (
          <FinanceSideNavItem key={item.id} active={tab === item.id} icon={item.icon} label={t(tabLabelKey(item.id))} onClick={() => onSelect(item.id)} />
        ))}
      </nav>
      <div style={{ padding: '14px 18px', borderTop: '1px solid var(--color-border)' }}>
        <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>{t('finance_balance_in_accounts')}</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>{fmt(accountsBalance)}</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {accountCount === 1 ? t('finance_overview_accounts_sub', { n: accountCount }) : t('finance_overview_accounts_sub_plural', { n: accountCount })}
        </div>
      </div>
    </aside>
  )
}

const MORE_TABS: TabId[] = ['accounts', 'goals', 'categories', 'recurring']

function MobileBottomNav({ tab, onSelect, onMore, onQuickAdd }: {
  tab: TabId
  onSelect: (t: TabId) => void
  onMore: () => void
  onQuickAdd: () => void
}) {
  const { t } = useLanguage()
  const moreActive = MORE_TABS.includes(tab)

  const navBtn = (id: TabId, icon: React.ReactNode, label: string) => {
    const active = tab === id
    return (
      <button onClick={() => onSelect(id)}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', color: active ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '6px 0', minHeight: MOBILE_NAV_HEIGHT - 4 }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap' }}>{label}</span>
      </button>
    )
  }

  return (
    <div className="finance-safe-bottom" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40, display: 'flex', alignItems: 'stretch', height: MOBILE_NAV_HEIGHT, backgroundColor: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border)' }}>
      {navBtn('overview', <BarChart2 size={20} />, t('finance_nav_overview'))}
      {navBtn('transactions', <List size={20} />, t('finance_nav_transactions'))}
      {/* Central FAB */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <button onClick={onQuickAdd} title={t('finance_new_transaction')}
          style={{ position: 'absolute', top: -18, width: 56, height: 56, borderRadius: '50%', border: '4px solid var(--color-bg-secondary)', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
          <Plus size={26} />
        </button>
      </div>
      {navBtn('budgets', <Target size={20} />, t('finance_nav_budgets'))}
      <button onClick={onMore}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', color: moreActive ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '6px 0', minHeight: MOBILE_NAV_HEIGHT - 4 }}>
        <MoreHorizontal size={20} />
        <span style={{ fontSize: 10, fontWeight: moreActive ? 700 : 500 }}>{t('finance_nav_more')}</span>
      </button>
    </div>
  )
}

function MoreMenuSheet({ current, onSelect, onClose }: {
  current: TabId
  onSelect: (t: TabId) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  const items: { id: TabId; icon: React.ReactNode; label: string }[] = [
    { id: 'accounts', icon: <CreditCard size={20} />, label: t('finance_tab_accounts') },
    { id: 'goals', icon: <Star size={20} />, label: t('finance_tab_goals') },
    { id: 'categories', icon: <Tag size={20} />, label: t('finance_tab_categories') },
    { id: 'recurring', icon: <RefreshCw size={20} />, label: t('finance_tab_recurring') },
  ]
  return (
    <Modal title={t('finance_nav_more')} onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {items.map(it => {
          const active = current === it.id
          return (
            <button key={it.id} onClick={() => { onSelect(it.id); onClose() }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 12px', borderRadius: 14, border: '1.5px solid', borderColor: active ? 'var(--color-text)' : 'var(--color-border)', backgroundColor: active ? 'var(--color-active)' : 'var(--color-surface)', color: active ? 'var(--color-text)' : 'var(--color-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              {it.icon}
              {it.label}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

// ─── Workspace Modal ──────────────────────────────────────────────────────────

function WorkspaceModal({
  workspace, members, invites, pendingInvitesForMe, partnerProfiles, onClose, onReload,
}: {
  workspace: FinanceWorkspace | null
  members: FinanceWorkspaceMember[]
  invites: FinanceWorkspaceInvite[]
  pendingInvitesForMe: FinanceWorkspaceInvite[]
  partnerProfiles: PartnerProfile[]
  onClose: () => void
  onReload: () => Promise<void>
}) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [activeTab, setActiveTab] = useState<'members' | 'invites' | 'received'>(pendingInvitesForMe.length > 0 && !workspace ? 'received' : 'members')

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3500)
  }

  const handleCreate = async () => {
    if (!wsName.trim()) return
    setCreating(true)
    const { error } = await supabase.rpc('create_workspace', { p_name: wsName.trim() })
    if (error) showFeedback('error', error.message)
    else { await onReload(); showFeedback('success', 'Workspace criado!') }
    setCreating(false)
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !workspace) return
    setSending(true)
    const { error } = await supabase.rpc('invite_member', { p_workspace_id: workspace.id, p_email: inviteEmail.trim() })
    if (error) showFeedback('error', error.message)
    else { setInviteEmail(''); await onReload(); showFeedback('success', 'Convite enviado!') }
    setSending(false)
  }

  const handleAccept = async (inviteId: string) => {
    setActing(true)
    const { error } = await supabase.rpc('accept_workspace_invite', { p_invite_id: inviteId })
    if (error) showFeedback('error', error.message)
    else { await onReload(); showFeedback('success', 'Convite aceito!') }
    setActing(false)
  }

  const handleDecline = async (inviteId: string) => {
    setActing(true)
    const { error } = await supabase.rpc('decline_workspace_invite', { p_invite_id: inviteId })
    if (error) showFeedback('error', error.message)
    else { await onReload(); showFeedback('success', 'Convite recusado.') }
    setActing(false)
  }

  const handleLeave = async () => {
    setActing(true)
    const { error } = await supabase.rpc('leave_workspace')
    if (error) showFeedback('error', error.message)
    else { await onReload(); setConfirmLeave(false); onClose() }
    setActing(false)
  }

  const handleRemoveMember = async (userId: string) => {
    setActing(true)
    const { error } = await supabase.rpc('remove_workspace_member', { p_user_id: userId })
    if (error) showFeedback('error', error.message)
    else { await onReload(); setConfirmRemove(null); showFeedback('success', 'Membro removido.') }
    setActing(false)
  }

  const isOwner = workspace && members.some(m => m.user_id === user?.id && m.role === 'owner')
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))
  const getMemberName = (m: FinanceWorkspaceMember) => {
    if (m.user_id === user?.id) return user?.email?.split('@')[0] ?? 'Você'
    const p = profileMap.get(m.user_id) ?? m.profile
    return p?.display_name || p?.email || m.user_id.slice(0, 8)
  }

  return (
    <Modal title={workspace ? workspace.name : t('finance_workspace_title')} onClose={onClose}>
      {feedback && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`, color: feedback.type === 'success' ? '#15803d' : '#dc2626', fontSize: 13 }}>
          {feedback.msg}
        </div>
      )}

      {/* No workspace: create or accept invites */}
      {!workspace && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pending invites for me */}
          {pendingInvitesForMe.length > 0 && (
            <div>
              <label style={labelStyle}>{t('finance_workspace_invites_received')}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingInvitesForMe.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Users size={14} color="var(--color-text)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_workspace_invite_title')}</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>de {inv.inviter_profile?.display_name || inv.inviter_profile?.email || inv.invited_by.slice(0, 8)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button disabled={acting} onClick={() => handleAccept(inv.id)}
                        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: FIN_POS, color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                        {t('finance_workspace_invite_accept')}
                      </button>
                      <button disabled={acting} onClick={() => handleDecline(inv.id)}
                        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                        {t('finance_workspace_invite_decline')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Users size={32} color="var(--color-text-muted)" style={{ marginBottom: 8 }} />
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_workspace_empty')}</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_workspace_empty_desc')}</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} type="text" value={wsName} onChange={e => setWsName(e.target.value)}
              placeholder={t('finance_workspace_create_placeholder')} onKeyDown={e => { if (e.key === 'Enter') handleCreate() }} />
            <button onClick={handleCreate} disabled={creating || !wsName.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: creating || !wsName.trim() ? 'not-allowed' : 'pointer', opacity: creating || !wsName.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
              {t('finance_workspace_create')}
            </button>
          </div>
        </div>
      )}

      {/* Has workspace: manage */}
      {workspace && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)' }}>
            {(['members', 'invites', ...(pendingInvitesForMe.length > 0 ? ['received' as const] : [])] as const).map(tabId => (
              <button key={tabId} onClick={() => setActiveTab(tabId)}
                style={{ padding: '8px 14px', border: 'none', borderBottom: activeTab === tabId ? '2px solid var(--color-text)' : '2px solid transparent', backgroundColor: 'transparent', color: activeTab === tabId ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tabId ? 600 : 400, transition: 'color 0.15s' }}>
                {tabId === 'members' ? t('finance_workspace_members') : tabId === 'invites' ? t('finance_workspace_invites_sent') : t('finance_workspace_invites_received')}
                {tabId === 'received' && pendingInvitesForMe.length > 0 && (
                  <span style={{ marginLeft: 4, minWidth: 16, height: 16, borderRadius: 999, backgroundColor: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    {pendingInvitesForMe.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Members tab */}
          {activeTab === 'members' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: m.role === 'owner' ? '#f59e0b18' : 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14, fontWeight: 700, color: m.role === 'owner' ? '#f59e0b' : 'var(--color-text)' }}>
                    {getMemberName(m).charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getMemberName(m)} {m.user_id === user?.id && <span style={{ fontSize: 10, color: 'var(--color-text)', fontWeight: 600 }}>(você)</span>}
                    </p>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 4, backgroundColor: m.role === 'owner' ? '#fef3c7' : '#f3f4f6', color: m.role === 'owner' ? '#d97706' : '#6b7280' }}>
                      {m.role === 'owner' ? t('finance_workspace_owner') : t('finance_workspace_member')}
                    </span>
                  </div>
                  {isOwner && m.user_id !== user?.id && (
                    <>
                      {confirmRemove === m.user_id ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button disabled={acting} onClick={() => handleRemoveMember(m.user_id)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer' }}>
                            Confirmar
                          </button>
                          <button onClick={() => setConfirmRemove(null)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmRemove(m.user_id)}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>
                          {t('finance_workspace_remove')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}

              {/* Invite new member */}
              <InviteAutocomplete value={inviteEmail} onChange={setInviteEmail} onSubmit={handleInvite} sending={sending} excludeIds={members.map(m => m.user_id)} />

              {/* Leave workspace */}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
                {confirmLeave ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#dc2626' }}>{t('finance_workspace_leave_confirm')}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={acting} onClick={handleLeave}
                        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                        Confirmar saída
                      </button>
                      <button onClick={() => setConfirmLeave(false)}
                        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmLeave(true)}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%' }}>
                    {t('finance_workspace_leave')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Invites sent tab */}
          {activeTab === 'invites' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {invites.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16 }}>{t('finance_workspace_no_invites_sent')}</p>
              ) : invites.map(inv => {
                const statusColors: Record<string, { bg: string; text: string; label: string }> = {
                  pending: { bg: '#dcfce7', text: '#15803d', label: t('finance_workspace_invite_pending') },
                  accepted: { bg: '#e0e7ff', text: '#4338ca', label: t('finance_workspace_invite_accepted') },
                  declined: { bg: '#fee2e2', text: '#dc2626', label: t('finance_workspace_invite_declined') },
                }
                const sc = statusColors[inv.status] ?? statusColors.pending
                return (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.invited_email}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>{new Date(inv.created_at).toLocaleDateString()}</p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text }}>{sc.label}</span>
                  </div>
                )
              })}

              {/* Invite new member */}
              <InviteAutocomplete value={inviteEmail} onChange={setInviteEmail} onSubmit={handleInvite} sending={sending} excludeIds={members.map(m => m.user_id)} />
            </div>
          )}

          {/* Received invites tab */}
          {activeTab === 'received' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingInvitesForMe.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16 }}>{t('finance_workspace_no_invites_pending')}</p>
              ) : pendingInvitesForMe.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_workspace_invite_title')}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                      de {inv.inviter_profile?.display_name || inv.inviter_profile?.email || inv.invited_by.slice(0, 8)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={acting} onClick={() => handleAccept(inv.id)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: FIN_POS, color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                      {t('finance_workspace_invite_accept')}
                    </button>
                    <button disabled={acting} onClick={() => handleDecline(inv.id)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                      {t('finance_workspace_invite_decline')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export default function FinancePanel({ isMobile: isMobileProp }: { isMobile?: boolean } = {}) {
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const isMobileHook = useIsMobile()
  const isMobile = isMobileProp ?? isMobileHook
  const { accounts, categories, transactions, budgets, goals, contributions, goalShares, incomingGoalShares, sharedTransactions, sharedBudgets, partnerProfiles, recurring, recurringEntries, workspace, workspaceMembers, workspaceInvites, pendingInvitesForMe, familyTransactions, familyBudgets, familyAccounts, familyCategories, loading, reload } = useFinanceData()

  type ViewMode = 'individual' | 'family'
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('finance_view_mode')
    return saved === 'family' ? 'family' : 'individual'
  })

  const [month, setMonth] = useState(currentYM())
  const [exporting, setExporting] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [wsModalOpen, setWsModalOpen] = useState(false)
  const [tab, setTab] = useState<TabId>(() => {
    const saved = localStorage.getItem('finance_active_tab')
    return (saved === 'overview' || saved === 'transactions' || saved === 'budgets' || saved === 'accounts' || saved === 'goals' || saved === 'categories' || saved === 'recurring') ? saved as TabId : 'overview'
  })

  // Desktop navigation layout: 'side' (Lateral) or 'top' (Topo). Persisted.
  const [direction, setDirection] = useState<'side' | 'top'>(() => {
    const saved = localStorage.getItem('finance_layout')
    return saved === 'top' ? 'top' : 'side'
  })
  useEffect(() => {
    localStorage.setItem('finance_layout', direction)
  }, [direction])

  // Save tab to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('finance_active_tab', tab)
  }, [tab])

  // Save view mode
  useEffect(() => {
    localStorage.setItem('finance_view_mode', viewMode)
  }, [viewMode])

  // Listen for tab change events dispatched by sidebar
  useEffect(() => {
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent<string>).detail as TabId
      if (['overview','transactions','budgets','accounts','goals','categories','recurring'].includes(tabId)) {
        setTab(tabId)
      }
    }
    window.addEventListener('finance_tab_change', handler)
    return () => window.removeEventListener('finance_tab_change', handler)
  }, [])

  // Derived datasets based on view mode
  const isFamily = viewMode === 'family' && !!workspace
  const activeTransactions = isFamily ? familyTransactions : transactions
  const activeBudgets = isFamily ? familyBudgets : budgets
  const activeAccounts = isFamily ? familyAccounts : accounts
  const activeCategories = isFamily ? familyCategories : categories

  // Total balance across the active accounts (shown in the Lateral sidebar footer).
  const accountsBalanceTotal = activeAccounts.reduce((sum, acc) => {
    const txs = activeTransactions.filter(tx => tx.account_id === acc.id)
    const inc = txs.filter(tx => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0)
    const exp = txs.filter(tx => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0)
    return sum + acc.initial_balance + inc - exp
  }, 0)

  // Modals
  const [txModal, setTxModal] = useState<{ open: boolean; tx?: FinanceTransaction }>({ open: false })
  const [accModal, setAccModal] = useState<{ open: boolean; account?: FinanceAccount }>({ open: false })
  const [budgetModal, setBudgetModal] = useState(false)
  const [goalModal, setGoalModal] = useState<{ open: boolean; goal?: FinanceGoal }>({ open: false })
  const [contributionGoal, setContributionGoal] = useState<FinanceGoal | null>(null)
  const [catModal, setCatModal] = useState<{ open: boolean; category?: FinanceCategory }>({ open: false })
  const [recurringModal, setRecurringModal] = useState<{ open: boolean; item?: FinanceRecurring }>({ open: false })
  const [payModal, setPayModal] = useState<{ open: boolean; entry?: FinanceRecurringEntry; rec?: FinanceRecurring }>({ open: false })
  const [goalShareModal, setGoalShareModal] = useState<{ open: boolean; goal?: FinanceGoal }>({ open: false })

  const monthTxs = activeTransactions.filter(tx => tx.date.startsWith(month))

  // CRUD helpers
  const saveTx = async (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { error } = txModal.tx
      ? await supabase.from('finance_transactions').update(data).eq('id', txModal.tx.id)
      : await supabase.from('finance_transactions').insert({ ...data, user_id: user.id })
    if (error) throw error
    await reload()
  }

  const deleteTx = async (id: string) => {
    await supabase.from('finance_transactions').delete().eq('id', id)
    await reload()
  }

  const quickAddTx = async (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    const { error } = await supabase.from('finance_transactions').insert({ ...data, user_id: user.id })
    if (error) throw error
    await reload()
  }

  const bulkDeleteTx = async (ids: string[]) => {
    if (ids.length === 0) return
    await supabase.from('finance_transactions').delete().in('id', ids)
    await reload()
  }

  const saveAccount = async (data: Omit<FinanceAccount, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    if (accModal.account) {
      await supabase.from('finance_accounts').update(data).eq('id', accModal.account.id)
    } else {
      await supabase.from('finance_accounts').insert({ ...data, user_id: user.id, workspace_id: isFamily && workspace ? workspace.id : null })
    }
    await reload()
  }

  const deleteAccount = async (id: string) => {
    await supabase.from('finance_accounts').delete().eq('id', id)
    await reload()
  }

  const saveBudget = async (data: { category_id: string; month: string; amount_limit: number; shared_with_user_id: string | null }) => {
    if (!user) return
    await supabase.from('finance_budgets').insert({ ...data, user_id: user.id, workspace_id: isFamily && workspace ? workspace.id : null })
    await reload()
  }

  const saveGoalShare = async (goalId: string, sharedWithUserId: string) => {
    if (!user) return
    await supabase.from('finance_goal_shares').upsert({ goal_id: goalId, owner_id: user.id, shared_with_user_id: sharedWithUserId }, { onConflict: 'goal_id,shared_with_user_id' })
    await reload()
  }

  const deleteGoalShare = async (shareId: string) => {
    await supabase.from('finance_goal_shares').delete().eq('id', shareId)
    await reload()
  }

  const deleteBudget = async (id: string) => {
    await supabase.from('finance_budgets').delete().eq('id', id)
    await reload()
  }

  const saveGoal = async (data: Omit<FinanceGoal, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    if (goalModal.goal) {
      await supabase.from('finance_goals').update(data).eq('id', goalModal.goal.id)
    } else {
      await supabase.from('finance_goals').insert({ ...data, user_id: user.id })
    }
    await reload()
  }

  const deleteGoal = async (id: string) => {
    await supabase.from('finance_goals').delete().eq('id', id)
    await reload()
  }

  const updateGoalStatus = async (id: string, status: FinanceGoal['status']) => {
    await supabase.from('finance_goals').update({ status }).eq('id', id)
    await reload()
  }

  const saveContribution = async (data: { goal_id: string; amount: number; note: string; date: string }) => {
    if (!user) return
    await supabase.from('finance_goal_contributions').insert({ ...data, user_id: user.id })
    // Auto-complete goal if accumulated >= target
    const goal = goals.find(g => g.id === data.goal_id)
    if (goal && goal.status === 'active') {
      const total = contributions.filter(c => c.goal_id === data.goal_id).reduce((s, c) => s + c.amount, 0) + data.amount
      if (total >= goal.target_amount) {
        await supabase.from('finance_goals').update({ status: 'completed' }).eq('id', data.goal_id)
      }
    }
    await reload()
  }

  const deleteContribution = async (id: string) => {
    await supabase.from('finance_goal_contributions').delete().eq('id', id)
    await reload()
  }

  const saveCategory = async (data: Omit<FinanceCategory, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    if (catModal.category) {
      await supabase.from('finance_categories').update(data).eq('id', catModal.category.id)
    } else {
      await supabase.from('finance_categories').insert({ ...data, user_id: user.id, workspace_id: isFamily && workspace ? workspace.id : null })
    }
    await reload()
  }

  const deleteCategory = async (id: string) => {
    await supabase.from('finance_categories').delete().eq('id', id)
    await reload()
  }

  const saveRecurring = async (data: Omit<FinanceRecurring, 'id' | 'user_id' | 'created_at'>) => {
    if (!user) return
    if (recurringModal.item) {
      await supabase.from('finance_recurring').update(data).eq('id', recurringModal.item.id)
    } else {
      await supabase.from('finance_recurring').insert({ ...data, user_id: user.id })
    }
    await reload()
  }

  const deleteRecurring = async (id: string) => {
    await supabase.from('finance_recurring').delete().eq('id', id)
    await reload()
  }

  const doMarkPaid = async (entry: FinanceRecurringEntry, rec: FinanceRecurring, amount: number) => {
    if (!user) return
    const { data: tx } = await supabase
      .from('finance_transactions')
      .insert({ user_id: user.id, type: rec.type, amount, description: rec.description, date: entry.due_date, account_id: rec.account_id, category_id: rec.category_id })
      .select('id').single()
    await supabase.from('finance_recurring_entries')
      .update({ status: 'paid', amount, transaction_id: tx?.id ?? null })
      .eq('id', entry.id)
    if (rec.total_installments != null) {
      const paidBefore = recurringEntries.filter(e => e.recurring_id === rec.id && e.status === 'paid').length
      if (paidBefore + 1 >= rec.total_installments) {
        await supabase.from('finance_recurring').update({ active: false }).eq('id', rec.id)
      }
    }
    await reload()
  }

  const handleMarkPaid = (entry: FinanceRecurringEntry, rec: FinanceRecurring) => {
    if (rec.is_variable) {
      setPayModal({ open: true, entry, rec })
    } else {
      doMarkPaid(entry, rec, rec.amount ?? 0)
    }
  }

  const skipEntry = async (entryId: string) => {
    await supabase.from('finance_recurring_entries').update({ status: 'skipped' }).eq('id', entryId)
    await reload()
  }

  const monthNavVisible = tab !== 'goals' && tab !== 'categories' && tab !== 'recurring'

  // Desktop nav arrangement (mobile always uses the bottom nav).
  const showSidebar = !isMobile && direction === 'side'
  const showTopTabs = !isMobile && direction === 'top'

  // Header subtitle shown in the Lateral layout under the tab title.
  const tabSubtitle =
    tab === 'overview' ? t('finance_subtitle_overview', { month: monthLabel(month) })
    : tab === 'transactions' ? (monthTxs.length === 1 ? t('finance_subtitle_transactions', { n: 1 }) : t('finance_subtitle_transactions_plural', { n: monthTxs.length }))
    : ''

  return (
    <FinanceMobileContext.Provider value={isMobile}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg-secondary)', overflow: 'hidden', position: 'relative' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {showSidebar && (
          <FinanceSidebar tab={tab} onSelect={setTab} accountsBalance={accountsBalanceTotal} accountCount={activeAccounts.length} />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: isMobile ? '10px 14px' : '0 24px', minHeight: 60, flexShrink: 0, backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          {showTopTabs ? (
            <>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: FIN_ACCENT, color: FIN_ACCENT_TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Wallet size={17} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--color-text)', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{t('finance_title')}</div>
            </>
          ) : (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.01em' }}>{t(tabLabelKey(tab))}</div>
              {!isMobile && tabSubtitle && <div style={{ fontSize: 12.5, color: 'var(--color-text-subtle)', marginTop: -1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tabSubtitle}</div>}
            </div>
          )}
        </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Month navigator — hidden on goals and categories tabs */}
          {monthNavVisible && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '3px 6px', flexShrink: 0 }}>
              <button onClick={() => setMonth(prevMonth(month))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                <ChevronLeft size={15} />
              </button>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)', minWidth: isMobile ? 74 : 90, textAlign: 'center', textTransform: 'capitalize' }}>
                {monthLabel(month)}
              </span>
              <button onClick={() => setMonth(nextMonth(month))}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 4, borderRadius: 4 }}>
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          {/* Workspace button */}
          <button
            onClick={() => setWsModalOpen(true)}
            title={workspace ? workspace.name : t('finance_workspace_title')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? 8 : '7px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: workspace ? 'var(--color-active)' : 'var(--color-surface)', cursor: 'pointer', fontSize: 12.5, color: workspace ? 'var(--color-text)' : 'var(--color-text-subtle)', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: workspace ? 600 : 500, position: 'relative' }}
          >
            <Users size={isMobile ? 16 : 14} />
            {!isMobile && <span>{t('finance_workspace_title')}</span>}
            {pendingInvitesForMe.length > 0 && (
              <span style={{ minWidth: 16, height: 16, borderRadius: 999, backgroundColor: FIN_NEG, color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {pendingInvitesForMe.length}
              </span>
            )}
          </button>
          {/* View scope toggle (only when in a workspace) */}
          {workspace && (
            <div style={segTrackStyle}>
              <button onClick={() => setViewMode('family')} title={t('finance_view_family')} style={segBtnStyle(viewMode === 'family')}>
                <Users size={13} />{!isMobile && t('finance_view_family')}
              </button>
              <button onClick={() => setViewMode('individual')} title={t('finance_view_individual')} style={segBtnStyle(viewMode === 'individual')}>
                <User size={13} />{!isMobile && t('finance_view_individual')}
              </button>
            </div>
          )}
          {/* Layout toggle — desktop only */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, paddingLeft: 9, marginLeft: 1, borderLeft: '1px solid var(--color-border)' }}>
              <span style={{ fontSize: 10.5, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_layout')}</span>
              <div style={segTrackStyle}>
                <button onClick={() => setDirection('side')} title={t('finance_layout_side')} style={segBtnStyle(direction === 'side')}><PanelLeft size={14} />{t('finance_layout_side')}</button>
                <button onClick={() => setDirection('top')} title={t('finance_layout_top')} style={segBtnStyle(direction === 'top')}><PanelTop size={14} />{t('finance_layout_top')}</button>
              </div>
            </div>
          )}
          <button
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try {
                const { exportFinanceToPdf } = await import('../../hooks/usePdfExport')
                await exportFinanceToPdf({ transactions, accounts, categories, budgets, goals, contributions, recurring, month, userName: profile?.display_name || profile?.email || '' })
              } catch (err) {
                console.error('[FinancePDF] export error:', err)
              } finally {
                setExporting(false)
              }
            }}
            disabled={exporting}
            title={t('finance_pdf_export_btn')}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: exporting ? 'not-allowed' : 'pointer', color: 'var(--color-text-subtle)', opacity: exporting ? 0.6 : 1, flexShrink: 0 }}
          >
            <FileDown size={16} />
          </button>
          </div>
      </div>

      {/* Top tabs — desktop, Topo layout */}
      {showTopTabs && (
        <nav className="finance-hide-scrollbar" style={{ display: 'flex', gap: 2, padding: '0 24px', backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', overflowX: 'auto', flexShrink: 0 }}>
          {FINANCE_NAV.map(item => {
            const active = tab === item.id
            return (
              <button key={item.id} onClick={() => setTab(item.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '11px 13px', border: 'none', borderBottom: active ? '2px solid var(--color-text)' : '2px solid transparent', marginBottom: -1, background: 'transparent', color: active ? 'var(--color-text)' : 'var(--color-text-subtle)', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{ display: 'flex' }}>{item.icon}</span>{t(tabLabelKey(item.id))}
              </button>
            )
          })}
        </nav>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--color-bg-secondary)', padding: isMobile ? '16px' : '22px 24px 48px', paddingBottom: isMobile ? MOBILE_NAV_HEIGHT + 24 : 48 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: 'var(--color-text-muted)', fontSize: 14 }}>
            {t('finance_loading')}
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab
                transactions={activeTransactions}
                categories={activeCategories}
                month={month}
                recurring={recurring}
                recurringEntries={recurringEntries}
                accounts={activeAccounts}
                budgets={activeBudgets}
                goals={goals}
                contributions={contributions}
                onMarkPaid={handleMarkPaid}
                onSkipEntry={skipEntry}
                onNavigate={setTab}
              />
            )}
            {tab === 'transactions' && (
              <TransactionsTab
                transactions={monthTxs}
                partnerTransactions={isFamily ? [] : sharedTransactions.filter(tx => tx.date.startsWith(month))}
                partnerProfiles={partnerProfiles}
                accounts={activeAccounts}
                categories={activeCategories}
                month={month}
                onAdd={() => setTxModal({ open: true })}
                onEdit={tx => setTxModal({ open: true, tx })}
                onQuickAdd={quickAddTx}
                onBulkDelete={bulkDeleteTx}
              />
            )}
            {tab === 'budgets' && (
              <BudgetsTab
                budgets={activeBudgets}
                sharedBudgets={isFamily ? [] : sharedBudgets}
                transactions={activeTransactions}
                partnerTransactions={isFamily ? [] : sharedTransactions}
                partnerProfiles={partnerProfiles}
                categories={activeCategories}
                month={month}
                onAdd={() => setBudgetModal(true)}
                onDeleteBudget={deleteBudget}
              />
            )}
            {tab === 'accounts' && (
              <AccountsTab
                accounts={activeAccounts}
                transactions={activeTransactions}
                onAdd={() => setAccModal({ open: true })}
                onEdit={acc => setAccModal({ open: true, account: acc })}
              />
            )}
            {tab === 'goals' && (
              <GoalsTab
                goals={goals}
                contributions={contributions}
                accounts={accounts}
                goalShares={goalShares}
                incomingGoalShares={incomingGoalShares}
                partnerProfiles={partnerProfiles}
                onNewGoal={() => setGoalModal({ open: true })}
                onEditGoal={g => setGoalModal({ open: true, goal: g })}
                onDeleteGoal={deleteGoal}
                onAddContribution={g => setContributionGoal(g)}
                onDeleteContribution={deleteContribution}
                onUpdateStatus={updateGoalStatus}
                onShareGoal={g => setGoalShareModal({ open: true, goal: g })}
              />
            )}
            {tab === 'categories' && (
              <CategoriesTab
                categories={activeCategories}
                transactions={activeTransactions}
                onAdd={() => setCatModal({ open: true })}
                onEdit={c => setCatModal({ open: true, category: c })}
              />
            )}
            {tab === 'recurring' && (
              <RecurringTab
                recurring={recurring}
                recurringEntries={recurringEntries}
                categories={categories}
                month={month}
                onAdd={() => setRecurringModal({ open: true })}
                onEdit={item => setRecurringModal({ open: true, item })}
                onMarkPaid={handleMarkPaid}
                onSkip={skipEntry}
              />
            )}
          </>
        )}
        </div>
      </div>
        </div>
      </div>

      {/* Quick action fab — desktop only (mobile uses bottom nav central FAB) */}
      {!isMobile && (tab === 'transactions' || tab === 'overview') && !loading && (
        <button
          onClick={() => setTxModal({ open: true })}
          title={t('finance_new_transaction')}
          style={{ position: 'fixed', bottom: 32, right: 32, width: 52, height: 52, borderRadius: '50%', border: 'none', backgroundColor: FIN_ACCENT, color: FIN_ACCENT_TEXT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 20px rgba(0,0,0,0.25)', zIndex: 50 }}>
          <Plus size={22} />
        </button>
      )}

      {/* Mobile bottom navigation */}
      {isMobile && !loading && (
        <MobileBottomNav
          tab={tab}
          onSelect={setTab}
          onMore={() => setMoreMenuOpen(true)}
          onQuickAdd={() => setTxModal({ open: true })}
        />
      )}
      {isMobile && moreMenuOpen && (
        <MoreMenuSheet current={tab} onSelect={setTab} onClose={() => setMoreMenuOpen(false)} />
      )}

      {/* Modals */}
      {catModal.open && (
        <CategoryModal
          category={catModal.category}
          transactions={transactions}
          onClose={() => setCatModal({ open: false })}
          onSave={saveCategory}
          onDelete={catModal.category ? () => deleteCategory(catModal.category!.id) : undefined}
        />
      )}
      {txModal.open && (
        <TransactionModal
          tx={txModal.tx}
          personalAccounts={accounts}
          familyAccounts={familyAccounts}
          personalCategories={categories}
          familyCategories={familyCategories}
          partners={partnerProfiles}
          userId={user?.id ?? ''}
          workspace={workspace}
          defaultShareWithFamily={isFamily}
          onClose={() => setTxModal({ open: false })}
          onSave={saveTx}
          onDelete={txModal.tx ? () => deleteTx(txModal.tx!.id) : undefined}
        />
      )}
      {accModal.open && (
        <AccountModal
          account={accModal.account}
          onClose={() => setAccModal({ open: false })}
          onSave={saveAccount}
          onDelete={accModal.account ? () => deleteAccount(accModal.account!.id) : undefined}
        />
      )}
      {budgetModal && (
        <BudgetModal
          categories={activeCategories}
          month={month}
          existing={activeBudgets.filter(b => b.month === month)}
          partners={partnerProfiles}
          onClose={() => setBudgetModal(false)}
          onSave={saveBudget}
        />
      )}
      {goalShareModal.open && goalShareModal.goal && (
        <GoalShareModal
          goal={goalShareModal.goal}
          shares={goalShares.filter(s => s.goal_id === goalShareModal.goal!.id)}
          onClose={() => setGoalShareModal({ open: false })}
          onAddShare={saveGoalShare}
          onRemoveShare={deleteGoalShare}
          partnerProfiles={partnerProfiles}
        />
      )}
      {wsModalOpen && (
        <WorkspaceModal
          workspace={workspace}
          members={workspaceMembers}
          invites={workspaceInvites}
          pendingInvitesForMe={pendingInvitesForMe}
          partnerProfiles={partnerProfiles}
          onClose={() => setWsModalOpen(false)}
          onReload={reload}
        />
      )}
      {goalModal.open && (
        <GoalModal
          goal={goalModal.goal}
          accounts={accounts}
          onClose={() => setGoalModal({ open: false })}
          onSave={saveGoal}
        />
      )}
      {contributionGoal && (
        <ContributionModal
          goal={contributionGoal}
          onClose={() => setContributionGoal(null)}
          onSave={saveContribution}
        />
      )}
      {recurringModal.open && (
        <RecurringModal
          item={recurringModal.item}
          categories={categories}
          accounts={accounts}
          onClose={() => setRecurringModal({ open: false })}
          onSave={saveRecurring}
          onDelete={recurringModal.item ? () => deleteRecurring(recurringModal.item!.id) : undefined}
        />
      )}
      {payModal.open && payModal.entry && payModal.rec && (
        <PayAmountModal
          entry={payModal.entry}
          recurring={payModal.rec}
          onClose={() => setPayModal({ open: false })}
          onSave={async (amount) => { await doMarkPaid(payModal.entry!, payModal.rec!, amount) }}
        />
      )}
    </div>
    </FinanceMobileContext.Provider>
  )
}
