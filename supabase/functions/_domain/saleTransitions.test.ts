import { describe, expect, it } from 'vitest'
import { CANCELLABLE, NEXT_STATUS, PREV_STATUS, SALE_TRANSITIONS, canTransition, confirmActionFor } from './saleTransitions.ts'
import { STORE_SALE_STATUSES } from './storeTypes.ts'

// API-028: a tabela que o gatilho private.store_sale_rules aplica. A lista dos
// 10 pares contra a migration e o harness fica em storeParity.test.ts.

describe('SALE_TRANSITIONS', () => {
  it('são 10 pares, sem repetição e sem "mesmo status"', () => {
    expect(SALE_TRANSITIONS).toHaveLength(10)
    expect(new Set(SALE_TRANSITIONS.map(([f, t]) => `${f}>${t}`)).size).toBe(10)
    expect(SALE_TRANSITIONS.filter(([f, t]) => f === t)).toEqual([])
  })

  it('cada par vem de um passo à frente, de um passo atrás ou de um cancelamento', () => {
    for (const [from, to] of SALE_TRANSITIONS) {
      expect(NEXT_STATUS[from] === to || PREV_STATUS[from] === to || (to === 'cancelled' && CANCELLABLE.includes(from))).toBe(true)
    }
  })
})

describe('canTransition', () => {
  it('nos 25 pares, só os 10 da tabela', () => {
    const allowed: string[] = []
    for (const from of STORE_SALE_STATUSES) for (const to of STORE_SALE_STATUSES) if (canTransition(from, to)) allowed.push(`${from}>${to}`)
    expect(allowed.sort()).toEqual(SALE_TRANSITIONS.map(([f, t]) => `${f}>${t}`).sort())
  })

  it('entregue não cancela; saltos e o mesmo status são recusados', () => {
    expect(canTransition('delivered', 'cancelled')).toBe(false)
    expect(canTransition('negotiating', 'delivered')).toBe(false)
    expect(canTransition('cancelled', 'sold')).toBe(false)
    expect(canTransition('sold', 'sold')).toBe(false)
  })
})

describe('confirmActionFor', () => {
  it('vender e cancelar sempre perguntam', () => {
    expect(confirmActionFor('negotiating', 'sold', false)).toBe('sold')
    expect(confirmActionFor('sold', 'cancelled', true)).toBe('cancelled')
    expect(confirmActionFor('negotiating', 'cancelled', false)).toBe('cancelled')
  })

  it('voltar para negociação só pergunta quando há receita a apagar', () => {
    expect(confirmActionFor('sold', 'negotiating', true)).toBe('reopen')
    expect(confirmActionFor('sold', 'negotiating', false)).toBeNull()
  })

  it('reabrir uma cancelada e os passos de envio vão direto (o servidor confere o estoque)', () => {
    expect(confirmActionFor('cancelled', 'negotiating', false)).toBeNull()
    expect(confirmActionFor('sold', 'shipped', true)).toBeNull()
    expect(confirmActionFor('shipped', 'sold', true)).toBeNull()
    expect(confirmActionFor('shipped', 'delivered', true)).toBeNull()
  })
})
