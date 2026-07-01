import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import type { Page, PageType } from '../types'
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
  const handleMouseDown = () => setDragging(true)

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (isMobile) {
      const y = e.clientY - rect.top
      const ratio = Math.min(80, Math.max(20, (y / rect.height) * 100))
      setSplitRatio(ratio)
    } else {
      const x = e.clientX - rect.left
      const ratio = Math.min(80, Math.max(20, (x / rect.width) * 100))
      setSplitRatio(ratio)
    }
  }

  const handleMouseUp = () => setDragging(false)

  if (isMobile) {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', userSelect: 'none', cursor: dragging ? 'row-resize' : 'auto' }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div style={{ height: `${splitRatio}%`, minHeight: 0, overflowY: 'auto' }}>
          <Lazy><NoteEditor key={`note-${pageId}`} pageId={pageId} /></Lazy>
        </div>
        <div
          style={{ height: 6, flexShrink: 0, backgroundColor: 'var(--color-border)', cursor: 'row-resize' }}
          onMouseDown={handleMouseDown}
        />
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Lazy><DrawingCanvas key={`drawing-${pageId}`} pageId={pageId} showLinkedNotePanel /></Lazy>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', userSelect: 'none', cursor: dragging ? 'col-resize' : 'auto' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div style={{ width: `${splitRatio}%`, minWidth: 0, overflowY: 'auto' }}>
        <Lazy><NoteEditor key={`note-${pageId}`} pageId={pageId} /></Lazy>
      </div>
      <div
        style={{ width: 4, flexShrink: 0, backgroundColor: 'var(--color-border)', cursor: 'col-resize', position: 'relative' }}
        onMouseDown={handleMouseDown}
      />
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <Lazy><DrawingCanvas key={`drawing-${pageId}`} pageId={pageId} showLinkedNotePanel /></Lazy>
      </div>
    </div>
  )
}
