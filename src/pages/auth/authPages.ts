// As telas de entrada num chunk só (App.tsx pede com import()): landing/login,
// redefinição de senha e MFA compartilham shell, barra e campos.
export { default as AuthPage } from '../AuthPage'
export { default as ResetPasswordPage } from '../ResetPasswordPage'
export { default as MfaChallengePage } from '../MfaChallengePage'
