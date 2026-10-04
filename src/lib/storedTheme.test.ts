// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest'
import { LOCAL_KEYS } from './localKeys'
import { applyStoredTheme, readStoredTheme } from './storedTheme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

it('aplica o tema escuro gravado no aparelho antes do primeiro paint', () => {
  localStorage.setItem(LOCAL_KEYS.theme, 'dark')
  expect(readStoredTheme()).toBe('dark')
  applyStoredTheme()
  expect(document.documentElement.classList.contains('dark')).toBe(true)
})

it('sem tema gravado (ou claro), tira a classe que sobrou de uma sessão anterior', () => {
  document.documentElement.classList.add('dark')
  applyStoredTheme()
  expect(document.documentElement.classList.contains('dark')).toBe(false)
  localStorage.setItem(LOCAL_KEYS.theme, 'light')
  expect(readStoredTheme()).toBe('light')
})
