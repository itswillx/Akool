// API-020: o bloco diagram das notas (src/components/diagramBlockConfig.ts e
// DiagramBlockView.tsx). As props guardam JSON em texto, no formato que o
// próprio bloco grava. Tudo aqui é contrato: o bloco já tolera `elements`
// ilegível (REL-004, src/lib/diagramProps.ts) e `appState` ilegível vira a
// vista padrão.
//
// Até o API-054 (_domain/excalidraw.ts), só entram os elementos que o app cria;
// image, embeddable e iframe ficam de fora (o app nem grava os files, e um
// iframe carregaria conteúdo de terceiros ao abrir a nota). Quando o
// excalidraw.ts existir, este arquivo delega a ele: um validador de Excalidraw só.

import { compileSchema, type JsonSchema, type SchemaIssue } from '../../_api/schema.ts'

/** Os tipos de elemento das ferramentas do DiagramCanvas (tools.image desligado). */
export const DIAGRAM_ELEMENT_TYPES = ['rectangle', 'ellipse', 'diamond', 'arrow', 'line', 'freedraw', 'text', 'frame'] as const

export const MAX_DIAGRAM_ZOOM = 30

const ELEMENTS_SCHEMA: JsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'type'],
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 200 },
      type: { type: 'string', enum: DIAGRAM_ELEMENT_TYPES },
    },
  },
}

// O que o DiagramBlockView grava do appState: fundo, zoom e rolagem.
const APP_STATE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    viewBackgroundColor: { type: 'string', maxLength: 64 },
    zoom: {
      type: 'object',
      additionalProperties: false,
      required: ['value'],
      // (0, 30]: o subconjunto não tem exclusiveMinimum; o zero sai à parte.
      properties: { value: { type: 'number', minimum: 0, maximum: MAX_DIAGRAM_ZOOM } },
    },
    scrollX: { type: 'number' },
    scrollY: { type: 'number' },
  },
}

const checkElements = compileSchema(ELEMENTS_SCHEMA)
const checkAppState = compileSchema(APP_STATE_SCHEMA)

/** Problemas de uma prop do diagrama, com o caminho dentro do JSON dela. */
export interface DiagramIssue extends SchemaIssue {
  prop: 'elements' | 'appState'
}

function parsed(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch {
    return { ok: false }
  }
}

/** Confere `elements` e `appState` (texto JSON). O tipo das props e o `collapsed` ficam no schema das props. */
export function diagramIssues(props: Record<string, unknown>): DiagramIssue[] {
  const issues: DiagramIssue[] = []
  if (typeof props.elements === 'string') {
    const elements = parsed(props.elements)
    if (!elements.ok) issues.push({ prop: 'elements', path: '', keyword: 'json', message: 'JSON inválido' })
    else {
      const result = checkElements(elements.value)
      if (!result.ok) for (const issue of result.issues) issues.push({ prop: 'elements', ...issue })
    }
  }
  if (typeof props.appState === 'string') {
    const appState = parsed(props.appState)
    if (!appState.ok) issues.push({ prop: 'appState', path: '', keyword: 'json', message: 'JSON inválido' })
    else {
      const result = checkAppState(appState.value)
      if (!result.ok) for (const issue of result.issues) issues.push({ prop: 'appState', ...issue })
      const zoom = (appState.value as { zoom?: { value?: unknown } } | null)?.zoom
      if (result.ok && zoom && zoom.value === 0) issues.push({ prop: 'appState', path: '/zoom/value', keyword: 'minimum', message: 'Deve ser maior que 0' })
    }
  }
  return issues
}
