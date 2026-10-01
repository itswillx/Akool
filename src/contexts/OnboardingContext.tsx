import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { localDateKey } from '../lib/localDate'
import { localKey } from '../lib/localKeys'
import { useLanguage } from '../i18n/LanguageContext'
import { moduleTours, type TourModule } from '../i18n/tourContent'
import { useAuth } from './AuthContext'

// PERF-009: o tour só baixa quando começa.
const WelcomeTour = lazy(() => import('../components/WelcomeTour'))

// UX-012: o que já foi visto fica no perfil (profiles.onboarding, módulo →
// data ISO), então não reaparece noutro aparelho. O localStorage antigo
// (akool:onboarding.seen:<userId>) só serve para migrar quem já tinha visto o
// tour geral neste aparelho: na primeira carga, vira `welcome` no perfil, sem
// reabrir o tour.
export type TourId = 'welcome' | TourModule

interface OnboardingContextType {
  /** O tour aberto agora, ou null. */
  activeTour: TourId | null
  showTour: boolean
  /** O módulo (ou `welcome`) já foi visto? */
  seen: (id: TourId) => boolean
  startTour: (id?: TourId) => void
  finishTour: () => void
}

const OnboardingContext = createContext<OnboardingContextType | null>(null)

/** Referência estável para "nada visto", para o `seen` não mudar a cada render. */
const NO_ONBOARDING: Record<string, string> = {}

const BADGE_KEY = { projects: 'tour_module_badge_projects', finance: 'tour_module_badge_finance', study: 'tour_module_badge_study' } as const

/** A marca antiga, por aparelho, de quem já viu o tour geral. */
function seenLocally(userId: string | undefined) {
  if (!userId) return false
  try { return localStorage.getItem(localKey.onboardingSeen(userId)) === '1' } catch { return false }
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user, profile, updateProfile } = useAuth()
  const { lang, t } = useLanguage()
  // Tour pedido (Ajuda ou mini-tour de módulo). O tour geral não passa por aqui:
  // ele é derivado do perfil, e `welcomeClosedFor` cobre o instante entre fechar
  // e o perfil voltar gravado.
  const [requested, setRequested] = useState<TourId | null>(null)
  const [welcomeClosedFor, setWelcomeClosedFor] = useState<string | null>(null)
  const migratedFor = useRef<string | null>(null)

  const userId = user?.id
  const onboarding = profile?.onboarding ?? NO_ONBOARDING
  const seen = useCallback((id: TourId) => typeof onboarding[id] === 'string', [onboarding])

  const welcomeSeen = seen('welcome')
  const hasLocalMark = seenLocally(userId)
  const welcomeDue = !!userId && !!profile && !welcomeSeen && !hasLocalMark && welcomeClosedFor !== userId
  const activeTour: TourId | null = requested ?? (welcomeDue ? 'welcome' : null)

  // Quem já tinha a marca local migra para o perfil, uma vez por conta.
  useEffect(() => {
    if (!userId || !profile || welcomeSeen || !hasLocalMark) return
    if (migratedFor.current === userId) return
    migratedFor.current = userId
    void updateProfile({ onboarding: { ...onboarding, welcome: localDateKey() } })
  }, [userId, profile, welcomeSeen, hasLocalMark, onboarding, updateProfile])

  const startTour = useCallback((id: TourId = 'welcome') => setRequested(id), [])

  const finishTour = useCallback(() => {
    const id = activeTour
    setRequested(null)
    if (!id || !userId) return
    if (id === 'welcome') setWelcomeClosedFor(userId)
    void updateProfile({ onboarding: { ...onboarding, [id]: localDateKey() } })
    try { localStorage.setItem(localKey.onboardingSeen(userId), '1') } catch { /* storage bloqueado */ }
  }, [activeTour, userId, onboarding, updateProfile])

  const value = useMemo(() => ({ activeTour, showTour: activeTour !== null, seen, startTour, finishTour }), [activeTour, seen, startTour, finishTour])

  const moduleProps = activeTour && activeTour !== 'welcome'
    ? { steps: moduleTours[lang][activeTour], badge: t(BADGE_KEY[activeTour]), finishLabel: t('tour_module_finish') }
    : {}

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {activeTour && <Suspense fallback={null}><WelcomeTour onClose={finishTour} {...moduleProps} /></Suspense>}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}
