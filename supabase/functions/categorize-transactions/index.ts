// Sugere categorias para transações importadas de extrato bancário usando a
// chave de IA do próprio usuário (profile_secrets), no mesmo padrão da função
// analyze-transaction-photo. Recebe transações + categorias disponíveis e
// devolve o id de categoria sugerido (ou null) por índice.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { allowedOrigins, corsHeaders } from "../_shared/cors.ts";
import { captureException } from "../_shared/sentry.ts";

// SEC-007: CORS em _shared/cors.ts; sem ALLOWED_ORIGINS, só produção.
const ALLOWED_ORIGINS = allowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));

function corsHeadersFor(req: Request): Record<string, string> {
  return corsHeaders(req, ALLOWED_ORIGINS);
}

const GEMINI_PREFERRED = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-preview-05-20",
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
];

const MAX_TRANSACTIONS = 300;
const MAX_CATEGORIES = 80;

interface TxIn { description: string; type: "income" | "expense" }
interface CatIn { id: string; name: string; type: string }

function extractJson(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const clean = fenceMatch ? fenceMatch[1].trim() : text.trim();
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("No JSON object in AI response");
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const jsonStr = end !== -1 ? clean.slice(start, end + 1) : clean.slice(start);
  return JSON.parse(jsonStr);
}

function buildPrompt(transactions: TxIn[], categories: CatIn[]): string {
  const cats = categories
    .map((c, i) => `${i} | ${c.name} | ${c.type}`)
    .join("\n");
  const txs = transactions
    .map((t, i) => `${i} | ${t.type} | ${t.description.slice(0, 120)}`)
    .join("\n");
  return `Você categoriza transações bancárias de um app de finanças pessoais brasileiro.

CATEGORIAS DISPONÍVEIS (índice | nome | tipo):
${cats}

TRANSAÇÕES (índice | tipo | descrição):
${txs}

Responda APENAS com um objeto JSON no formato {"suggestions": [...]} contendo exatamente ${transactions.length} elementos, um por transação, na mesma ordem. Cada elemento é o ÍNDICE (número) da categoria escolhida. Regras:
- TODA transação deve receber uma categoria — não use null (null apenas se não existir NENHUMA categoria do tipo correspondente).
- Use apenas índices da lista e a categoria deve ter o mesmo tipo da transação (expense para expense, income para income).
- Prefira a categoria mais específica que se aplicar; quando nenhuma específica couber, use a categoria genérica do tipo (ex.: "Outros gastos" para despesas, "Outras receitas" para receitas), identificando-a pelo nome.
- Se existir uma categoria com nome de pessoa e a transação for um Pix de/para essa pessoa, use essa categoria.
- Supermercados/padarias/restaurantes/lanchonetes são alimentação/mercado quando essas categorias existirem. Uber/99/transporte por app são transporte.
- Sem explicações, sem markdown: somente o JSON.`;
}

function normalizeSuggestions(raw: unknown, txs: TxIn[], categories: CatIn[]): (string | null)[] {
  const obj = raw as { suggestions?: unknown };
  const arr = Array.isArray(obj?.suggestions) ? obj.suggestions : [];
  return txs.map((tx, i) => {
    const v = arr[i];
    const idx = typeof v === "number" ? v : (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
    if (idx == null || idx < 0 || idx >= categories.length) return null;
    const cat = categories[idx];
    if (cat.type !== tx.type) return null;
    return cat.id;
  });
}

async function getAvailableGeminiModels(apiKey: string): Promise<Array<{ version: string; model: string }>> {
  const result: Array<{ version: string; model: string }> = [];
  for (const version of ["v1beta", "v1"]) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`);
      if (!res.ok) continue;
      const data = await res.json();
      const available = new Set(
        (data.models ?? []).map((m: { name: string }) => m.name.replace("models/", ""))
      );
      for (const model of GEMINI_PREFERRED) {
        if (available.has(model) && !result.some(r => r.model === model)) {
          result.push({ version, model });
        }
      }
    } catch { continue; }
  }
  if (result.length === 0) result.push({ version: "v1beta", model: "gemini-2.0-flash" });
  return result;
}

// Timeout por tentativa de modelo: um modelo lento não pode segurar a request
// inteira (limite de wall clock da edge function) nem o spinner do usuário.
const ATTEMPT_TIMEOUT_MS = 90_000;
// Orçamento total por provedor — sobra espaço para o failover dentro do limite
// da edge function.
const PROVIDER_BUDGET_MS = 150_000;

async function suggestWithGemini(apiKey: string, prompt: string): Promise<unknown> {
  const candidates = await getAvailableGeminiModels(apiKey);
  const deadline = Date.now() + PROVIDER_BUDGET_MS;
  let lastError = "No Gemini model available";
  for (const { version, model } of candidates) {
    if (Date.now() > deadline) break;
    const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
    // Sem maxOutputTokens (modelos com "thinking" truncariam o JSON dentro do
    // teto); responseSchema garante JSON parseável por decodificação restrita;
    // thinkingBudget 0 corta a latência nos modelos que pensam por padrão
    // (2.5+/3.x — modelos antigos rejeitariam o parâmetro).
    const supportsThinking = /gemini-(2\.5|[3-9])/.test(model);
    const generationConfig: Record<string, unknown> = {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { suggestions: { type: "ARRAY", items: { type: "INTEGER", nullable: true } } },
        required: ["suggestions"],
      },
    };
    if (supportsThinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    let data: Record<string, unknown> & { error?: { message?: string }; candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }> };
    let status = 0; // eslint-disable-line no-useless-assignment -- código como publicado
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig,
        }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      status = res.status;
      data = await res.json();
    } catch (fetchErr) {
      lastError = `[${model}] ${fetchErr instanceof Error ? fetchErr.name : "fetch error"}: timeout/rede`;
      console.error("[categorize-transactions] attempt failed:", lastError);
      continue;
    }
    if (status < 200 || status >= 300) {
      // Sempre tenta o próximo modelo: a lista de modelos da API inclui
      // modelos que retornam 404 no generateContent (ex.: 2.5-flash "no
      // longer available to new users") — abortar aqui derrubava tudo.
      lastError = `[${model}] HTTP ${status}: ${data.error?.message ?? "Gemini error"}`;
      console.error("[categorize-transactions] attempt failed:", lastError);
      continue;
    }
    const finishReason = data.candidates?.[0]?.finishReason ?? "";
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    try {
      return extractJson(content);
    } catch (parseErr) {
      lastError = `[${model}] finishReason=${finishReason} JSON parse error: ${parseErr}. Raw: ${content.slice(0, 200)}`;
      console.error("[categorize-transactions] attempt failed:", lastError);
      continue;
    }
  }
  throw new Error(lastError);
}

// Modelos gratuitos preferidos no OpenRouter (ids mudam com frequência; a
// lista real vem da API e esta ordem só prioriza). Ordem: MoE rápidos primeiro;
// tencent/hy3 é lento mas foi o mais estável em horário de pico.
const OPENROUTER_FREE_PREFERRED = [
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "google/gemma-4-26b-a4b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-4-31b-it:free",
  "tencent/hy3:free",
  "openai/gpt-oss-20b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
];

async function getOpenRouterFreeModels(apiKey: string): Promise<string[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });
    if (!res.ok) return OPENROUTER_FREE_PREFERRED;
    const data = await res.json();
    const free = ((data.data ?? []) as Array<{ id: string }>)
      .map((m) => m.id)
      .filter((id) => id.endsWith(":free"));
    const preferred = OPENROUTER_FREE_PREFERRED.filter((id) => free.includes(id));
    const rest = free.filter((id) => !preferred.includes(id));
    const ordered = [...preferred, ...rest];
    return ordered.length > 0 ? ordered.slice(0, 6) : OPENROUTER_FREE_PREFERRED;
  } catch {
    return OPENROUTER_FREE_PREFERRED;
  }
}

async function suggestWithOpenRouter(apiKey: string, prompt: string): Promise<unknown> {
  const models = await getOpenRouterFreeModels(apiKey);
  const deadline = Date.now() + PROVIDER_BUDGET_MS;
  let lastError = "No OpenRouter free model available";
  for (const model of models) {
    if (Date.now() > deadline) break;
    let data: Record<string, unknown> & { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
    let status = 0; // eslint-disable-line no-useless-assignment -- código como publicado
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://www.slinkysalsichinha.com.br",
          "X-Title": "Akool Finance",
        },
        // Sem response_format: nem todo modelo :free suporta; o extractJson
        // (brace-counting) já tolera fences/prosa em volta do JSON.
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
        }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      status = res.status;
      data = await res.json().catch(() => ({}));
    } catch (fetchErr) {
      lastError = `[${model}] ${fetchErr instanceof Error ? fetchErr.name : "fetch error"}: timeout/rede`;
      console.error("[categorize-transactions] attempt failed:", lastError);
      continue;
    }
    if (status < 200 || status >= 300 || data.error) {
      lastError = `[${model}] HTTP ${status}: ${data.error?.message ?? "OpenRouter error"}`;
      console.error("[categorize-transactions] attempt failed:", lastError);
      continue;
    }
    const content = data.choices?.[0]?.message?.content ?? "";
    try {
      return extractJson(content);
    } catch (parseErr) {
      lastError = `[${model}] JSON parse error: ${parseErr}. Raw: ${String(content).slice(0, 200)}`;
      console.error("[categorize-transactions] attempt failed:", lastError);
      continue;
    }
  }
  throw new Error(lastError);
}

async function suggestWithOpenAI(apiKey: string, prompt: string): Promise<unknown> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 8192,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
  return extractJson(data.choices?.[0]?.message?.content ?? "");
}

Deno.serve(async (req: Request) => {
  const corsHeaders = corsHeadersFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: profile } = await serviceClient
      .from("profile_secrets")
      .select("ai_provider, ai_api_key, ai_fallback_provider, ai_fallback_api_key")
      .eq("user_id", user.id)
      .single();

    if (!profile?.ai_provider || !profile?.ai_api_key) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const transactions = (Array.isArray(body?.transactions) ? body.transactions : []) as TxIn[];
    const categories = (Array.isArray(body?.categories) ? body.categories : []) as CatIn[];
    const validTx = transactions
      .filter((t) => t && typeof t.description === "string" && (t.type === "income" || t.type === "expense"))
      .slice(0, MAX_TRANSACTIONS);
    const validCats = categories
      .filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && typeof c.type === "string")
      .slice(0, MAX_CATEGORIES);

    if (validTx.length === 0 || validCats.length === 0) {
      return new Response(JSON.stringify({ suggestions: validTx.map(() => null) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = buildPrompt(validTx, validCats);
    const suggestWith = (provider: string, key: string): Promise<unknown> =>
      provider === "openai" ? suggestWithOpenAI(key, prompt)
        : provider === "openrouter" ? suggestWithOpenRouter(key, prompt)
          : suggestWithGemini(key, prompt);

    let raw: unknown;
    try {
      raw = await suggestWith(profile.ai_provider, profile.ai_api_key);
    } catch (primaryErr) {
      // Failover: se o provedor primário falhar (quota diária, high demand,
      // etc.) e houver um fallback configurado, tenta com ele.
      if (!profile.ai_fallback_provider || !profile.ai_fallback_api_key) throw primaryErr;
      console.error(
        `[categorize-transactions] primary provider ${profile.ai_provider} failed, falling back to ${profile.ai_fallback_provider}:`,
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      );
      raw = await suggestWith(profile.ai_fallback_provider, profile.ai_fallback_api_key);
    }
    const suggestions = normalizeSuggestions(raw, validTx, validCats);

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[categorize-transactions] ERROR:", err instanceof Error ? err.message : String(err));
    await captureException(err, { fn: "categorize-transactions" });
    return new Response(JSON.stringify({ error: "Internal error processing request" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
