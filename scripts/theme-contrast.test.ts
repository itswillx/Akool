import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// UX-005: baseline de contraste WCAG dos tokens de cor, nos dois temas.
// Texto pede 4,5:1; ícone que carrega sentido e anel de foco, 3:1. Fundos de
// hover e de seleção ficam fora: são estado, não leitura.

// Lido do disco: no vitest, import de .css (mesmo com ?raw) vira texto vazio.
const css = readFileSync(join(__dirname, '..', 'src', 'index.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const block = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]))
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const light = tokens(':root')
const dark = { ...light, ...tokens('html\\.dark') }
const BACKGROUNDS = ['color-bg', 'color-bg-secondary', 'color-bg-tertiary', 'color-surface']

it('a conta de contraste bate com a referência da WCAG', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
})

describe.each([['claro', light], ['escuro', dark]] as const)('tema %s', (_theme, theme) => {
  it.each(['color-text', 'color-text-subtle', 'color-text-muted'])('%s passa 4,5:1 nos fundos fixos', token => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(theme[token], theme[bg]), `${token} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('ícone passa 3:1 nos fundos fixos', () => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(theme['color-icon'], theme[bg]), `color-icon sobre ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  // Telas de entrada: texto de erro/sucesso e borda de campo (rodada 2 da landing).
  it.each(['color-error-text', 'color-success-text'])('%s passa 4,5:1 nos fundos fixos', token => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(theme[token], theme[bg]), `${token} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('borda forte de campo passa 3:1 no surface e no bg', () => {
    for (const bg of ['color-bg', 'color-surface']) {
      expect(contrast(theme['color-border-strong'], theme[bg]), `color-border-strong sobre ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('anel de foco (primary) passa 3:1 nos fundos principais', () => {
    for (const bg of ['color-bg', 'color-bg-secondary']) {
      expect(contrast(theme['color-primary'], theme[bg]), `color-primary sobre ${bg}`).toBeGreaterThanOrEqual(3)
    }
  })
})
