import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'

// Canvas do bloco de diagrama, isolado num módulo próprio para que o chunk do
// Excalidraw (~4.7 MB) só seja baixado quando um diagrama realmente renderiza.
// Quem monta isto é o `DiagramBlock`, via lazy() + Suspense — nada aqui pode ser
// importado estaticamente por `NoteEditor`, senão o ganho se perde.
interface DiagramCanvasProps {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  onChange?: (elements: readonly ExcalidrawElement[], appState: AppState) => void
}

export default function DiagramCanvas({ elements, appState, onChange }: DiagramCanvasProps) {
  return (
    <Excalidraw
      initialData={{
        elements,
        appState: { ...appState, collaborators: new Map() },
      }}
      onChange={onChange}
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
  )
}
