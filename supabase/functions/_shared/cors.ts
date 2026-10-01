// SEC-007: CORS das edge functions num lugar só (antes, a mesma cópia em cada
// function, com localhost no padrão de produção).
//
// Sem ALLOWED_ORIGINS, só os domínios de produção. Localhost entra pelo env em
// desenvolvimento (ex.: ALLOWED_ORIGINS=http://localhost:5173 no .env do
// `supabase functions serve`). Nada de Deno aqui: cada function lê o env e
// passa o valor, e o Vitest testa este arquivo direto.

// REL-005: sem a akool.netlify.app — o site na Netlify foi desativado, e o nome
// livre poderia ser registrado por outra pessoa.
export const PRODUCTION_ORIGINS = [
  "https://www.slinkysalsichinha.com.br",
];

const BASE_ALLOW_HEADERS = ["authorization", "x-client-info", "apikey", "content-type"];

/** Origens permitidas: o valor de ALLOWED_ORIGINS (separado por vírgula) ou produção. */
export function allowedOrigins(env: string | undefined | null): string[] {
  const list = (env ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return list.length > 0 ? list : [...PRODUCTION_ORIGINS];
}

export interface CorsOptions {
  /** Headers de request além do padrão (ex.: x-cron-secret). */
  allowHeaders?: string[];
  /** Headers de resposta que o navegador pode ler (ex.: Retry-After). */
  exposeHeaders?: string[];
}

/** Headers CORS da resposta: ecoa a origem se ela for permitida; senão, a 1ª da lista. */
export function corsHeaders(req: Request, origins: string[], options: CorsOptions = {}): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
    "Access-Control-Allow-Headers": [...BASE_ALLOW_HEADERS, ...(options.allowHeaders ?? [])].join(", "),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (options.exposeHeaders?.length) headers["Access-Control-Expose-Headers"] = options.exposeHeaders.join(", ");
  return headers;
}
