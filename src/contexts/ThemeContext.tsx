import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './AuthContext'

export type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

const LS_KEY = 'excalinotion_theme'

function applyTheme(t: Theme) {
  if (t === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile, updateProfile } = useAuth()
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(LS_KEY) as Theme | null
    return stored === 'dark' ? 'dark' : 'light'
  })

  // Sync from profile when it loads
  useEffect(() => {
    if (profile?.theme) {
      const t = profile.theme as Theme
      setThemeState(t)
      localStorage.setItem(LS_KEY, t)
      applyTheme(t)
    }
  }, [profile?.theme])

  // Apply on initial mount from localStorage
  useEffect(() => {
    applyTheme(theme)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setTheme = async (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(LS_KEY, t)
    applyTheme(t)
    await updateProfile({ theme: t })
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
