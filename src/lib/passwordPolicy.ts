// Política de senha única do app (SEC-004). Espelha o que o Supabase Auth deve
// exigir no servidor: mínimo de 10 caracteres com minúscula, maiúscula e dígito
// (`password_requirements = "lower_upper_letters_digits"` no config.toml; no
// projeto remoto a mesma regra é ligada no painel do Supabase).
export const MIN_PASSWORD_LENGTH = 10

export type PasswordIssue = 'length' | 'lowercase' | 'uppercase' | 'digit'

export function passwordIssues(pwd: string): PasswordIssue[] {
  const issues: PasswordIssue[] = []
  if (pwd.length < MIN_PASSWORD_LENGTH) issues.push('length')
  if (!/[a-z]/.test(pwd)) issues.push('lowercase')
  if (!/[A-Z]/.test(pwd)) issues.push('uppercase')
  if (!/[0-9]/.test(pwd)) issues.push('digit')
  return issues
}

export function isPasswordValid(pwd: string): boolean {
  return passwordIssues(pwd).length === 0
}
