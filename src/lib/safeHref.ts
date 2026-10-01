// Allowlist de esquemas para href que vem de dado do usuário (Markdown das
// descrições, links de card). Lista negra não serve: o navegador descarta
// caracteres de controle no começo da URL e tab/quebra de linha no meio, então
// "\x01javascript:" e "java\tscript:" passam por um /^javascript:/ e executam
// do mesmo jeito. Aqui só vira link o que começa, literalmente, por um esquema
// permitido.

const LINK_SCHEMES = /^(https?:\/\/|mailto:)/i
const WEB_SCHEMES = /^https?:\/\//i

/** Href seguro para links dentro de texto: http(s) ou mailto. Senão, null. */
export function safeHref(url: string): string | null {
  const u = (url ?? '').trim()
  return LINK_SCHEMES.test(u) ? u : null
}

/** Href seguro para os links de card: só http(s), a regra do normalizeLinkUrl. */
export function safeWebHref(url: string): string | null {
  const u = (url ?? '').trim()
  return WEB_SCHEMES.test(u) ? u : null
}

/**
 * Se o texto declara um esquema (javascript:, data:, vbscript:…), lendo como o
 * navegador leria: sem controles nem espaços em posição nenhuma. Sem esquema, é
 * um caminho relativo, como os `[a.ts](src/a.ts)` dos cards importados. O ponto
 * fica fora do nome do esquema de propósito: `Arquivo.tsx:42` é arquivo com
 * linha, não esquema.
 */
export function hasUrlScheme(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- os controles são o alvo aqui
  return /^[a-z][a-z0-9+-]*:/i.test((url ?? '').replace(/[\u0000- \u007f]/g, ''))
}
