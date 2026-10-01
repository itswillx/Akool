import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { captureException } from "../_shared/sentry.ts";
import { cronSecretMatches, decideAuth } from "./auth.ts";
import { BACKUP_TABLES, EXCLUDED_TABLES, STORAGE_BUCKETS } from "./tables.ts";

// SEC-007: CORS em _shared/cors.ts; sem ALLOWED_ORIGINS, só produção.
const ALLOWED_ORIGINS = allowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));

const BACKUP_BUCKET = "site-backups";
const MAX_BACKUPS = 10;
const STORAGE_PAGE_SIZE = 1000;
const STORAGE_REMOVE_BATCH = 100;
const DUMP_PAGE_SIZE = 1000;

interface BackupPayload {
  version: 1;
  created_at: string;
  type: "manual" | "automatic" | "pre_restore";
  tables: Record<string, unknown[]>;
  storage_manifest: Record<string, string[]>;
}

function corsHeadersFor(req: Request): Record<string, string> {
  return corsHeaders(req, ALLOWED_ORIGINS, { allowHeaders: ["x-cron-secret"] });
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

// JWT de admin. O segredo do cron não passa mais por aqui (SEC-003): ele só é
// aceito em run_auto_backup, decidido por decideAuth() antes desta chamada.
async function verifyAdmin(
  req: Request,
  serviceClient: SupabaseClient,
): Promise<{ userId: string }> {
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
  return { userId: user.id };
}

// Fails the backup when the public schema no longer matches BACKUP_TABLES +
// EXCLUDED_TABLES, in either direction.
//
// Why this is worth failing over: between 2026-08-07 and 2026-08-16 every
// single backup died on `Failed to dump finance_projects` — migration
// 20260807120000 dropped the finance_project* tables and nothing updated this
// file. In the same window the finance_store_* module (migration 20260728120000)
// was never added, so even a passing backup would have silently omitted it.
// A backup that quietly misses a table is worse than one that refuses to run,
// so drift is a hard error and the message says exactly what to edit.
async function assertNoTableDrift(serviceClient: SupabaseClient): Promise<void> {
  const { data, error } = await serviceClient.rpc("list_public_tables");
  if (error) {
    throw new Error(
      `Table drift check failed (${error.message}). ` +
        "public.list_public_tables() comes from migration 20260816120000 — apply it before deploying this function.",
    );
  }

  const actual = new Set((data as string[] | null) ?? []);
  const known = new Set<string>([...BACKUP_TABLES, ...EXCLUDED_TABLES]);

  const missing = [...known].filter((t) => !actual.has(t)).sort();
  const unclassified = [...actual].filter((t) => !known.has(t)).sort();
  if (missing.length === 0 && unclassified.length === 0) return;

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`listed but no longer in the database: ${missing.join(", ")}`);
  }
  if (unclassified.length > 0) {
    parts.push(`in the database but unclassified: ${unclassified.join(", ")}`);
  }
  throw new Error(
    `Backup table list is out of sync with the schema — ${parts.join("; ")}. ` +
      "Update BACKUP_TABLES (and restore_order in the restore_site_backup migration) or EXCLUDED_TABLES.",
  );
}

async function dumpTables(serviceClient: SupabaseClient): Promise<{
  tables: Record<string, unknown[]>;
  summary: Record<string, number>;
}> {
  const tables: Record<string, unknown[]> = {};
  const summary: Record<string, number> = {};

  // REL-001: paginated. A bare select("*") is capped at PostgREST max_rows
  // (1000), and since restore is DELETE + INSERT, anything past the cap would
  // be wiped for good on restore. Every table in BACKUP_TABLES has an `id`.
  for (const table of BACKUP_TABLES) {
    const rows: unknown[] = [];
    let total: number | null = null;
    for (let from = 0; ; from += DUMP_PAGE_SIZE) {
      const { data, error, count } = await serviceClient
        .from(table)
        .select("*", { count: "exact" })
        .order("id", { ascending: true })
        .range(from, from + DUMP_PAGE_SIZE - 1);
      if (error) throw new Error(`Failed to dump ${table}: ${error.message}`);
      if (total === null) total = count ?? 0;
      rows.push(...(data ?? []));
      if (!data || data.length < DUMP_PAGE_SIZE || rows.length >= total) break;
    }
    if (rows.length !== total) {
      throw new Error(`Dump incompleto de ${table}: ${rows.length} de ${total} linhas`);
    }
    tables[table] = rows;
    summary[table] = rows.length;
  }

  return { tables, summary };
}

// Recursively list every file under `root` in a bucket. Paginates each folder
// with `offset` because Supabase caps `list()` at STORAGE_PAGE_SIZE items —
// without this, folders with >1000 entries are silently truncated.
async function listFilesUnder(
  serviceClient: SupabaseClient,
  bucket: string,
  root = "",
): Promise<string[]> {
  const paths: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const prefix = queue.pop()!;
    let offset = 0;
    for (;;) {
      const { data, error } = await serviceClient.storage
        .from(bucket)
        .list(prefix, { limit: STORAGE_PAGE_SIZE, offset });
      if (error) break;
      const page = data ?? [];
      for (const item of page) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id) {
          paths.push(path); // file (has an id)
        } else {
          queue.push(path); // folder
        }
      }
      if (page.length < STORAGE_PAGE_SIZE) break;
      offset += STORAGE_PAGE_SIZE;
    }
  }

  return paths;
}

function listStorageFiles(serviceClient: SupabaseClient, bucket: string): Promise<string[]> {
  return listFilesUnder(serviceClient, bucket);
}

// Recursively delete everything under `prefix`. Used to fully clean a backup's
// copied storage tree (`${backupId}/storage/**`) — listing a folder path and
// calling remove() on it does NOT recurse, which left orphaned files before.
async function removeStoragePrefix(
  serviceClient: SupabaseClient,
  bucket: string,
  prefix: string,
): Promise<void> {
  const files = await listFilesUnder(serviceClient, bucket, prefix);
  for (let i = 0; i < files.length; i += STORAGE_REMOVE_BATCH) {
    await serviceClient.storage.from(bucket).remove(files.slice(i, i + STORAGE_REMOVE_BATCH));
  }
}

// Whether an exact object path exists in a bucket (used to probe server-side
// copy support without trusting a possibly-ignored option).
async function objectExists(
  serviceClient: SupabaseClient,
  bucket: string,
  path: string,
): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const { data } = await serviceClient.storage.from(bucket).list(dir, { search: name, limit: 1 });
  return !!data && data.some((i) => i.name === name);
}

async function copyStorageToBackup(
  serviceClient: SupabaseClient,
  backupId: string,
): Promise<Record<string, string[]>> {
  const manifest: Record<string, string[]> = {};
  // null = capability unknown, true = cross-bucket copy works, false = fall back.
  let serverCopy: boolean | null = null;

  const downloadUpload = async (bucket: string, filePath: string, destPath: string) => {
    const { data, error } = await serviceClient.storage.from(bucket).download(filePath);
    if (error || !data) return;
    await serviceClient.storage.from(BACKUP_BUCKET).upload(destPath, data, { upsert: true });
  };

  for (const bucket of STORAGE_BUCKETS) {
    const files = await listStorageFiles(serviceClient, bucket);
    manifest[bucket] = files;

    for (const filePath of files) {
      const destPath = `${backupId}/storage/${bucket}/${filePath}`;

      if (serverCopy === false) {
        await downloadUpload(bucket, filePath, destPath);
        continue;
      }

      // Prefer a server-side copy: no bytes flow through the function.
      const { error: copyErr } = await serviceClient.storage
        .from(bucket)
        .copy(filePath, destPath, { destinationBucket: BACKUP_BUCKET });

      if (serverCopy === null) {
        // Probe once: confirm the object actually landed in BACKUP_BUCKET. An
        // older storage client could ignore `destinationBucket` and copy into
        // the source bucket instead — detect that, clean the stray object, and
        // fall back to download+upload for the rest of the run.
        if (!copyErr && await objectExists(serviceClient, BACKUP_BUCKET, destPath)) {
          serverCopy = true;
        } else {
          serverCopy = false;
          if (!copyErr) await serviceClient.storage.from(bucket).remove([destPath]);
          await downloadUpload(bucket, filePath, destPath);
          continue;
        }
      }

      if (copyErr) await downloadUpload(bucket, filePath, destPath);
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
    await removeStoragePrefix(serviceClient, BACKUP_BUCKET, row.id);
    await serviceClient.storage.from(BACKUP_BUCKET).remove([row.storage_path]);
    await serviceClient.from("site_backups").delete().eq("id", row.id);
  }
}

async function createBackup(
  serviceClient: SupabaseClient,
  type: "manual" | "automatic" | "pre_restore",
  userId: string | null,
  actorLabel?: string,
): Promise<unknown> {
  const backupId = crypto.randomUUID();
  const storagePath = `${backupId}.json.gz`;

  // Checked before the site_backups row exists: a drifted list would otherwise
  // insert one `failed` row per cron run forever (enforceRetention only prunes
  // `completed` ones). The overdue banner and the red cron job are the signal.
  try {
    await assertNoTableDrift(serviceClient);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAudit(serviceClient, {
      actorId: userId,
      actorLabel,
      action: "create_backup",
      targetType: "site_backup",
      details: { type, stage: "table_drift_check" },
      success: false,
      errorMessage: msg,
    });
    // REL-011: tag para a regra de alerta de backup no Sentry.
    await captureException(err, { fn: "site-backup", tags: { alert: "backup_failed", stage: "table_drift_check", type } });
    throw err;
  }

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
    // Durable record of the failure: audit_log is outside BACKUP_TABLES, so
    // unlike the site_backups row it survives a restore.
    await logAudit(serviceClient, {
      actorId: userId,
      actorLabel,
      action: "create_backup",
      targetType: "site_backup",
      targetId: backupId,
      details: { type },
      success: false,
      errorMessage: msg,
    });
    await captureException(err, { fn: "site-backup", tags: { alert: "backup_failed", type } });
    throw err;
  }
}

interface BackupValidation {
  payload: BackupPayload;
  summary: Record<string, number>;
  unknownTables: string[];
}

// Download + decompress + parse a backup archive and sanity-check its shape.
// Read-only: never touches the database. Used both as the standalone
// "validate_backup" action and as the mandatory first step of restoreBackup,
// so a corrupt or unsupported-version archive is caught before anything is
// locked or overwritten.
async function downloadAndValidateBackup(
  serviceClient: SupabaseClient,
  backupId: string,
): Promise<BackupValidation> {
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

  const summary: Record<string, number> = {};
  const unknownTables: string[] = [];
  for (const table of Object.keys(payload.tables ?? {})) {
    const rows = payload.tables[table] ?? [];
    if ((BACKUP_TABLES as readonly string[]).includes(table)) {
      summary[table] = rows.length;
    } else {
      unknownTables.push(table);
    }
  }

  return { payload, summary, unknownTables };
}

// Best-effort append to the audit trail. Never throws — a broken audit_log
// insert must not block or mask the outcome of the action being logged.
async function logAudit(
  serviceClient: SupabaseClient,
  entry: {
    actorId: string | null;
    actorLabel?: string;
    action: string;
    targetType?: string;
    targetId?: string;
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
    console.error("[site-backup] audit log insert failed", err);
  }
}

// Claims the restore lock with a single conditional UPDATE — atomic at the DB
// level, so two concurrent restores can't both believe they won the race.
async function acquireRestoreLock(serviceClient: SupabaseClient): Promise<void> {
  const { data, error } = await serviceClient
    .from("site_backup_settings")
    .update({ restore_in_progress: true, restore_started_at: new Date().toISOString() })
    .eq("id", 1)
    .eq("restore_in_progress", false)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Restore already in progress");
}

async function releaseRestoreLock(serviceClient: SupabaseClient): Promise<void> {
  await serviceClient
    .from("site_backup_settings")
    .update({ restore_in_progress: false, restore_started_at: null })
    .eq("id", 1);
}

async function restoreBackup(
  serviceClient: SupabaseClient,
  backupId: string,
  userId: string,
): Promise<void> {
  // 1. Validate the archive before touching anything else.
  const { payload } = await downloadAndValidateBackup(serviceClient, backupId);

  // 2. Claim the restore lock (throws if one is already in progress).
  await acquireRestoreLock(serviceClient);

  let preRestoreBackupId: string | null = null;
  try {
    // 3. Automatic safety backup of current state before it gets overwritten.
    const safety = await createBackup(serviceClient, "pre_restore", userId) as { backup?: { id: string } };
    preRestoreBackupId = safety.backup?.id ?? null;
    if (!preRestoreBackupId) throw new Error("Safety backup did not produce a record");

    await logAudit(serviceClient, {
      actorId: userId,
      action: "restore_backup",
      targetType: "site_backup",
      targetId: backupId,
      details: { phase: "started", pre_restore_backup_id: preRestoreBackupId },
      success: true,
    });

    // 4. Atomic clear + repopulate: one Postgres function call, one transaction.
    //    Any error rolls back every DELETE/INSERT it already made.
    const { data: rowsRestored, error: rpcErr } = await serviceClient.rpc("restore_site_backup", {
      p_tables: payload.tables,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    // 5. Restore storage files. Can't be part of the SQL transaction (these
    //    are storage API calls, not DB rows) — best-effort, same as before.
    for (const bucket of STORAGE_BUCKETS) {
      const files = payload.storage_manifest?.[bucket] ?? [];
      for (const filePath of files) {
        const srcPath = `${backupId}/storage/${bucket}/${filePath}`;
        const { data, error } = await serviceClient.storage.from(BACKUP_BUCKET).download(srcPath);
        if (error || !data) continue;
        await serviceClient.storage.from(bucket).upload(filePath, data, { upsert: true });
      }
    }

    await logAudit(serviceClient, {
      actorId: userId,
      action: "restore_backup",
      targetType: "site_backup",
      targetId: backupId,
      details: { phase: "completed", pre_restore_backup_id: preRestoreBackupId, rows_restored: rowsRestored },
      success: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAudit(serviceClient, {
      actorId: userId,
      action: "restore_backup",
      targetType: "site_backup",
      targetId: backupId,
      details: { phase: "failed", pre_restore_backup_id: preRestoreBackupId },
      success: false,
      errorMessage: msg,
    });
    throw err;
  } finally {
    await releaseRestoreLock(serviceClient);
  }
}

async function deleteBackup(
  serviceClient: SupabaseClient,
  backupId: string,
  userId: string,
): Promise<void> {
  // Read the metadata BEFORE destroying anything: once the archive and the row
  // are gone there is nothing left to describe what was lost, and an audit entry
  // that only carries the id says nothing useful months later.
  const { data: meta } = await serviceClient
    .from("site_backups")
    .select("type, created_at, size_bytes, storage_path")
    .eq("id", backupId)
    .single();

  // A delete aimed at an id that no longer exists still gets a row — an admin
  // trying to erase something already gone is exactly what a trail should show.
  const details: Record<string, unknown> = meta
    ? {
      found: true,
      type: meta.type,
      created_at: meta.created_at,
      size_bytes: meta.size_bytes,
      storage_path: meta.storage_path,
    }
    : { found: false };

  try {
    // Remove the whole copied-storage tree (${backupId}/storage/**) recursively…
    await removeStoragePrefix(serviceClient, BACKUP_BUCKET, backupId);
    // …and the compressed archive sitting next to it (${backupId}.json.gz).
    if (meta?.storage_path) {
      await serviceClient.storage.from(BACKUP_BUCKET).remove([meta.storage_path]);
    }

    // Checked, unlike before: a swallowed error here would answer "success" to
    // the UI and write success=true to the trail while the row is still there.
    const { error } = await serviceClient.from("site_backups").delete().eq("id", backupId);
    if (error) throw new Error(error.message);

    await logAudit(serviceClient, {
      actorId: userId,
      action: "delete_backup",
      targetType: "site_backup",
      targetId: backupId,
      details,
      success: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAudit(serviceClient, {
      actorId: userId,
      action: "delete_backup",
      targetType: "site_backup",
      targetId: backupId,
      details,
      success: false,
      errorMessage: msg,
    });
    throw err;
  }
}

// A backup that outlives the function's wall-clock limit leaves its row stuck
// on `running` forever. Without an age cut-off that one row would block every
// later run, and with the browser trigger gone nobody would be looking at the
// panel to notice.
const STALE_RUNNING_MS = 3600000;

async function runAutoIfDue(serviceClient: SupabaseClient, actorLabel?: string): Promise<unknown> {
  const { data: settings } = await serviceClient.from("site_backup_settings").select("*").eq("id", 1).single();
  if (!settings?.auto_enabled) return { skipped: true, reason: "auto_disabled" };

  const intervalMs = (settings.interval_days ?? 7) * 86400000;
  const lastAuto = settings.last_auto_at ? new Date(settings.last_auto_at).getTime() : 0;
  if (Date.now() - lastAuto < intervalMs) return { skipped: true, reason: "not_due" };

  const { data: running } = await serviceClient
    .from("site_backups")
    .select("id")
    .eq("status", "running")
    .gte("created_at", new Date(Date.now() - STALE_RUNNING_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) return { skipped: true, reason: "already_running" };

  return await createBackup(serviceClient, "automatic", null, actorLabel);
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

    // SEC-003: o segredo do agendador só autoriza run_auto_backup. Em qualquer
    // outra ação ele vira 403 (e fica registrado), e o resto exige JWT de admin.
    const cronSecretOk = await cronSecretMatches(
      req.headers.get("x-cron-secret"),
      Deno.env.get("BACKUP_CRON_SECRET"),
    );
    const decision = decideAuth(action, cronSecretOk);

    if (decision === "forbidden") {
      await logAudit(serviceClient, {
        actorId: null,
        actorLabel: "cron",
        action: String(action ?? "unknown"),
        targetType: "site_backup",
        details: { reason: "cron_secret_outside_run_auto_backup" },
        success: false,
        errorMessage: "Forbidden",
      });
      throw new Error("Forbidden");
    }

    if (action === "run_auto_backup") {
      if (decision === "cron") {
        return jsonResponse(req, await runAutoIfDue(serviceClient, "cron"));
      }
      await verifyAdmin(req, serviceClient);
      return jsonResponse(req, await runAutoIfDue(serviceClient));
    }

    const { userId } = await verifyAdmin(req, serviceClient);

    switch (action) {
      case "create_backup": {
        const result = await createBackup(
          serviceClient,
          body.type === "automatic" ? "automatic" : "manual",
          userId,
        );
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
      case "get_overview": {
        // List + settings in one round-trip (saves a second admin verification).
        const [listRes, settingsRes] = await Promise.all([
          serviceClient.from("site_backups").select("*").order("created_at", { ascending: false }),
          serviceClient.from("site_backup_settings").select("*").eq("id", 1).single(),
        ]);
        if (listRes.error) throw new Error(listRes.error.message);
        if (settingsRes.error) throw new Error(settingsRes.error.message);
        return jsonResponse(req, { backups: listRes.data ?? [], settings: settingsRes.data });
      }
      case "restore_backup": {
        if (!body.backup_id) throw new Error("backup_id required");
        await restoreBackup(serviceClient, body.backup_id, userId);
        return jsonResponse(req, { success: true });
      }
      case "validate_backup": {
        if (!body.backup_id) throw new Error("backup_id required");
        const { summary, unknownTables } = await downloadAndValidateBackup(serviceClient, body.backup_id);
        return jsonResponse(req, { valid: true, summary, unknown_tables: unknownTables });
      }
      case "delete_backup": {
        if (!body.backup_id) throw new Error("backup_id required");
        await deleteBackup(serviceClient, body.backup_id, userId);
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
    // Falha de backup já foi reportada com a tag de alerta (o reporter deduplica).
    if (status === 500) await captureException(err, { fn: "site-backup" });
    return jsonResponse(req, { error: msg }, status);
  }
});
