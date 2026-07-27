import type { CSSProperties } from 'react'
import type {
  FinanceProjectItemPriority,
  FinanceProjectItemStatus,
  FinanceProjectStatus,
  FinancePaymentMethod,
} from '../../../types'
import type { TranslationKey } from '../../../i18n/translations'
import { FIN_NEG, FIN_POS, FIN_WARN } from '../ui'

// Style and label helpers local to the works submodule. Kept free of JSX so it
// stays a plain .ts module (same split as studyUi.ts).

export const PROJECT_STATUSES: FinanceProjectStatus[] = ['planning', 'active', 'paused', 'done', 'cancelled']
export const ITEM_STATUSES: FinanceProjectItemStatus[] = ['planned', 'quoted', 'purchased', 'cancelled']
export const ITEM_PRIORITIES: FinanceProjectItemPriority[] = ['low', 'normal', 'high']
export const PAYMENT_METHODS: FinancePaymentMethod[] = [
  'pix', 'cash', 'debit', 'credit', 'boleto', 'transfer', 'financing',
]

// Units offered as datalist suggestions — free text is still allowed, since a
// building site always invents one more ("balde", "viagem").
export const UNIT_SUGGESTIONS = ['un', 'm²', 'm³', 'm', 'kg', 'saco', 'cx', 'pç', 'L', 'rolo', 'barra', 'milheiro']

// Explicit maps rather than `\`finance_proj_status_${s}\` as TranslationKey`: a
// template cast type-checks even when the key does not exist, these do not.
export const PROJECT_STATUS_KEY: Record<FinanceProjectStatus, TranslationKey> = {
  planning: 'finance_proj_status_planning',
  active: 'finance_proj_status_active',
  paused: 'finance_proj_status_paused',
  done: 'finance_proj_status_done',
  cancelled: 'finance_proj_status_cancelled',
}

export const ITEM_STATUS_KEY: Record<FinanceProjectItemStatus, TranslationKey> = {
  planned: 'finance_proj_item_status_planned',
  quoted: 'finance_proj_item_status_quoted',
  purchased: 'finance_proj_item_status_purchased',
  cancelled: 'finance_proj_item_status_cancelled',
}

export const PRIORITY_KEY: Record<FinanceProjectItemPriority, TranslationKey> = {
  low: 'finance_proj_prio_low',
  normal: 'finance_proj_prio_normal',
  high: 'finance_proj_prio_high',
}

export const PAYMENT_KEY: Record<FinancePaymentMethod, TranslationKey> = {
  cash: 'finance_proj_pay_cash',
  pix: 'finance_proj_pay_pix',
  debit: 'finance_proj_pay_debit',
  credit: 'finance_proj_pay_credit',
  boleto: 'finance_proj_pay_boleto',
  transfer: 'finance_proj_pay_transfer',
  financing: 'finance_proj_pay_financing',
}

export function projectStatusColor(status: FinanceProjectStatus): string {
  switch (status) {
    case 'active': return FIN_POS
    case 'planning': return 'var(--color-text-muted)'
    case 'paused': return FIN_WARN
    case 'done': return FIN_POS
    case 'cancelled': return FIN_NEG
  }
}

export function itemStatusColor(status: FinanceProjectItemStatus): string {
  switch (status) {
    case 'planned': return 'var(--color-text-muted)'
    case 'quoted': return FIN_WARN
    case 'purchased': return FIN_POS
    case 'cancelled': return FIN_NEG
  }
}

// Green while inside the budget, amber from 80% on, red once it bursts.
export function budgetBarColor(pct: number, over: boolean): string {
  if (over) return FIN_NEG
  return pct >= 80 ? FIN_WARN : FIN_POS
}

export function badgeStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 999,
    color,
    background: 'color-mix(in srgb, currentColor 14%, transparent)',
    whiteSpace: 'nowrap',
  }
}

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '11px 14px',
  borderBottom: '1px solid var(--color-border)',
}

export const emptyStateStyle: CSSProperties = {
  padding: '38px 20px',
  textAlign: 'center',
  color: 'var(--color-text-muted)',
  fontSize: 13.5,
}

// Quantities are decimals: trim the trailing zeros so "10.000" reads as "10".
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
}
