// REL-011: erros das edge functions no Sentry, sem SDK (a API de envelope é um
// POST simples) e sem Deno no topo do arquivo, para o Vitest testar direto.
// Sem o secret SENTRY_DSN não faz nada. Nunca lança nem segura a resposta por
// mais de 2 s: observabilidade não pode derrubar a function que observa.
import { scrubDeep } from "./scrub.ts";

export interface SentryDsn {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
}

export interface CaptureContext {
  /** Nome da function (vira a tag `function`). */
  fn: string;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  level?: "error" | "warning";
}

export function parseDsn(dsn: string | null | undefined): SentryDsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split("/").filter(Boolean).pop();
    if (!url.username || !projectId) return null;
    return { protocol: url.protocol.replace(":", ""), publicKey: url.username, host: url.host, projectId };
  } catch {
    return null;
  }
}

export function envelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`;
}

interface Frame { function?: string; filename?: string; lineno?: number; colno?: number }

// Stack do V8 ("    at fn (file:12:3)") no formato do Sentry: mais antigo primeiro.
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (m) frames.push({ function: m[1] || "?", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) });
  }
  return frames.reverse();
}

export function buildEvent(error: unknown, ctx: CaptureContext, release?: string): Record<string, unknown> {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : JSON.stringify(error));
  const frames = parseStack(err.stack);
  return scrubDeep({
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: ctx.level ?? "error",
    logger: "edge-function",
    environment: "production",
    ...(release ? { release } : {}),
    tags: { function: ctx.fn, runtime: "supabase-edge", ...ctx.tags },
    extra: ctx.extra ?? {},
    exception: {
      values: [{ type: err.name, value: err.message, ...(frames.length ? { stacktrace: { frames } } : {}) }],
    },
  });
}

export function buildEnvelope(dsn: SentryDsn, event: Record<string, unknown>): string {
  const header = {
    event_id: event.event_id,
    sent_at: new Date().toISOString(),
    dsn: `${dsn.protocol}://${dsn.publicKey}@${dsn.host}/${dsn.projectId}`,
  };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}

function env(name: string): string | undefined {
  try {
    return (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env.get(name);
  } catch {
    return undefined;
  }
}

// O mesmo erro sobe por vários catch (ex.: createBackup relança para o handler):
// um evento só por objeto de erro.
const reported = new WeakSet<object>();

export interface CaptureOptions {
  dsn?: string | null;
  release?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function captureException(error: unknown, ctx: CaptureContext, options: CaptureOptions = {}): Promise<void> {
  try {
    const dsn = parseDsn(options.dsn !== undefined ? options.dsn : env("SENTRY_DSN"));
    if (!dsn) return;
    if (error !== null && typeof error === "object") {
      if (reported.has(error)) return;
      reported.add(error);
    }
    const event = buildEvent(error, ctx, options.release ?? env("SENTRY_RELEASE"));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);
    try {
      await (options.fetchImpl ?? fetch)(envelopeUrl(dsn), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=akool-edge/1.0, sentry_key=${dsn.publicKey}`,
        },
        body: buildEnvelope(dsn, event),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Falha ao reportar não pode virar falha da function.
  }
}
