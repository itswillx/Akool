import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { blockingAdvisories, evaluate } from './audit-gate.mjs'

// DEV-008: o gate lê o JSON do npm audit e só bloqueia high/critical fora da
// lista de exceções (por GHSA, com validade).
const report = {
  metadata: { vulnerabilities: { high: 1, moderate: 1, total: 2 } },
  vulnerabilities: {
    'lib-a': { severity: 'high', via: [{ name: 'lib-a', severity: 'high', title: 'RCE', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }, 'lib-b'] },
    'lib-b': { severity: 'moderate', via: [{ name: 'lib-b', severity: 'moderate', title: 'ReDoS', url: 'https://github.com/advisories/GHSA-dddd-eeee-ffff' }] },
  },
}

describe('audit-gate', () => {
  it('só as advisories high/critical contam, uma vez cada', () => {
    expect(blockingAdvisories(report)).toEqual([{ id: 'GHSA-aaaa-bbbb-cccc', package: 'lib-a', severity: 'high', title: 'RCE' }])
  })

  it('passa com exceção válida, falha sem exceção ou com exceção vencida', () => {
    const allow = [{ id: 'GHSA-aaaa-bbbb-cccc', package: 'lib-a', motivo: 'aguardando PR', ate: '2026-12-31' }]
    expect(evaluate(report, allow, '2026-10-01').ok).toBe(true)
    expect(evaluate(report, [], '2026-10-01')).toMatchObject({ ok: false, failures: [{ id: 'GHSA-aaaa-bbbb-cccc', reason: 'sem exceção' }] })
    expect(evaluate(report, allow, '2027-01-01')).toMatchObject({ ok: false, failures: [{ reason: 'exceção vencida em 2026-12-31' }] })
  })

  it('relatório sem vulnerabilidades passa', () => {
    expect(evaluate({ vulnerabilities: {} }, [], '2026-10-01')).toEqual({ ok: true, failures: [], ignored: [] })
  })
})
