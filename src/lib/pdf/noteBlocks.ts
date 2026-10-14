import { isProjectPriority, projectPriorityLabelKey } from '../priorities'
import type { TFn } from '../optimistic'
import type { ProjectCardSnapshot } from '../projectImport'
import { HARD_MAX_DEPTH } from '../../../supabase/functions/_domain/blocknote/spec'

// ARCH-005: os blocos do BlockNote (jsonb de note_contents) viram linhas de
// texto para o PDF. Só leitura de estrutura; nada de jsPDF aqui, para o teste
// não precisar de canvas.
// API-020: a leitura é tolerante (o conteúdo pode não ter passado pelo
// validador): o texto dos links e o content em texto entram, a tabela sai como
// linhas "a | b", título com nível fora de 1..6 vira parágrafo e os campos do
// snapshot do card passam por coerção. A guarda do NoteEditor usa a mesma
// extração para mostrar a nota que o editor não abre.

export type LineStyle = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'code' | 'blank'

export interface LineEntry {
  text: string
  style: LineStyle
}

/** Texto que a fonte padrão do jsPDF consegue desenhar: sem acentos e só ASCII. */
export function pdfSafe(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u0080-\uffff]/g, '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Texto do conteúdo em linha: texto solto, {type: 'text'} e o conteúdo dos links. */
export function inlineText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((item: unknown) => {
    if (typeof item === 'string') return item
    if (!isRecord(item)) return ''
    if (item.type === 'link') return inlineText(item.content)
    return typeof item.text === 'string' ? item.text : ''
  }).join('')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Texto de um campo do snapshot: texto fica; número e booleano viram texto; o resto some. */
function str(value: unknown): string {
  if (typeof value === 'string') return value
  return typeof value === 'number' || typeof value === 'boolean' ? String(value) : ''
}

// UX-011: os rótulos do PDF saem no idioma de quem exporta (`t` vem de quem
// chama; o jsPDF roda fora dos componentes).

/** Bloco do BlockNote como fica guardado no jsonb (só o que o PDF lê). */
export interface StoredBlock {
  type?: unknown
  content?: unknown
  props?: { level?: unknown; checked?: unknown; snapshot?: unknown }
  children?: unknown
}

// Serialises a `projectCard` block's snapshot into printable lines: title,
// board · column context, priority/due meta, description and checklist.
export function extractProjectCard(b: StoredBlock, t: TFn): LineEntry[] {
  // Snapshot gravado pelo próprio bloco (buildCardSnapshot); campos podem faltar
  // em blocos antigos, e uma nota escrita fora do app pode trazer outro tipo.
  const parsed = parseJson(typeof b.props?.snapshot === 'string' ? b.props.snapshot : '{}')
  const snap: Partial<Record<keyof ProjectCardSnapshot, unknown>> = isRecord(parsed) ? parsed : {}

  const lines: LineEntry[] = []
  lines.push({ text: str(snap.title) || t('projects_table_card'), style: 'h3' })

  const context = [str(snap.boardName), str(snap.columnName)].filter(Boolean).join(' · ')
  if (context) lines.push({ text: context, style: 'p' })

  const meta: string[] = []
  const priority = str(snap.priority)
  if (priority) {
    const label = isProjectPriority(priority) ? t(projectPriorityLabelKey(priority)) : priority
    meta.push(`${t('projects_priority')}: ${label}`)
  }
  const due = str(snap.dueDate)
  if (due) meta.push(`${t('projects_due_date')}: ${due}`)
  if (snap.completed === true) meta.push(t('pdf_card_completed'))
  if (meta.length) lines.push({ text: meta.join('  |  '), style: 'p' })

  const description = str(snap.description)
  if (description) lines.push({ text: description, style: 'p' })

  if (Array.isArray(snap.checklist)) {
    for (const item of snap.checklist as unknown[]) {
      const done = isRecord(item) && item.completed === true
      lines.push({ text: `${done ? '[x]' : '[ ]'} ${isRecord(item) ? str(item.text) : ''}`, style: 'li' })
    }
  }

  lines.push({ text: '', style: 'blank' })
  return lines
}

function cellText(cell: unknown): string {
  if (isRecord(cell) && cell.type === 'tableCell') return inlineText(cell.content)
  return inlineText(cell)
}

/** Tabela como linhas "a | b"; uma linha por linha da tabela. */
function tableLines(content: unknown): LineEntry[] {
  if (!isRecord(content) || !Array.isArray(content.rows)) return []
  const lines: LineEntry[] = []
  for (const row of content.rows as unknown[]) {
    if (!isRecord(row) || !Array.isArray(row.cells)) continue
    lines.push({ text: (row.cells as unknown[]).map(cellText).join(' | '), style: 'p' })
  }
  lines.push({ text: '', style: 'blank' })
  return lines
}

function headingStyle(level: unknown): LineStyle {
  // Fora de 1..6, o jsPDF lançava com o estilo 'h0'/'hNaN' e derrubava a exportação.
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 6) return 'p'
  return `h${Math.min(level, 3)}` as LineStyle
}

function blockLines(b: StoredBlock, t: TFn): LineEntry[] {
  const type = typeof b.type === 'string' ? b.type : 'paragraph'
  if (type === 'projectCard') return extractProjectCard(b, t)
  if (type === 'table') return tableLines(b.content)
  if (type === 'image' || type === 'diagram' || type === 'video' || type === 'audio' || type === 'file' || type === 'divider') return []
  const text = inlineText(b.content)
  if (type === 'heading') return [{ text, style: headingStyle(b.props?.level ?? 1) }]
  if (type === 'bulletListItem' || type === 'numberedListItem' || type === 'toggleListItem') return [{ text: `- ${text}`, style: 'li' }]
  if (type === 'checkListItem') return [{ text: `${b.props?.checked === true ? '[x]' : '[ ]'} ${text}`, style: 'li' }]
  if (type === 'codeBlock') return [{ text, style: 'code' }]
  return [text.trim() ? { text, style: 'p' } : { text: '', style: 'blank' }]
}

export function extractBlocks(blocks: unknown[], t: TFn, depth = 1): LineEntry[] {
  const lines: LineEntry[] = []
  for (const block of blocks) {
    const b: StoredBlock = isRecord(block) ? block : {}
    // Um bloco ilegível não derruba o resto da nota.
    try { lines.push(...blockLines(b, t)) } catch { /* bloco pulado */ }
    // Teto de profundidade: a recursão nunca estoura a pilha.
    if (Array.isArray(b.children) && b.children.length > 0 && depth < HARD_MAX_DEPTH) {
      lines.push(...extractBlocks(b.children as unknown[], t, depth + 1))
    }
  }
  return lines
}
