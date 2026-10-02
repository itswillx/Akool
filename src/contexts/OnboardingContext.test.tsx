// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localKey } from '../lib/localKeys'

// UX-012: o tour visto fica no perfil; o localStorage antigo migra uma vez.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type ProfilePatch = { onboarding?: Record<string, string> }
const updateProfile = vi.fn<(data: ProfilePatch) => Promise<{ error: string | null }>>(async () => ({ error: null }))
let onboarding: Record<string, string> = {}
const lastPatch = () => updateProfile.mock.calls[updateProfile.mock.calls.length - 1]?.[0]
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, profile: { id: 'u1', onboarding }, updateProfile }),
}))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../components/WelcomeTour', () => ({
  default: ({ onClose, badge }: { onClose: () => void; badge?: string }) => (
    <div role="dialog" data-badge={badge ?? 'welcome'}><button type="button" onClick={onClose}>fechar</button></div>
  ),
}))

const { OnboardingProvider, useOnboarding } = await import('./OnboardingContext')
const { useModuleTour } = await import('../hooks/useModuleTour')

let container: HTMLDivElement
let root: Root
function Probe() {
  const { seen } = useOnboarding()
  return <output data-testid="seen-welcome">{String(seen('welcome'))}</output>
}
function ModuleProbe() {
  useModuleTour('projects')
  return null
}
const mount = async (module?: 'projects') => {
  await act(async () => { root.render(<OnboardingProvider><Probe />{module && <ModuleProbe />}</OnboardingProvider>) })
}
const dialog = () => container.querySelector('[role=dialog]')

beforeEach(() => {
  onboarding = {}
  updateProfile.mockClear()
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('OnboardingProvider (UX-012)', () => {
  it('perfil sem welcome abre o tour geral; fechar grava no perfil', async () => {
    await mount()
    await act(async () => { await Promise.resolve() })
    expect(dialog()?.getAttribute('data-badge')).toBe('welcome')
    await act(async () => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(lastPatch()?.onboarding?.welcome).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(dialog()).toBeNull()
  })

  it('perfil com welcome não abre nada', async () => {
    onboarding = { welcome: '2026-10-01' }
    await mount()
    await act(async () => { await Promise.resolve() })
    expect(dialog()).toBeNull()
    expect(container.querySelector('[data-testid=seen-welcome]')?.textContent).toBe('true')
  })

  it('a marca antiga do aparelho migra para o perfil sem reabrir o tour', async () => {
    localStorage.setItem(localKey.onboardingSeen('u1'), '1')
    await mount()
    await act(async () => { await Promise.resolve() })
    expect(dialog()).toBeNull()
    expect(Object.keys(lastPatch()?.onboarding ?? {})).toEqual(['welcome'])
  })

  it('mini-tour do módulo abre uma vez, depois do geral, com o badge do módulo', async () => {
    onboarding = { welcome: '2026-10-01' }
    await mount('projects')
    await act(async () => { await Promise.resolve() })
    expect(dialog()?.getAttribute('data-badge')).toBe('tour_module_badge_projects')
    await act(async () => { (container.querySelector('button') as HTMLButtonElement).click() })
    expect(lastPatch()?.onboarding).toMatchObject({ welcome: '2026-10-01' })
    expect(lastPatch()?.onboarding?.projects).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('módulo já visto não reabre', async () => {
    onboarding = { welcome: '2026-10-01', projects: '2026-10-01' }
    await mount('projects')
    await act(async () => { await Promise.resolve() })
    expect(dialog()).toBeNull()
  })
})
