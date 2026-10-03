import { describe, expect, it } from 'vitest'
import { settingsShellSize } from './settingsTokens'

// As Configurações têm um tamanho só: a casca depende de ser admin e de ser
// celular, nunca da aba aberta.

describe('settingsShellSize', () => {
  it('computador: admin largo, conta comum estreita, mesma altura', () => {
    expect(settingsShellSize(true, false)).toEqual({ maxWidth: 980, height: 'min(760px, calc(100dvh - 48px))' })
    expect(settingsShellSize(false, false)).toEqual({ maxWidth: 640, height: 'min(760px, calc(100dvh - 48px))' })
  })

  it('celular: tela cheia, com ou sem as abas de admin', () => {
    expect(settingsShellSize(true, true)).toEqual({ maxWidth: '100%', height: 'calc(100dvh - 24px)' })
    expect(settingsShellSize(false, true)).toEqual(settingsShellSize(true, true))
  })
})
