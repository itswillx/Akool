// REL-007: decisão do login diário. O App.tsx roda uma vez por boot (quando
// ainda não há trabalho aberto); com a aba aberta na virada do dia, o app só
// avisa (useDayRollover) e o login é pedido na próxima abertura.

export interface DailyLoginInput {
  /** `profiles.last_login_date` (YYYY-MM-DD) */
  lastLoginDate: string | null
  /** Hoje no fuso do aparelho (localDateKey) */
  today: string
  justSignedIn: boolean
  recoveryMode: boolean
}

export function mustReLogin({ lastLoginDate, today, justSignedIn, recoveryMode }: DailyLoginInput): boolean {
  // Quem acabou de entrar, ou chegou pelo link de recuperação, já está
  // "logado hoje" (ou no meio de trocar a senha).
  if (justSignedIn || recoveryMode) return false
  // `>=` e não `===`: datas gravadas em UTC antes do REL-007 podem estar um dia
  // à frente (login entre 21h e 0h em Brasília) e continuam valendo.
  return !(lastLoginDate && lastLoginDate >= today)
}
