import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { ChevronLeft, ChevronRight, X, Trash2, Pencil, TrendingUp, TrendingDown, Wallet, Plus, Target, ChevronDown, CheckCircle2, XCircle, Users, User, Link2, FileDown, Camera, Download, BarChart2, List, CreditCard, Star, Tag, RefreshCw, MoreHorizontal } from 'lucide-react'
import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceBudget, FinanceTxType, FinanceGoal, FinanceGoalContribution, FinanceGoalShare, FinanceRecurring, FinanceRecurringEntry, FinanceWorkspace, FinanceWorkspaceMember, FinanceWorkspaceInvite } from '../types'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useIsMobile } from '../hooks/useIsMobile'

// ─── Mobile context ────────────────────────────────────────────────────────────
// Lets nested components (modals, tabs) adapt their layout without threading an
// `isMobile` prop through every call site.

const FinanceMobileContext = createContext(false)
const useFinanceMobile = () => useContext(FinanceMobileContext)

// Height reserved for the fixed mobile bottom navigation (incl. elevated FAB).
const MOBILE_NAV_HEIGHT = 64

type TabId = 'overview' | 'transactions' | 'budgets' | 'accounts' | 'goals' | 'categories' | 'recurring'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
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
          placeholder="Cole ou digite um emoji..."
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
                style={{ width: 32, height: 32, border: value === em ? '2px solid #6366f1' : '1px solid var(--color-border)', borderRadius: 6, backgroundColor: value === em ? '#6366f122' : 'transparent', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
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
      supabase.from('finance_categories').select('*').eq('user_id', user.id).order('type').order('name'),
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
    if (!q.trim() || q.length < 2) { setResults([]); return }
    setSearching(true)
    const { data } = await supabase.from('profiles').select('id, email, display_name').or(`email.ilike.%${q}%,display_name.ilike.%${q}%`).limit(6)
    setResults((data as PartnerProfile[]) ?? [])
    setSearching(false)
  }, [])

  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, backgroundColor: 'var(--color-bg)' }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
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
                  <div style={{ width: 18, height: 18, borderRadius: '50%', backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#6366f1' }}>
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
                  <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
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
    const term = q.trim()
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
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: sending || !value.trim() ? 'not-allowed' : 'pointer', opacity: sending || !value.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
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
              <div style={{ width: 28, height: 28, borderRadius: '50%', backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
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
    amount: tx ? String(tx.amount) : '',
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
    const amt = parseFloat(form.amount.replace(',', '.'))
    if (!amt || amt <= 0) return
    setSaving(true)

    let photoUrl: string | null | undefined = undefined
    if (photoFile) {
      const ext = photoFile.name.split('.').pop() ?? 'jpg'
      const path = `${userId}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('transaction-photos')
        .upload(path, photoFile, { contentType: photoFile.type, upsert: false })
      if (!uploadErr) {
        const { data } = supabase.storage.from('transaction-photos').getPublicUrl(path)
        photoUrl = data.publicUrl
      }
    } else if (photoRemoved) {
      photoUrl = null
    } else {
      photoUrl = tx?.photo_url ?? null
    }

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
    setSaving(false)
    onClose()
  }

  const accent = form.type === 'income' ? '#22c55e' : '#ef4444'

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
                title="Baixar imagem"
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <Download size={14} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemovePhoto(true)}
                title="Remover foto"
                style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.6)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          {confirmRemovePhoto && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, backgroundColor: '#fef2f2', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, color: '#dc2626' }}>Remover esta foto?</span>
              <button type="button" onClick={handlePhotoRemove}
                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Remover
              </button>
              <button type="button" onClick={() => setConfirmRemovePhoto(false)}
                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', fontSize: 12, cursor: 'pointer' }}>
                Cancelar
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
                borderColor: form.type === tp ? (tp === 'income' ? '#22c55e' : '#ef4444') : 'var(--color-border)',
                backgroundColor: form.type === tp ? (tp === 'income' ? '#22c55e22' : '#ef444422') : 'transparent',
                color: form.type === tp ? (tp === 'income' ? '#22c55e' : '#ef4444') : 'var(--color-text-muted)',
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
            autoFocus={!tx}
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
              style={{ flexShrink: 0, padding: '9px 14px', borderRadius: 20, border: '1.5px solid', borderColor: !form.category_id ? '#6366f1' : 'var(--color-border)', backgroundColor: !form.category_id ? '#6366f122' : 'var(--color-surface)', color: !form.category_id ? '#6366f1' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', minHeight: 40 }}>
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
                  style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: form.share_with_family ? '#6366f110' : 'var(--color-bg)', cursor: 'pointer', transition: 'all 0.15s' }}>
                  <div style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: form.share_with_family ? '#6366f1' : 'var(--color-border)', position: 'relative', transition: 'background-color 0.2s', flexShrink: 0 }}>
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
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '15px 16px', borderRadius: 12, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 16, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
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

  // ─── Desktop ─────────────────────────────────────────────────────────────────
  return (
    <Modal title={tx ? t('finance_edit') : t('finance_new_transaction')} onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['expense', 'income'] as FinanceTxType[]).map(tp => (
          <button
            key={tp}
            onClick={() => setForm(f => ({ ...f, type: tp, category_id: '' }))}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8, border: '2px solid',
              borderColor: form.type === tp ? (tp === 'income' ? '#22c55e' : '#ef4444') : 'var(--color-border)',
              backgroundColor: form.type === tp ? (tp === 'income' ? '#22c55e22' : '#ef444422') : 'transparent',
              color: form.type === tp ? (tp === 'income' ? '#22c55e' : '#ef4444') : 'var(--color-text-muted)',
              cursor: 'pointer', fontWeight: 600, fontSize: 14,
            }}
          >
            {tp === 'income' ? t('finance_tx_income') : t('finance_tx_expense')}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <label style={labelStyle}>{t('finance_tx_date')}</label>
          <input style={inputStyle} type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
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
        {workspace ? (
          <div>
            <label style={labelStyle}>{t('finance_share_family')}</label>
            <button type="button" onClick={() => setForm(f => ({ ...f, share_with_family: !f.share_with_family, category_id: '', account_id: '' }))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: form.share_with_family ? '#6366f110' : 'var(--color-bg)', cursor: 'pointer', transition: 'all 0.15s' }}>
              <div style={{ width: 38, height: 22, borderRadius: 11, backgroundColor: form.share_with_family ? '#6366f1' : 'var(--color-border)', position: 'relative', transition: 'background-color 0.2s', flexShrink: 0 }}>
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

      <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
        {tx && onDelete && !confirming && (
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
          {t('finance_save')}
        </button>
      </div>
    </Modal>
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
    initial_balance: account ? String(account.initial_balance) : '0',
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
      initial_balance: parseFloat(form.initial_balance.replace(',', '.')) || 0,
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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
    const amt = parseFloat(limit.replace(',', '.'))
    if (!catId || !amt || amt <= 0) return
    setSaving(true)
    await onSave({ category_id: catId, month, amount_limit: amt, shared_with_user_id: sharedWith || null })
    setSaving(false)
    onClose()
  }

  if (available.length === 0) {
    return (
      <Modal title={t('finance_new_budget')} onClose={onClose}>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Todas as categorias já têm orçamento neste mês.</p>
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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

  // Top expense categories
  const catMap = new Map(categories.map(c => [c.id, c]))
  const expenseBycat: Record<string, number> = {}
  monthTxs.filter(tx => tx.type === 'expense' && tx.category_id).forEach(tx => {
    expenseBycat[tx.category_id!] = (expenseBycat[tx.category_id!] ?? 0) + tx.amount
  })
  const topCats = Object.entries(expenseBycat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
  const maxCatAmount = topCats[0]?.[1] ?? 1

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
  const in30 = new Date(todayDate)
  in30.setDate(todayDate.getDate() + 15)
  const recMap = new Map(recurring.map(r => [r.id, r]))
  const upcomingEntries = recurringEntries
    .filter(e => {
      if (e.status !== 'pending') return false
      const due = new Date(e.due_date + 'T12:00:00')
      return due <= in30 || due < todayDate
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  const cardStyle = (color: string): React.CSSProperties => ({
    flex: 1,
    minWidth: isMobile ? '100%' : 0,
    backgroundColor: 'var(--color-surface)',
    border: `1px solid var(--color-border)`,
    borderRadius: 12,
    padding: '16px 20px',
    borderLeft: `4px solid ${color}`,
  })

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

  const sectorCard = (key: string, icon: React.ReactNode, label: string, value: React.ReactNode, sub: string, tab: TabId) => (
    <button key={key} onClick={() => onNavigate(tab)}
      style={{ flex: 1, minWidth: isMobile ? 'calc(50% - 5px)' : 140, textAlign: 'left', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--color-text-muted)' }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <ChevronRight size={13} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{sub}</div>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={cardStyle('#22c55e')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <TrendingUp size={14} color="#22c55e" />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{t('finance_month_income')}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#22c55e' }}>{fmt(income)}</div>
        </div>
        <div style={cardStyle('#ef4444')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <TrendingDown size={14} color="#ef4444" />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{t('finance_month_expense')}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#ef4444' }}>{fmt(expense)}</div>
        </div>
        <div style={cardStyle(balance >= 0 ? '#6366f1' : '#f59e0b')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Wallet size={14} color={balance >= 0 ? '#6366f1' : '#f59e0b'} />
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600 }}>{t('finance_month_balance')}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: balance >= 0 ? '#6366f1' : '#f59e0b' }}>{fmt(balance)}</div>
        </div>
      </div>

      {/* Sector shortcuts */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {sectorCard('accounts', <Wallet size={14} />, t('finance_tab_accounts'),
          fmt(accountsBalance),
          accounts.length === 1 ? t('finance_overview_accounts_sub', { n: accounts.length }) : t('finance_overview_accounts_sub_plural', { n: accounts.length }),
          'accounts')}
        {sectorCard('goals', <Target size={14} />, t('finance_tab_goals'),
          activeGoals.length > 0 ? `${goalsPct.toFixed(0)}%` : '—',
          activeGoals.length === 1 ? t('finance_overview_goals_sub', { n: activeGoals.length }) : t('finance_overview_goals_sub_plural', { n: activeGoals.length }),
          'goals')}
        {sectorCard('budgets', <BarChart2 size={14} />, t('finance_tab_budgets'),
          monthBudgets.length > 0 ? (budgetsOver > 0 ? t('finance_overview_budgets_over', { n: budgetsOver }) : t('finance_overview_budgets_ok')) : '—',
          monthBudgets.length === 1 ? t('finance_overview_budgets_sub', { n: monthBudgets.length }) : t('finance_overview_budgets_sub_plural', { n: monthBudgets.length }),
          'budgets')}
        {sectorCard('recurring', <RefreshCw size={14} />, t('finance_tab_recurring'),
          upcomingEntries.length > 0 ? String(upcomingEntries.length) : '—',
          upcomingEntries.length === 1 ? t('finance_overview_recurring_sub', { n: upcomingEntries.length }) : t('finance_overview_recurring_sub_plural', { n: upcomingEntries.length }),
          'recurring')}
      </div>


      {/* Upcoming bills */}
      {upcomingEntries.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_upcoming_bills')}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upcomingEntries.map(entry => {
              const rec = recMap.get(entry.recurring_id)
              if (!rec) return null
              const due = new Date(entry.due_date + 'T12:00:00')
              const diffDays = Math.round((due.getTime() - todayDate.getTime()) / 86400000)
              const badgeColor = diffDays < 0 ? '#ef4444' : diffDays === 0 ? '#f59e0b' : diffDays <= 3 ? '#ef4444' : diffDays <= 7 ? '#f59e0b' : '#22c55e'
              const badgeLabel = diffDays < 0 ? t('finance_upcoming_overdue') : diffDays === 0 ? t('finance_upcoming_today') : diffDays === 1 ? t('finance_upcoming_days_left', { n: diffDays }) : t('finance_upcoming_days_left_plural', { n: diffDays })
              return (
                <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, backgroundColor: 'var(--color-bg)', border: `1px solid ${badgeColor}33` }}>
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
                          style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: confirm.action === 'pay' ? '#22c55e' : '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                          ✓ Confirmar
                        </button>
                        <button onClick={() => setConfirm(null)}
                          style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11 }}>
                          ✕
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setConfirm({ entryId: entry.id, action: 'pay' })}
                          style={{ padding: '4px 8px', borderRadius: 6, border: 'none', backgroundColor: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
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

      {/* Top categories */}
      {topCats.length > 0 && (
        <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
          <h4 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_top_categories')}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topCats.map(([catId, amount]) => {
              const cat = catMap.get(catId)
              if (!cat) return null
              const pct = (amount / maxCatAmount) * 100
              return (
                <div key={catId}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{cat.icon} {cat.name}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>{fmt(amount)}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--color-border)' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, backgroundColor: cat.color, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Monthly evolution */}
      <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
        <h4 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_monthly_evolution')}</h4>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 100 }}>
          {monthStats.map(ms => (
            <div key={ms.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: 80 }}>
                <div title={`Receita: ${fmt(ms.income)}`} style={{ flex: 1, borderRadius: '3px 3px 0 0', backgroundColor: '#22c55e66', height: `${(ms.income / maxBar) * 100}%`, minHeight: ms.income > 0 ? 3 : 0, transition: 'height 0.4s ease' }} />
                <div title={`Despesa: ${fmt(ms.expense)}`} style={{ flex: 1, borderRadius: '3px 3px 0 0', backgroundColor: '#ef444466', height: `${(ms.expense / maxBar) * 100}%`, minHeight: ms.expense > 0 ? 3 : 0, transition: 'height 0.4s ease' }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{ms.label}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#22c55e66' }} /><span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Receita</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#ef444466' }} /><span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Despesa</span></div>
        </div>
      </div>

      {/* Donut chart — expenses by category */}
      {(() => {
        const donutTotal = topCats.reduce((s, [, v]) => s + v, 0)
        if (donutTotal === 0) return null
        const CIRC = 2 * Math.PI * 54
        let cumulative = 0
        const segments = topCats.map(([catId, amount]) => {
          const cat = catMap.get(catId)
          if (!cat) return null
          const fraction = amount / donutTotal
          const dashLen = fraction * CIRC
          const dashOffset = CIRC / 4 - cumulative
          cumulative += dashLen
          return { catId, cat, amount, fraction, dashLen, dashOffset }
        }).filter(Boolean) as { catId: string; cat: FinanceCategory; amount: number; fraction: number; dashLen: number; dashOffset: number }[]

        return (
          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_overview_donut_title')}</h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <svg width="140" height="140" viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
                <circle cx="80" cy="80" r="54" fill="none" stroke="var(--color-border)" strokeWidth="22" />
                {segments.map(seg => (
                  <circle key={seg.catId} cx="80" cy="80" r="54" fill="none"
                    stroke={seg.cat.color} strokeWidth="22"
                    strokeDasharray={`${seg.dashLen} ${CIRC}`}
                    strokeDashoffset={seg.dashOffset}
                    style={{ transition: 'stroke-dasharray 0.4s ease' }}
                  />
                ))}
                <text x="80" y="76" textAnchor="middle" style={{ fontSize: 11, fill: 'var(--color-text-muted)' }}>Total</text>
                <text x="80" y="92" textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--color-text)' }}>{fmt(donutTotal)}</text>
              </svg>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 120 }}>
                {segments.map(seg => (
                  <div key={seg.catId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: seg.cat.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--color-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{seg.cat.icon} {seg.cat.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0 }}>{Math.round(seg.fraction * 100)}%</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', flexShrink: 0 }}>{fmt(seg.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Savings rate chart — last 6 months */}
      {(() => {
        const savingsStats = monthStats.map(ms => ({
          ...ms,
          rate: ms.income > 0 ? Math.round(((ms.income - ms.expense) / ms.income) * 100) : null,
        }))
        const hasData = savingsStats.some(s => s.income > 0 || s.expense > 0)
        if (!hasData) return null
        const maxAbs = Math.max(...savingsStats.map(s => Math.abs(s.rate ?? 0)), 1)
        return (
          <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: '16px 20px' }}>
            <h4 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_overview_savings_title')}</h4>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 110 }}>
              {savingsStats.map(ms => {
                const rate = ms.rate
                const isPositive = rate != null && rate >= 0
                const barColor = rate == null ? 'var(--color-border)' : isPositive ? '#22c55e' : '#ef4444'
                const barH = rate != null ? (Math.abs(rate) / maxAbs) * 72 : 4
                return (
                  <div key={ms.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: barColor }}>
                      {rate != null ? `${rate > 0 ? '+' : ''}${rate}%` : '—'}
                    </span>
                    <div title={rate != null ? `${rate}% de economia` : 'Sem receita'} style={{ width: '70%', borderRadius: '3px 3px 0 0', backgroundColor: barColor, height: barH, minHeight: 3, transition: 'height 0.4s ease, background-color 0.3s' }} />
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{ms.label}</span>
                  </div>
                )
              })}
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>{t('finance_overview_of_income')}</p>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────

function TransactionsTab({ transactions, partnerTransactions, partnerProfiles, accounts, categories, onAdd, onEdit }: {
  transactions: FinanceTransaction[]
  partnerTransactions: FinanceTransaction[]
  partnerProfiles: PartnerProfile[]
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  onAdd: () => void
  onEdit: (tx: FinanceTransaction) => void
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const [filterType, setFilterType] = useState<'all' | FinanceTxType>('all')
  const [filterCat, setFilterCat] = useState('')
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))

  const catMap = new Map(categories.map(c => [c.id, c]))
  const accMap = new Map(accounts.map(a => [a.id, a]))

  const filtered = transactions.filter(tx => {
    if (filterType !== 'all' && tx.type !== filterType) return false
    if (filterCat && tx.category_id !== filterCat) return false
    return true
  })

  const grouped: { date: string; txs: FinanceTransaction[] }[] = []
  filtered.forEach(tx => {
    const last = grouped[grouped.length - 1]
    if (last && last.date === tx.date) {
      last.txs.push(tx)
    } else {
      grouped.push({ date: tx.date, txs: [tx] })
    }
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters + Add button */}
      <div className="finance-hide-scrollbar" style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'nowrap' : 'wrap', alignItems: 'center', overflowX: isMobile ? 'auto' : 'visible', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {(['all', 'income', 'expense'] as const).map(f => (
          <button key={f} onClick={() => setFilterType(f)}
            style={{ flexShrink: 0, padding: isMobile ? '9px 16px' : '6px 14px', borderRadius: 20, border: '1px solid var(--color-border)', backgroundColor: filterType === f ? '#6366f1' : 'transparent', color: filterType === f ? '#fff' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: filterType === f ? 600 : 400, whiteSpace: 'nowrap' }}>
            {f === 'all' ? t('finance_filter_all') : f === 'income' ? t('finance_filter_income') : t('finance_filter_expense')}
          </button>
        ))}
        <select style={{ ...inputStyle, width: 'auto', flexShrink: 0, fontSize: 13, padding: isMobile ? '9px 10px' : '6px 10px' }}
          value={filterCat} onChange={e => setFilterCat(e.target.value)}>
          <option value="">{t('finance_tx_none_category')}</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        {!isMobile && (
          <button onClick={onAdd}
            style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            {t('finance_new_transaction')}
          </button>
        )}
      </div>

      {/* Transaction list */}
      {filtered.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>{t('finance_no_transactions')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grouped.map(group => (
            <div key={group.date}>
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)' }}>
                {new Date(group.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {group.txs.map(tx => {
                  const cat = tx.category_id ? catMap.get(tx.category_id) : null
                  const acc = tx.account_id ? accMap.get(tx.account_id) : null
                  return (
                    <div key={tx.id}
                      onClick={() => onEdit(tx)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', cursor: 'pointer', transition: 'background-color 0.1s' }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'var(--color-surface)')}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, backgroundColor: cat ? `${cat.color}22` : 'var(--color-border)' }}>
                        {cat ? cat.icon : (tx.type === 'income' ? '💰' : '💸')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tx.description || (cat?.name ?? (tx.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')))}
                        </p>
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
                          {cat?.name ?? t('finance_tx_none_category')} {acc ? `· ${acc.icon} ${acc.name}` : ''}
                        </p>
                      </div>
                      <span style={{ fontSize: 15, fontWeight: 700, color: tx.type === 'income' ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
                        {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
                      </span>
                      {tx.photo_url && (
                        <span title="Tem comprovante" style={{ display: 'flex', alignItems: 'center', color: '#94a3b8', flexShrink: 0 }}>
                          <Camera size={13} />
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Partner shared transactions */}
      {partnerTransactions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Link2 size={11} />{t('finance_tx_shared_partner')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {partnerTransactions.map(tx => {
              const cat = tx.category_id ? catMap.get(tx.category_id) : null
              const owner = profileMap.get(tx.user_id)
              return (
                <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid #6366f133', opacity: 0.9 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, backgroundColor: cat ? `${cat.color}22` : 'var(--color-border)' }}>
                    {cat ? cat.icon : (tx.type === 'income' ? '💰' : '💸')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.description || (cat?.name ?? (tx.type === 'income' ? t('finance_tx_income') : t('finance_tx_expense')))}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: '#6366f1' }}>
                      {t('finance_tx_shared_by')} {owner?.display_name || owner?.email || '?'}
                    </p>
                  </div>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: '#6366f122', color: '#6366f1', fontWeight: 700, flexShrink: 0 }}>{t('finance_shared_badge')}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: tx.type === 'income' ? '#22c55e' : '#ef4444', flexShrink: 0 }}>
                    {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
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
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
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
                  <span>{over ? t('finance_budget_over') : t('finance_budget_remaining')}: <strong style={{ color: over ? '#ef4444' : '#22c55e' }}>{fmt(Math.abs(remaining))}</strong></span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Shared budgets from partner */}
      {monthSharedBudgets.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
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
              const barColor = over ? '#ef4444' : pct > 80 ? '#f59e0b' : '#6366f1'
              return (
                <div key={budget.id} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid #6366f133', borderRadius: 12, padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 18 }}>{cat?.icon ?? '📦'}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{cat?.name ?? budget.category_id}</span>
                      <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 8, backgroundColor: '#6366f122', color: '#6366f1', fontWeight: 700 }}>{t('finance_shared_badge')}</span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('finance_budget_shared_by')} {owner?.display_name || owner?.email}</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 4, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <span>{t('finance_budget_combined_spent')}: <strong style={{ color: over ? '#ef4444' : 'var(--color-text)' }}>{fmt(combinedSpent)}</strong></span>
                    <span>{t('finance_budget_limit')}: <strong>{fmt(budget.amount_limit)}</strong></span>
                    <span>{over ? t('finance_budget_over') : t('finance_budget_remaining')}: <strong style={{ color: over ? '#ef4444' : '#22c55e' }}>{fmt(Math.abs(budget.amount_limit - combinedSpent))}</strong></span>
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
            {t('finance_balance_total')}: <strong style={{ color: totalBalance >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(totalBalance)}</strong>
          </div>
        )}
        <button onClick={onAdd}
          style={{ marginLeft: 'auto', padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
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
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: bal >= 0 ? '#22c55e' : '#ef4444' }}>{fmt(bal)}</p>
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
                  borderColor: form.type === tp ? (tp === 'income' ? '#22c55e' : '#ef4444') : 'var(--color-border)',
                  backgroundColor: form.type === tp ? (tp === 'income' ? '#22c55e22' : '#ef444422') : 'transparent',
                  color: form.type === tp ? (tp === 'income' ? '#22c55e' : '#ef4444') : 'var(--color-text-muted)',
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
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
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_cat_income')} ({incomes.length})</p>
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
    target_amount: goal ? String(goal.target_amount) : '',
    deadline: goal?.deadline ?? '',
    account_id: goal?.account_id ?? '',
    status: goal?.status ?? 'active' as FinanceGoal['status'],
  })
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const amt = parseFloat(form.target_amount.replace(',','.'))
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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
    const amt = parseFloat(amount.replace(',','.'))
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
            onChange={e => setNote(e.target.value)} placeholder="Ex: Economias de março" />
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
                    <div style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#6366f1', flexShrink: 0 }}>
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
              style={{ marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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
      completed: { bg: '#22c55e22', color: '#22c55e', label: t('finance_goal_status_completed') },
      cancelled:  { bg: '#6b728022', color: '#6b7280', label: t('finance_goal_status_cancelled') },
      overdue:    { bg: '#ef444422', color: '#ef4444', label: t('finance_goal_status_overdue') },
      active:     { bg: '#6366f122', color: '#6366f1', label: t('finance_goal_status_active') },
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
    if (raw === 0) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>Vence hoje</span>
    return <span style={{ color: raw <= 30 ? '#f59e0b' : '#22c55e', fontWeight: 600 }}>{days === 1 ? t('finance_goal_days_left', { n: days }) : t('finance_goal_days_left_plural', { n: days })}</span>
  }

  const ownedGoals = goals.filter(g => !sharedGoalIds.has(g.id))
  const sharedGoals = goals.filter(g => sharedGoalIds.has(g.id))
  const active = ownedGoals.filter(g => g.status !== 'cancelled')
  const cancelled = ownedGoals.filter(g => g.status === 'cancelled')

  const renderGoal = (goal: FinanceGoal, isOwned = true) => {
    const accumulated = getAccumulated(goal.id)
    const pct = Math.min((accumulated / goal.target_amount) * 100, 100)
    const status = getEffectiveStatus(goal)
    const goalContribs = getContributions(goal.id)
    const isExpanded = expanded[goal.id] ?? false
    const barColor = status === 'overdue' ? '#ef4444' : status === 'completed' ? '#22c55e' : pct >= 80 ? '#f59e0b' : goal.color
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
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: '#6366f122', color: '#6366f1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={10} />{t('finance_goal_shared_by')} {sharer.display_name || sharer.email}
                  </span>
                )}
                {isOwned && sharesForGoal.length > 0 && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: '#6366f122', color: '#6366f1', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
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
                  + Aporte
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
              <span style={{ fontWeight: 600, color: barColor }}>{pct.toFixed(1)}%</span>
              {status !== 'completed' && (
                <span>{t('finance_goal_remaining')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(Math.max(goal.target_amount - accumulated, 0))}</strong></span>
              )}
              {status === 'completed' && (
                <span style={{ color: '#22c55e', fontWeight: 700 }}>{t('finance_goal_completed_badge')}</span>
              )}
            </div>
          </div>

          {/* Status actions + expand */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isOwned && status === 'active' && accumulated >= goal.target_amount && (
              <button onClick={() => onUpdateStatus(goal.id, 'completed')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: '#22c55e22', color: '#22c55e', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <CheckCircle2 size={12} />{t('finance_goal_mark_completed')}
              </button>
            )}
            {isOwned && status === 'completed' && (
              <button onClick={() => onUpdateStatus(goal.id, 'active')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: '#6366f122', color: '#6366f1', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
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
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, backgroundColor: '#6366f122', color: '#6366f1', fontWeight: 600, flexShrink: 0 }}>
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
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Excluir meta?</span>
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
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
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
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Canceladas</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: 0.6 }}>
                {cancelled.map(g => renderGoal(g, true))}
              </div>
            </div>
          )}
          {sharedGoals.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
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
    amount: item?.amount != null ? String(item.amount) : '',
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
    if (!form.is_variable && (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0)) return
    setSaving(true)
    await onSave({
      type: form.type,
      description: form.description.trim(),
      is_variable: form.is_variable,
      amount: form.is_variable ? null : Number(form.amount),
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
                border: `2px solid ${form.type === tp ? (tp === 'expense' ? '#ef4444' : '#22c55e') : 'var(--color-border)'}`,
                backgroundColor: form.type === tp ? (tp === 'expense' ? '#ef444422' : '#22c55e22') : 'transparent',
                color: form.type === tp ? (tp === 'expense' ? '#ef4444' : '#22c55e') : 'var(--color-text-muted)',
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
            style={toggleStyle(form.is_variable, '#6366f1')}>
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
              style={toggleStyle(form.active, '#22c55e')}>
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
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
  const [amount, setAmount] = useState(recurring.amount != null ? String(recurring.amount) : '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const v = Number(amount)
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
          style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: (saving || !amount) ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: (saving || !amount) ? 0.7 : 1 }}>
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
    if (entry.status === 'paid') return { label: t('finance_entry_paid'), color: '#22c55e' }
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
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: '#22c55e22', color: '#22c55e', fontWeight: 600 }}>
                  {t('finance_recurring_installments_done')}
                </span>
              )}
              {item.total_installments != null && !isFullyPaid && (
                <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: '#6366f122', color: '#818cf8', fontWeight: 600 }}>
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
                  style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', backgroundColor: confirm.action === 'pay' ? '#22c55e' : '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
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
                  style={{ flex: 1, padding: '6px 0', borderRadius: 7, border: 'none', backgroundColor: '#22c55e', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
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
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
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
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', color: active ? '#6366f1' : 'var(--color-text-muted)', padding: '6px 0', minHeight: MOBILE_NAV_HEIGHT - 4 }}>
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
          style={{ position: 'absolute', top: -18, width: 56, height: 56, borderRadius: '50%', border: '4px solid var(--color-bg-secondary)', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(99,102,241,0.45)' }}>
          <Plus size={26} />
        </button>
      </div>
      {navBtn('budgets', <Target size={20} />, t('finance_nav_budgets'))}
      <button onClick={onMore}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', color: moreActive ? '#6366f1' : 'var(--color-text-muted)', padding: '6px 0', minHeight: MOBILE_NAV_HEIGHT - 4 }}>
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
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '20px 12px', borderRadius: 14, border: '1.5px solid', borderColor: active ? '#6366f1' : 'var(--color-border)', backgroundColor: active ? '#6366f122' : 'var(--color-surface)', color: active ? '#6366f1' : 'var(--color-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
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
                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#6366f118', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Users size={14} color="#6366f1" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Convite para workspace</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>de {inv.inviter_profile?.display_name || inv.inviter_profile?.email || inv.invited_by.slice(0, 8)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button disabled={acting} onClick={() => handleAccept(inv.id)}
                        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
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
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: creating || !wsName.trim() ? 'not-allowed' : 'pointer', opacity: creating || !wsName.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
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
                style={{ padding: '8px 14px', border: 'none', borderBottom: activeTab === tabId ? '2px solid #6366f1' : '2px solid transparent', backgroundColor: 'transparent', color: activeTab === tabId ? '#6366f1' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tabId ? 600 : 400, transition: 'color 0.15s' }}>
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
                  <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: m.role === 'owner' ? '#f59e0b18' : '#6366f118', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14, fontWeight: 700, color: m.role === 'owner' ? '#f59e0b' : '#6366f1' }}>
                    {getMemberName(m).charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getMemberName(m)} {m.user_id === user?.id && <span style={{ fontSize: 10, color: '#6366f1', fontWeight: 600 }}>(você)</span>}
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
                <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16 }}>Nenhum convite enviado.</p>
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
                <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16 }}>Nenhum convite pendente.</p>
              ) : pendingInvitesForMe.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Convite para workspace</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                      de {inv.inviter_profile?.display_name || inv.inviter_profile?.email || inv.invited_by.slice(0, 8)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={acting} onClick={() => handleAccept(inv.id)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: '#22c55e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
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
    if (txModal.tx) {
      await supabase.from('finance_transactions').update(data).eq('id', txModal.tx.id)
    } else {
      await supabase.from('finance_transactions').insert({ ...data, user_id: user.id })
    }
    await reload()
  }

  const deleteTx = async (id: string) => {
    await supabase.from('finance_transactions').delete().eq('id', id)
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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'overview', label: t('finance_tab_overview') },
    { id: 'transactions', label: t('finance_tab_transactions') },
    { id: 'budgets', label: t('finance_tab_budgets') },
    { id: 'accounts', label: t('finance_tab_accounts') },
    { id: 'goals', label: t('finance_tab_goals') },
    { id: 'categories', label: t('finance_tab_categories') },
    { id: 'recurring', label: t('finance_tab_recurring') },
  ]

  const monthNavVisible = tab !== 'goals' && tab !== 'categories' && tab !== 'recurring'

  return (
    <FinanceMobileContext.Provider value={isMobile}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden', position: 'relative' }}>
      {/* Header */}
      <div style={{ padding: isMobile ? '12px 14px' : '14px 16px 0', borderBottom: '1px solid var(--color-border)', flexShrink: 0, backgroundColor: 'var(--color-bg-secondary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: isMobile ? 0 : 12, flexWrap: 'nowrap' }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: '#6366f122', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <TrendingUp size={16} color="#6366f1" />
          </div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {isMobile ? (tabs.find(tb => tb.id === tab)?.label ?? t('finance_title')) : t('finance_title')}
          </h2>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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
            title={t('finance_workspace_title')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMobile ? 8 : '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: workspace ? '#6366f110' : 'var(--color-bg)', cursor: 'pointer', fontSize: 12, color: workspace ? '#6366f1' : 'var(--color-text-muted)', flexShrink: 0, whiteSpace: 'nowrap', fontWeight: workspace ? 600 : 400 }}
          >
            <Users size={isMobile ? 16 : 13} />
            {!isMobile && <span>{workspace ? workspace.name : t('finance_workspace_title')}</span>}
            {pendingInvitesForMe.length > 0 && (
              <span style={{ minWidth: 16, height: 16, borderRadius: 999, backgroundColor: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                {pendingInvitesForMe.length}
              </span>
            )}
          </button>
          {/* View toggle (only when in a workspace) */}
          {workspace && (
            <div style={{ display: 'flex', borderRadius: 8, border: '1px solid var(--color-border)', overflow: 'hidden', flexShrink: 0 }}>
              <button
                onClick={() => setViewMode('individual')}
                title={t('finance_view_individual')}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMobile ? '5px 8px' : '5px 10px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: viewMode === 'individual' ? 600 : 400, backgroundColor: viewMode === 'individual' ? '#6366f1' : 'var(--color-bg)', color: viewMode === 'individual' ? '#fff' : 'var(--color-text-muted)', transition: 'all 0.15s' }}
              >
                <User size={12} />
                {!isMobile && t('finance_view_individual')}
              </button>
              <button
                onClick={() => setViewMode('family')}
                title={t('finance_view_family')}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: isMobile ? '5px 8px' : '5px 10px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: viewMode === 'family' ? 600 : 400, backgroundColor: viewMode === 'family' ? '#6366f1' : 'var(--color-bg)', color: viewMode === 'family' ? '#fff' : 'var(--color-text-muted)', transition: 'all 0.15s' }}
              >
                <Users size={12} />
                {!isMobile && t('finance_view_family')}
              </button>
            </div>
          )}
          <button
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try {
                const { exportFinanceToPdf } = await import('../hooks/usePdfExport')
                await exportFinanceToPdf({ transactions, accounts, categories, budgets, goals, contributions, recurring, month, userName: profile?.display_name || profile?.email || '' })
              } catch (err) {
                console.error('[FinancePDF] export error:', err)
              } finally {
                setExporting(false)
              }
            }}
            disabled={exporting}
            title={t('finance_pdf_export_btn')}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: isMobile ? 8 : '5px 10px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', cursor: exporting ? 'not-allowed' : 'pointer', fontSize: 12, color: 'var(--color-text-muted)', opacity: exporting ? 0.6 : 1, flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            <FileDown size={isMobile ? 16 : 13} />
            {!isMobile && <span>{exporting ? t('finance_pdf_generating') : t('finance_pdf_export_btn')}</span>}
          </button>
          </div>
        </div>

        {/* Tabs — desktop only (mobile uses bottom nav) */}
        {!isMobile && (
          <div style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
            {tabs.map(tb => (
              <button key={tb.id} onClick={() => setTab(tb.id)}
                style={{
                  padding: '9px 14px', border: 'none', borderBottom: tab === tb.id ? '2px solid #6366f1' : '2px solid transparent',
                  backgroundColor: 'transparent', color: tab === tb.id ? '#6366f1' : 'var(--color-text-muted)',
                  cursor: 'pointer', fontSize: 13, fontWeight: tab === tb.id ? 600 : 400, transition: 'color 0.15s',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                {tb.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', paddingBottom: isMobile ? MOBILE_NAV_HEIGHT + 24 : 16 }}>
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
                onAdd={() => setTxModal({ open: true })}
                onEdit={tx => setTxModal({ open: true, tx })}
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

      {/* Quick action fab — desktop only (mobile uses bottom nav central FAB) */}
      {!isMobile && (tab === 'transactions' || tab === 'overview') && !loading && (
        <button
          onClick={() => setTxModal({ open: true })}
          title={t('finance_new_transaction')}
          style={{ position: 'fixed', bottom: 32, right: 32, width: 52, height: 52, borderRadius: '50%', border: 'none', backgroundColor: '#6366f1', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(99,102,241,0.4)', zIndex: 50 }}>
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
