// Pure transforms for provider payloads. Kept free of Deno globals so Vitest
// can exercise the exact code that runs in the Edge Function.

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  ndash: "–", mdash: "—", hellip: "…",
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, raw: string) => {
    if (raw[0] !== "#") return NAMED_ENTITIES[raw.toLowerCase()] ?? whole;
    const hex = raw[1]?.toLowerCase() === "x";
    const code = Number.parseInt(raw.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff) return whole;
    try { return String.fromCodePoint(code); } catch { return whole; }
  });
}

function balanceBold(markdown: string): string {
  const matches = markdown.match(/\*\*/g)?.length ?? 0;
  if (matches % 2 === 0) return markdown;
  const last = markdown.lastIndexOf("**");
  return last < 0 ? markdown : `${markdown.slice(0, last)}${markdown.slice(last + 2)}`;
}

/**
 * Converts a MediaWiki intro extract into the tiny Markdown subset the app
 * needs. All upstream HTML is stripped; only paragraph breaks and bold terms
 * survive. Returning HTML to the browser is deliberately impossible.
 */
export function wikipediaExtractToMarkdown(html: unknown, maxChars = 1200): string {
  if (typeof html !== "string" || !html.trim()) return "";
  let text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/?(?:b|strong)\b[^>]*>/gi, "**")
    .replace(/<[^>]*>/g, "")
  text = decodeHtmlEntities(text)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > maxChars) {
    const cut = text.slice(0, maxChars + 1);
    const boundary = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
    text = `${cut.slice(0, boundary > maxChars * 0.7 ? boundary : maxChars).trimEnd()}…`;
  }
  return balanceBold(text);
}

export function compactText(value: unknown): string {
  return typeof value === "string"
    ? decodeHtmlEntities(value.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()
    : "";
}
