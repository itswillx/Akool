import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getT, isLangLoaded, loadLang, subscribeLangs, toLang } from './translations'
import type { Lang, TranslationKey } from './translations'

interface LanguageContextType {
  lang: Lang
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'pt-BR',
  t: getT('pt-BR'),
})

function storedAuthLang(): Lang {
  try {
    return toLang(localStorage.getItem('excalinotion_auth_lang'))
  } catch {
    return 'pt-BR'
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  // Sem perfil (tela de login), vale o idioma escolhido ali (UX-011): os
  // toasts e o <html lang> acompanham a tela.
  const wanted: Lang = profile?.language ?? storedAuthLang()
  // PERF-009: o dicionário que não veio no boot (troca de idioma, ou perfil em
  // inglês num aparelho novo) baixa aqui. Até chegar, o app segue inteiro em
  // pt-BR, com lang e t sempre do mesmo idioma.
  const loaded = useSyncExternalStore(subscribeLangs, () => isLangLoaded(wanted))
  useEffect(() => {
    if (!loaded) loadLang(wanted).catch(() => {})
  }, [wanted, loaded])
  const lang: Lang = loaded ? wanted : 'pt-BR'
  // UX-006: o <html lang> acompanha o idioma na tela (leitor de tela, tradutor).
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const t = useMemo(() => getT(lang), [lang])
  // PERF-001: objeto estável, senão os 93 consumidores re-renderizam a cada
  // render do provider (que acompanha toda mudança do Auth).
  const value = useMemo(() => ({ lang, t }), [lang, t])

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}
