import { useEffect } from 'react'
import { useOnboarding } from '../contexts/OnboardingContext'
import type { TourModule } from '../i18n/tourContent'

/**
 * UX-012: mini-tour de um módulo, uma vez por conta, na primeira abertura e só
 * depois de o tour geral ter sido visto (para não empilhar dois).
 */
export function useModuleTour(module: TourModule) {
  const { seen, startTour, activeTour } = useOnboarding()
  useEffect(() => {
    if (activeTour !== null) return
    if (!seen('welcome') || seen(module)) return
    startTour(module)
  }, [module, seen, startTour, activeTour])
}
