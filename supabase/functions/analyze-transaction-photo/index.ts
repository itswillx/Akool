import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://www.slinkysalsichinha.com.br,https://akool.netlify.app,http://localhost:5173,http://localhost:4173,http://localhost:3000")
  .split(",")
  .map((o: string) => o.trim())
  .filter(Boolean);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const GEMINI_PREFERRED = [
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  "gemini-2.5-flash-preview-05-20",
  "gemini-2.0-flash",
  "gemini-2.0-flash-exp",
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-001",
  "gemini-1.5-pro",
  "gemini-1.5-pro-latest",
  "gemini-pro-vision",
];

function isRetryableError(status: number, message: string): boolean {
  if (status === 503 || status === 429) return true;
  const lower = message.toLowerCase();
  return lower.includes("high demand") || lower.includes("overloaded") ||
    lower.includes("rate limit") || lower.includes("quota") || lower.includes("try again");
}

/**
 * Robust JSON extractor: strips markdown fences, then uses
 * brace-counting to find the exact JSON object boundaries.
 */
function extractJson(text: string): unknown {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const clean = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // Find the first '{'
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("No JSON object in AI response");

  // Walk forward counting braces to find the matching '}'
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
      .select("ai_provider, ai_api_key")
      .eq("user_id", user.id)
      .single();

    const body = await req.json();
    const { action, image_base64, mime_type } = body;

    if (action === "test") {
      if (!profile?.ai_provider || !profile?.ai_api_key) {
        return new Response(JSON.stringify({ ok: false, error: "AI not configured" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ok = await testApiKey(profile.ai_provider, profile.ai_api_key);
      return new Response(JSON.stringify({ ok }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile?.ai_provider || !profile?.ai_api_key) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!image_base64 || !mime_type) {
      return new Response(JSON.stringify({ error: "Missing image_base64 or mime_type" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await analyzeImage(profile.ai_provider, profile.ai_api_key, image_base64, mime_type);
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[analyze-transaction-photo] ERROR:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error processing request" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function testApiKey(provider: string, apiKey: string): Promise<boolean> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      return res.ok;
    } else if (provider === "gemini") {
      for (const version of ["v1beta", "v1"]) {
        const res = await fetch(`https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`);
        if (res.ok) return true;
      }
      return false;
    }
    return false;
  } catch { return false; }
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

async function analyzeImage(
  provider: string,
  apiKey: string,
  imageBase64: string,
  mimeType: string
): Promise<{ description: string; amount: number | null; type: string; category_suggestion: string }> {
  const prompt = `You are analyzing an image for a personal finance app. The image may show a receipt, product, or any item.\nReturn a JSON object with exactly these 4 fields:\n{\n  "description": "<brief description in Portuguese, max 60 chars>",\n  "amount": <number or null>,\n  "type": "expense",\n  "category_suggestion": "<one of: Alimenta\u00e7\u00e3o, Supermercado, Transporte, Sa\u00fade, Lazer, Moradia, Educa\u00e7\u00e3o, Vestu\u00e1rio, Tecnologia, Servi\u00e7os, Outros>"\n}\nRules: output ONLY the JSON object, no explanation, no markdown.`;

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
        ]}],
        max_tokens: 200,
        response_format: { type: "json_object" },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
    return extractJson(data.choices?.[0]?.message?.content) as { description: string; amount: number | null; type: string; category_suggestion: string };
  }

  if (provider === "gemini") {
    const candidates = await getAvailableGeminiModels(apiKey);
    let lastError = "No Gemini model available";

    for (const { version, model } of candidates) {
      const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ]}],
          generationConfig: { maxOutputTokens: 800, temperature: 0.1 },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error?.message ?? "Gemini error";
        lastError = `[${model}] ${msg}`;
        if (isRetryableError(res.status, msg)) continue;
        throw new Error(lastError);
      }
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      try {
        return extractJson(content) as { description: string; amount: number | null; type: string; category_suggestion: string };
      } catch (parseErr) {
        // JSON parse failed — log raw content in error and try next model
        lastError = `[${model}] JSON parse error: ${parseErr}. Raw: ${content.slice(0, 200)}`;
        continue;
      }
    }
    throw new Error(lastError);
  }

  throw new Error("Unknown AI provider");
}
