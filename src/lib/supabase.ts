import { createClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env'
import type { Database } from '../types/db'

// DEV-003: com a env faltando ou inválida, o main.tsx mostra a tela de
// configuração e o app não chega a usar este cliente. O endereço reservado
// (.invalid nunca resolve) só existe para a importação não lançar exceção.
const supabaseUrl = SUPABASE_URL || 'http://config-ausente.invalid'
const supabaseAnonKey = SUPABASE_ANON_KEY || 'config-ausente'

// Captured BEFORE createClient: detectSessionInUrl processes and clears the
// URL hash asynchronously right after the client is created, so this is the
// only reliable place to know the tab was opened from a recovery email link.
const initialUrl = typeof window !== 'undefined'
  ? window.location.hash + window.location.search
  : ''
export const recoveryLinkDetected = initialUrl.includes('type=recovery')
export const recoveryLinkError = /error_code=otp_expired|error=access_denied/.test(initialUrl)

// ARCH-004: tipado pelo schema (src/types/db.ts sobre o gerado). Tabela,
// coluna ou argumento de RPC que não existe no banco vira erro de compilação.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

// Throwaway client to verify a password via signInWithPassword without
// firing SIGNED_IN on the main client or touching its persisted session.
// The distinct storageKey avoids clashing with the main GoTrueClient.
export function createEphemeralAuthClient() {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'akool-ephemeral-verify',
    },
  })
}
