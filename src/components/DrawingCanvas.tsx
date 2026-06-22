import { useEffect, useRef, useState, useCallback } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcalidrawImperativeAPI = any
import '@excalidraw/excalidraw/index.css'
import { supabase } from '../lib/supabase'
import LinkedNotePanel from './LinkedNotePanel'
import { usePages } from '../contexts/PagesContext'
import { useCollaborativeContent } from '../hooks/useCollaborativeContent'
import { useTheme } from '../contexts/ThemeContext'

interface DrawingCanvasProps {
  pageId: string
  showLinkedNotePanel?: boolean
}

export default function DrawingCanvas({ pageId, showLinkedNotePanel }: DrawingCanvasProps) {
  const { userShareRole } = usePages()
  const { theme } = useTheme()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [initialData, setInitialData] = useState<any | null>(null)
  const [initialUpdatedAt, setInitialUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const role = userShareRole(pageId)
  const isCollaborative = role !== null
  const canEdit = role === 'owner' || role === 'co_owner' || role === 'editor'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setInitialData(null)

    const load = async () => {
      const { data } = await supabase
        .from('drawing_contents')
        .select('elements, app_state, files, updated_at')
        .eq('page_id', pageId)
        .single()

      if (!cancelled) {
        setInitialData({
          elements: data?.elements ?? [],
          appState: data?.app_state ?? {},
          files: data?.files ?? {},
        })
        setInitialUpdatedAt(data?.updated_at ?? null)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [pageId])

  if (loading || initialData === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>
        Loading canvas...
      </div>
    )
  }

  return (
    <CanvasInner
      pageId={pageId}
      initialData={initialData}
      initialUpdatedAt={initialUpdatedAt}
      isCollaborative={isCollaborative}
      readOnly={!canEdit}
      showLinkedNotePanel={showLinkedNotePanel}
      appTheme={theme}
    />
  )
}

function CanvasInner({ pageId, initialData, initialUpdatedAt, isCollaborative, readOnly, showLinkedNotePanel, appTheme }: {
  pageId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData: any
  initialUpdatedAt: string | null
  isCollaborative: boolean
  readOnly: boolean
  showLinkedNotePanel?: boolean
  appTheme: 'light' | 'dark'
}) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSaveAt = useRef<string | null>(initialUpdatedAt)
  const isDirty = useRef(false)
  const localSavedAt = useRef<number>(0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prevElementsRef = useRef<readonly any[]>(initialData.elements ?? [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null)

  const { remoteContent, remoteUpdatedAt } = useCollaborativeContent(pageId, 'drawing_contents', isCollaborative)

  const POST_SAVE_PROTECTION_MS = 3000

  useEffect(() => {
    if (!remoteContent || !remoteUpdatedAt) return
    if (!lastSaveAt.current || remoteUpdatedAt > lastSaveAt.current) {
      const withinProtectionWindow = Date.now() - localSavedAt.current < POST_SAVE_PROTECTION_MS
      if (!isDirty.current && !withinProtectionWindow && excalidrawApi.current) {
        lastSaveAt.current = remoteUpdatedAt
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        excalidrawApi.current.updateScene({ elements: remoteContent as any[] })
      }
    }
  }, [remoteContent, remoteUpdatedAt])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const save = useCallback(async (elements: any[], appState: any, files: any) => {
    const safeAppState = {
      viewBackgroundColor: appState.viewBackgroundColor,
      currentItemStrokeColor: appState.currentItemStrokeColor,
      currentItemBackgroundColor: appState.currentItemBackgroundColor,
      gridSize: appState.gridSize,
      zoom: appState.zoom,
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
    }
    const { data } = await supabase
      .from('drawing_contents')
      .upsert(
        { page_id: pageId, elements, app_state: safeAppState, files },
        { onConflict: 'page_id' }
      )
      .select('updated_at')
      .single()
    if (data?.updated_at) lastSaveAt.current = data.updated_at
  }, [pageId])

  const handleChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (elements: readonly any[], appState: any, files: any) => {
      if (readOnly) return
      // Only react to actual element changes, not appState (pan/zoom/selection)
      if (elements === prevElementsRef.current) return
      prevElementsRef.current = elements
      isDirty.current = true
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        save([...elements], appState, files)
        localSavedAt.current = Date.now()
        isDirty.current = false
      }, 2000)
    },
    [save, readOnly]
  )

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  return (
    <div className="flex-1 h-full" style={{ position: 'relative' }}>
      <Excalidraw
        key={pageId}
        excalidrawAPI={(api) => { excalidrawApi.current = api }}
        initialData={{
          elements: initialData.elements,
          appState: {
            ...initialData.appState,
            collaborators: new Map(),
          },
          files: initialData.files,
        }}
        theme={appTheme}
        onChange={handleChange}
        viewModeEnabled={readOnly}
        UIOptions={{
          canvasActions: {
            saveAsImage: true,
            export: { saveFileToDisk: true },
          },
        }}
      />
      {showLinkedNotePanel && <LinkedNotePanel pageId={pageId} />}
    </div>
  )
}
