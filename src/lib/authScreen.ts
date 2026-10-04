// Qual tela o App abre antes da área logada (App.tsx). Puro, para testar a
// ordem sem montar o app inteiro.
//
// - boot: a sessão ainda está sendo checada.
// - mfa na recuperação: a sessão do link de recuperação é AAL1, e o Supabase só
//   troca a senha de uma conta com MFA em AAL2 (senão responde "sessão
//   expirada"). O código vem antes; depois dele mfaPending cai e a tela da senha
//   nova aparece.
// - reset: o link de recuperação, mesmo com `user` nulo por um instante (a tela
//   cuida da sessão que falta).
// - signin: sem sessão, a página pública e o login.
// - mfa: conta com MFA entra só depois do código (SEC-004).
export type AuthScreen = 'boot' | 'mfa' | 'reset' | 'signin' | 'app'

export function authScreen({ loading, recoveryMode, signedIn, mfaPending }: {
  loading: boolean
  recoveryMode: boolean
  signedIn: boolean
  mfaPending: boolean
}): AuthScreen {
  if (loading) return 'boot'
  if (recoveryMode && signedIn && mfaPending) return 'mfa'
  if (recoveryMode) return 'reset'
  if (!signedIn) return 'signin'
  if (mfaPending) return 'mfa'
  return 'app'
}
