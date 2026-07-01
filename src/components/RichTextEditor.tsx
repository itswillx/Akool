import { useEffect, useRef } from 'react'
import { Bold, Italic, Heading, List, ListOrdered, Code, Link } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import type { TranslationKey } from '../i18n/translations'
import { markdownToHtml, htmlToMarkdown } from '../lib/markdownHtml'
import { normalizeLinkUrl } from '../lib/cardLinks'

type ToolId = 'bold' | 'italic' | 'heading' | 'bullet' | 'numbered' | 'code' | 'link'

// Pure data (no ref access) so the toolbar can be mapped during render.
const TOOLS: { id: ToolId; Icon: typeof Bold; labelKey: TranslationKey }[] = [
  { id: 'bold', Icon: Bold, labelKey: 'projects_md_bold' },
  { id: 'italic', Icon: Italic, labelKey: 'projects_md_italic' },
  { id: 'heading', Icon: Heading, labelKey: 'projects_md_heading' },
  { id: 'bullet', Icon: List, labelKey: 'projects_md_bullet' },
  { id: 'numbered', Icon: ListOrdered, labelKey: 'projects_md_numbered' },
  { id: 'code', Icon: Code, labelKey: 'projects_md_code' },
  { id: 'link', Icon: Link, labelKey: 'projects_md_link' },
]

// Visual (WYSIWYG) editor for a card description. It works on HTML internally but
// keeps the source of truth as Markdown: it seeds itself from `markdown` on mount
// and emits Markdown (via htmlToMarkdown) on every edit, so display, search, PDF
// and persistence stay unchanged. execCommand is deprecated but is the most
// reliable way to get native toggle behaviour without a heavy editor dependency.
export function RichTextEditor({ markdown, onChange, onBlur, autoFocus, minHeight = 220, disabled }: {
  markdown: string
  onChange: (md: string) => void
  onBlur?: () => void
  autoFocus?: boolean
  minHeight?: number
  disabled?: boolean
}) {
  const { t } = useLanguage()
  const ref = useRef<HTMLDivElement>(null)

  // Seed the editor once. We never re-inject innerHTML while typing — React leaves
  // the contentEditable's DOM alone (no JSX children), so the caret is preserved.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = markdownToHtml(markdown)
    if (autoFocus) {
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const emit = () => {
    const el = ref.current
    if (el) onChange(htmlToMarkdown(el))
  }

  const exec = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value)
    ref.current?.focus()
    emit()
  }

  const toggleHeading = () => {
    const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase()
    exec('formatBlock', cur === 'h3' ? 'P' : 'H3')
  }

  // Inline code has no execCommand: wrap the selection in <code>, or unwrap when
  // the selection already sits inside one.
  const toggleInlineCode = () => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    let node: Node | null = range.commonAncestorContainer
    let codeEl: HTMLElement | null = null
    while (node && node !== ref.current) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === 'CODE') { codeEl = node as HTMLElement; break }
      node = node.parentNode
    }
    if (codeEl) {
      const parent = codeEl.parentNode
      while (codeEl.firstChild) parent?.insertBefore(codeEl.firstChild, codeEl)
      parent?.removeChild(codeEl)
    } else if (!range.collapsed) {
      const code = document.createElement('code')
      code.appendChild(range.extractContents())
      range.insertNode(code)
    }
    ref.current?.focus()
    emit()
  }

  const insertLink = () => {
    const sel = window.getSelection()
    const raw = window.prompt(`${t('projects_md_link')} (URL):`, 'https://')
    if (!raw) return
    // Validate/normalize the URL (blocks javascript:, data:, etc.) before it is
    // handed to execCommand — both createLink and insertHTML would otherwise
    // accept a raw, unsafe URL.
    const url = normalizeLinkUrl(raw)
    if (!url) return
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      exec('createLink', url)
    } else {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      exec('insertHTML', `<a href="${esc(url)}">${esc(url)}</a>`)
    }
  }

  const runTool = (id: ToolId) => {
    switch (id) {
      case 'bold': return exec('bold')
      case 'italic': return exec('italic')
      case 'heading': return toggleHeading()
      case 'bullet': return exec('insertUnorderedList')
      case 'numbered': return exec('insertOrderedList')
      case 'code': return toggleInlineCode()
      case 'link': return insertLink()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    emit()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 2, padding: 4, border: '1px solid var(--color-border)', borderBottom: 'none', borderRadius: '6px 6px 0 0', backgroundColor: 'var(--color-bg-secondary)', flexWrap: 'wrap' }}>
        {TOOLS.map(({ id, Icon, labelKey }) => {
          const label = t(labelKey)
          // preventDefault on mousedown keeps the editor selection while clicking.
          return (
            <button key={id} type="button" title={label} aria-label={label} disabled={disabled}
              onMouseDown={e => e.preventDefault()} onClick={() => runTool(id)}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 28, border: 'none', borderRadius: 5, background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
              <Icon size={15} />
            </button>
          )
        })}
      </div>
      <div
        ref={ref}
        className="rich-editor"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={t('projects_card_description_placeholder')}
        onInput={emit}
        onBlur={onBlur}
        onPaste={handlePaste}
        style={{
          border: '1px solid var(--color-border)', borderRadius: '0 0 6px 6px',
          padding: '10px 12px', minHeight, maxHeight: 600, overflowY: 'auto',
          fontSize: 14, lineHeight: 1.5, color: 'var(--color-text)', backgroundColor: 'var(--color-bg)',
          outline: 'none', boxSizing: 'border-box', wordBreak: 'break-word',
        }}
      />
    </div>
  )
}
