// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { formatBRL } from '../../lib/money'
import { parseFinanceLocation, type ProjectsSection } from './myprojects/section'


// Single source of truth for the tabs: the union, the localStorage validator and
// the CustomEvent whitelist below all derive from this array, so adding a tab in
// one place can't silently desync the other two.
const TAB_IDS = ['overview', 'transactions', 'budgets', 'accounts', 'categories', 'recurring', 'network', 'myprojects'] as const
export type TabId = typeof TAB_IDS[number]

function isTabId(value: unknown): value is TabId {
  return typeof value === 'string' && (TAB_IDS as readonly string[]).includes(value)
}

/**
 * Único ponto do painel que entende os ids de aba antigos ('projects',
 * 'store', 'investments', 'goals'), hoje sub-abas de "Projetos". Usado tanto
 * pelo localStorage quanto pelo CustomEvent, para que os dois nunca divirjam.
 *
 * O TabId continua sendo 'myprojects' mesmo com o rótulo "Projetos": trocá-lo
 * por 'projects' colidiria com o id legado de Obras, e o mesmo texto passaria a
 * significar duas coisas.
 */
export function resolveTabRequest(raw: string | null): { tab: TabId; section: ProjectsSection | null } | null {
  const loc = parseFinanceLocation(raw)
  if (!loc || !isTabId(loc.tab)) return null
  return { tab: loc.tab, section: loc.section }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Amounts are stored and summed as integer cents; render via the shared formatter.
export function fmt(cents: number) {
  return formatBRL(cents)
}

export function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

export function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function currentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function last6Months(base: string): string[] {
  const months: string[] = []
  let cur = base
  for (let i = 5; i >= 0; i--) {
    const [y, m] = cur.split('-').map(Number)
    const d = new Date(y, m - 1 - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

export const ACCOUNT_TYPE_ICONS: Record<string, string> = {
  checking: '🏦',
  savings: '🐷',
  credit: '💳',
  cash: '💵',
}

// ─── Goal helpers ────────────────────────────────────────────────────────────

export function daysUntil(deadline: string): number {
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(deadline + 'T00:00:00'); d.setHours(0,0,0,0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}
