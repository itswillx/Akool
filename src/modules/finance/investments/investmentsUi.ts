import type { CSSProperties } from 'react'
import type { FinanceInvestmentAssetClass, FinanceInvestmentMovementKind } from '../../../types'
import type { TranslationKey } from '../../../i18n/translations'
import { FIN_ACCENT, FIN_NEG, FIN_POS, FIN_WARN } from '../ui'

// Style and label helpers local to the investments submodule. Kept free of JSX
// so it stays a plain .ts module (same split as storeUi.ts / projectsUi.ts).

export const ASSET_CLASSES: FinanceInvestmentAssetClass[] = [
  'fixed_income', 'treasury', 'savings', 'fund', 'equity', 'pension', 'crypto', 'other',
]

// Explicit maps rather than template casts: a `\`finance_invest_${c}\` as
// TranslationKey` type-checks even when the key does not exist, these do not.
export const ASSET_CLASS_KEY: Record<FinanceInvestmentAssetClass, TranslationKey> = {
  fixed_income: 'finance_invest_class_fixed_income',
  treasury: 'finance_invest_class_treasury',
  savings: 'finance_invest_class_savings',
  fund: 'finance_invest_class_fund',
  equity: 'finance_invest_class_equity',
  pension: 'finance_invest_class_pension',
  crypto: 'finance_invest_class_crypto',
  other: 'finance_invest_class_other',
}

export const MOVEMENT_KIND_KEY: Record<FinanceInvestmentMovementKind, TranslationKey> = {
  contribution: 'finance_invest_kind_contribution',
  redemption: 'finance_invest_kind_redemption',
  yield: 'finance_invest_kind_yield',
  tax: 'finance_invest_kind_tax',
  fee: 'finance_invest_kind_fee',
}

export const ASSET_CLASS_ICON: Record<FinanceInvestmentAssetClass, string> = {
  fixed_income: '🏦',
  treasury: '🏛️',
  savings: '🐷',
  fund: '📊',
  equity: '📈',
  pension: '🧓',
  crypto: '🪙',
  other: '💠',
}

// Donut palette. Fixed per asset class so the same slice keeps its colour
// between renders and between the two groupings.
export const ASSET_CLASS_COLOR: Record<FinanceInvestmentAssetClass, string> = {
  fixed_income: FIN_ACCENT,
  treasury: '#0ea5e9',
  savings: '#22c55e',
  fund: '#a855f7',
  equity: '#f97316',
  pension: '#64748b',
  crypto: FIN_WARN,
  other: '#94a3b8',
}

// Institutions are free text (whatever the statement named), so their colours
// come from a stable rotation keyed by position in the sorted slice list.
export const SLICE_PALETTE = [
  FIN_ACCENT, '#0ea5e9', '#22c55e', '#a855f7', '#f97316', FIN_WARN, '#64748b', '#94a3b8',
]

/** Money leaving the pocket reads negative; money coming back reads positive. */
export function movementColor(kind: FinanceInvestmentMovementKind): string {
  switch (kind) {
    case 'contribution': return FIN_NEG
    case 'redemption': return FIN_POS
    case 'yield': return FIN_POS
    case 'tax':
    case 'fee': return FIN_WARN
  }
}

export function movementSign(kind: FinanceInvestmentMovementKind): string {
  return kind === 'contribution' || kind === 'tax' || kind === 'fee' ? '−' : '+'
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
  lineHeight: 1.6,
}
