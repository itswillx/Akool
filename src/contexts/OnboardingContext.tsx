import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { localKey } from '../lib/localKeys'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

// PERF-009: o tour só baixa quando começa.
const WelcomeTour = lazy(() => import('../components/WelcomeTour'))

interface OnboardingContextType {
  showTour: boolean
  startTour: () => void
  finishTour: () => void
}

const OnboardingContext = createContext<OnboardingContextType | null>(null)


export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [showTour, setShowTour] = useState(false)

  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    try {
      const seen = localStorage.getItem(localKey.onboardingSeen(userId))
      if (!seen) setShowTour(true)
    } catch {
      // localStorage unavailable; skip auto-open
    }
  }, [user?.id])

  const startTour = useCallback(() => setShowTour(true), [])

  const finishTour = useCallback(() => {
    setShowTour(false)
    const userId = user?.id
    if (userId) {
      try {
        localStorage.setItem(localKey.onboardingSeen(userId), '1')
      } catch {
        // ignore persistence errors
      }
    }
  }, [user?.id])

  const value = useMemo(() => ({ showTour, startTour, finishTour }), [showTour, startTour, finishTour])

  return (
    <OnboardingContext.Provider value={value}>
      {children}
      {showTour && <Suspense fallback={null}><WelcomeTour onClose={finishTour} /></Suspense>}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}
