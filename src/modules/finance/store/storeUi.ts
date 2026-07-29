import type { CSSProperties } from 'react'
import type {
  FinanceStoreChannel,
  FinanceStoreCondition,
  FinanceStoreProductKind,
  FinanceStoreSaleStatus,
} from '../../../types'
import type { TranslationKey } from '../../../i18n/translations'
import type { UniqueItemState } from '../../../lib/financeStoreCalc'
import { FIN_NEG, FIN_POS, FIN_WARN } from '../ui'

// Style and label helpers local to the store submodule. Kept free of JSX so it
// stays a plain .ts module (same split as projectsUi.ts).

export const SALE_STATUSES: FinanceStoreSaleStatus[] = [
  'negotiating', 'sold', 'shipped', 'delivered', 'cancelled',
]
export const CHANNELS: FinanceStoreChannel[] = [
  'olx', 'mercado_livre', 'facebook', 'whatsapp', 'referral', 'in_person', 'other',
]
export const CONDITIONS: FinanceStoreCondition[] = ['used', 'new']
export const PRODUCT_KINDS: FinanceStoreProductKind[] = ['unique', 'stock']

// Categories offered as datalist suggestions — free text is still allowed.
export const CATEGORY_SUGGESTIONS = [
  'GPU', 'CPU', 'Placa-mãe', 'Memória RAM', 'SSD', 'HD', 'Fonte', 'Gabinete',
  'Cooler', 'Monitor', 'Periférico', 'Notebook', 'Console', 'Celular',
]

// Explicit maps rather than template casts: a `\`finance_store_${s}\` as
// TranslationKey` type-checks even when the key does not exist, these do not.
export const SALE_STATUS_KEY: Record<FinanceStoreSaleStatus, TranslationKey> = {
  negotiating: 'finance_store_status_negotiating',
  sold: 'finance_store_status_sold',
  shipped: 'finance_store_status_shipped',
  delivered: 'finance_store_status_delivered',
  cancelled: 'finance_store_status_cancelled',
}

export const CHANNEL_KEY: Record<FinanceStoreChannel, TranslationKey> = {
  olx: 'finance_store_channel_olx',
  mercado_livre: 'finance_store_channel_mercado_livre',
  facebook: 'finance_store_channel_facebook',
  whatsapp: 'finance_store_channel_whatsapp',
  referral: 'finance_store_channel_referral',
  in_person: 'finance_store_channel_in_person',
  other: 'finance_store_channel_other',
}

export const CONDITION_KEY: Record<FinanceStoreCondition, TranslationKey> = {
  new: 'finance_store_cond_new',
  used: 'finance_store_cond_used',
}

export const KIND_KEY: Record<FinanceStoreProductKind, TranslationKey> = {
  unique: 'finance_store_kind_unique',
  stock: 'finance_store_kind_stock',
}

export const UNIQUE_STATE_KEY: Record<UniqueItemState, TranslationKey> = {
  in_stock: 'finance_store_state_in_stock',
  reserved: 'finance_store_state_reserved',
  sold: 'finance_store_state_sold',
}

export function saleStatusColor(status: FinanceStoreSaleStatus): string {
  switch (status) {
    case 'negotiating': return FIN_WARN
    case 'sold': return FIN_POS
    case 'shipped': return 'var(--color-btn-primary)'
    case 'delivered': return FIN_POS
    case 'cancelled': return FIN_NEG
  }
}

export function uniqueStateColor(state: UniqueItemState): string {
  switch (state) {
    case 'in_stock': return FIN_POS
    case 'reserved': return FIN_WARN
    case 'sold': return 'var(--color-text-muted)'
  }
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
