import { describe, it, expect } from 'vitest'
import { parseC6Statement } from './c6PdfParser'
import { C6_SAMPLE_LINES } from './c6StatementFixture'

describe('parseC6Statement', () => {
  const result = parseC6Statement(C6_SAMPLE_LINES)
  const byDesc = (needle: string) => result.txs.find(tx => tx.description.includes(needle))

  it('parses all transactions from the fixture', () => {
    expect(result.txs).toHaveLength(12)
  })

  it('captures the account hint', () => {
    expect(result.accountHint).toBe('Agência 1 • Conta 12345678')
  })

  it('parses single-line income and expense with year from the month section', () => {
    const salary = byDesc('RECEBIMENTO SALARIO')!
    expect(salary).toMatchObject({ date: '2026-05-15', type: 'income', amount: 259813, sourceKind: 'Entradas', internal: false })
    const cpfl = byDesc('CPFL PAULISTA')!
    // Launch date (first DD/MM) wins over accounting date.
    expect(cpfl).toMatchObject({ date: '2026-05-15', type: 'expense', amount: 25017 })
  })

  it('applies each section year to its own transactions', () => {
    expect(byDesc('APLICAÇÃO DE CDB')!.date).toBe('2026-06-25')
    expect(byDesc('GOOD BOM')!.date).toBe('2026-05-16')
  })

  it('joins wrapped multi-line descriptions ending in a bare amount line', () => {
    const shpp = byDesc('SHPP BRASIL')!
    expect(shpp.description).toBe('Pix enviado para SHPP BRASIL INSTITUICAO DE PAGAMENTO E SERVICOS DE PAGAMENTOS LTDA')
    expect(shpp).toMatchObject({ date: '2026-05-04', type: 'expense', amount: 2440, sourceKind: 'Saída PIX' })
  })

  it('skips "Saldo do dia" and table-header noise without creating transactions', () => {
    expect(result.txs.some(tx => /saldo do dia/i.test(tx.description))).toBe(false)
    expect(result.txs.some(tx => /^Data$/i.test(tx.description))).toBe(false)
  })

  it('ignores institutional footer lines silently', () => {
    expect(result.txs.some(tx => /Atendimento/i.test(tx.description))).toBe(false)
  })

  it('keeps the ". Cartão NNNN" suffix in the raw description', () => {
    expect(byDesc('KBCA BEBIDAS')!.description).toBe('KBCA BEBIDAS HORTOLANDIA BRA. Cartão 6403')
  })

  it('parses thousands-grouped amounts to cents', () => {
    expect(byDesc('APLICAÇÃO DE CDB')!.amount).toBe(100000)
  })

  it('flags internal movements', () => {
    expect(byDesc('PGTO FAT CARTAO')).toMatchObject({ internal: true, internalReason: 'card_payment' })
    expect(byDesc('APLICAÇÃO DE CDB')).toMatchObject({ internal: true, internalReason: 'investment' })
    expect(byDesc('99 FOOD')).toMatchObject({ internal: true, internalReason: 'refund', sourceKind: 'Devolução PIX' })
    expect(byDesc('Pix estornado')).toMatchObject({ internal: true, internalReason: 'refund' })
    expect(byDesc('TARIFA DEP BOLETO')).toMatchObject({ internal: true, internalReason: 'fee' })
  })

  it('handles the "Entrada PIX" / "Entradas" kind prefix overlap', () => {
    expect(byDesc('MARIA DA SILVA')!.sourceKind).toBe('Entrada PIX')
  })

  it('derives the period from the parsed transactions', () => {
    expect(result.periodStart).toBe('2026-05-04')
    expect(result.periodEnd).toBe('2026-06-28')
  })

  it('aborts an unterminated wrapped transaction with a warning', () => {
    const r = parseC6Statement([
      'Maio 2026 ( 01/05/2026 - 31/05/2026 )',
      '04/05 04/05 Saída PIX',
      'Pix enviado para ALGUEM',
      'Saldo do dia 04/05/26 R$ 1,00',
    ])
    expect(r.txs).toHaveLength(0)
    expect(r.warnings.some(w => w.includes('c6_incomplete_tx'))).toBe(true)
  })

  it('warns on transactions appearing before any month section', () => {
    const r = parseC6Statement(['15/05 15/05 Entradas RECEBIMENTO SALARIO R$ 100,00'])
    expect(r.txs).toHaveLength(0)
    expect(r.warnings.some(w => w.includes('c6_tx_before_section'))).toBe(true)
  })
})
