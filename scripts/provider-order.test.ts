import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { providerChain, readProviderOrder } from './provider-order.mjs'

// ARCH-009: a ordem dos providers tem três cópias que precisam bater: o
// src/App.tsx (a verdade), o docs/arquitetura.md (lido por gente) e o mapa
// gerado (que já lê o App.tsx). Este teste prende o doc ao código.
const ROOT = join(__dirname, '..')

describe('ordem dos providers (ARCH-009)', () => {
  const order = readProviderOrder(readFileSync(join(ROOT, 'src/App.tsx'), 'utf8'))

  it('App.tsx: Auth > Language > Toast por fora; Pages > Notifications > Theme > Onboarding > WorkspaceMode por dentro', () => {
    expect(order).toEqual({
      outer: ['AuthProvider', 'LanguageProvider', 'ToastProvider'],
      inner: ['PagesProvider', 'NotificationsProvider', 'ThemeProvider', 'OnboardingProvider', 'WorkspaceModeProvider'],
    })
  })

  it('docs/arquitetura.md lista os mesmos providers, na mesma ordem', () => {
    const doc = readFileSync(join(ROOT, 'docs/arquitetura.md'), 'utf8')
    const block = /```text\n([\s\S]*?)```/.exec(doc)?.[1] ?? ''
    const listed = block.split('\n').map(l => l.trim()).filter(l => /^[A-Z][A-Za-z]*Provider$/.test(l))
    expect(listed).toEqual(providerChain(order))
  })

  it('lê só tags de abertura, uma vez cada, e separa App de AppInner', () => {
    const src = [
      'function AppInner() { return <PagesProvider><ThemeProvider><div /></ThemeProvider></PagesProvider> }',
      '// comentário citando o LanguageProvider sem tag',
      'export default function App() { return <AuthProvider><LanguageProvider><AppInner /></LanguageProvider></AuthProvider> }',
    ].join('\n')
    expect(readProviderOrder(src)).toEqual({ outer: ['AuthProvider', 'LanguageProvider'], inner: ['PagesProvider', 'ThemeProvider'] })
    expect(() => readProviderOrder('const x = 1')).toThrow(/App\.tsx/)
  })
})
