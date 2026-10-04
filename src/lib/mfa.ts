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

/** Nome que o app autenticador mostra na entrada da conta: "Akool (e-mail)". */
export const TOTP_ISSUER = 'Akool'

/** A chave em grupos de 4, para ler e digitar; a cópia leva a chave crua. */
export function formatTotpSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')
}

/** Só uma URI de cadastro TOTP vira QR code ou link para o app autenticador. */
export function isOtpauthUri(uri: string): boolean {
  return /^otpauth:\/\/totp\//i.test(uri)
}

/**
 * Nome do fator no Supabase, que exige nome único por usuário. Com os segundos,
 * ativar e logo em seguida adicionar outro aparelho não colidem.
 */
export function totpFriendlyName(now: Date): string {
  return `${TOTP_ISSUER} ${now.toISOString().slice(0, 19).replace('T', ' ')}`
}

/** O que importa de um erro do supabase.auth.mfa (AuthError). */
export interface MfaError {
  code?: string | undefined
  message: string
}

/** Código errado ou vencido; o resto (rede, limite de tentativas…) é outro erro. */
export function isInvalidTotpError(error: MfaError): boolean {
  return error.code === 'mfa_verification_failed' || /invalid|expired/i.test(error.message)
}

/**
 * Cada aparelho é um fator com segredo próprio, e o código vale só para o que o
 * gerou. Tenta os fatores em ordem e para no primeiro que aceitar; um erro que
 * não é de código volta na hora, sem gastar tentativas nos outros.
 */
export async function verifyWithAnyFactor(
  factorIds: readonly string[],
  verify: (factorId: string) => Promise<{ error: MfaError | null }>,
): Promise<{ error: string | null }> {
  if (factorIds.length === 0) return { error: 'no_factor' }
  for (const factorId of factorIds) {
    const { error } = await verify(factorId)
    if (!error) return { error: null }
    if (!isInvalidTotpError(error)) return { error: error.message }
  }
  return { error: 'invalid_code' }
}
