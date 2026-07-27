import type { StudyCheckpoint, StudyQuizAnswer, StudyQuizQuestion, StudyResource } from '../types'

// Parses the "Estudo" markdown contract produced from the prompt in
// studyPrompt.ts (STUDY_MD_CONTRACT). Deliberately tolerant to the ways
// Claude output tends to drift: code fences around the document, CRLF,
// ##/### card headings with optional numbering, metadata as table or list,
// accented/uppercased field names, plain bullets instead of checkboxes.
// Never throws — problems become warnings.

export interface ParsedStudyCard {
  title: string
  description: string
  // "Por que agora" — why this roadmap step follows the previous one ('' when absent).
  rationale: string
  checkpoints: StudyCheckpoint[]
  resources: StudyResource[]
  quiz: StudyQuizQuestion[]
}

export interface ParsedStudyTopicMeta {
  title: string | null
  area: string | null
  level: string | null
  objective: string | null
}

export interface StudyParseResult {
  topic: ParsedStudyTopicMeta
  cards: ParsedStudyCard[]
  warnings: string[]
}

const TOPIC_HEADING_RE = /^#\s+\*{0,2}Estudo\s*[:—–-]\s*(.+?)\*{0,2}\s*$/i
const CARD_HEADING_RE = /^#{2,3}\s+\*{0,2}Card(?:\s+\d+)?\s*[:—–-]\s*(.+?)\*{0,2}\s*$/i
const TABLE_ROW_RE = /^\|\s*\*{0,2}([^|*]+?)\*{0,2}\s*\|\s*(.+?)\s*\|\s*$/
// Accepts "- **Área:** valor", "- **Área**: valor" and "- Área: valor".
const LIST_META_RE = /^[-*]\s+\*{0,2}([^:*]+?)(?::\*{0,2}|\*{0,2}\s*:)\s*(.+)$/
const CHECKPOINTS_MARKER_RE = /^\*{0,2}(?:Pontos de estudo|Checkpoints)\s*:?\s*\*{0,2}\s*:?\s*$/i
const RESOURCES_MARKER_RE = /^\*{0,2}Recursos\s*:?\s*\*{0,2}\s*:?\s*$/i
// "**Por que agora:** texto", "Por quê agora: texto", "Porque agora: texto",
// "- **Por que agora**: texto" — bold/colon/bullet/accent tolerant.
const RATIONALE_LINE_RE = /^(?:[-*]\s+)?\*{0,2}Por\s*qu[eê]\s+agora\s*:?\s*\*{0,2}\s*:?\s*(.+)$/i
const CHECK_ITEM_RE = /^[-*]\s+\[([ xX])\]\s+(.+)$/
const PLAIN_BULLET_RE = /^[-*]\s+(.+)$/
const RESOURCE_LINK_RE = /^[-*]\s+\[([^\]]+)\]\(\s*<?(https?:\/\/[^)\s>]+)>?\s*\)/
const RESOURCE_BARE_RE = /^[-*]\s+<?(https?:\/\/[^\s>]+)>?\s*(?:[—–-]\s*(.+))?$/
// "**Quiz:**", "Quiz (Certo ou Errado):", "### Quiz" — heading/bold/paren tolerant.
const QUIZ_MARKER_RE = /^#{0,4}\s*\*{0,2}Quiz(?:\s*\([^)]*\))?\s*:?\s*\*{0,2}\s*:?\s*$/i
// "- [C] afirmação" / "- [E] ..." plus common drift: [Certo]/[Errado]/[V]/[F].
// Requires a space after "]" so it never matches a "[titulo](url)" resource link.
const QUIZ_ITEM_RE = /^[-*]\s+\[\s*(C|E|V|F|Certo|Errado|Verdadeiro|Falso)\s*\]\s+(.+)$/i
// Fallback: "- afirmação (Certo)" / "- afirmação — Errado" at end of line.
const QUIZ_ITEM_SUFFIX_RE = /^[-*]\s+(.+?)\s*(?:[—–-]\s*|\(\s*)(Certo|Errado|Verdadeiro|Falso)\s*\)?\s*$/i
// "- [Q] pergunta" — opens a multiple-choice question; its alternatives
// follow as checkbox sub-items ("- [ ] opção" / "- [x] correta").
const QUIZ_CHOICE_STEM_RE = /^[-*]\s+\[\s*Q\s*\]\s+(.+)$/i
const QUIZ_OPTION_RE = /^[-*]\s+\[([ xX])\]\s+(.+)$/
// "Justificativa: ...", "> Explicação: ...", "**Justificativa:** ..." —
// attaches to the preceding quiz question.
const QUIZ_EXPLANATION_RE = /^(?:>\s*)?\*{0,2}(?:Justificativa|Explica[cç][aã]o)\s*:?\s*\*{0,2}\s*:?\s*(.+)$/i

function normalizeQuizAnswer(raw: string): StudyQuizAnswer {
  return /^(c|v|certo|verdadeiro)$/i.test(raw.trim()) ? 'certo' : 'errado'
}

function normalizeFieldName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\*/g, '')
    .trim()
    .toLowerCase()
}

// Strips a single pair of code fences wrapping the whole document
// (Claude often returns ```markdown ... ```).
function stripFences(source: string): string {
  const lines = source.split('\n')
  let start = 0
  while (start < lines.length && !lines[start].trim()) start++
  let end = lines.length - 1
  while (end >= 0 && !lines[end].trim()) end--
  if (start < end && /^```/.test(lines[start].trim()) && /^```\s*$/.test(lines[end].trim())) {
    return lines.slice(start + 1, end).join('\n')
  }
  return source
}

function parsePreamble(lines: string[], warnings: string[]): ParsedStudyTopicMeta {
  const meta: ParsedStudyTopicMeta = { title: null, area: null, level: null, objective: null }

  for (const line of lines) {
    const titleMatch = line.match(TOPIC_HEADING_RE)
    if (titleMatch) {
      meta.title = titleMatch[1].trim()
      continue
    }
    const rowMatch = line.match(TABLE_ROW_RE) ?? line.match(LIST_META_RE)
    if (!rowMatch) continue
    const field = normalizeFieldName(rowMatch[1])
    if (field === 'campo' || field.startsWith('---')) continue
    const value = rowMatch[2].replace(/\*\*/g, '').trim()
    if (!value || /^<.*>$/.test(value)) continue
    if (field === 'area') meta.area = value
    else if (field === 'nivel') meta.level = value
    else if (field === 'objetivo' || field === 'foco') meta.objective = value
  }

  if (!meta.title) {
    warnings.push('Título do estudo não encontrado (esperado "# Estudo: ...")')
  }
  if (!meta.area && !meta.level && !meta.objective) {
    warnings.push('Metadados do estudo não encontrados (Área/Nível/Objetivo)')
  }
  return meta
}

function parseCardBlock(title: string, lines: string[], warnings: string[]): ParsedStudyCard {
  const descriptionLines: string[] = []
  const checkpoints: StudyCheckpoint[] = []
  const resources: StudyResource[] = []
  const quiz: StudyQuizQuestion[] = []
  let rationale = ''
  let sawQuizMarker = false
  let section: 'description' | 'checkpoints' | 'resources' | 'quiz' = 'description'

  // Multiple-choice question being assembled ("- [Q] stem" seen, collecting
  // its "- [ ]"/"- [x]" alternatives until the next question or section).
  let pendingChoice: { statement: string; options: string[]; correctIndex: number | null; explanation?: string } | null = null

  const flushPendingChoice = () => {
    if (!pendingChoice) return
    const { statement, options, correctIndex, explanation } = pendingChoice
    pendingChoice = null
    if (options.length < 2) {
      warnings.push(`"${title}": pergunta de múltipla escolha ignorada (menos de 2 alternativas): ${statement}`)
      return
    }
    if (correctIndex === null) {
      warnings.push(`"${title}": pergunta de múltipla escolha ignorada (nenhuma alternativa marcada com [x]): ${statement}`)
      return
    }
    quiz.push({
      kind: 'choice',
      id: crypto.randomUUID(),
      statement,
      options,
      answer: correctIndex,
      userAnswer: null,
      ...(explanation ? { explanation } : {}),
    })
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (CHECKPOINTS_MARKER_RE.test(line)) { flushPendingChoice(); section = 'checkpoints'; continue }
    if (RESOURCES_MARKER_RE.test(line)) { flushPendingChoice(); section = 'resources'; continue }
    if (QUIZ_MARKER_RE.test(line)) { section = 'quiz'; sawQuizMarker = true; continue }

    if (section === 'description') {
      // First "Por que agora" line becomes the rationale (and leaves the
      // description); later matches stay in the description verbatim. Only
      // checked here, so a "Por que agora..." bullet under Pontos de estudo
      // is still a checkpoint. Absent line → no warning (optional field).
      const rationaleMatch = line.match(RATIONALE_LINE_RE)
      if (rationaleMatch && !rationale) {
        rationale = rationaleMatch[1].replace(/\*+$/, '').trim()
        continue
      }
      descriptionLines.push(rawLine)
      continue
    }

    if (!line) continue

    if (section === 'checkpoints') {
      const checkMatch = line.match(CHECK_ITEM_RE)
      if (checkMatch) {
        checkpoints.push({ id: crypto.randomUUID(), text: checkMatch[2].trim(), completed: checkMatch[1].toLowerCase() === 'x' })
        continue
      }
      const plainMatch = line.match(PLAIN_BULLET_RE)
      if (plainMatch) {
        checkpoints.push({ id: crypto.randomUUID(), text: plainMatch[1].trim(), completed: false })
      }
      continue
    }

    if (section === 'quiz') {
      // Order matters: explanations are plain lines; "[Q]" must win over the
      // C/E item regex; "[ ]/[x]" options must be claimed before the
      // suffix fallback can misread them.
      const explanationMatch = line.match(QUIZ_EXPLANATION_RE)
      if (explanationMatch) {
        const text = explanationMatch[1].trim()
        if (pendingChoice) pendingChoice.explanation = text
        else if (quiz.length > 0) quiz[quiz.length - 1].explanation = text
        continue
      }
      const stemMatch = line.match(QUIZ_CHOICE_STEM_RE)
      if (stemMatch) {
        flushPendingChoice()
        pendingChoice = { statement: stemMatch[1].trim(), options: [], correctIndex: null }
        continue
      }
      const booleanMatch = line.match(QUIZ_ITEM_RE)
      if (booleanMatch) {
        flushPendingChoice()
        quiz.push({
          id: crypto.randomUUID(),
          statement: booleanMatch[2].trim(),
          answer: normalizeQuizAnswer(booleanMatch[1]),
          userAnswer: null,
        })
        continue
      }
      const optionMatch = line.match(QUIZ_OPTION_RE)
      if (optionMatch) {
        if (!pendingChoice) {
          warnings.push(`"${title}": alternativa de quiz fora de uma pergunta [Q], ignorada: ${line}`)
          continue
        }
        if (/x/i.test(optionMatch[1])) {
          if (pendingChoice.correctIndex !== null) {
            warnings.push(`"${title}": mais de uma alternativa marcada com [x] em "${pendingChoice.statement}" — a primeira foi mantida`)
          } else {
            pendingChoice.correctIndex = pendingChoice.options.length
          }
        }
        pendingChoice.options.push(optionMatch[2].trim())
        continue
      }
      const suffixMatch = line.match(QUIZ_ITEM_SUFFIX_RE)
      if (suffixMatch) {
        flushPendingChoice()
        quiz.push({
          id: crypto.randomUUID(),
          statement: suffixMatch[1].trim(),
          answer: normalizeQuizAnswer(suffixMatch[2]),
          userAnswer: null,
        })
        continue
      }
      if (PLAIN_BULLET_RE.test(line)) {
        warnings.push(`"${title}": item de quiz ignorado (sem gabarito [C]/[E]): ${line}`)
      }
      continue
    }

    // section === 'resources'
    const linkMatch = line.match(RESOURCE_LINK_RE)
    if (linkMatch) {
      resources.push({ id: crypto.randomUUID(), title: linkMatch[1].trim(), url: linkMatch[2] })
      continue
    }
    const bareMatch = line.match(RESOURCE_BARE_RE)
    if (bareMatch) {
      resources.push({ id: crypto.randomUUID(), title: bareMatch[2]?.trim() || bareMatch[1], url: bareMatch[1] })
      continue
    }
    // A "- [C] ..." or "- [Q] ..." item right after the resources means the
    // model forgot the "Quiz:" marker — recover by switching sections (once,
    // with a warning). Bare checkboxes are NOT a trigger: stray "- [ ]" lines
    // among resources stay ignored.
    const strayQuizMatch = line.match(QUIZ_ITEM_RE)
    const strayStemMatch = strayQuizMatch ? null : line.match(QUIZ_CHOICE_STEM_RE)
    if (strayQuizMatch || strayStemMatch) {
      section = 'quiz'
      if (!sawQuizMarker) {
        sawQuizMarker = true
        warnings.push(`"${title}": quiz encontrado sem o marcador "Quiz:"`)
      }
      if (strayQuizMatch) {
        quiz.push({
          id: crypto.randomUUID(),
          statement: strayQuizMatch[2].trim(),
          answer: normalizeQuizAnswer(strayQuizMatch[1]),
          userAnswer: null,
        })
      } else if (strayStemMatch) {
        pendingChoice = { statement: strayStemMatch[1].trim(), options: [], correctIndex: null }
      }
      continue
    }
    if (PLAIN_BULLET_RE.test(line)) {
      warnings.push(`Recurso ignorado (sem URL http/https): ${line}`)
    }
  }

  flushPendingChoice()

  const description = descriptionLines.join('\n').trim()

  if (checkpoints.length === 0) {
    warnings.push(`"${title}": nenhum ponto de estudo encontrado`)
  }
  if (resources.length === 0) {
    warnings.push(`"${title}": nenhum recurso encontrado`)
  }
  // A quiz section is optional — only warn when the marker was there but no
  // valid item followed it.
  if (sawQuizMarker && quiz.length === 0) {
    warnings.push(`"${title}": seção Quiz sem perguntas válidas`)
  }

  return { title, description, rationale, checkpoints, resources, quiz }
}

export function parseStudyMarkdown(source: string): StudyParseResult {
  const warnings: string[] = []
  const text = stripFences(source.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
  const lines = text.split('\n')

  const cardStarts: { index: number; title: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(CARD_HEADING_RE)
    if (match) cardStarts.push({ index: i, title: match[1].trim() })
  }

  const preambleEnd = cardStarts.length > 0 ? cardStarts[0].index : lines.length
  const topic = parsePreamble(lines.slice(0, preambleEnd), warnings)

  const cards: ParsedStudyCard[] = []
  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i].index + 1
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1].index : lines.length
    cards.push(parseCardBlock(cardStarts[i].title, lines.slice(start, end), warnings))
  }

  if (cards.length === 0) {
    warnings.push('Nenhum card encontrado no arquivo')
  }

  return { topic, cards, warnings }
}
