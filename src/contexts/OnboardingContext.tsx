import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'
import WelcomeTour from '../components/WelcomeTour'

interface OnboardingContextType {
  showTour: boolean
  startTour: () => void
  finishTour: () => void
}

const OnboardingContext = createContext<OnboardingContextType | null>(null)

const SEEN_PREFIX = 'akool_onboarding_seen_'

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [showTour, setShowTour] = useState(false)

  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    try {
      const seen = localStorage.getItem(SEEN_PREFIX + userId)
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
        localStorage.setItem(SEEN_PREFIX + userId, '1')
      } catch {
        // ignore persistence errors
      }
    }
  }, [user?.id])

  return (
    <OnboardingContext.Provider value={{ showTour, startTour, finishTour }}>
      {children}
      {showTour && <WelcomeTour onClose={finishTour} />}
    </OnboardingContext.Provider>
  )
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext)
  if (!ctx) throw new Error('useOnboarding must be used within OnboardingProvider')
  return ctx
}
