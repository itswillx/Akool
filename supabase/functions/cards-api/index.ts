import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { captureException } from "../_shared/sentry.ts";

/**
 * API de cards para a IA (Claude Code via `npm run cards`).
 *
 * Autenticação: `Authorization: Bearer akool_pat_…`, um token pessoal gerado em
 * Configurações → API. Só o sha256 fica no banco (`public.api_tokens`). Por isso
 * esta function roda com verify_jwt = false (config.toml).
 *
 * Toda regra (permissão no quadro, fila, conclusão) vive nas RPCs `public.cq_*`.
 * Aqui só resolvemos o token para um usuário e repassamos como `p_actor`, que as
 * RPCs só aceitam de service_role.
 */

const TOKEN_PREFIX = "akool_pat_";
const PHASES = new Set(["avaliacao", "plano", "aprovado", "desenvolvimento"]);
const RATE_LIMIT = 120;
const RATE_WINDOW_SECONDS = 60;

interface RateLimitVerdict {
  allowed: boolean;
  hits: number;
  limit: number;
  retry_after: number;
  tripped: boolean;
}

// Mesmo helper das antigas edges de IA: fail-open se o contador estiver indisponível.
async function checkRateLimit(
  client: SupabaseClient,
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict | null> {
  try {
    const { data, error } = await client.rpc("check_rate_limit", {
      p_bucket: bucket,
      p_subject: subject,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] RPC falhou, seguindo fail-open:", error.message);
      return null;
    }
    return data as RateLimitVerdict;
  } catch (err) {
    console.error("[rate-limit] excecao, seguindo fail-open:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Códigos levantados pelas RPCs cq_* → HTTP.
function statusForPgCode(code: string | undefined): number {
  switch (code) {
    case "42501": return 403;
    case "P0002": return 404;
    case "22023":
    case "22P02": return 400;
    case "P0001": return 409;
    default: return 500;
  }
}

function asStringArray(value: unknown): string[] | null {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const out = list.map((v) => String(v).trim()).filter(Boolean);
  return out.length ? out : null;
}

// Textos livres (itens novos da checklist): não quebra por vírgula.
function asTextArray(value: unknown): string[] | null {
  if (value == null) return null;
  const list = Array.isArray(value) ? value : [value];
  const out = list.map((v) => String(v).trim()).filter(Boolean);
  return out.length ? out : null;
}

function optionalNote(body: Record<string, unknown>): string | null {
  return typeof body.note === "string" ? body.note : null;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw new BadRequest(`Campo "${key}" é obrigatório`);
  return v.trim();
}

class BadRequest extends Error {}

type Handler = (body: Record<string, unknown>) => { fn: string; args: Record<string, unknown> };

// action → RPC. `p_actor` é acrescentado depois, nunca vem do cliente.
const ACTIONS: Record<string, Handler> = {
  "boards": () => ({ fn: "cq_boards", args: {} }),
  "cards.list": (b) => ({
    fn: "cq_cards",
    args: {
      p_board: requireString(b, "board"),
      p_columns: asStringArray(b.columns),
      p_priorities: asStringArray(b.priorities),
      p_labels: asStringArray(b.labels)?.map((l) => l.toLowerCase()) ?? null,
      p_completed: typeof b.completed === "boolean" ? b.completed : b.completed === "all" ? null : false,
    },
  }),
  "card.get": (b) => ({ fn: "cq_card", args: { p_board: requireString(b, "board"), p_card: requireString(b, "card") } }),
  "queue.enqueue": (b) => ({
    fn: "cq_enqueue",
    args: {
      p_board: requireString(b, "board"),
      p_cards: asStringArray(b.cards),
      p_columns: asStringArray(b.columns),
      p_priorities: asStringArray(b.priorities),
      p_labels: asStringArray(b.labels)?.map((l) => l.toLowerCase()) ?? null,
    },
  }),
  "queue.list": (b) => ({ fn: "cq_list", args: { p_board: requireString(b, "board"), p_statuses: asStringArray(b.status) } }),
  "queue.next": (b) => ({ fn: "cq_next", args: { p_board: requireString(b, "board") } }),
  "queue.remove": (b) => ({ fn: "cq_remove", args: { p_queue_id: requireString(b, "queue_id") } }),
  // Fila priorizada: reordena os "queued" por prioridade → esforço (desfaz ajustes manuais).
  "queue.reprioritize": (b) => ({ fn: "cq_reprioritize", args: { p_board: requireString(b, "board") } }),
  // Fluxo v2: lote de cards em andamento (planos apresentados juntos).
  "queue.start": (b) => {
    const count = b.count == null ? 3 : Number(b.count);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw new BadRequest('Campo "count" deve ser um inteiro de 1 a 10');
    return { fn: "cq_start", args: { p_board: requireString(b, "board"), p_count: count } };
  },
  // Validação do usuário: aprovar conclui; reprovar exige o motivo e volta ao topo da fila.
  "card.validate": (b) => {
    if (typeof b.approve !== "boolean") throw new BadRequest('Campo "approve" deve ser true ou false');
    return {
      fn: "cq_validate",
      args: { p_board: requireString(b, "board"), p_card: requireString(b, "card"), p_approve: b.approve, p_note: optionalNote(b) },
    };
  },
  "card.release": (b) => ({
    fn: "cq_release",
    args: { p_board: requireString(b, "board"), p_card: requireString(b, "card"), p_note: optionalNote(b) },
  }),
  // Converte o quadro para as colunas por fase (só o dono).
  "board.setup_flow": (b) => ({ fn: "cq_setup_flow", args: { p_board: requireString(b, "board") } }),
  "card.check": (b) => {
    const items = asStringArray(b.items);
    if (!items) throw new BadRequest('Campo "items" é obrigatório');
    return {
      fn: "cq_check",
      args: { p_board: requireString(b, "board"), p_card: requireString(b, "card"), p_items: items, p_done: b.done !== false },
    };
  },
  "card.complete": (b) => ({
    fn: "cq_complete",
    args: { p_board: requireString(b, "board"), p_card: requireString(b, "card"), p_note: typeof b.note === "string" ? b.note : null },
  }),
  // Aguardando o usuário: itens dele novos (user_items) ou existentes (user_refs, id ou posição).
  "card.block": (b) => ({
    fn: "cq_block",
    args: {
      p_board: requireString(b, "board"),
      p_card: requireString(b, "card"),
      p_note: requireString(b, "note"),
      p_user_items: asTextArray(b.user_items),
      p_user_refs: asStringArray(b.user_refs),
    },
  }),
  // Fluxo Avaliação → Plano → Desenvolvimento: muda a fase e, com texto, anexa a seção ao card.
  "card.note": (b) => {
    const phase = requireString(b, "phase");
    if (!PHASES.has(phase)) throw new BadRequest('Campo "phase" deve ser avaliacao, plano, aprovado ou desenvolvimento');
    return {
      fn: "cq_note",
      args: { p_board: requireString(b, "board"), p_card: requireString(b, "card"), p_phase: phase, p_text: typeof b.text === "string" ? b.text : null },
    };
  },
  "queue.move": (b) => {
    const position = Number(b.position);
    if (!Number.isInteger(position) || position < 1) throw new BadRequest('Campo "position" deve ser um inteiro >= 1');
    return { fn: "cq_move", args: { p_queue_id: requireString(b, "queue_id"), p_position: position } };
  },
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json(405, { error: "Use POST com { action, ... }" }, { Allow: "POST" });
  }

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith(TOKEN_PREFIX)) {
    return json(401, { error: "Token ausente. Gere um em Configurações → API e envie como Bearer." });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor, error: tokenError } = await admin.rpc("resolve_api_token", { p_hash: await sha256Hex(token) });
  if (tokenError) {
    console.error("[cards-api] resolve_api_token falhou:", tokenError.message);
    await captureException(new Error(`resolve_api_token: ${tokenError.message}`), { fn: "cards-api", tags: { rpc: "resolve_api_token" } });
    return json(500, { error: "Falha ao validar o token" });
  }
  if (!actor) {
    return json(401, { error: "Token inválido, revogado ou expirado" });
  }

  const verdict = await checkRateLimit(admin, "cards-api", String(actor), RATE_LIMIT, RATE_WINDOW_SECONDS);
  if (verdict && !verdict.allowed) {
    return json(429, { error: "Muitas requisições", retry_after: verdict.retry_after }, {
      "Retry-After": String(verdict.retry_after),
    });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return json(400, { error: "Corpo JSON inválido" });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const handler = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!handler) {
    return json(400, { error: `Ação desconhecida: "${action}"`, actions: Object.keys(ACTIONS) });
  }

  let call: { fn: string; args: Record<string, unknown> };
  try {
    call = handler(body);
  } catch (err) {
    if (err instanceof BadRequest) return json(400, { error: err.message });
    throw err;
  }

  const { data, error } = await admin.rpc(call.fn, { ...call.args, p_actor: actor });
  if (error) {
    const status = statusForPgCode(error.code);
    if (status === 500) {
      console.error(`[cards-api] ${call.fn} falhou:`, error.code, error.message);
      await captureException(new Error(`${call.fn}: ${error.message}`), { fn: "cards-api", tags: { rpc: call.fn, code: String(error.code ?? "") } });
    }
    return json(status, { error: status === 500 ? "Erro interno" : error.message });
  }

  return json(200, { data });
});
