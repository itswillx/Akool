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
