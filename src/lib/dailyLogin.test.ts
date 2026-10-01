import { describe, expect, it } from 'vitest'
import { mustReLogin } from './dailyLogin'

const base = { today: '2026-09-26', justSignedIn: false, recoveryMode: false }

describe('mustReLogin', () => {
  it('login de hoje vale; de ontem ou nunca, pede de novo', () => {
    expect(mustReLogin({ ...base, lastLoginDate: '2026-09-26' })).toBe(false)
    expect(mustReLogin({ ...base, lastLoginDate: '2026-09-25' })).toBe(true)
    expect(mustReLogin({ ...base, lastLoginDate: null })).toBe(true)
  })

  it('data um dia à frente (gravada em UTC antes do REL-007) continua valendo', () => {
    expect(mustReLogin({ ...base, lastLoginDate: '2026-09-27' })).toBe(false)
  })

  it('quem acabou de entrar ou está recuperando a senha não é deslogado', () => {
    expect(mustReLogin({ ...base, lastLoginDate: '2026-09-20', justSignedIn: true })).toBe(false)
    expect(mustReLogin({ ...base, lastLoginDate: '2026-09-20', recoveryMode: true })).toBe(false)
  })
})
