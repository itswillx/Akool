import { useState, useRef, useCallback } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { Pencil, ChevronDown, ChevronUp } from 'lucide-react'

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
      const isEditable = editor.isEditable
      const collapsed = block.props.collapsed === 'true'
      const [localCollapsed, setLocalCollapsed] = useState(collapsed)
      const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handleChange = useCallback((elements: readonly any[], appState: any) => {
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

      let elements = []
      let appStateData = {}
      try { elements = JSON.parse(block.props.elements || '[]') } catch {}
      try { appStateData = JSON.parse(block.props.appState || '{}') } catch {}

      return (
        <div className="my-3 rounded-xl border border-[#e9e9e7] overflow-hidden bg-white" contentEditable={false}>
          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-2 bg-[#f7f6f3] border-b border-[#e9e9e7]">
            <Pencil size={13} className="text-[#9b9a97]" />
            <span className="text-xs font-medium text-[#9b9a97]">Diagram</span>
            <div className="flex-1" />
            <button
              onClick={toggleCollapsed}
              className="flex items-center gap-1 text-xs text-[#9b9a97] hover:text-[#37352f] transition-colors"
            >
              {localCollapsed ? <><ChevronDown size={12} /> Expand</> : <><ChevronUp size={12} /> Collapse</>}
            </button>
          </div>

          {/* Canvas */}
          {!localCollapsed && (
            <div style={{ height: 340, position: 'relative' }}>
              <Excalidraw
                initialData={{
                  elements,
                  appState: { ...appStateData, collaborators: new Map() },
                }}
                onChange={isEditable ? handleChange : undefined}
                UIOptions={{
                  canvasActions: {
                    saveAsImage: false,
                    export: false,
                    loadScene: false,
                    clearCanvas: false,
                  },
                  tools: { image: false },
                }}
              />
            </div>
          )}
        </div>
      )
    },
  }
)
