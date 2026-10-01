// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { BarChart2, CreditCard, FolderKanban, List, RefreshCw, Tag, Target, Waypoints } from 'lucide-react'
import type { TabId } from '../financeFormat'

// ─── Mobile bottom navigation ──────────────────────────────────────────────────

// Shared tab definition (icon is static; label/subtitle resolved via i18n).
export const FINANCE_NAV: { id: TabId; icon: React.ReactNode }[] = [
  { id: 'overview', icon: <BarChart2 size={18} /> },
  { id: 'transactions', icon: <List size={18} /> },
  { id: 'budgets', icon: <Target size={18} /> },
  { id: 'accounts', icon: <CreditCard size={18} /> },
  { id: 'categories', icon: <Tag size={18} /> },
  { id: 'recurring', icon: <RefreshCw size={18} /> },
  { id: 'network', icon: <Waypoints size={18} /> },
  { id: 'myprojects', icon: <FolderKanban size={18} /> },
]

export const FINANCE_TAB_IDS = FINANCE_NAV.map(item => item.id)
export const FINANCE_NAV_ICON = Object.fromEntries(FINANCE_NAV.map(item => [item.id, item.icon])) as Record<TabId, React.ReactNode>

export function tabLabelKey(id: TabId): `finance_tab_${TabId}` {
  return `finance_tab_${id}`
}

export const MORE_TABS: TabId[] = ['accounts', 'categories', 'recurring', 'network', 'myprojects']
