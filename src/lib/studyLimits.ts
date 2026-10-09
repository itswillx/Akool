// API-021: os limites do gatilho study_cards_rules (funções private.study_*_problem
// de supabase/migrations/20261008130000_api021_study_rules.sql), num lugar só.
// O parser e o card os seguem para o servidor não recusar no meio de uma
// importação ou edição. O servidor conta caracteres por code point; aqui, por
// unidade UTF-16 (o `maxLength` do navegador também): nunca mais folgado.

export const STUDY_JSON_MAX_BYTES = 256 * 1024
export const STUDY_ID_MAX = 100

export const STUDY_CHECKPOINTS_MAX = 200
export const STUDY_CHECKPOINT_TEXT_MAX = 2000
export const STUDY_CHECKPOINT_NOTE_MAX = 5000

export const STUDY_RESOURCES_MAX = 50
export const STUDY_URL_MAX = 2048
export const STUDY_RESOURCE_TITLE_MAX = 2048

export const STUDY_QUIZ_MAX = 100
export const STUDY_STATEMENT_MAX = 2000
export const STUDY_EXPLANATION_MAX = 4000
export const STUDY_OPTIONS_MIN = 2
export const STUDY_OPTIONS_MAX = 10
export const STUDY_OPTION_MAX = 1000

export const STUDY_BLOCKS_MAX = 50

/**
 * A regra do servidor para url e licenseUrl (a mesma de
 * private.card_links_are_safe, SEC-010): http(s), sem espaço nem caractere de
 * controle, até 2048. Aqui também sem caractere de formatação invisível.
 */
export function isSafeStudyUrl(url: string): boolean {
  return url.length <= STUDY_URL_MAX && /^https?:\/\/[^\s\p{Cc}\p{Cf}]+$/iu.test(url)
}

/** Corta em `max` unidades sem deixar meia letra (o banco recusa surrogate solto). */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

// O jsonb em texto, como o octet_length(col::text) do servidor mede: ", " e
// ": " entre os itens (o JSON.stringify não põe espaço). Chave com undefined
// some, como no envio.
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => jsonbText(item === undefined ? null : item)).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`).join(', ')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** Tamanho, em bytes UTF-8, de uma coluna JSON como o servidor a mede. */
export function studyJsonBytes(value: unknown): number {
  return new TextEncoder().encode(jsonbText(value)).length
}
