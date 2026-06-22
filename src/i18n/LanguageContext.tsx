import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getT } from './translations'
import type { Lang, TranslationKey } from './translations'

interface LanguageContextType {
  lang: Lang
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'pt-BR',
  t: getT('pt-BR'),
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const lang: Lang = profile?.language ?? 'pt-BR'
  const t = useMemo(() => getT(lang), [lang])

  return (
    <LanguageContext.Provider value={{ lang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
