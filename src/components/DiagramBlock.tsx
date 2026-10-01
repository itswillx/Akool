import { useState, useRef, useCallback, lazy, Suspense } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
// Só tipos: somem no build e não puxam o chunk do Excalidraw.
import type { AppState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { parseDiagramProps } from '../lib/diagramProps'
import { reportError } from '../lib/observability'

// O spec do bloco precisa estar no schema do BlockNote de forma síncrona
// (NoteEditor monta o schema em escopo de módulo), mas o canvas do Excalidraw não:
// ele vive em `DiagramCanvas` e só é buscado quando um diagrama expandido renderiza.
// O react-refresh reclama porque este módulo exporta um block spec, não um componente —
// mas o lazy() precisa ficar em escopo de módulo para não remontar o canvas a cada render.
// eslint-disable-next-line react-refresh/only-export-components
const DiagramCanvas = lazy(() => import('./DiagramCanvas'))

const CANVAS_HEIGHT = 340

// Um aviso por bloco na sessão: o render do bloco roda a cada mudança do editor.
const reportedUnreadable = new Set<string>()
function reportUnreadableDiagram(blockId: string) {
  if (reportedUnreadable.has(blockId)) return
  reportedUnreadable.add(blockId)
  reportError(new Error('diagram block: unreadable elements'), { blockId })
}

export const DiagramBlock = createReactBlockSpec(
  {
    type: 'diagram' as const,
    propSchema: {
      elements: {
        default: '[]',
      },
      appState: {
        default: '{}',
      },
      collapsed: {
        default: 'false',
      },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => {
      const { t } = useLanguage()
      const isEditable = editor.isEditable
      const collapsed = block.props.collapsed === 'true'
      const [localCollapsed, setLocalCollapsed] = useState(collapsed)
      const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

      const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => {
          editor.updateBlock(block, {
            type: 'diagram',
            props: {
              elements: JSON.stringify(elements),
              appState: JSON.stringify({
                viewBackgroundColor: appState.viewBackgroundColor,
                zoom: appState.zoom,
                scrollX: appState.scrollX,
                scrollY: appState.scrollY,
              }),
            },
          })
        }, 800)
      }, [block, editor])

      const toggleCollapsed = () => {
        const next = !localCollapsed
        setLocalCollapsed(next)
        editor.updateBlock(block, {
          type: 'diagram',
          props: { collapsed: String(next) },
        })
      }

      // REL-004: `elements` ilegível não monta o canvas. O Excalidraw chama
      // onChange ao montar, e o bloco gravaria um diagrama vazio por cima do
      // dado salvo; assim ele fica intacto para recuperar.
      const diagram = parseDiagramProps(block.props.elements, block.props.appState)
      if (!diagram.ok) reportUnreadableDiagram(block.id)

      return (
        <div className="my-3 rounded-xl border border-[color:var(--color-border)] overflow-hidden bg-[color:var(--color-bg)]" contentEditable={false}>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[color:var(--color-bg-secondary)] border-b border-[color:var(--color-border)]">
            <Pencil size={13} className="text-[color:var(--color-icon)]" />
            <span className="text-xs font-medium text-[color:var(--color-text-muted)]">{t('diagram_label')}</span>
            <div className="flex-1" />
            <button
              onClick={toggleCollapsed}
              className="flex items-center gap-1 text-xs text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
            >
              {localCollapsed ? <><ChevronDown size={12} /> {t('diagram_expand')}</> : <><ChevronUp size={12} /> {t('diagram_collapse')}</>}
            </button>
          </div>

          {/* Canvas */}
          {!localCollapsed && !diagram.ok && (
            <div role="alert" style={{ padding: '14px 16px', fontSize: 13, color: 'var(--color-text-muted)' }}>
              {t('diagram_unreadable')}
            </div>
          )}
          {!localCollapsed && diagram.ok && (
            <div style={{ height: CANVAS_HEIGHT, position: 'relative' }}>
              <Suspense
                fallback={
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
                    {t('diagram_loading')}
                  </div>
                }
              >
                <DiagramCanvas
                  // JSON gravado por este bloco, no formato do próprio Excalidraw.
                  elements={diagram.elements as ExcalidrawElement[]}
                  appState={diagram.appState}
                  onChange={isEditable ? handleChange : undefined}
                />
              </Suspense>
            </div>
          )}
        </div>
      )
    },
  }
)
