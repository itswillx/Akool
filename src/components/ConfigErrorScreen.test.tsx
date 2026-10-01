// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { loadLang } from '../i18n/translations'
import ConfigErrorScreen from './ConfigErrorScreen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

describe('ConfigErrorScreen', () => {
  it('explains the missing configuration by variable name, in Portuguese', () => {
    act(() => root.render(<ConfigErrorScreen missing={['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']} lang="pt-BR" />))
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('O app não está configurado')
    expect([...container.querySelectorAll('code')].map(c => c.textContent)).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
    expect(container.textContent).toContain('Coolify')
  })

  it('follows the saved language', async () => {
    await loadLang('en')
    act(() => root.render(<ConfigErrorScreen missing={['VITE_SUPABASE_ANON_KEY']} lang="en" />))
    expect(container.querySelector('h1')?.textContent).toBe('The app is not configured')
  })
})
