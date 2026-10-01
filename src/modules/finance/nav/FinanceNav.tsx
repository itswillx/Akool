// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { BarChart2, List, MoreHorizontal, Plus, Target, Wallet } from 'lucide-react'
import { useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { TabId } from '../financeFormat'
import { fmt } from '../financeFormat'
import {
FIN_ACCENT, FIN_ACCENT_TEXT,
MOBILE_NAV_HEIGHT,
Modal,
tabularNums
} from '../ui'
import { FINANCE_NAV, MORE_TABS, tabLabelKey } from './navItems'

// ─── Desktop left navigation (Lateral layout) ─────────────────────────────────

function FinanceSideNavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hov, setHov] = useState(false)
  const bg = active ? 'var(--color-active)' : hov ? 'var(--color-hover)' : 'transparent'
  return (
    <button
      type="button"
      onClick={onClick}
      // UX-008: a barra lateral é navegação (não abas); o item ativo é a página atual.
      aria-current={active ? 'page' : undefined}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', backgroundColor: bg, color: active ? 'var(--color-text)' : 'var(--color-text-subtle)', fontSize: 13.5, fontWeight: active ? 600 : 500, textAlign: 'left', transition: 'background-color 0.1s' }}
    >
      <span style={{ display: 'flex', flexShrink: 0, color: active ? 'var(--color-text)' : 'var(--color-text-muted)' }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

export function FinanceSidebar({ tab, onSelect, accountsBalance, accountCount }: {
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
      <nav aria-label={t('finance_nav_label')} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 10px', flex: 1, overflowY: 'auto' }}>
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

export function MobileBottomNav({ tab, onSelect, onMore, onQuickAdd }: {
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
      <button type="button" onClick={() => onSelect(id)} aria-current={active ? 'page' : undefined}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', color: active ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '6px 0', minHeight: MOBILE_NAV_HEIGHT - 4 }}>
        {icon}
        <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap' }}>{label}</span>
      </button>
    )
  }

  return (
    <nav aria-label={t('finance_nav_label')} className="finance-safe-bottom" style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 40, display: 'flex', alignItems: 'stretch', height: MOBILE_NAV_HEIGHT, backgroundColor: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border)' }}>
      {navBtn('overview', <BarChart2 size={20} />, t('finance_nav_overview'))}
      {navBtn('transactions', <List size={20} />, t('finance_nav_transactions'))}
      {/* Central FAB */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <button type="button" onClick={onQuickAdd} title={t('finance_new_transaction')} aria-label={t('finance_new_transaction')}
          style={{ position: 'absolute', top: -18, width: 56, height: 56, borderRadius: '50%', border: '4px solid var(--color-bg-secondary)', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.25)' }}>
          <Plus size={26} />
        </button>
      </div>
      {navBtn('budgets', <Target size={20} />, t('finance_nav_budgets'))}
      <button type="button" onClick={onMore} aria-haspopup="dialog" aria-current={moreActive ? 'page' : undefined}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', color: moreActive ? 'var(--color-text)' : 'var(--color-text-muted)', padding: '6px 0', minHeight: MOBILE_NAV_HEIGHT - 4 }}>
        <MoreHorizontal size={20} />
        <span style={{ fontSize: 10, fontWeight: moreActive ? 700 : 500 }}>{t('finance_nav_more')}</span>
      </button>
    </nav>
  )
}

export function MoreMenuSheet({ current, onSelect, onClose }: {
  current: TabId
  onSelect: (t: TabId) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  // Derived from MORE_TABS/FINANCE_NAV instead of a parallel hardcoded list:
  // a tab added to MORE_TABS but forgotten here becomes unreachable on mobile,
  // since it is not in the bottom bar either.
  const items = MORE_TABS.map(id => ({
    id,
    icon: FINANCE_NAV.find(n => n.id === id)?.icon,
    label: t(tabLabelKey(id)),
  }))
  return (
    // A navigation sheet, not a form: there is nothing typed to lose, and
    // tapping the backdrop to dismiss is the expected bottom-sheet gesture.
    <Modal title={t('finance_nav_more')} onClose={onClose} dismissOnBackdrop>
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
