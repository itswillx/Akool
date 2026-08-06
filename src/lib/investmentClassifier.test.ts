import { describe, it, expect } from 'vitest'
import { classifyInvestment, investmentMatchKey, investmentImportKey } from './investmentClassifier'

const inv = (desc: string, type: 'income' | 'expense' = 'expense') =>
  classifyInvestment(desc, undefined, type)

describe('classifyInvestment — product recognition', () => {
  it('recognizes fixed income products', () => {
    expect(inv('APLICACAO CDB C6')).toMatchObject({ product: 'CDB', assetClass: 'fixed_income', institution: 'C6' })
    expect(inv('APLICACAO LCI')).toMatchObject({ product: 'LCI', assetClass: 'fixed_income' })
    expect(inv('RESGATE LCA', 'income')).toMatchObject({ product: 'LCA', assetClass: 'fixed_income' })
    expect(inv('COMPRA DE DEBENTURE')).toMatchObject({ product: 'DEBENTURE', assetClass: 'fixed_income' })
  })

  it('recognizes treasury, savings, funds, equity, pension and crypto', () => {
    expect(inv('APLICACAO TESOURO SELIC')).toMatchObject({ product: 'TESOURO SELIC', assetClass: 'treasury' })
    expect(inv('COMPRA DE TITULO LTN')).toMatchObject({ product: 'TESOURO DIRETO', assetClass: 'treasury' })
    expect(inv('APLICACAO POUPANCA')).toMatchObject({ product: 'POUPANCA', assetClass: 'savings' })
    expect(inv('APLICACAO FUNDO DE INVESTIMENTO')).toMatchObject({ product: 'FUNDO', assetClass: 'fund' })
    expect(inv('B3 OPERACAO ATIVO')).toMatchObject({ product: 'B3', assetClass: 'equity' })
    expect(inv('APLICACAO PGBL')).toMatchObject({ product: 'PREVIDENCIA', assetClass: 'pension' })
    expect(inv('COMPRA DE ATIVO MERCADO BITCOIN')).toMatchObject({ product: 'CRIPTO', assetClass: 'crypto' })
  })

  // The generic FUNDO pattern must not swallow a more specific product.
  it('prefers the more specific product token', () => {
    expect(inv('FUNDO DE INVESTIMENTO EM TESOURO SELIC')).toMatchObject({ product: 'TESOURO SELIC' })
  })
})

describe('classifyInvestment — contribution vs redemption', () => {
  // The most common real-world shape: a broker name with no verb at all.
  it('uses the sign when the wording carries no verb', () => {
    expect(inv('XP INVESTIMENTOS CCTVM', 'expense')).toMatchObject({ movementKind: 'contribution' })
    expect(inv('XP INVESTIMENTOS CCTVM', 'income')).toMatchObject({ movementKind: 'redemption' })
  })

  it('agrees with the wording when they point the same way', () => {
    expect(inv('APLICACAO CDB', 'expense')).toMatchObject({ movementKind: 'contribution', confidence: 'high' })
    expect(inv('RESGATE CDB', 'income')).toMatchObject({ movementKind: 'redemption', confidence: 'high' })
  })

  // The sign is a fact of the ledger; the wording is just text. A "RESGATE"
  // that left the account is money going in, whatever the label says.
  it('lets the sign win over a contradicting verb and lowers confidence', () => {
    expect(inv('RESGATE CDB', 'expense')).toMatchObject({ movementKind: 'contribution', confidence: 'low' })
    expect(inv('APLICACAO CDB', 'income')).toMatchObject({ movementKind: 'redemption', confidence: 'low' })
  })

  it('recognizes yields, taxes and fees regardless of sign', () => {
    expect(inv('RENDIMENTO CDB', 'income')).toMatchObject({ movementKind: 'yield' })
    expect(inv('JCP B3 PROVENTOS', 'income')).toMatchObject({ movementKind: 'yield' })
    expect(inv('IRRF SOBRE RESGATE CDB', 'expense')).toMatchObject({ movementKind: 'tax' })
    expect(inv('IOF CDB', 'expense')).toMatchObject({ movementKind: 'tax' })
    expect(inv('TAXA DE CUSTODIA B3', 'expense')).toMatchObject({ movementKind: 'fee' })
  })
})

describe('classifyInvestment — false positives', () => {
  it('ignores ordinary merchants that share a broker name', () => {
    expect(inv('TORO PIZZARIA HORTOLANDIA BRA')).toBeNull()
    expect(inv('CLEAR COSMETICOS LTDA')).toBeNull()
    expect(inv('MODAL MOVEIS PLANEJADOS')).toBeNull()
  })

  it('ignores the account holder own bank when no product is named', () => {
    expect(inv('Pix enviado para C6 BANK')).toBeNull()
  })

  it('ignores fees and card bills that belong to other internal reasons', () => {
    expect(inv('TARIFA DEP BOLETO')).toBeNull()
    expect(inv('PGTO FAT CARTAO C6')).toBeNull()
    // Even when a product word is present, a card bill is never an investment.
    expect(inv('PGTO FAT CARTAO C6 CDB')).toBeNull()
  })

  it('ignores plain transactions', () => {
    expect(inv('RECEBIMENTO SALARIO', 'income')).toBeNull()
    expect(inv('GOOD BOM LOJA 4 HORTO HORTOLANDIA BRA')).toBeNull()
    expect(inv('Pix enviado para RESTAURANTE ESTALO')).toBeNull()
  })

  it('accepts an ambiguous house name once a verb backs it up', () => {
    expect(inv('APLICACAO TORO INVESTIMENTOS')).toMatchObject({ institution: 'TORO', confidence: 'high' })
  })

  // Institution-only rows are real but unproven: they import unchecked.
  it('keeps institution-only matches at low confidence', () => {
    expect(inv('NUINVEST')).toMatchObject({ institution: 'NUINVEST', confidence: 'low' })
  })
})

describe('matchKey stability', () => {
  it('is identical across months and description variants of the same product', () => {
    const a = inv('APLICACAO CDB C6 LIM.GARANT.')!
    const b = inv('RESGATE DE CDB C6', 'income')!
    expect(a.matchKey).toBe('c6|cdb')
    expect(b.matchKey).toBe(a.matchKey)
  })

  it('falls back to the asset class and an "outros" house', () => {
    expect(investmentMatchKey('', '', 'equity')).toBe('outros|equity')
    expect(investmentMatchKey('XP', 'TESOURO SELIC', 'treasury')).toBe('xp|tesouro-selic')
    expect(investmentMatchKey('ÓRAMA', 'PREVIDÊNCIA', 'pension')).toBe('orama|previdencia')
  })
})

describe('investmentImportKey', () => {
  it('collapses whitespace and case so re-imports land on the same key', () => {
    expect(investmentImportKey('2026-07-15', 'contribution', 5000, '  Aplicacao   CDB  '))
      .toBe(investmentImportKey('2026-07-15', 'contribution', 5000, 'APLICACAO CDB'))
  })

  it('separates movements that differ in kind, amount or date', () => {
    const base = investmentImportKey('2026-07-15', 'contribution', 5000, 'CDB')
    expect(investmentImportKey('2026-07-15', 'redemption', 5000, 'CDB')).not.toBe(base)
    expect(investmentImportKey('2026-07-15', 'contribution', 5001, 'CDB')).not.toBe(base)
    expect(investmentImportKey('2026-07-16', 'contribution', 5000, 'CDB')).not.toBe(base)
  })
})
