// DEV-003: configuração do build validada num lugar só. Nada aqui lança
// exceção: com a env faltando ou inválida, o main.tsx mostra a tela de
// configuração, em vez de o createClient quebrar na importação (tela branca).

export type EnvName = 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'

export interface EnvCheck {
  supabaseUrl: string
  supabaseAnonKey: string
  /** Variáveis ausentes ou inválidas (vazio = tudo certo). */
  missing: EnvName[]
}

/** As mesmas regras do createClient do supabase-js: não vazia, http(s) e URL válida. */
function validUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!/^https?:\/\//i.test(url)) return ''
  try {
    new URL(url)
  } catch {
    return ''
  }
  // Sem barra final: as URLs das edge functions são montadas com "/functions/v1/…".
  return url.replace(/\/+$/, '')
}

export function checkEnv(raw: Record<string, unknown>): EnvCheck {
  const supabaseUrl = validUrl(raw.VITE_SUPABASE_URL)
  const supabaseAnonKey = typeof raw.VITE_SUPABASE_ANON_KEY === 'string' ? raw.VITE_SUPABASE_ANON_KEY.trim() : ''
  const missing: EnvName[] = []
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL')
  if (!supabaseAnonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  return { supabaseUrl, supabaseAnonKey, missing }
}

const env = checkEnv(import.meta.env)

export const SUPABASE_URL = env.supabaseUrl
export const SUPABASE_ANON_KEY = env.supabaseAnonKey
export const missingEnv = env.missing

// MFA com passkey ("Entrar com o celular"): o Supabase hospedado ainda recusa
// ligar o WebAuthn de MFA (a API responde 422). Desligado até lá; ver
// docs/deploy-coolify.md §3.3.
export const MFA_PASSKEY_ENABLED = import.meta.env.VITE_MFA_PASSKEY === 'true'
