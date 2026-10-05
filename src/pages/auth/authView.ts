import type { MouseEvent } from 'react'
import type { getT, Lang } from '../../i18n/translations'

// A página pública vive em `/` sem roteador: a view é espelhada no hash
// (#entrar, #cadastro, #recuperar) para o Voltar do navegador e links diretos
// funcionarem. Hash com `=` é callback do auth-js (#access_token=…, #error=…)
// e nunca vira view nossa; o auth-js só age sobre esses, e o `supabase.ts` já
// leu a URL no boot, então regravar o hash depois não muda nada lá.

export type AuthView = 'landing' | 'signin' | 'signup' | 'forgot'
export type AuthFormView = Exclude<AuthView, 'landing'>
export type Translate = ReturnType<typeof getT>

export const VIEW_HASH: Record<AuthFormView, string> = {
  signin: '#entrar',
  signup: '#cadastro',
  forgot: '#recuperar',
}

const HASH_VIEW: Record<string, AuthFormView> = { entrar: 'signin', cadastro: 'signup', recuperar: 'forgot' }

export function viewFromHash(hash: string): AuthView {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  if (h.includes('=')) return 'landing'
  return HASH_VIEW[h] ?? 'landing'
}

/** Login diário e link de recuperação expirado abrem direto no formulário. */
export function initialView(forced: AuthView | null, hash: string): AuthView {
  return forced ?? viewFromHash(hash)
}

export function hrefForView(view: AuthView, loc: { pathname: string; search: string } = window.location): string {
  return view === 'landing' ? loc.pathname + loc.search : VIEW_HASH[view]
}

/** O href (relativo, como '#entrar') já é a URL atual? Compara as duas resolvidas. */
function isCurrent(href: string): boolean {
  return new URL(href, window.location.href).href === window.location.href
}

/** Entrada nova no histórico; no-op se a URL já é essa. */
export function pushAuthView(view: AuthView): void {
  const href = hrefForView(view)
  if (isCurrent(href)) return
  window.history.pushState(null, '', href)
}

/** Troca a URL sem entrada nova (views forçadas, hash feio do link expirado). */
export function replaceAuthView(view: AuthView): void {
  const href = hrefForView(view)
  if (isCurrent(href)) return
  window.history.replaceState(null, '', href)
}

/** Depois do login: só limpa se o hash for um dos nossos. */
export function clearAuthHash(): void {
  if (viewFromHash(window.location.hash) === 'landing') return
  window.history.replaceState(null, '', hrefForView('landing'))
}

export function subscribeAuthHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

/** Clique comum: o link vira troca de view; com modificador, o href real abre em nova aba. */
export function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

export const LANG_SHORT: Record<Lang, string> = { 'pt-BR': 'PT', en: 'EN' }
