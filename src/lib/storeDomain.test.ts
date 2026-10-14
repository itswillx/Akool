import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type {
  StoreProductKind,
  StoreProductLike,
  StorePurchaseLike,
  StorePurchaseStatus,
  StoreSaleItemLike,
  StoreSaleLike,
  StoreSaleStatus,
} from '../../supabase/functions/_domain/storeTypes'
import type { ConfirmAction as DomainConfirmAction } from '../../supabase/functions/_domain/saleTransitions'
import type { ConfirmAction } from '../modules/finance/store/saleTransitions'
import type {
  FinanceStoreProduct,
  FinanceStoreProductKind,
  FinanceStorePurchase,
  FinanceStorePurchaseStatus,
  FinanceStoreSale,
  FinanceStoreSaleItem,
  FinanceStoreSaleStatus,
} from '../types'
import { customerHistory, saleCreatedDayLocal } from './financeStoreCalc'

// API-028: _domain não importa src/types, então tem os seus tipos da Loja
// (storeTypes.ts). Este teste trava a deriva pelo tsc (expectTypeOf, conferido
// no `tsc -b`) e confere o dia de criação do customerHistory em três fusos,
// como o projectDomain.test.ts do API-027.

describe('tipos de _domain × src/types', () => {
  it('status, funil e tipo de produto são os mesmos', () => {
    expectTypeOf<StoreSaleStatus>().toEqualTypeOf<FinanceStoreSaleStatus>()
    expectTypeOf<StorePurchaseStatus>().toEqualTypeOf<FinanceStorePurchaseStatus>()
    expectTypeOf<StoreProductKind>().toEqualTypeOf<FinanceStoreProductKind>()
    expectTypeOf<ConfirmAction>().toEqualTypeOf<DomainConfirmAction>()
  })

  it('as linhas do app servem onde o domínio pede uma linha', () => {
    expectTypeOf<FinanceStoreSale>().toExtend<StoreSaleLike>()
    expectTypeOf<FinanceStoreSaleItem>().toExtend<StoreSaleItemLike>()
    expectTypeOf<FinanceStorePurchase>().toExtend<StorePurchaseLike>()
    expectTypeOf<FinanceStoreProduct>().toExtend<StoreProductLike>()
  })
})

// Fusos com offsets a 1 h ou mais um do outro (nenhum muda de horário em
// setembro de 2026). Em UTC (o CI) o dia local e o dia UTC coincidem.
const DEVICE_ZONES = [
  { tz: 'America/Sao_Paulo', offset: 180 },
  { tz: 'America/Manaus', offset: 240 },
  { tz: 'Asia/Tokyo', offset: -540 },
]

const sale = (over: Partial<FinanceStoreSale>): FinanceStoreSale => ({
  id: 's', user_id: 'u', workspace_id: null, customer_id: 'k', status: 'negotiating', channel: 'olx',
  sold_on: null, shipping_method: '', tracking_code: '', expected_delivery_on: null, delivered_on: null,
  shipping_charged: 0, shipping_cost: 0, fees: 0, account_id: null, transaction_id: null,
  notes: '', attachments: [], created_at: '', updated_at: '', ...over,
})

describe('customerHistory no app: o dia de criação é o do fuso do aparelho', () => {
  // O stubEnv grava no process.env, e o Node relê o TZ (o pool do vitest é forks).
  afterEach(() => { vi.unstubAllEnvs() })

  // Os instantes são montados em hora local, dos dois lados da meia-noite.
  const nightAndMorning = (tz: string, offset: number) => {
    vi.stubEnv('TZ', tz)
    const night = new Date(2026, 8, 10, 23, 30)
    const morning = new Date(2026, 8, 11, 0, 30)
    // Pré-condição: o fuso fixado vale; sem ela o caso rodaria no fuso do processo.
    expect([night.getTimezoneOffset(), morning.getTimezoneOffset()]).toEqual([offset, offset])
    return { night: night.toISOString(), morning: morning.toISOString() }
  }

  it.each(DEVICE_ZONES)('23:30 e 00:30 locais ficam em dias diferentes ($tz)', ({ tz, offset }) => {
    const { night, morning } = nightAndMorning(tz, offset)
    expect(saleCreatedDayLocal(night)).toBe('2026-09-10')
    expect(saleCreatedDayLocal(morning)).toBe('2026-09-11')
    // O created_at do PostgREST vem com microssegundos e +00:00.
    expect(saleCreatedDayLocal(night.replace(/\.\d{3}Z$/, '.123456+00:00'))).toBe('2026-09-10')
  })

  it.each(DEVICE_ZONES)('a negociação criada às 23:30 fica atrás da vendida no mesmo dia, e a das 00:30 passa à frente ($tz)', ({ tz, offset }) => {
    const { night, morning } = nightAndMorning(tz, offset)
    const sold = sale({ id: 'vendida-10', status: 'sold', sold_on: '2026-09-10' })
    // Estável: no mesmo dia, a vendida (que vem antes na lista) continua antes.
    expect(customerHistory('k', [sold, sale({ id: 'noite-10', created_at: night })]).map(s => s.id)).toEqual(['vendida-10', 'noite-10'])
    expect(customerHistory('k', [sold, sale({ id: 'manha-11', created_at: morning })]).map(s => s.id)).toEqual(['manha-11', 'vendida-10'])
  })
})
