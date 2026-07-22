import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Captured BEFORE createClient: detectSessionInUrl processes and clears the
// URL hash asynchronously right after the client is created, so this is the
// only reliable place to know the tab was opened from a recovery email link.
const initialUrl = typeof window !== 'undefined'
  ? window.location.hash + window.location.search
  : ''
export const recoveryLinkDetected = initialUrl.includes('type=recovery')
export const recoveryLinkError = /error_code=otp_expired|error=access_denied/.test(initialUrl)

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Throwaway client to verify a password via signInWithPassword without
// firing SIGNED_IN on the main client or touching its persisted session.
// The distinct storageKey avoids clashing with the main GoTrueClient.
export function createEphemeralAuthClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'akool-ephemeral-verify',
    },
  })
}
