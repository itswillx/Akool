import { supabase } from '../supabase'

// Reenvio do e-mail de confirmação do cadastro (o painel de sucesso oferece o
// botão com espera de 60 s, que é o limite do Supabase por e-mail).
export function resendSignupEmail(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin },
  })
}
