import type { FinanceAccount, FinanceCategory, FinanceTransaction } from '../types'
import { fromCents } from './money'

// CSV uses ';' as the field delimiter (the de-facto standard for pt-BR
// spreadsheets, where ',' is the decimal separator). Cells are quoted only when
// they contain the delimiter, a quote, or a line break.
const DELIM = ';'

function csvCell(value: string): string {
  if (value.includes(DELIM) || value.includes('"') || /[\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

/** Serialize transactions to a CSV string (one header row + one row per tx). */
export function transactionsToCsv(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  accounts: FinanceAccount[],
): string {
  const catMap = new Map(categories.map(c => [c.id, c.name]))
  const accMap = new Map(accounts.map(a => [a.id, a.name]))
  const header = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Valor']
  const rows = transactions.map(tx => [
    tx.date,
    tx.type === 'income' ? 'Receita' : 'Despesa',
    tx.description ?? '',
    tx.category_id ? (catMap.get(tx.category_id) ?? '') : '',
    tx.account_id ? (accMap.get(tx.account_id) ?? '') : '',
    fromCents(tx.amount).toFixed(2).replace('.', ','),
  ])
  return [header, ...rows].map(row => row.map(cell => csvCell(String(cell))).join(DELIM)).join('\r\n')
}

/** Build the CSV and trigger a browser download named `transacoes-<month>.csv`. */
export function downloadTransactionsCsv(
  transactions: FinanceTransaction[],
  categories: FinanceCategory[],
  accounts: FinanceAccount[],
  month: string,
): void {
  const csv = transactionsToCsv(transactions, categories, accounts)
  // Prepend a UTF-8 BOM so Excel renders accented characters correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `transacoes-${month}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
