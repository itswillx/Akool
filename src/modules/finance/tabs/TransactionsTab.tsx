// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Camera, Download, Link2, Pencil, Plus, Search, Trash2, Upload, Users, Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useToast } from '../../../contexts/ToastContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { localeOf } from '../../../i18n/translations'
import { activateProps } from '../../../lib/a11y'
import { downloadTransactionsCsv } from '../../../lib/financeCsv'
import { toCents } from '../../../lib/money'
import type { FinanceAccount, FinanceCategory, FinanceTransaction, FinanceTxType, FinanceWorkspace } from '../../../types'
import { fmt } from '../financeFormat'
import {
cardSurfaceStyle,
FIN_ACCENT,
FIN_NEG,
FIN_POS,
ghostBtnStyle,
primaryBtnStyle,
ScopePicker,
sectionCaptionStyle,
segBtnStyle,
segTrackStyle,
tabularNums,
useFinanceMobile
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'

// ─── Transactions Tab ─────────────────────────────────────────────────────────

export function TransactionsTab({ transactions, partnerTransactions, partnerProfiles, accounts, categories, workspace, workspaceCategories, workspaceAccounts, month, onAdd, onEdit, onQuickAdd, onBulkDelete, onImport }: {
  transactions: FinanceTransaction[]
  partnerTransactions: FinanceTransaction[]
  partnerProfiles: PartnerProfile[]
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  workspace?: FinanceWorkspace | null
  workspaceCategories: FinanceCategory[]
  workspaceAccounts: FinanceAccount[]
  month: string
  onAdd: () => void
  onEdit: (tx: FinanceTransaction) => void
  onQuickAdd: (data: Omit<FinanceTransaction, 'id' | 'user_id' | 'created_at'>) => Promise<void>
  onBulkDelete: (ids: string[]) => Promise<void>
  onImport: () => void
}) {
  const { t, lang } = useLanguage()
  const { showToast } = useToast()
  const isMobile = useFinanceMobile()
  const [filterType, setFilterType] = useState<'all' | FinanceTxType>('all')
  const [filterCat, setFilterCat] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const profileMap = useMemo(() => new Map(partnerProfiles.map(p => [p.id, p])), [partnerProfiles])
  // Resolution maps include workspace rows so the user's own shared
  // transactions render their (workspace) category/account instead of "none".
  const catMap = useMemo(() => new Map([...categories, ...workspaceCategories].map(c => [c.id, c])), [categories, workspaceCategories])
  const accMap = useMemo(() => new Map([...accounts, ...workspaceAccounts].map(a => [a.id, a])), [accounts, workspaceAccounts])

  // Quick add ("Lançamento rápido"). qaScope: null = personal, workspace id =
  // shared — category/account lists swap with it, mirroring the full modal.
  const [qaType, setQaType] = useState<FinanceTxType>('expense')
  const [qaScope, setQaScope] = useState<string | null>(null)
  const [qaDesc, setQaDesc] = useState('')
  const [qaAmount, setQaAmount] = useState('')
  const [qaCat, setQaCat] = useState('')
  const [qaAcc, setQaAcc] = useState('')
  const [qaSaving, setQaSaving] = useState(false)
  const qaCats = (qaScope ? workspaceCategories : categories).filter(c => c.type === qaType)
  const qaAccounts = qaScope ? workspaceAccounts : accounts
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
        account_id: (qaAcc || qaAccounts[0]?.id) ?? null,
        shared_with_user_id: null,
        workspace_id: qaScope,
      })
      setQaDesc('')
      setQaAmount('')
    } catch (err) {
      console.error('quickAddTx failed:', err)
      showToast('error', t('finance_quickadd_error'))
    } finally {
      setQaSaving(false)
    }
  }

  // PERF-005: filtro e agrupamento só quando a lista ou os filtros mudam.
  const { filtered, grouped } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = transactions.filter(tx => {
      if (filterType !== 'all' && tx.type !== filterType) return false
      if (filterCat && tx.category_id !== filterCat) return false
      if (q) {
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
    return { filtered, grouped }
  }, [transactions, filterType, filterCat, search, catMap])

  const toggleSel = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const doBulkDelete = async () => { const ids = selected; setSelected([]); await onBulkDelete(ids) }

  const fieldStyle: React.CSSProperties = { border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, background: 'var(--color-surface)', color: 'var(--color-text)' }
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
        <button onClick={onImport} style={ghostBtnStyle}>
          <Upload size={16} />{!isMobile && t('finance_import')}
        </button>
        <button onClick={() => downloadTransactionsCsv(filtered, [...categories, ...workspaceCategories], [...accounts, ...workspaceAccounts], month)} style={ghostBtnStyle}>
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
          {workspace && (
            <ScopePicker
              value={qaScope}
              onChange={ws => { setQaScope(ws); setQaCat(''); setQaAcc('') }}
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              label={null}
              compact
            />
          )}
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
          <select value={qaAcc || qaAccounts[0]?.id || ''} onChange={e => setQaAcc(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
            {qaAccounts.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
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
                    {new Date(group.date + 'T12:00:00').toLocaleDateString(localeOf(lang), { weekday: 'short', day: '2-digit', month: 'short' })}
                  </span>
                  <span style={{ fontSize: 12, color: net >= 0 ? FIN_POS : FIN_NEG, fontWeight: 600, ...tabularNums }}>{net >= 0 ? '+' : '−'}{fmt(Math.abs(net))}</span>
                </div>
                {group.txs.map(tx => {
                  const cat = tx.category_id ? catMap.get(tx.category_id) : null
                  const acc = tx.account_id ? accMap.get(tx.account_id) : null
                  const isSel = selected.includes(tx.id)
                  return (
                    <div key={tx.id} {...activateProps(() => onEdit(tx))} onClick={() => onEdit(tx)}
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
                      {tx.workspace_id && !isMobile && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--color-text-subtle)', background: 'var(--color-active)', borderRadius: 10, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          <Users size={10} />{t('finance_scope_workspace')}
                        </span>
                      )}
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
