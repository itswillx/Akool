// Contrato da edge function `study-lookup`.
//
// Espelhado no cliente em `src/lib/studyLookup.ts` + o tipo
// StudyLookupProvider em `src/types/index.ts`. Deno nao consegue importar de
// `src/`, entao os dois lados mudam JUNTOS.
//
// 🔴 SSRF: NAO existe campo `url`, `host` nem `path` em nenhum tipo de request,
// e isso e a defesa -- nao um validador que possa ser contornado, mas uma
// AUSENCIA. O cliente so manda texto; toda URL de saida e remontada de
// constantes em providers.ts.

export type LookupAction = "outline" | "summary" | "define" | "resources";

export type ProviderId =
  | "wikipedia"
  | "wiktionary"
  | "openlibrary"
  | "crossref"
  | "stackexchange"
  | "github";

export interface LookupRequest {
  action: LookupAction;
  /** Texto livre. Nunca URL, nunca path. Limitado a MAX_QUERY_LENGTH. */
  query: string;
  /** Titulo exato devolvido por outline; pula uma nova busca. */
  pageTitle?: string;
  /** So honrado em action:"resources". */
  providers?: ProviderId[];
  /** Clampado 1..10. */
  limit?: number;
}

export type ProviderError =
  | "timeout"
  | "unavailable"
  | "too_large"
  | "budget"
  | "backoff"
  | "not_found";

export interface ProviderStatus {
  id: ProviderId;
  ok: boolean;
  cached: boolean;
  error?: ProviderError;
}

export interface LookupItem {
  id: string;
  title: string;
  /** Pagina publica canonica, DERIVADA -- nunca a URL que a function chamou. */
  url: string;
  snippet?: string;
  provider: ProviderId;
  license: string;
  licenseUrl?: string;
}

export interface OutlineSection {
  index: string;
  level: string;
  line: string;
  anchor: string;
}

export interface LookupResponse {
  action: LookupAction;
  results: LookupItem[];
  outline?: {
    pageTitle: string;
    pageUrl: string;
    /** Outros candidatos da busca, para trocar de desambiguacao sem gastar nova chamada. */
    alternates: string[];
    sections: OutlineSection[];
  };
  summary?: {
    pageTitle: string;
    pageUrl: string;
    text: string;
    license: string;
    licenseUrl: string;
  };
  providers: ProviderStatus[];
}

export const MAX_QUERY_LENGTH = 200;
export const MAX_LIMIT = 10;
