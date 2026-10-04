// SEC-004 (etapa B): segundo fator nas functions de admin. A sessão AAL1 de
// quem já tem um fator verificado é recusada em admin-ops e site-backup; quem
// ainda não ativou o MFA continua entrando (senão o admin ficaria trancado
// até ativar). A sessão aberta com passkey de login (amr `passkey`) vale no
// lugar do código, como no app: o GoTrue só deixa cadastrar passkey em sessão
// AAL2 de quem tem MFA. Sem imports de Deno/jsr, para o vitest cobrir.

export type Aal = "aal1" | "aal2";

export const MFA_REQUIRED = "mfa_required";

interface JwtClaims {
  aal?: unknown;
  amr?: unknown;
}

/** Payload do JWT que o getUser já validou (só decodifica). */
function claimsFromJwt(token: string | null | undefined): JwtClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(decodeBase64Url(parts[1])) as JwtClaims;
  } catch {
    return null;
  }
}

/** Lê o claim `aal` do JWT que o getUser já validou (só decodifica o payload). */
export function aalFromJwt(token: string | null | undefined): Aal | null {
  const aal = claimsFromJwt(token)?.aal;
  if (aal === "aal2") return "aal2";
  if (aal === "aal1") return "aal1";
  return null;
}

/** A sessão foi aberta com passkey de login: o GoTrue grava `{ method: "passkey" }` no amr. */
export function passkeySignInFromJwt(token: string | null | undefined): boolean {
  const amr = claimsFromJwt(token)?.amr;
  return Array.isArray(amr) && amr.some((entry) => typeof entry === "object" && entry !== null && (entry as { method?: unknown }).method === "passkey");
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Exige o segundo fator só de quem já tem fator verificado e veio sem AAL2 nem passkey. */
export function needsSecondFactor(aal: Aal | null, verifiedFactors: number, passkey = false): boolean {
  if (verifiedFactors <= 0) return false;
  if (passkey) return false;
  return aal !== "aal2";
}

/** Conta os fatores verificados na resposta de auth.admin.mfa.listFactors. */
export function countVerifiedFactors(factors: ReadonlyArray<{ status?: string }> | null | undefined): number {
  return (factors ?? []).filter((f) => f.status === "verified").length;
}

/** O pedaço do supabase-js que a checagem usa; estrutural, para o teste passar um fake. */
export interface MfaAdminClient {
  auth: {
    admin: {
      mfa: {
        listFactors(args: { userId: string }): Promise<{ data: { factors?: ReadonlyArray<{ status?: string }> } | null }>;
      };
    };
  };
}

/** Recusa a sessão AAL1 de quem já tem fator verificado (consulta os fatores com o service role). */
export async function mfaRequired(client: MfaAdminClient, userId: string, jwt: string | null | undefined): Promise<boolean> {
  const { data } = await client.auth.admin.mfa.listFactors({ userId });
  return needsSecondFactor(aalFromJwt(jwt), countVerifiedFactors(data?.factors), passkeySignInFromJwt(jwt));
}
