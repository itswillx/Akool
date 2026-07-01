import type { CSSProperties, ReactNode } from 'react'

// Lightweight Markdown → React renderer. Covers the subset that appears in card
// descriptions and that the formatting toolbar produces: bold, italic, inline
// code, fenced code, links, headings, bullet/numbered lists, blockquotes and
// paragraphs. It builds React nodes (never dangerouslySetInnerHTML), so user
// text can't inject markup.
//
// Note: underscores are intentionally left literal (not italic) so snake_case
// identifiers like `assignee_user_id` aren't mangled — italics use `*...*`.

const codeStyle: CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.88em', backgroundColor: 'var(--color-hover)', padding: '1px 5px',
  borderRadius: 4, wordBreak: 'break-word',
}
const linkStyle: CSSProperties = { color: 'var(--color-primary)', textDecoration: 'underline' }

// Only navigable, safe schemes become anchors; relative file paths (common in
// imported cards, e.g. [foo.ts](src/foo.ts)) render as plain label text.
function safeHref(url: string): string | null {
  const u = url.trim()
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null
}

const INLINE_PATTERNS: { type: 'code' | 'link' | 'bold' | 'italic'; re: RegExp }[] = [
  { type: 'code', re: /`([^`]+)`/ },
  { type: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
  { type: 'bold', re: /\*\*(.+?)\*\*/ },
  { type: 'italic', re: /\*([^*\n]+?)\*/ },
]

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let rest = text
  let n = 0
  let guard = 0
  while (rest.length > 0 && guard++ < 2000) {
    let best: { type: string; index: number; m: RegExpExecArray } | null = null
    for (const p of INLINE_PATTERNS) {
      const m = new RegExp(p.re.source).exec(rest)
      // Strict < keeps priority order on ties (e.g. bold wins over italic at the
      // same '*').
      if (m && (best === null || m.index < best.index)) best = { type: p.type, index: m.index, m }
    }
    if (!best) { nodes.push(rest); break }
    if (best.index > 0) nodes.push(rest.slice(0, best.index))
    const m = best.m
    const key = `${keyPrefix}-${n++}`
    switch (best.type) {
      case 'code':
        nodes.push(<code key={key} style={codeStyle}>{m[1]}</code>); break
      case 'link': {
        const href = safeHref(m[2])
        nodes.push(href
          ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{renderInline(m[1], key)}</a>
          : <span key={key}>{renderInline(m[1], key)}</span>)
        break
      }
      case 'bold':
        nodes.push(<strong key={key} style={{ fontWeight: 700 }}>{renderInline(m[1], key)}</strong>); break
      case 'italic':
        nodes.push(<em key={key}>{renderInline(m[1], key)}</em>); break
    }
    rest = rest.slice(best.index + m[0].length)
  }
  return nodes
}

// Inline content joined with <br/> for soft line breaks inside a block.
function inlineWithBreaks(lines: string[], keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${keyPrefix}-br-${i}`} />)
    out.push(...renderInline(line, `${keyPrefix}-l${i}`))
  })
  return out
}

const FENCE_RE = /^```/
const HEADING_RE = /^(#{1,3})\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/
const BULLET_RE = /^[-*]\s+(.*)$/
const NUMBERED_RE = /^\d+\.\s+(.*)$/

function isSpecial(line: string): boolean {
  const t = line.trimStart()
  return t === '' || FENCE_RE.test(t) || HEADING_RE.test(t) || QUOTE_RE.test(t) || BULLET_RE.test(t) || NUMBERED_RE.test(t)
}

export function MarkdownText({ text, style }: { text: string; style?: CSSProperties }) {
  if (!text || !text.trim()) return null

  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let b = 0

  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trimStart()

    // Fenced code block.
    if (FENCE_RE.test(trimmed)) {
      const code: string[] = []
      i++
      while (i < lines.length && !FENCE_RE.test(lines[i].trimStart())) { code.push(lines[i]); i++ }
      i++ // closing fence
      blocks.push(
        <pre key={`b${b++}`} style={{ margin: '6px 0', padding: '8px 10px', backgroundColor: 'var(--color-hover)', borderRadius: 6, overflowX: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.85em', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // Blank line — block separator.
    if (trimmed === '') { i++; continue }

    // Heading.
    const h = HEADING_RE.exec(trimmed)
    if (h) {
      const level = h[1].length
      const size = level === 1 ? '1.3em' : level === 2 ? '1.12em' : '1.02em'
      blocks.push(
        <div key={`b${b++}`} style={{ fontWeight: 700, fontSize: size, color: 'var(--color-text)', margin: '8px 0 4px' }}>
          {renderInline(h[2], `b${b}`)}
        </div>,
      )
      i++
      continue
    }

    // Blockquote (consecutive `>` lines).
    if (QUOTE_RE.test(trimmed)) {
      const q: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i].trimStart())) {
        q.push(QUOTE_RE.exec(lines[i].trimStart())![1])
        i++
      }
      blocks.push(
        <blockquote key={`b${b++}`} style={{ margin: '6px 0', paddingLeft: 10, borderLeft: '3px solid var(--color-border)', color: 'var(--color-text-muted)' }}>
          {inlineWithBreaks(q, `b${b}`)}
        </blockquote>,
      )
      continue
    }

    // Bullet list.
    if (BULLET_RE.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && BULLET_RE.test(lines[i].trimStart())) {
        items.push(BULLET_RE.exec(lines[i].trimStart())![1])
        i++
      }
      blocks.push(
        <ul key={`b${b++}`} style={{ margin: '6px 0', paddingLeft: 20 }}>
          {items.map((it, j) => <li key={j} style={{ margin: '2px 0' }}>{renderInline(it, `b${b}-${j}`)}</li>)}
        </ul>,
      )
      continue
    }

    // Numbered list.
    if (NUMBERED_RE.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && NUMBERED_RE.test(lines[i].trimStart())) {
        items.push(NUMBERED_RE.exec(lines[i].trimStart())![1])
        i++
      }
      blocks.push(
        <ol key={`b${b++}`} style={{ margin: '6px 0', paddingLeft: 22 }}>
          {items.map((it, j) => <li key={j} style={{ margin: '2px 0' }}>{renderInline(it, `b${b}-${j}`)}</li>)}
        </ol>,
      )
      continue
    }

    // Paragraph — gather consecutive plain lines.
    const para: string[] = [line]
    i++
    while (i < lines.length && !isSpecial(lines[i])) { para.push(lines[i]); i++ }
    blocks.push(
      <p key={`b${b++}`} style={{ margin: '4px 0' }}>{inlineWithBreaks(para, `b${b}`)}</p>,
    )
  }

  return <div style={{ wordBreak: 'break-word', ...style }}>{blocks}</div>
}
