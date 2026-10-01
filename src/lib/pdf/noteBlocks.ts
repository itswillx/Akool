import { isProjectPriority, projectPriorityLabelKey } from '../priorities'
import type { TFn } from '../optimistic'
import type { ProjectCardSnapshot } from '../projectImport'

// ARCH-005: os blocos do BlockNote (jsonb de note_contents) viram linhas de
// texto para o PDF. Só leitura de estrutura; nada de jsPDF aqui, para o teste
// não precisar de canvas.

export type LineStyle = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'code' | 'blank'

export interface LineEntry {
  text: string
  style: LineStyle
}

/** Texto que a fonte padrão do jsPDF consegue desenhar: sem acentos e só ASCII. */
export function pdfSafe(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7F]/g, '')
}

export function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content.map((c: { text?: unknown } | null) => (typeof c?.text === 'string' ? c.text : '')).join('')
}

// UX-011: os rótulos do PDF saem no idioma de quem exporta (`t` vem de quem
// chama; o jsPDF roda fora dos componentes).

/** Bloco do BlockNote como fica guardado no jsonb (só o que o PDF lê). */
export interface StoredBlock {
  type?: string
  content?: unknown
  props?: { level?: number; checked?: boolean; snapshot?: string }
  children?: unknown[]
}

// Serialises a `projectCard` block's snapshot into printable lines: title,
// board · column context, priority/due meta, description and checklist.
export function extractProjectCard(b: StoredBlock, t: TFn): LineEntry[] {
  // Snapshot gravado pelo próprio bloco (buildCardSnapshot); campos podem faltar em blocos antigos.
  let snap: Partial<ProjectCardSnapshot> = {}
  try { snap = JSON.parse(b.props?.snapshot || '{}') } catch { snap = {} }

  const lines: LineEntry[] = []
  lines.push({ text: snap.title || t('projects_table_card'), style: 'h3' })

  const context = [snap.boardName, snap.columnName].filter(Boolean).join(' · ')
  if (context) lines.push({ text: context, style: 'p' })

  const meta: string[] = []
  if (snap.priority) {
    const label = isProjectPriority(snap.priority) ? t(projectPriorityLabelKey(snap.priority)) : snap.priority
    meta.push(`${t('projects_priority')}: ${label}`)
  }
  if (snap.dueDate) meta.push(`${t('projects_due_date')}: ${snap.dueDate}`)
  if (snap.completed) meta.push(t('pdf_card_completed'))
  if (meta.length) lines.push({ text: meta.join('  |  '), style: 'p' })

  if (snap.description) lines.push({ text: snap.description, style: 'p' })

  if (Array.isArray(snap.checklist)) {
    for (const item of snap.checklist) {
      lines.push({ text: `${item?.completed ? '[x]' : '[ ]'} ${item?.text ?? ''}`, style: 'li' })
    }
  }

  lines.push({ text: '', style: 'blank' })
  return lines
}

export function extractBlocks(blocks: unknown[], t: TFn): LineEntry[] {
  const lines: LineEntry[] = []
  for (const block of blocks) {
    const b = (block ?? {}) as StoredBlock
    const type: string = b.type ?? 'paragraph'
    const text = inlineText(b.content)

    if (type === 'heading') {
      const level = b.props?.level ?? 1
      lines.push({ text, style: (`h${Math.min(level, 3)}`) as LineStyle })
    } else if (type === 'bulletListItem' || type === 'numberedListItem') {
      lines.push({ text: `- ${text}`, style: 'li' })
    } else if (type === 'checkListItem') {
      const checked = b.props?.checked ? '[x]' : '[ ]'
      lines.push({ text: `${checked} ${text}`, style: 'li' })
    } else if (type === 'codeBlock') {
      lines.push({ text, style: 'code' })
    } else if (type === 'projectCard') {
      lines.push(...extractProjectCard(b, t))
    } else if (type === 'image' || type === 'diagram') {
      // skip unsupported block types
    } else {
      if (text.trim()) lines.push({ text, style: 'p' })
      else lines.push({ text: '', style: 'blank' })
    }

    if (Array.isArray(b.children) && b.children.length > 0) {
      lines.push(...extractBlocks(b.children, t))
    }
  }
  return lines
}
