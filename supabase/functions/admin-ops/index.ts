import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { captureException } from "../_shared/sentry.ts";
import {
  AUDITED_ACTIONS, checkSetRole, checkTarget, isDemotingAdmin, leftNoAdmin, revokesSessionsAfterRoleChange,
} from "./rules.ts";

// SEC-007: CORS em _shared/cors.ts; sem ALLOWED_ORIGINS, só produção.
const ALLOWED_ORIGINS = allowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));

function corsHeadersFor(req: Request): Record<string, string> {
  return corsHeaders(req, ALLOWED_ORIGINS);
}

// Best-effort append to the audit trail. Never throws — a broken audit_log
// insert must not block or mask the outcome of the action being logged.
// Mirrors logAudit() in supabase/functions/site-backup/index.ts.
async function logAudit(
  serviceClient: SupabaseClient,
  entry: {
    actorId: string | null;
    actorLabel?: string | null;
    action: string;
    targetType?: string;
    targetId?: string | null;
    details?: Record<string, unknown>;
    success: boolean;
    errorMessage?: string;
  },
): Promise<void> {
  try {
    await serviceClient.from("audit_log").insert({
      actor_id: entry.actorId,
      actor_label: entry.actorLabel ?? null,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      details: entry.details ?? {},
      success: entry.success,
      error_message: entry.errorMessage ?? null,
    });
  } catch (err) {
    console.error("[admin-ops] audit log insert failed", err);
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Built up as the request is validated so the catch-all at the bottom can
  // still write a failure row for whatever the caller was trying to do.
  let adminClient: SupabaseClient | null = null;
  const audit: {
    actorId: string | null;
    actorLabel: string | null;
    action: string | null;
    targetId: string | null;
    details: Record<string, unknown>;
  } = { actorId: null, actorLabel: null, action: null, targetId: null, details: {} };

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use anon client to verify caller identity
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for privileged operations
    adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is admin (server-side check — never trust the client)
    const { data: profile, error: profileErr } = await adminClient
      .from("profiles")
      .select("role, email")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile || profile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    audit.actorId = user.id;
    audit.actorLabel = profile.email ?? null;

    const body = await req.json();
    const { action, user_id, role } = body;
    audit.action = action ?? null;
    audit.targetId = user_id ?? null;

    // Rejected attempts get a row too — a denied privilege change is exactly
    // what an audit trail exists to surface.
    const deny = async (status: number, message: string) => {
      if (action && AUDITED_ACTIONS.has(action)) {
        await logAudit(adminClient!, {
          actorId: audit.actorId,
          actorLabel: audit.actorLabel,
          action,
          targetType: "user",
          targetId: audit.targetId,
          details: audit.details,
          success: false,
          errorMessage: message,
        });
      }
      // REL-011: 500 aqui é falha real (ex.: sessões não revogadas no SEC-006).
      if (status >= 500) await captureException(new Error(message), { fn: "admin-ops", tags: { action: String(action) } });
      return new Response(JSON.stringify({ error: message }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    };

    if (action === "list_users") {
      const { data, error } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      return new Response(JSON.stringify({ users: data.users }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetRejection = checkTarget(action, user_id, user.id);
    if (targetRejection) return await deny(targetRejection.status, targetRejection.message);

    // Read the target up front: delete_user cascades the profiles row away, so
    // the e-mail has to be captured before the action runs, not after.
    let targetRole: string | null = null;
    if (AUDITED_ACTIONS.has(action)) {
      const { data: target } = await adminClient
        .from("profiles")
        .select("email, role")
        .eq("id", user_id)
        .single();
      targetRole = target?.role ?? null;
      audit.details = { target_email: target?.email ?? null };
    }

    if (action === "delete_user") {
      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;
      await logAudit(adminClient, {
        actorId: audit.actorId, actorLabel: audit.actorLabel,
        action: "delete_user", targetType: "user", targetId: user_id,
        details: audit.details, success: true,
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "ban_user") {
      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: "876000h",
      });
      if (error) throw error;
      await adminClient.from("profiles").update({ is_active: false }).eq("id", user_id);
      // Kill any session the user already holds so the ban applies on next
      // refresh instead of waiting for it to expire.
      const { error: revokeErr } = await adminClient.rpc("admin_revoke_user_sessions", { target_id: user_id });
      // SEC-006: o ban já vale (o Auth recusa o refresh), mas sessão aberta que
      // não caiu não pode sair como sucesso na UI nem no audit_log.
      if (revokeErr) return await deny(500, `User banned, but open sessions were not revoked: ${revokeErr.message}`);
      await logAudit(adminClient, {
        actorId: audit.actorId, actorLabel: audit.actorLabel,
        action: "ban_user", targetType: "user", targetId: user_id,
        details: audit.details, success: true,
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "unban_user") {
      const { error } = await adminClient.auth.admin.updateUserById(user_id, {
        ban_duration: "none",
      });
      if (error) throw error;
      await adminClient.from("profiles").update({ is_active: true }).eq("id", user_id);
      await logAudit(adminClient, {
        actorId: audit.actorId, actorLabel: audit.actorLabel,
        action: "unban_user", targetType: "user", targetId: user_id,
        details: audit.details, success: true,
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set_role") {
      const change = checkSetRole(role, targetRole);
      if (!change.ok) return await deny(change.status, change.message);

      audit.details = { ...audit.details, from_role: change.fromRole, to_role: change.toRole };

      const { error } = await adminClient.from("profiles").update({ role: change.toRole }).eq("id", user_id);
      if (error) throw error;

      // Último admin: conferido DEPOIS da escrita (ver rules.ts).
      if (isDemotingAdmin(change.fromRole, change.toRole)) {
        const { count, error: countErr } = await adminClient
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("role", "admin");
        if (countErr) throw countErr;
        if (leftNoAdmin(count)) {
          await adminClient.from("profiles").update({ role: change.fromRole }).eq("id", user_id);
          return await deny(400, "Cannot demote the last admin");
        }
      }

      if (revokesSessionsAfterRoleChange(change.toRole)) {
        const { error: revokeErr } = await adminClient.rpc("admin_revoke_user_sessions", { target_id: user_id });
        if (revokeErr) return await deny(500, `Role changed, but open sessions were not revoked: ${revokeErr.message}`);
      }

      await logAudit(adminClient, {
        actorId: audit.actorId, actorLabel: audit.actorLabel,
        action: "set_role", targetType: "user", targetId: user_id,
        details: audit.details, success: true,
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    console.error("[admin-ops] ERROR:", err instanceof Error ? err.message : String(err));
    await captureException(err, { fn: "admin-ops", tags: { action: String(audit.action ?? "unknown") } });
    const message = err instanceof Error ? err.message : "Internal error";
    if (adminClient && audit.action && AUDITED_ACTIONS.has(audit.action)) {
      await logAudit(adminClient, {
        actorId: audit.actorId, actorLabel: audit.actorLabel,
        action: audit.action, targetType: "user", targetId: audit.targetId,
        details: audit.details, success: false, errorMessage: message,
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
