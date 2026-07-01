// Helpers for the card "Links" section. Pure and framework-agnostic so they can
// be unit-tested.

export interface CardLink {
  id: string
  url: string
  title: string
}

// Normalize a user-typed link into a safe, navigable URL. Returns null when the
// input is empty or not an http(s) link (e.g. javascript:, data:, mailto: are
// rejected — this section is for web links). A bare host like "example.com" gets
// an https:// prefix.
export function normalizeLinkUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null
  let withScheme: string
  if (/^https?:\/\//i.test(trimmed)) {
    withScheme = trimmed
  } else if (/^[a-z][a-z0-9+-]*:/i.test(trimmed)) {
    // Has a non-http(s) scheme (mailto:, javascript:, data:, …). Scheme names
    // don't contain dots, so "example.com:8080" isn't matched here and falls
    // through to get an https:// prefix.
    return null
  } else {
    withScheme = `https://${trimmed}`
  }
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  return parsed.href
}

// What to show in the list: the display text if set, otherwise the hostname
// (stripping a leading "www."), falling back to the raw URL.
export function linkDisplay(link: { url: string; title: string }): string {
  const title = (link.title ?? '').trim()
  if (title) return title
  try {
    return new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    return link.url
  }
}
