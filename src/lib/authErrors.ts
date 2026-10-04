import type { TranslationKey } from '../i18n/translations'

// Os erros do Supabase Auth chegam em inglês ("Invalid login credentials",
// "Email not confirmed"…). Aqui cada caso conhecido vira uma chave de
// tradução; o que não é conhecido volta `null` e a tela mostra o texto cru.

export interface AuthErrorLike {
  code?: string | null
  status?: number | null
  name?: string
  message?: string
}

const BY_CODE: Record<string, TranslationKey> = {
  invalid_credentials: 'auth_err_invalid_credentials',
  email_not_confirmed: 'auth_err_email_not_confirmed',
  user_already_exists: 'auth_err_user_exists',
  email_exists: 'auth_err_user_exists',
  over_request_rate_limit: 'auth_err_rate_limited',
  over_email_send_rate_limit: 'auth_err_rate_limited',
  over_sms_send_rate_limit: 'auth_err_rate_limited',
  weak_password: 'auth_password_weak',
}

/**
 * O Supabase recusa um segundo e-mail para o mesmo endereço em menos de 60 s
 * (`over_email_send_rate_limit`, "For security purposes…"). Na recuperação de
 * senha isso só acontece quando a conta existe: mostrar o erro revelaria isso.
 */
export function isEmailCooldown(error: AuthErrorLike | string | null | undefined): boolean {
  if (!error) return false
  const e: AuthErrorLike = typeof error === 'string' ? { message: error } : error
  return e.code === 'over_email_send_rate_limit' || /for security purposes/i.test(e.message ?? '')
}

export function authErrorKey(error: AuthErrorLike | string | null | undefined): TranslationKey | null {
  if (!error) return null
  const e: AuthErrorLike = typeof error === 'string' ? { message: error } : error
  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code]
  if (e.status === 429) return 'auth_err_rate_limited'
  const msg = (e.message ?? '').toLowerCase()
  if (e.name === 'AuthRetryableFetchError' || /failed to fetch|load failed|networkerror|network request failed/.test(msg)) return 'auth_err_network'
  // Mensagens do GoTrue sem `code` (versões antigas e o reset, que só devolve texto).
  if (msg.includes('invalid login credentials')) return 'auth_err_invalid_credentials'
  if (msg.includes('email not confirmed')) return 'auth_err_email_not_confirmed'
  if (msg.includes('already registered') || msg.includes('already been registered')) return 'auth_err_user_exists'
  if (msg.includes('rate limit') || msg.includes('security purposes') || msg.includes('too many requests')) return 'auth_err_rate_limited'
  return null
}
