import { describe, expect, it } from 'vitest'
import { addCardLabel, cleanCardLabel, hasCardLabel, normalizeCardLabels } from './cardLabels'

// API-013: as mesmas regras do gatilho (private.card_labels_ok), para o app
// não mandar o que o servidor recusa.

describe('rótulos de card', () => {
  it('limpa as pontas e corta em 50 caracteres (por code point)', () => {
    expect(cleanCardLabel('  api  ')).toBe('api')
    expect(cleanCardLabel('é'.repeat(60))).toHaveLength(50)
    expect(cleanCardLabel('🔥'.repeat(60))).toBe('🔥'.repeat(50))
    expect(cleanCardLabel(`${'a'.repeat(49)} b`)).toBe('a'.repeat(49))
  })

  it('repetido só na caixa é o mesmo rótulo; a grafia de quem digitou fica', () => {
    expect(hasCardLabel(['Segurança'], 'SEGURANÇA')).toBe(true)
    expect(addCardLabel(['Segurança'], 'segurança')).toEqual(['Segurança'])
    expect(addCardLabel(['Segurança'], ' Performance ')).toEqual(['Segurança', 'Performance'])
  })

  it('vazio e além de 30 devolvem a mesma lista', () => {
    const full = Array.from({ length: 30 }, (_, i) => `r${i}`)
    expect(addCardLabel(full, 'outro')).toBe(full)
    const one = ['a']
    expect(addCardLabel(one, '   ')).toBe(one)
  })

  it('normaliza uma lista inteira (import): sem repetidos, limpa e com até 30', () => {
    expect(normalizeCardLabels(['API', 'api', ' x ', '', 'X'])).toEqual(['API', 'x'])
    expect(normalizeCardLabels(Array.from({ length: 40 }, (_, i) => `r${i}`))).toHaveLength(30)
  })
})
