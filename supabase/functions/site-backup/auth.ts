// Decisão de autenticação do site-backup (SEC-003), sem imports de Deno/jsr
// para o vitest cobrir.
//
// O BACKUP_CRON_SECRET existe só para o agendador disparar o backup
// automático. Antes ele liberava qualquer ação, inclusive restore_backup,
// delete_backup e update_settings, numa function exposta com verify_jwt=false.

export const CRON_ACTION = "run_auto_backup";

export type AuthDecision =
  | "cron" // segredo válido em run_auto_backup
  | "require_admin" // segue para o JWT de admin
  | "forbidden"; // segredo válido numa ação que ele não autoriza

export function decideAuth(action: string, cronSecretOk: boolean): AuthDecision {
  if (action === CRON_ACTION) return cronSecretOk ? "cron" : "require_admin";
  return cronSecretOk ? "forbidden" : "require_admin";
}

// Compara o header com o segredo em tempo constante. Os dois lados viram
// SHA-256 antes, então nem o tamanho do segredo vaza pelo tempo de resposta.
export async function cronSecretMatches(
  provided: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  if (!provided || !expected) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(provided)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
