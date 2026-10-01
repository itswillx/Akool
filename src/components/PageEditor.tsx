import { lazy, Suspense, useState, useRef } from 'react'
import type { ReactNode } from 'react'
import type { Page, PageType } from '../types'
import SplitDivider from './SplitDivider'
import PageHeader from './PageHeader'

const NoteEditor = lazy(() => import('./NoteEditor'))
const DrawingCanvas = lazy(() => import('./DrawingCanvas'))
const TodoList = lazy(() => import('./TodoList'))

export function ContentFallback() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700, fontSize: 13 }}>A</div>
      </div>
    </div>
  )
}

export function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ContentFallback />}>{children}</Suspense>
}

interface PageEditorProps {
  page: Page
  isMobile?: boolean
}

// Renders a single page's header + its type-specific editor. Driven purely by the
// `page` prop, so it works both for the global activePage (MainContent) and for a
// locally-selected page (the Documentos master-detail panel).
export default function PageEditor({ page, isMobile = false }: PageEditorProps) {
  const [splitRatio, setSplitRatio] = useState(50)
  const [dragging, setDragging] = useState(false)
  const type: PageType = page.type

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      <PageHeader page={page} isMobile={isMobile} />

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {type === 'note' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Lazy><NoteEditor key={page.id} pageId={page.id} /></Lazy>
          </div>
        )}
        {type === 'todo' && (
          <div style={{ flex: 1, overflowY: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
            <Lazy><TodoList key={page.id} pageId={page.id} /></Lazy>
          </div>
        )}
        {type === 'drawing' && (
          <div style={{ flex: 1, position: 'relative' }}>
            <Lazy><DrawingCanvas key={page.id} pageId={page.id} showLinkedNotePanel /></Lazy>
          </div>
        )}
        {type === 'both' && (
          <SplitView
            pageId={page.id}
            splitRatio={splitRatio}
            setSplitRatio={setSplitRatio}
            dragging={dragging}
            setDragging={setDragging}
            isMobile={isMobile}
          />
        )}
      </div>
    </div>
  )
}

function SplitView({ pageId, splitRatio, setSplitRatio, dragging, setDragging, isMobile }: {
  pageId: string
  splitRatio: number
  setSplitRatio: (v: number) => void
  dragging: boolean
  setDragging: (v: boolean) => void
  isMobile?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  // UX-010: o divisor usa Pointer Events com captura (touch, e não se perde
  // sobre o desenho). Sem seleção de texto só durante o arrasto.
  const divider = (
    <SplitDivider containerRef={containerRef} ratio={splitRatio} onChange={setSplitRatio} onDraggingChange={setDragging} stacked={isMobile} />
  )

  if (isMobile) {
    return (
      <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', userSelect: dragging ? 'none' : undefined }}>
        <div style={{ height: `${splitRatio}%`, minHeight: 0, overflowY: 'auto' }}>
          <Lazy><NoteEditor key={`note-${pageId}`} pageId={pageId} /></Lazy>
        </div>
        {divider}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Lazy><DrawingCanvas key={`drawing-${pageId}`} pageId={pageId} showLinkedNotePanel /></Lazy>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', userSelect: dragging ? 'none' : undefined }}>
      <div style={{ width: `${splitRatio}%`, minWidth: 0, overflowY: 'auto' }}>
        <Lazy><NoteEditor key={`note-${pageId}`} pageId={pageId} /></Lazy>
      </div>
      {divider}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <Lazy><DrawingCanvas key={`drawing-${pageId}`} pageId={pageId} showLinkedNotePanel /></Lazy>
      </div>
    </div>
  )
}
