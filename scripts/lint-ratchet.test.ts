import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos; a lógica pura é o que importa aqui.
import { adopt, compare, countProblems, ruleMatcher, worseTotals } from './lint-ratchet.mjs'

// DEV-001: a catraca do lint só deixa a base descer.

describe('lint-ratchet', () => {
  it('conta por arquivo + regra, com caminho relativo', () => {
    const { counts, messages } = countProblems([
      { filePath: '/repo/src/a.tsx', messages: [
        { ruleId: 'no-unused-vars', line: 3, message: 'x' },
        { ruleId: 'no-unused-vars', line: 9, message: 'y' },
        { ruleId: null, line: 1, message: 'Parsing error' },
      ] },
      { filePath: '/repo/src/b.ts', messages: [] },
    ], '/repo')
    expect(counts).toEqual({ 'src/a.tsx::no-unused-vars': 2, 'src/a.tsx::fatal': 1 })
    expect(messages['src/a.tsx::no-unused-vars']).toEqual(['src/a.tsx:3 no-unused-vars — x', 'src/a.tsx:9 no-unused-vars — y'])
  })

  it('igual à base: nada piorou nem melhorou', () => {
    expect(compare({ 'a::r': 2 }, { 'a::r': 2 })).toEqual({ worse: [], better: [] })
  })

  it('piora na mesma chave ou chave nova falha', () => {
    const { worse } = compare({ 'a::r': 1 }, { 'a::r': 2, 'b::rules-of-hooks': 1 })
    expect(worse).toEqual([
      { key: 'a::r', base: 1, now: 2 },
      { key: 'b::rules-of-hooks', base: 0, now: 1 },
    ])
  })

  it('corrigir uma regra não compensa problema novo de outra regra no mesmo arquivo', () => {
    const { worse, better } = compare({ 'a::no-unused-vars': 1 }, { 'a::rules-of-hooks': 1 })
    expect(worse).toEqual([{ key: 'a::rules-of-hooks', base: 0, now: 1 }])
    expect(better).toEqual([{ key: 'a::no-unused-vars', base: 1, now: 0 }])
  })

  it('melhora é reportada', () => {
    expect(compare({ 'a::r': 3 }, { 'a::r': 1 }).better).toEqual([{ key: 'a::r', base: 3, now: 1 }])
  })

  it('adopt: regra nova entra com os casos atuais; as outras seguem na base', () => {
    const baseline = { 'a::old-rule': 2 }
    const current = { 'a::old-rule': 2, 'a::jsx-a11y/no-autofocus': 3, 'b::jsx-a11y/alt-text': 1, 'b::other': 1 }
    const result = adopt(baseline, current, ['jsx-a11y/*'])
    expect(result.alreadyInBaseline).toEqual([])
    expect(result.adopted).toEqual({ 'jsx-a11y/no-autofocus': 3, 'jsx-a11y/alt-text': 1 })
    expect(result.baseline).toEqual({ 'a::old-rule': 2, 'a::jsx-a11y/no-autofocus': 3, 'b::jsx-a11y/alt-text': 1 })
    // `b::other` não foi adotada: continua sendo piora.
    expect(compare(result.baseline, current).worse).toEqual([{ key: 'b::other', base: 0, now: 1 }])
  })

  it('adopt recusa regra que já está na base (ela só pode descer)', () => {
    const result = adopt({ 'a::no-unused-vars': 1 }, { 'a::no-unused-vars': 5 }, ['no-unused-vars'])
    expect(result.alreadyInBaseline).toEqual(['no-unused-vars'])
    expect(result.adopted).toEqual({})
    expect(result.baseline).toEqual({ 'a::no-unused-vars': 1 })
  })

  it('ruleMatcher: nome exato ou plugin/*', () => {
    const m = ruleMatcher(['@typescript-eslint/require-await', 'jsx-a11y/*'])
    expect(m('@typescript-eslint/require-await')).toBe(true)
    expect(m('@typescript-eslint/require-await-x')).toBe(false)
    expect(m('jsx-a11y/alt-text')).toBe(true)
    expect(m('react-hooks/refs')).toBe(false)
  })

  it('allow-moves: problema que mudou de arquivo passa; regra que cresceu no total, não', () => {
    const baseline = { 'big.tsx::react-hooks/exhaustive-deps': 3, 'big.tsx::no-unused-vars': 1 }
    const moved = { 'big.tsx::react-hooks/exhaustive-deps': 1, 'tabs/A.tsx::react-hooks/exhaustive-deps': 2, 'big.tsx::no-unused-vars': 1 }
    expect(worseTotals(baseline, moved)).toEqual([])
    const grew = { ...moved, 'tabs/B.tsx::no-unused-vars': 1 }
    expect(worseTotals(baseline, grew)).toEqual([{ rule: 'no-unused-vars', base: 1, now: 2 }])
  })
})
