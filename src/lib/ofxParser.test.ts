import { describe, it, expect } from 'vitest'
import { decodeOfxBytes, parseOfx, parseOfxAmount } from './ofxParser'

const SGML_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<BANKID>336
<ACCTID>12345678
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260701
<DTEND>20260728
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260715120000[-3:BRT]
<TRNAMT>-591.02
<FITID>abc-001
<MEMO>PGTO FAT CARTAO C6
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260716
<TRNAMT>2598.13
<FITID>abc-002
<NAME>RECEBIMENTO SALARIO
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260717
<TRNAMT>-30,45
<FITID>abc-003
<MEMO>GOOD BOM LOJA 4
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

describe('parseOfx', () => {
  const result = parseOfx(SGML_SAMPLE)

  it('parses SGML without closing tags', () => {
    expect(result.txs).toHaveLength(3)
  })

  it('reads DTPOSTED with time and timezone into a date', () => {
    expect(result.txs[0].date).toBe('2026-07-15')
  })

  it('maps TRNAMT sign to type and absolute cents', () => {
    expect(result.txs[0]).toMatchObject({ type: 'expense', amount: 59102 })
    expect(result.txs[1]).toMatchObject({ type: 'income', amount: 259813 })
  })

  it('falls back from MEMO to NAME for the description', () => {
    expect(result.txs[1].description).toBe('RECEBIMENTO SALARIO')
  })

  it('accepts decimal-comma TRNAMT', () => {
    expect(result.txs[2].amount).toBe(3045)
  })

  it('captures FITID, account and period', () => {
    expect(result.txs[0].fitId).toBe('abc-001')
    expect(result.accountHint).toBe('Conta 12345678')
    expect(result.periodStart).toBe('2026-07-01')
    expect(result.periodEnd).toBe('2026-07-28')
  })

  it('classifies internal movements', () => {
    expect(result.txs[0]).toMatchObject({ internal: true, internalReason: 'card_payment' })
    expect(result.txs[1].internal).toBe(false)
  })

  it('skips repeated FITIDs inside the same file with a warning', () => {
    const dup = SGML_SAMPLE.replace('</BANKTRANLIST>',
      '<STMTTRN>\n<DTPOSTED>20260718\n<TRNAMT>-1.00\n<FITID>abc-003\n<MEMO>DUP\n</STMTTRN>\n</BANKTRANLIST>')
    const r = parseOfx(dup)
    expect(r.txs).toHaveLength(3)
    expect(r.warnings.some(w => w.includes('abc-003'))).toBe(true)
  })

  it('parses the OFX 2.x XML variant', () => {
    const xml = `<?xml version="1.0"?><OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260701</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>x1</FITID><MEMO>UBER</MEMO></STMTTRN></BANKTRANLIST></OFX>`
    const r = parseOfx(xml)
    expect(r.txs).toHaveLength(1)
    expect(r.txs[0]).toMatchObject({ date: '2026-07-01', type: 'expense', amount: 1000, description: 'UBER' })
  })

  it('rejects files without <OFX> or without transactions', () => {
    expect(parseOfx('hello world').warnings).toContain('invalid_ofx')
    expect(parseOfx('<OFX><BANKTRANLIST></BANKTRANLIST></OFX>').warnings).toContain('invalid_ofx')
  })
})

describe('parseOfxAmount', () => {
  it('handles point, comma and invalid input', () => {
    expect(parseOfxAmount('-591.02')).toBe(-59102)
    expect(parseOfxAmount('2598.13')).toBe(259813)
    expect(parseOfxAmount('-30,45')).toBe(-3045)
    expect(parseOfxAmount('abc')).toBeNaN()
  })
})

describe('decodeOfxBytes', () => {
  it('decodes UTF-8 and falls back to windows-1252', () => {
    const utf8 = new TextEncoder().encode('Débito').buffer
    expect(decodeOfxBytes(utf8)).toBe('Débito')
    // 'é' in windows-1252 is byte 0xE9 — invalid as UTF-8 continuation.
    const latin = new Uint8Array([0x44, 0xe9, 0x62, 0x69, 0x74, 0x6f]).buffer
    expect(decodeOfxBytes(latin)).toBe('Débito')
  })
})
