import { ptBR } from './translations.pt-BR'
import type { TranslationKey } from './translations.pt-BR'

export type Lang = 'pt-BR' | 'en'
export type { TranslationKey }

type Dict = Record<TranslationKey, string>

// PERF-009: só o pt-BR vem no boot. Os outros idiomas são chunks à parte,
// baixados por loadLang(): no main.tsx antes do 1º render (idioma salvo) e no
// LanguageProvider quando o perfil pede outro idioma. Até chegar, getT()
// responde em pt-BR.
const dictionaries: Partial<Record<Lang, Dict>> = { 'pt-BR': ptBR }
const loaders: Partial<Record<Lang, () => Promise<Dict>>> = {
  en: () => import('./translations.en').then(m => m.default),
}
const pending = new Map<Lang, Promise<void>>()
const listeners = new Set<() => void>()

export function isLangLoaded(lang: Lang): boolean {
  return !!dictionaries[lang]
}

/** Garante o dicionário do idioma; chamadas simultâneas dividem o download. */
export function loadLang(lang: Lang): Promise<void> {
  const loader = loaders[lang]
  if (dictionaries[lang] || !loader) return Promise.resolve()
  let request = pending.get(lang)
  if (!request) {
    request = loader()
      .then(dict => {
        dictionaries[lang] = dict
        listeners.forEach(notify => notify())
      })
      // Falhou (rede, deploy novo)? A próxima chamada tenta de novo.
      .finally(() => pending.delete(lang))
    pending.set(lang, request)
  }
  return request
}

/** Avisa quando um dicionário chega (useSyncExternalStore do provider). */
export function subscribeLangs(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}

/** Texto guardado (perfil, localStorage) → idioma do app; o que não for 'en' é pt-BR. */
export function toLang(value: string | null | undefined): Lang {
  return value === 'en' ? 'en' : 'pt-BR'
}

export function getT(lang: Lang) {
  return function t(key: TranslationKey, vars?: Record<string, string | number>): string {
    // Lido a cada chamada: um t criado antes do dicionário chegar passa a
    // responder no idioma certo assim que ele carrega.
    let str: string = dictionaries[lang]?.[key] ?? ptBR[key] ?? key
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v))
      })
    }
    return str
  }
}
