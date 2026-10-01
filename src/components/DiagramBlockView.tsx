import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react'
import type { ReactCustomBlockRenderProps } from '@blocknote/react'
import { diagramBlockConfig } from './diagramBlockConfig'
// Só tipos: somem no build e não puxam o chunk do Excalidraw.
import type { AppState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { Pencil, ChevronDown, ChevronUp } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { flushPendingDiagramSave, parseDiagramProps } from '../lib/diagramProps'
import { reportError } from '../lib/observability'

// O spec do bloco (DiagramBlock.tsx) precisa estar no schema do BlockNote de
// forma síncrona, mas o canvas do Excalidraw não: ele vive em `DiagramCanvas` e
// só é buscado quando um diagrama expandido renderiza. O lazy() fica em escopo
// de módulo para não remontar o canvas a cada render.
const DiagramCanvas = lazy(() => import('./DiagramCanvas'))

const CANVAS_HEIGHT = 340

// Um aviso por bloco na sessão: o render do bloco roda a cada mudança do editor.
const reportedUnreadable = new Set<string>()
function reportUnreadableDiagram(blockId: string) {
  if (reportedUnreadable.has(blockId)) return
  reportedUnreadable.add(blockId)
  reportError(new Error('diagram block: unreadable elements'), { blockId })
}

// UX-013: o render é um componente de verdade (antes era uma arrow em `render`,
// e os hooks ali ficavam fora das regras de hooks do lint).
export default function DiagramBlockView({ block, editor }: ReactCustomBlockRenderProps<typeof diagramBlockConfig>) {
      const { t } = useLanguage()
      const isEditable = editor.isEditable
      const collapsed = block.props.collapsed === 'true'
      const [localCollapsed, setLocalCollapsed] = useState(collapsed)
      const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
      const pendingProps = useRef<{ elements: string; appState: string } | null>(null)

      const saveNow = useCallback((props: { elements: string; appState: string }) => {
        pendingProps.current = null
        editor.updateBlock(block, { type: 'diagram', props })
      }, [block, editor])

      const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        pendingProps.current = {
          elements: JSON.stringify(elements),
          appState: JSON.stringify({
            viewBackgroundColor: appState.viewBackgroundColor,
            zoom: appState.zoom,
            scrollX: appState.scrollX,
            scrollY: appState.scrollY,
          }),
        }
        saveTimer.current = setTimeout(() => {
          saveTimer.current = null
          if (pendingProps.current) saveNow(pendingProps.current)
        }, 800)
      }, [saveNow])

      // UX-013: ao desmontar (colapsar, trocar de página, apagar o bloco), o
      // timer não pode disparar depois: grava na hora o que estiver pendente,
      // se o bloco ainda existir; se foi removido, descarta.
      useEffect(() => () => {
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = null
        flushPendingDiagramSave({
          pending: pendingProps.current,
          blockExists: () => editor.getBlock(block.id) !== undefined,
          save: saveNow,
        })
      }, [block.id, editor, saveNow])

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
}
