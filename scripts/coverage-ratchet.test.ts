import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos; a lógica pura é o que importa aqui.
import { compareCoverage, coverageByGroup, groupOf } from './coverage-ratchet.mjs'

// QA-001: trava da cobertura por pasta.

describe('coverage-ratchet', () => {
  it('agrupa por pasta, com módulos e edge functions separados', () => {
    expect(groupOf('src/lib/a.ts')).toBe('src/lib')
    expect(groupOf('src/lib/data/pages.ts')).toBe('src/lib')
    expect(groupOf('src/modules/finance/store/useFinanceStore.ts')).toBe('src/modules/finance')
    expect(groupOf('supabase/functions/admin-ops/logic.ts')).toBe('supabase/functions/admin-ops')
    expect(groupOf('src/App.tsx')).toBe('src')
  })

  it('soma as linhas de cada pasta', () => {
    const line = (covered: number, total: number) => ({ lines: { covered, total } })
    expect(coverageByGroup({
      total: line(0, 0),
      '/repo/src/lib/a.ts': line(1, 2),
      '/repo/src/lib/b.ts': line(2, 2),
      '/repo/src/hooks/c.ts': line(0, 3),
      '/repo/src/types/x.ts': line(0, 0),
    }, '/repo')).toEqual({ 'src/lib': 75, 'src/hooks': 0 })
  })

  it('queda além da folga falha; dentro dela, não', () => {
    const { worse, better, unbased } = compareCoverage(
      { 'src/lib': 70, 'src/hooks': 50, 'src/pages': 10 },
      { 'src/lib': 69.9, 'src/hooks': 49, 'src/pages': 12, 'src/modules/x': 5 },
      0.25,
    )
    expect(worse).toEqual([{ group: 'src/hooks', base: 50, now: 49 }])
    expect(better).toEqual([{ group: 'src/pages', base: 10, now: 12 }])
    expect(unbased).toEqual([{ group: 'src/modules/x', now: 5 }])
  })
})

// ARCH-006: o total geral entra na base, e --allow-moves só regrava quando ele não caiu.
import { coverageByGroup as byGroup, movesTolerated } from './coverage-ratchet.mjs'

describe('coverage-ratchet: movimentação entre pastas', () => {
  it('o resumo do v8 traz o total geral como "total"', () => {
    const summary = {
      total: { lines: { total: 200, covered: 90, pct: 45 } },
      '/r/src/components/A.tsx': { lines: { total: 100, covered: 50 } },
      '/r/src/shared/ui/B.tsx': { lines: { total: 100, covered: 40 } },
    }
    expect(byGroup(summary, '/r')).toEqual({ 'src/components': 50, 'src/shared': 40, total: 45 })
  })

  it('tolera a queda de uma pasta quando o total geral não caiu', () => {
    const baseline = { 'src/components': 50, total: 45 }
    const current = { 'src/components': 30, 'src/shared': 80, total: 45.2 }
    const worse = [{ group: 'src/components', base: 50, now: 30 }]
    expect(movesTolerated(baseline, current, worse)).toEqual({ ok: true })
  })

  it('recusa quando o total geral caiu além da folga ou a base não o tem', () => {
    const worse = [{ group: 'src/components', base: 50, now: 30 }]
    expect(movesTolerated({ 'src/components': 50, total: 45 }, { 'src/components': 30, total: 44 }, worse).ok).toBe(false)
    expect(movesTolerated({ 'src/components': 50 }, { 'src/components': 30, total: 45 }, worse).ok).toBe(false)
    expect(movesTolerated({ total: 45 }, { total: 44 }, [{ group: 'total', base: 45, now: 44 }]).ok).toBe(false)
  })
})
