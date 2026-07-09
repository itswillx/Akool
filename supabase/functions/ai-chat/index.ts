import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://akool.netlify.app,http://localhost:5173,http://localhost:4173,http://localhost:3000")
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

    if (!profile?.ai_provider || !profile?.ai_api_key) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { message, history } = body;

    let reply = "";

    if (profile.ai_provider === "openai") {
      const msgs = history.map((m: any) => ({ role: m.role, content: m.content }));
      msgs.push({ role: "user", content: message });

      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${profile.ai_api_key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Você é um assistente financeiro e de produtividade no Excalinotion. Ajude o usuário de forma concisa e útil com seus projetos, tarefas e finanças." },
            ...msgs
          ],
          max_tokens: 4000,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message ?? "OpenAI error");
      reply = data.choices?.[0]?.message?.content || "Sem resposta.";
    } else if (profile.ai_provider === "gemini") {
      const candidates = await getAvailableGeminiModels(profile.ai_api_key);
      let lastError = "No Gemini model available";

      const contents = history.map((m: any) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));
      contents.push({ role: "user", parts: [{ text: message }] });

      for (const { version, model } of candidates) {
        const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:generateContent?key=${profile.ai_api_key}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "Você é um assistente financeiro e de produtividade no Excalinotion. Ajude o usuário de forma concisa e útil com seus projetos, tarefas e finanças." }] },
            contents,
            generationConfig: { maxOutputTokens: 4000 },
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          lastError = data.error?.message ?? "Gemini error";
          continue;
        }
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sem resposta.";
        lastError = "";
        break; // Sucesso, paramos o loop
      }
      
      if (lastError) throw new Error(lastError);
    } else {
      throw new Error("Unknown AI provider");
    }

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[ai-chat] ERROR:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error processing request" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
