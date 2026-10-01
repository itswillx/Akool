import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, isPasswordValid, passwordIssues } from './passwordPolicy'

describe('passwordPolicy (SEC-004)', () => {
  it('exige no mínimo 10 caracteres', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10)
    expect(passwordIssues('Abcdef12')).toEqual(['length'])
    expect(isPasswordValid('Abcdefgh12')).toBe(true)
  })

  it('aponta cada requisito que falta', () => {
    expect(passwordIssues('abcdefghij')).toEqual(['uppercase', 'digit'])
    expect(passwordIssues('ABCDEFGHIJ')).toEqual(['lowercase', 'digit'])
    expect(passwordIssues('1234567890')).toEqual(['lowercase', 'uppercase'])
    expect(passwordIssues('')).toEqual(['length', 'lowercase', 'uppercase', 'digit'])
  })

  it('a senha de 6 dígitos que o app aceitava antes agora é recusada', () => {
    expect(isPasswordValid('123456')).toBe(false)
  })

  it('símbolos são permitidos, mas não obrigatórios', () => {
    expect(isPasswordValid('Senha-Forte-2026!')).toBe(true)
    expect(isPasswordValid('SenhaForte2026')).toBe(true)
  })
})
