import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://akool.netlify.app,http://localhost:5173,http://localhost:4173,http://localhost:3000")
  .split(",")
  .map((o: string) => o.trim())
  .filter(Boolean);

const BACKUP_TABLES = [
  "profiles",
  "invite_codes",
  "pages",
  "page_shares",
  "note_contents",
  "drawing_contents",
  "todos",
  "project_boards",
  "project_columns",
  "project_cards",
  "project_shares",
  "finance_workspaces",
  "finance_workspace_members",
  "finance_accounts",
  "finance_categories",
  "finance_budgets",
  "finance_goals",
  "finance_goal_shares",
  "finance_recurring",
  "finance_transactions",
  "finance_goal_contributions",
  "finance_recurring_entries",
  "finance_workspace_invites",
  "notifications",
] as const;

const STORAGE_BUCKETS = ["note-images", "project-card-images", "transaction-photos"] as const;
const BACKUP_BUCKET = "site-backups";
const MAX_BACKUPS = 10;

type BackupTable = (typeof BACKUP_TABLES)[number];

interface BackupPayload {
  version: 1;
  created_at: string;
  type: "manual" | "automatic";
  tables: Record<string, unknown[]>;
  storage_manifest: Record<string, string[]>;
}

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

async function gzipString(str: string): Promise<Uint8Array> {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipToString(data: Uint8Array): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

async function verifyAdmin(
  req: Request,
  serviceClient: SupabaseClient,
): Promise<{ userId: string | null; isCron: boolean }> {
  const cronSecret = Deno.env.get("BACKUP_CRON_SECRET");
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronSecret && cronHeader === cronSecret) {
    return { userId: null, isCron: true };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Missing authorization");

  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) throw new Error("Missing authorization");

  const { data: { user }, error } = await serviceClient.auth.getUser(jwt);
  if (error || !user) throw new Error("Unauthorized");

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Forbidden");
  return { userId: user.id, isCron: false };
}

async function dumpTables(serviceClient: SupabaseClient): Promise<{
  tables: Record<string, unknown[]>;
  summary: Record<string, number>;
}> {
  const tables: Record<string, unknown[]> = {};
  const summary: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const { data, error } = await serviceClient.from(table).select("*");
    if (error) throw new Error(`Failed to dump ${table}: ${error.message}`);
    tables[table] = data ?? [];
    summary[table] = (data ?? []).length;
  }

  return { tables, summary };
}

async function listStorageFiles(
  serviceClient: SupabaseClient,
  bucket: string,
): Promise<string[]> {
  const paths: string[] = [];
  const queue = [""];

  while (queue.length > 0) {
    const prefix = queue.pop()!;
    const { data, error } = await serviceClient.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) continue;

    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        paths.push(path);
      } else {
        queue.push(path);
      }
    }
  }

  return paths;
}

async function copyStorageToBackup(
  serviceClient: SupabaseClient,
  backupId: string,
): Promise<Record<string, string[]>> {
  const manifest: Record<string, string[]> = {};

  for (const bucket of STORAGE_BUCKETS) {
    const files = await listStorageFiles(serviceClient, bucket);
    manifest[bucket] = files;

    for (const filePath of files) {
      const { data, error } = await serviceClient.storage.from(bucket).download(filePath);
      if (error || !data) continue;

      const destPath = `${backupId}/storage/${bucket}/${filePath}`;
      await serviceClient.storage.from(BACKUP_BUCKET).upload(destPath, data, { upsert: true });
    }
  }

  return manifest;
}

async function enforceRetention(serviceClient: SupabaseClient): Promise<void> {
  const { data: all } = await serviceClient
    .from("site_backups")
    .select("id, storage_path")
    .eq("status", "completed")
    .order("created_at", { ascending: false });

  if (!all || all.length <= MAX_BACKUPS) return;

  const toDelete = all.slice(MAX_BACKUPS);
  for (const row of toDelete) {
    await serviceClient.storage.from(BACKUP_BUCKET).remove([row.storage_path]);
    await serviceClient.storage.from(BACKUP_BUCKET).list(`${row.id}/storage`).then(async (res) => {
      if (res.data) {
        for (const item of res.data) {
          await serviceClient.storage.from(BACKUP_BUCKET).remove([`${row.id}/storage/${item.name}`]);
        }
      }
    });
    await serviceClient.from("site_backups").delete().eq("id", row.id);
  }
}

async function createBackup(
  serviceClient: SupabaseClient,
  type: "manual" | "automatic",
  userId: string | null,
): Promise<unknown> {
  const backupId = crypto.randomUUID();
  const storagePath = `${backupId}.json.gz`;

  const { error: insertErr } = await serviceClient.from("site_backups").insert({
    id: backupId,
    created_by: userId,
    type,
    status: "running",
    storage_path: storagePath,
    size_bytes: 0,
    tables_summary: {},
  });
  if (insertErr) throw new Error(insertErr.message);

  try {
    const { tables, summary } = await dumpTables(serviceClient);
    const storage_manifest = await copyStorageToBackup(serviceClient, backupId);

    const payload: BackupPayload = {
      version: 1,
      created_at: new Date().toISOString(),
      type,
      tables,
      storage_manifest,
    };

    const compressed = await gzipString(JSON.stringify(payload));
    const { error: uploadErr } = await serviceClient.storage
      .from(BACKUP_BUCKET)
      .upload(storagePath, compressed, { contentType: "application/gzip", upsert: true });
    if (uploadErr) throw new Error(uploadErr.message);

    await serviceClient.from("site_backups").update({
      status: "completed",
      size_bytes: compressed.byteLength,
      tables_summary: summary,
    }).eq("id", backupId);

    if (type === "automatic") {
      await serviceClient.from("site_backup_settings").update({
        last_auto_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
    }

    await enforceRetention(serviceClient);

    const { data: record } = await serviceClient.from("site_backups").select("*").eq("id", backupId).single();
    return { backup: record };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await serviceClient.from("site_backups").update({
      status: "failed",
      error_message: msg,
    }).eq("id", backupId);
    throw err;
  }
}

async function clearTable(serviceClient: SupabaseClient, table: BackupTable): Promise<void> {
  const { error } = await serviceClient.from(table).delete().not("id", "is", null);
  if (error) {
    const { error: err2 } = await serviceClient.from(table).delete().gte("created_at", "1970-01-01");
    if (err2) throw new Error(`Failed to clear ${table}: ${err2.message}`);
  }
}

async function restoreBackup(serviceClient: SupabaseClient, backupId: string): Promise<void> {
  const { data: meta, error: metaErr } = await serviceClient
    .from("site_backups")
    .select("*")
    .eq("id", backupId)
    .eq("status", "completed")
    .single();
  if (metaErr || !meta) throw new Error("Backup not found");

  const { data: fileData, error: dlErr } = await serviceClient.storage
    .from(BACKUP_BUCKET)
    .download(meta.storage_path);
  if (dlErr || !fileData) throw new Error("Failed to download backup");

  const json = await gunzipToString(new Uint8Array(await fileData.arrayBuffer()));
  const payload = JSON.parse(json) as BackupPayload;

  if (payload.version !== 1) throw new Error("Unsupported backup version");

  // Clear in reverse dependency order
  for (const table of [...BACKUP_TABLES].reverse()) {
    await clearTable(serviceClient, table);
  }

  // Insert in forward order
  for (const table of BACKUP_TABLES) {
    const rows = payload.tables[table] ?? [];
    if (rows.length === 0) continue;

    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await serviceClient.from(table).insert(chunk);
      if (error) throw new Error(`Failed to restore ${table}: ${error.message}`);
    }
  }

  // Restore storage files
  for (const bucket of STORAGE_BUCKETS) {
    const files = payload.storage_manifest?.[bucket] ?? [];
    for (const filePath of files) {
      const srcPath = `${backupId}/storage/${bucket}/${filePath}`;
      const { data, error } = await serviceClient.storage.from(BACKUP_BUCKET).download(srcPath);
      if (error || !data) continue;
      await serviceClient.storage.from(bucket).upload(filePath, data, { upsert: true });
    }
  }
}

async function deleteBackup(serviceClient: SupabaseClient, backupId: string): Promise<void> {
  const { data: meta } = await serviceClient
    .from("site_backups")
    .select("storage_path")
    .eq("id", backupId)
    .single();

  if (meta?.storage_path) {
    await serviceClient.storage.from(BACKUP_BUCKET).remove([meta.storage_path]);
  }

  const { data: storageItems } = await serviceClient.storage.from(BACKUP_BUCKET).list(`${backupId}/storage`);
  if (storageItems?.length) {
    const paths = storageItems.flatMap((item) =>
      STORAGE_BUCKETS.map((b) => `${backupId}/storage/${b}/${item.name}`)
    );
    if (paths.length) await serviceClient.storage.from(BACKUP_BUCKET).remove(paths);
  }

  await serviceClient.from("site_backups").delete().eq("id", backupId);
}

async function runAutoIfDue(serviceClient: SupabaseClient): Promise<unknown> {
  const { data: settings } = await serviceClient.from("site_backup_settings").select("*").eq("id", 1).single();
  if (!settings?.auto_enabled) return { skipped: true, reason: "auto_disabled" };

  const intervalMs = (settings.interval_days ?? 7) * 86400000;
  const lastAuto = settings.last_auto_at ? new Date(settings.last_auto_at).getTime() : 0;
  if (Date.now() - lastAuto < intervalMs) return { skipped: true, reason: "not_due" };

  const { data: running } = await serviceClient
    .from("site_backups")
    .select("id")
    .eq("status", "running")
    .limit(1);
  if (running && running.length > 0) return { skipped: true, reason: "already_running" };

  return await createBackup(serviceClient, "automatic", null);
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const action = body.action as string;

    if (action === "run_auto_backup") {
      await verifyAdmin(req, serviceClient);
      const result = await runAutoIfDue(serviceClient);
      return jsonResponse(req, result);
    }

    const { userId } = await verifyAdmin(req, serviceClient);

    switch (action) {
      case "create_backup": {
        const result = await createBackup(serviceClient, body.type === "automatic" ? "automatic" : "manual", userId);
        return jsonResponse(req, result);
      }
      case "list_backups": {
        const { data, error } = await serviceClient
          .from("site_backups")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        return jsonResponse(req, { backups: data ?? [] });
      }
      case "restore_backup": {
        if (!body.backup_id) throw new Error("backup_id required");
        await restoreBackup(serviceClient, body.backup_id);
        return jsonResponse(req, { success: true });
      }
      case "delete_backup": {
        if (!body.backup_id) throw new Error("backup_id required");
        await deleteBackup(serviceClient, body.backup_id);
        return jsonResponse(req, { success: true });
      }
      case "get_settings": {
        const { data, error } = await serviceClient.from("site_backup_settings").select("*").eq("id", 1).single();
        if (error) throw new Error(error.message);
        return jsonResponse(req, { settings: data });
      }
      case "update_settings": {
        const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof body.auto_enabled === "boolean") updates.auto_enabled = body.auto_enabled;
        const { data, error } = await serviceClient
          .from("site_backup_settings")
          .update(updates)
          .eq("id", 1)
          .select()
          .single();
        if (error) throw new Error(error.message);
        return jsonResponse(req, { settings: data });
      }
      default:
        return jsonResponse(req, { error: "Unknown action" }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    console.error("[site-backup]", msg);
    return jsonResponse(req, { error: msg }, status);
  }
});
