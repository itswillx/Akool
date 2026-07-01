import { describe, it, expect } from 'vitest'
import { transactionsToCsv } from './financeCsv'
import type { FinanceAccount, FinanceCategory, FinanceTransaction } from '../types'

const cats = [
  { id: 'c1', name: 'Salário' },
  { id: 'c2', name: 'Alimentação' },
] as unknown as FinanceCategory[]

const accs = [
  { id: 'a1', name: 'C6 Bank' },
] as unknown as FinanceAccount[]

function tx(partial: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: 't1', user_id: 'u1', account_id: 'a1', category_id: 'c1', type: 'income',
    amount: 0, description: '', date: '2026-06-24', shared_with_user_id: null, created_at: '',
    ...partial,
  } as FinanceTransaction
}

describe('transactionsToCsv', () => {
  it('emits a header row and one row per transaction', () => {
    const csv = transactionsToCsv([
      tx({ type: 'income', amount: 1180000, description: 'PLR', category_id: 'c1', account_id: 'a1', date: '2026-06-24' }),
    ], cats, accs)
    const lines = csv.split('\r\n')
    expect(lines[0]).toBe('Data;Tipo;Descrição;Categoria;Conta;Valor')
    expect(lines[1]).toBe('2026-06-24;Receita;PLR;Salário;C6 Bank;11800,00')
  })

  it('formats expenses and cents with a comma decimal', () => {
    const csv = transactionsToCsv([
      tx({ type: 'expense', amount: 7050, description: 'Mercado', category_id: 'c2', account_id: 'a1' }),
    ], cats, accs)
    expect(csv.split('\r\n')[1]).toBe('2026-06-24;Despesa;Mercado;Alimentação;C6 Bank;70,50')
  })

  it('quotes cells that contain the delimiter or quotes', () => {
    const csv = transactionsToCsv([
      tx({ description: 'Mercado; feira "boa"', amount: 100 }),
    ], cats, accs)
    expect(csv).toContain('"Mercado; feira ""boa"""')
  })

  it('handles missing category/account gracefully', () => {
    const csv = transactionsToCsv([
      tx({ category_id: null, account_id: null, description: 'Avulso', amount: 500 }),
    ], cats, accs)
    expect(csv.split('\r\n')[1]).toBe('2026-06-24;Receita;Avulso;;;5,00')
  })
})
