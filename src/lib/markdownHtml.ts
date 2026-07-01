// Bridge between the Markdown we persist in `card.description` and the HTML a
// contentEditable WYSIWYG editor works with.
//
// - markdownToHtml: fill the editor when it opens.
// - htmlToMarkdown: serialize the editor's DOM back to Markdown on every edit.
//
// The supported subset mirrors MarkdownText.tsx (the read-only renderer): bold,
// italic, inline code, links, headings, bullet/numbered lists, blockquotes,
// paragraphs and soft line breaks. Per the request we don't escape stray
// Markdown characters in plain text — fidelity only covers the toolbar's set.

// ─── Markdown → HTML ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

const INLINE_PATTERNS: { type: 'code' | 'link' | 'bold' | 'italic'; re: RegExp }[] = [
  { type: 'code', re: /`([^`]+)`/ },
  { type: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { type: 'bold', re: /\*\*(.+?)\*\*/ },
  { type: 'italic', re: /\*([^*\n]+?)\*/ },
]

function inlineToHtml(text: string): string {
  let out = ''
  let rest = text
  let guard = 0
  while (rest.length > 0 && guard++ < 4000) {
    let best: { type: string; index: number; m: RegExpExecArray } | null = null
    for (const p of INLINE_PATTERNS) {
      const m = new RegExp(p.re.source).exec(rest)
      if (m && (best === null || m.index < best.index)) best = { type: p.type, index: m.index, m }
    }
    if (!best) { out += escapeHtml(rest); break }
    if (best.index > 0) out += escapeHtml(rest.slice(0, best.index))
    const m = best.m
    switch (best.type) {
      case 'code': out += `<code>${escapeHtml(m[1])}</code>`; break
      case 'link': {
        const href = m[2].trim()
        out += /^javascript:/i.test(href)
          ? inlineToHtml(m[1])
          : `<a href="${escapeAttr(href)}">${inlineToHtml(m[1])}</a>`
        break
      }
      case 'bold': out += `<strong>${inlineToHtml(m[1])}</strong>`; break
      case 'italic': out += `<em>${inlineToHtml(m[1])}</em>`; break
    }
    rest = rest.slice(best.index + m[0].length)
  }
  return out
}

const FENCE_RE = /^```/
const HEADING_RE = /^(#{1,3})\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const NUMBERED_RE = /^\d+\.\s+(.*)$/

export function markdownToHtml(md: string): string {
  if (!md || !md.trim()) return ''
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trimStart()

    if (FENCE_RE.test(trimmed)) {
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i].trimStart())) { code.push(lines[i]); i++ }
      i++
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }
    if (trimmed === '') { i++; continue }

    const h = HEADING_RE.exec(trimmed)
    if (h) { blocks.push(`<h${h[1].length}>${inlineToHtml(h[2])}</h${h[1].length}>`); i++; continue }

    if (QUOTE_RE.test(trimmed)) {
      const q: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i].trimStart())) { q.push(QUOTE_RE.exec(lines[i].trimStart())![1]); i++ }
      blocks.push(`<blockquote>${q.map(inlineToHtml).join('<br>')}</blockquote>`)
      continue
    }
    if (BULLET_RE.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && BULLET_RE.test(lines[i].trimStart())) { items.push(BULLET_RE.exec(lines[i].trimStart())![1]); i++ }
      blocks.push(`<ul>${items.map(it => `<li>${inlineToHtml(it)}</li>`).join('')}</ul>`)
      continue
    }
    if (NUMBERED_RE.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && NUMBERED_RE.test(lines[i].trimStart())) { items.push(NUMBERED_RE.exec(lines[i].trimStart())![1]); i++ }
      blocks.push(`<ol>${items.map(it => `<li>${inlineToHtml(it)}</li>`).join('')}</ol>`)
      continue
    }

    const para: string[] = [line]
    i++
    while (i < lines.length && !isSpecial(lines[i])) { para.push(lines[i]); i++ }
    blocks.push(`<p>${para.map(inlineToHtml).join('<br>')}</p>`)
  }
  return blocks.join('')
}

function isSpecial(line: string): boolean {
  const t = line.trimStart()
  return t === '' || FENCE_RE.test(t) || HEADING_RE.test(t) || QUOTE_RE.test(t) || BULLET_RE.test(t) || NUMBERED_RE.test(t)
}

// ─── HTML → Markdown ──────────────────────────────────────────────────────────

function serializeChildren(node: Node): string {
  let out = ''
  node.childNodes.forEach(child => { out += serializeNode(child) })
  return out
}

function serializeNode(node: Node): string {
  if (node.nodeType === 3 /* TEXT_NODE */) return node.textContent ?? ''
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return ''
  const el = node as Element
  const tag = el.tagName.toUpperCase()
  switch (tag) {
    case 'BR': return '\n'
    case 'STRONG': case 'B': {
      const inner = serializeChildren(el)
      return inner ? `**${inner}**` : ''
    }
    case 'EM': case 'I': {
      const inner = serializeChildren(el)
      return inner ? `*${inner}*` : ''
    }
    case 'CODE': {
      const inner = el.textContent ?? ''
      return inner ? `\`${inner}\`` : ''
    }
    case 'A': {
      const href = el.getAttribute('href') ?? ''
      const inner = serializeChildren(el)
      return href ? `[${inner}](${href})` : inner
    }
    case 'H1': return `# ${serializeChildren(el)}\n\n`
    case 'H2': return `## ${serializeChildren(el)}\n\n`
    case 'H3': case 'H4': case 'H5': case 'H6': return `### ${serializeChildren(el)}\n\n`
    case 'UL': {
      const items = Array.from(el.children).filter(c => c.tagName.toUpperCase() === 'LI')
      return items.map(li => `- ${serializeChildren(li)}`).join('\n') + '\n\n'
    }
    case 'OL': {
      const items = Array.from(el.children).filter(c => c.tagName.toUpperCase() === 'LI')
      return items.map((li, i) => `${i + 1}. ${serializeChildren(li)}`).join('\n') + '\n\n'
    }
    case 'LI': return serializeChildren(el)
    case 'BLOCKQUOTE': {
      const inner = serializeChildren(el).trim()
      return inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n'
    }
    case 'PRE': return '```\n' + (el.textContent ?? '') + '\n```\n\n'
    case 'P': case 'DIV': {
      const inner = serializeChildren(el)
      return inner + '\n\n'
    }
    default: return serializeChildren(el)
  }
}

export function htmlToMarkdown(root: Node): string {
  return serializeChildren(root)
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
