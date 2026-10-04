// Código de convite como a pessoa cola: espaços fora, maiúsculas, tamanho
// limitado. Sem máscara de formato: os de produção são 8 caracteres hex, mas os
// de seed do Supabase local têm hífen (SEED-ADMIN), e o servidor compara o
// texto exato.
export const INVITE_CODE_MAX_LENGTH = 16

export function normalizeInviteCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase().slice(0, INVITE_CODE_MAX_LENGTH)
}
