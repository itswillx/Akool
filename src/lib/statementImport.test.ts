import { describe, it, expect } from 'vitest'
import {
  detectStatementFormat, normalizeCounterparty, classifyInternal,
  buildExistingTxIndex, isLikelyDuplicate,
  buildHistorySuggestions, groupForCategorization,
  type ParsedTx,
} from './statementImport'

const tx = (over: Partial<ParsedTx>): ParsedTx => ({
  date: '2026-07-15', amount: 1000, type: 'expense', description: 'X', internal: false, ...over,
})

describe('detectStatementFormat', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)
  it('detects by extension and by content', () => {
    expect(detectStatementFormat('extrato.pdf', bytes('junk'))).toBe('pdf')
    expect(detectStatementFormat('extrato.bin', bytes('%PDF-1.7 ...'))).toBe('pdf')
    expect(detectStatementFormat('extrato.ofx', bytes('junk'))).toBe('ofx')
    expect(detectStatementFormat('conta.txt', bytes('OFXHEADER:100\n...'))).toBe('ofx')
    expect(detectStatementFormat('conta.xml', bytes('<?xml?><OFX>'))).toBe('ofx')
    expect(detectStatementFormat('foto.png', bytes('\x89PNG'))).toBe('unknown')
  })
})

describe('normalizeCounterparty', () => {
  it('strips pix prefixes', () => {
    expect(normalizeCounterparty('Pix enviado para Gianluca Pampana')).toBe('GIANLUCA PAMPANA')
    expect(normalizeCounterparty('Pix recebido de MARIA DA SILVA')).toBe('MARIA DA SILVA')
    expect(normalizeCounterparty('Pix recebido c6 de MARIA DA SILVA')).toBe('MARIA DA SILVA')
    expect(normalizeCounterparty('Devol recebida pix de 99 FOOD')).toBe('99 FOOD')
  })
  it('strips card and city suffixes', () => {
    expect(normalizeCounterparty('KBCA BEBIDAS HORTOLANDIA BRA. Cartão 6403')).toBe('KBCA BEBIDAS')
    expect(normalizeCounterparty('GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA')).toBe('GOOD BOM LOJA 4 HORTO')
    expect(normalizeCounterparty('SUBWAY HORTOLANDIA Hortolandia BRA')).toBe('SUBWAY HORTOLANDIA')
  })
  it('strips CPF/CNPJ fragments and long ids', () => {
    expect(normalizeCounterparty('Pix enviado para 63.685.850 LETICIA BRAND')).toBe('LETICIA BRAND')
    expect(normalizeCounterparty('Pix recebido de MARIA DA SILVA 14823852877')).toBe('MARIA DA SILVA')
    expect(normalizeCounterparty('54598088Vanessa HORTOLANDIA BRA')).toBe('VANESSA')
  })
  it('groups pix and card variants of the same merchant together', () => {
    expect(normalizeCounterparty('Meumarket24h HORTOLANDIA BRA'))
      .toBe(normalizeCounterparty('Meumarket24h HORTOLANDIA BRA. Cartão 6403'))
  })
})

describe('classifyInternal', () => {
  it('flags card bill payments, investments, refunds and fees', () => {
    expect(classifyInternal('PGTO FAT CARTAO C6', 'Pagamento', 'expense')).toBe('card_payment')
    expect(classifyInternal('APLICAÇÃO DE CDB', 'Outros gastos', 'expense')).toBe('investment')
    expect(classifyInternal('RESGATE DE CDB', 'Entradas', 'income')).toBe('investment')
    expect(classifyInternal('CDB C6 LIM.GARANT.', 'Outros gastos', 'expense')).toBe('investment')
    expect(classifyInternal('COMPRA DE ATIVO B3', 'Outros gastos', 'expense')).toBe('investment')
    expect(classifyInternal('Devol recebida pix de 99 FOOD', 'Devolução PIX', 'income')).toBe('refund')
    expect(classifyInternal('Pix estornado', 'Entradas', 'income')).toBe('refund')
    expect(classifyInternal('Pix recusado', 'Saída PIX', 'expense')).toBe('refund')
    expect(classifyInternal('EST DEBITO DE CARTAO', 'Entradas', 'income')).toBe('refund')
    expect(classifyInternal('TARIFA DEP BOLETO', 'Outros gastos', 'expense')).toBe('fee')
  })
  it('leaves ordinary transactions alone', () => {
    expect(classifyInternal('RECEBIMENTO SALARIO', 'Entradas', 'income')).toBeNull()
    expect(classifyInternal('GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA', 'Débito de Cartão', 'expense')).toBeNull()
    expect(classifyInternal('Pix enviado para RESTAURANTE ESTALO', 'Saída PIX', 'expense')).toBeNull()
  })
})

describe('duplicate detection', () => {
  const existing = [
    { date: '2026-07-15', amount: 4796, type: 'expense' as const, description: 'Meumarket24h HORTOLANDIA BRA' },
  ]
  it('flags same day + amount + normalized counterparty', () => {
    const index = buildExistingTxIndex(existing)
    expect(isLikelyDuplicate(tx({ date: '2026-07-15', amount: 4796, description: 'Meumarket24h HORTOLANDIA BRA. Cartão 6403' }), index)).toBe(true)
  })
  it('does not flag different amount, date or type', () => {
    const index = buildExistingTxIndex(existing)
    expect(isLikelyDuplicate(tx({ date: '2026-07-15', amount: 4797, description: 'Meumarket24h HORTOLANDIA BRA' }), index)).toBe(false)
    expect(isLikelyDuplicate(tx({ date: '2026-07-16', amount: 4796, description: 'Meumarket24h HORTOLANDIA BRA' }), index)).toBe(false)
    expect(isLikelyDuplicate(tx({ date: '2026-07-15', amount: 4796, type: 'income', description: 'Meumarket24h HORTOLANDIA BRA' }), index)).toBe(false)
  })

  // Two identical coffees on the same day are two real expenses. The old
  // Set-based index flagged the second one as a duplicate of the first and left
  // it unchecked, silently dropping real money from the import.
  it('only flags as many rows as there are saved occurrences', () => {
    const index = buildExistingTxIndex(existing)
    const line = () => tx({ date: '2026-07-15', amount: 4796, description: 'Meumarket24h HORTOLANDIA BRA' })
    expect(isLikelyDuplicate(line(), index)).toBe(true)
    expect(isLikelyDuplicate(line(), index)).toBe(false)
  })

  it('flags both rows when the same transaction was already saved twice', () => {
    const index = buildExistingTxIndex([...existing, ...existing])
    const line = () => tx({ date: '2026-07-15', amount: 4796, description: 'Meumarket24h HORTOLANDIA BRA' })
    expect(isLikelyDuplicate(line(), index)).toBe(true)
    expect(isLikelyDuplicate(line(), index)).toBe(true)
    expect(isLikelyDuplicate(line(), index)).toBe(false)
  })
})

describe('history suggestions + grouping', () => {
  const existing = [
    { date: '2026-06-01', type: 'expense' as const, description: 'GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA', category_id: 'cat-old' },
    { date: '2026-07-01', type: 'expense' as const, description: 'GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA. Cartão 6403', category_id: 'cat-new' },
    { date: '2026-07-02', type: 'expense' as const, description: 'SEM CATEGORIA LTDA', category_id: null },
  ]
  const suggestions = buildHistorySuggestions(existing)

  it('suggests the category of the most recent categorized transaction', () => {
    expect(suggestions.get('GOOD BOM LOJA 4 HORTO|expense')).toBe('cat-new')
    expect(suggestions.has('SEM CATEGORIA LTDA|expense')).toBe(false)
  })

  it('groups selected transactions by counterparty and type, keeping income and expense apart', () => {
    const txs = [
      tx({ description: 'GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA', amount: 100 }),
      tx({ description: 'GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA. Cartão 6403', amount: 200, date: '2026-07-20' }),
      tx({ description: 'Pix recebido de GOOD BOM LOJA 4 HORTO', amount: 300, type: 'income' }),
      tx({ description: 'UBER DO BRASIL TECNOLOGIA LTDA.', amount: 400 }),
    ]
    const groups = groupForCategorization(txs, new Set([0, 1, 2, 3]), suggestions)
    expect(groups).toHaveLength(3)
    const goodBomExpense = groups.find(g => g.label.startsWith('GOOD BOM') && g.type === 'expense')!
    expect(goodBomExpense.txIndexes).toEqual([0, 1])
    expect(goodBomExpense.total).toBe(300)
    expect(goodBomExpense.suggestedCategoryId).toBe('cat-new')
    const goodBomIncome = groups.find(g => g.label.startsWith('GOOD BOM') && g.type === 'income')!
    expect(goodBomIncome.suggestedCategoryId).toBeNull()
  })

  it('excludes unselected transactions from grouping', () => {
    const txs = [tx({}), tx({ description: 'Y' })]
    const groups = groupForCategorization(txs, new Set([1]), new Map())
    expect(groups).toHaveLength(1)
    expect(groups[0].txIndexes).toEqual([1])
  })
})
