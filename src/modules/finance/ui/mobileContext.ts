import { createContext, useContext } from 'react'

// Lets nested components (modals, tabs, submodules) adapt their layout without
// threading an `isMobile` prop through every call site. Provided once by
// FinancePanel — anything rendered outside that provider silently falls back to
// the desktop layout.
export const FinanceMobileContext = createContext(false)
export const useFinanceMobile = () => useContext(FinanceMobileContext)

// Height reserved for the fixed mobile bottom navigation (incl. elevated FAB).
export const MOBILE_NAV_HEIGHT = 64
