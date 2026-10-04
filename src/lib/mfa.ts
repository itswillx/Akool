import type { Factor, GoTrueMFAApi, Session } from '@supabase/supabase-js'
import type { TranslationKey } from '../i18n/translations'

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

// --- Passkey (WebAuthn) como fator de MFA ---------------------------------
// Só a passkey de MFA sobe a sessão para AAL2 (no GoTrue, a passkey de login
// principal dá AAL1 e o app pediria o código do mesmo jeito). No computador o
// navegador mostra um QR para ler com o celular; no celular, Face ID ou digital.

/** Onde a passkey mora: neste aparelho (celular, tablet) ou no celular, via QR. */
export type PasskeyDevice = 'this' | 'phone'

/** Tela de toque (celular, tablet): não dá para escanear a própria tela. */
export function hasCoarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches
}

export function passkeyDevice(isMobile: boolean, coarsePointer: boolean): PasskeyDevice {
  return isMobile || coarsePointer ? 'this' : 'phone'
}

type PasskeyWindow = Pick<Window, 'navigator'> & { PublicKeyCredential?: unknown }

export function supportsPasskeys(win: PasskeyWindow | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  const credentials = win?.navigator?.credentials
  return !!win?.PublicKeyCredential && typeof credentials?.create === 'function' && typeof credentials.get === 'function'
}

export function verifiedFactorId(
  factors: readonly Pick<Factor, 'id' | 'factor_type' | 'status'>[] | null | undefined,
  type: Factor['factor_type'],
): string | null {
  return factors?.find(f => f.factor_type === type && f.status === 'verified')?.id ?? null
}

/**
 * Nome único com os segundos e prefixo próprio (o do app autenticador é
 * `Akool …`). Importa: se o enroll falha, o register() do auth-js remove o
 * fator webauthn VERIFICADO que tiver o mesmo nome.
 */
export function passkeyFriendlyName(now: Date): string {
  return `Passkey ${now.toISOString().slice(0, 19).replace('T', ' ')}`
}

type WebAuthnApi = GoTrueMFAApi['webauthn']
type PasskeyCreateOptions = NonNullable<Parameters<WebAuthnApi['register']>[1]>
type PasskeyGetOptions = NonNullable<Parameters<WebAuthnApi['authenticate']>[1]>

/**
 * O auth-js parte de padrões de chave de segurança física (cross-platform,
 * hints security-key, residentKey discouraged). No celular isso esconderia a
 * própria passkey, e no computador o Chrome não iria direto ao QR.
 */
export function passkeyCreateOptions(device: PasskeyDevice): PasskeyCreateOptions {
  return {
    hints: [device === 'this' ? 'client-device' : 'hybrid'],
    authenticatorSelection: {
      authenticatorAttachment: device === 'this' ? 'platform' : 'cross-platform',
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    attestation: 'none',
  }
}

export function passkeyGetOptions(device: PasskeyDevice): PasskeyGetOptions {
  // O auth-js tipa esta sobrescrita como opções completas (com challenge), mas
  // só mescla o que vier aqui.
  const options: Partial<PasskeyGetOptions> = {
    hints: [device === 'this' ? 'client-device' : 'hybrid'],
    userVerification: 'required',
  }
  return options as PasskeyGetOptions
}

export type PasskeyErrorKind = 'cancelled' | 'exists' | 'wrong_domain' | 'unavailable' | 'failed'

export const PASSKEY_ERROR_KEYS: Record<PasskeyErrorKind, TranslationKey> = {
  cancelled: 'mfa_passkey_cancelled',
  exists: 'mfa_passkey_exists',
  wrong_domain: 'mfa_passkey_wrong_domain',
  unavailable: 'mfa_passkey_unavailable',
  failed: 'mfa_passkey_failed',
}

export function isPasskeyErrorKind(value: string): value is PasskeyErrorKind {
  return Object.hasOwn(PASSKEY_ERROR_KEYS, value)
}

interface PasskeyErrorLike {
  code?: string | undefined
  name?: string | undefined
  message?: string | undefined
  cause?: unknown
}

/**
 * Erros do navegador (WebAuthnError do auth-js, com o DOMException em cause) e
 * do GoTrue viram poucos casos com mensagem própria. NotAllowedError cobre
 * cancelar, o tempo esgotado e o clique que o Safari antigo deixou de valer.
 */
export function passkeyErrorKind(error: PasskeyErrorLike | null | undefined): PasskeyErrorKind | null {
  if (!error) return null
  const cause = error.cause
  const causeName = typeof cause === 'object' && cause !== null && 'name' in cause ? String(cause.name) : ''
  const names = [error.name ?? '', causeName]
  const { code = '', message = '' } = error
  if (code === 'ERROR_CEREMONY_ABORTED' || names.some(n => n === 'NotAllowedError' || n === 'AbortError')) return 'cancelled'
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || code === 'webauthn_credential_exists' || names.includes('InvalidStateError')) return 'exists'
  if (code === 'ERROR_INVALID_RP_ID' || code === 'ERROR_INVALID_DOMAIN' || names.includes('SecurityError')) return 'wrong_domain'
  if (code === 'mfa_webauthn_enroll_not_enabled' || code === 'mfa_webauthn_verify_not_enabled' || /does not support WebAuthn/i.test(message)) return 'unavailable'
  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired' || code.startsWith('webauthn_') || /validate WebAuthn/i.test(message)) return 'failed'
  return null
}
