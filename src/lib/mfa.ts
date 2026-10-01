import type { Session } from '@supabase/supabase-js'

// MFA/TOTP (SEC-004). Quem tem um fator verificado precisa subir a sessão de
// AAL1 (só senha) para AAL2 (senha + código) antes de entrar no app.

export type AssuranceLevel = 'aal1' | 'aal2'

export interface Assurance {
  currentLevel: AssuranceLevel | null
  nextLevel: AssuranceLevel | null
}

function decodeAal(accessToken: string | undefined): AssuranceLevel | null {
  const payload = accessToken?.split('.')[1]
  if (!payload) return null
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=')
    const aal = (JSON.parse(atob(b64)) as { aal?: unknown }).aal
    return aal === 'aal1' || aal === 'aal2' ? aal : null
  } catch {
    return null
  }
}

/**
 * Mesmo cálculo de `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`: o nível
 * atual vem do claim `aal` do JWT e o próximo é AAL2 se houver fator verificado.
 * Síncrono de propósito: roda dentro do onAuthStateChange, onde chamadas async
 * do supabase-js podem travar no lock da sessão.
 */
export function assuranceFromSession(session: Pick<Session, 'access_token' | 'user'> | null): Assurance | null {
  if (!session) return null
  const currentLevel = decodeAal(session.access_token)
  const hasVerifiedFactor = (session.user?.factors ?? []).some(f => f.status === 'verified')
  return { currentLevel, nextLevel: hasVerifiedFactor ? 'aal2' : currentLevel }
}

/** A sessão existe, o usuário tem MFA e ainda não digitou o código. */
export function needsMfaChallenge(assurance: Assurance | null): boolean {
  return !!assurance && assurance.nextLevel === 'aal2' && assurance.currentLevel !== 'aal2'
}

export function isTotpCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim())
}
