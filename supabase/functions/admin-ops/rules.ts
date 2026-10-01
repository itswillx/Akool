// QA-001: as decisões do admin-ops, sem Deno nem Supabase, para testar no
// vitest (rules.test.ts). O index.ts faz o I/O e pergunta aqui o que fazer.

// Actions that leave a row in audit_log. `list_users` is a read — logging it
// would bury the mutations in noise.
export const AUDITED_ACTIONS = new Set(["set_role", "ban_user", "unban_user", "delete_user"]);

export const VALID_ROLES = new Set(["admin", "standard"]);

// Prevent admin from acting on themselves for destructive actions.
const SELF_FORBIDDEN = new Set(["delete_user", "ban_user", "set_role"]);

export type Rejection = { status: number; message: string } | null;

/** Antes de ler o alvo: precisa de user_id, e o admin não age sobre si mesmo. */
export function checkTarget(action: unknown, userId: unknown, callerId: string): Rejection {
  if (!userId) return { status: 400, message: "Missing user_id" };
  if (userId === callerId && typeof action === "string" && SELF_FORBIDDEN.has(action)) {
    return { status: 400, message: "Cannot perform this action on yourself" };
  }
  return null;
}

export type RoleChange =
  | { ok: true; fromRole: string; toRole: string }
  | { ok: false; status: number; message: string };

/** set_role: papel conhecido e alvo que existe. */
export function checkSetRole(role: unknown, targetRole: string | null): RoleChange {
  if (typeof role !== "string" || !VALID_ROLES.has(role)) return { ok: false, status: 400, message: "Invalid role" };
  if (!targetRole) return { ok: false, status: 404, message: "User not found" };
  return { ok: true, fromRole: targetRole, toRole: role };
}

// Never let the bench end up empty — nobody left with admin means nobody
// can promote anyone back from inside the app. The check has to come
// *after* the write: a count taken beforehand can only ever be >= 2 (the
// caller is an admin and can't target themselves), so it would never
// fire, and two admins demoting each other at the same instant would
// both see a healthy count. Checking after and putting the role back is
// what actually catches that race.

/** Rebaixar um admin pede a contagem de admins depois da escrita. */
export function isDemotingAdmin(fromRole: string, toRole: string): boolean {
  return fromRole === "admin" && toRole !== "admin";
}

/** Contagem depois da escrita: nenhum admin sobrou = desfazer e recusar. */
export function leftNoAdmin(adminCountAfterWrite: number | null): boolean {
  return (adminCountAfterWrite ?? 0) === 0;
}

// A demoted admin keeps an admin-looking UI (and a stale cached profile)
// until they reload. Dropping their sessions makes it take effect now.
/** Depois de set_role: quem deixa de ser admin perde as sessões abertas. */
export function revokesSessionsAfterRoleChange(toRole: string): boolean {
  return toRole !== "admin";
}
