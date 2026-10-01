import { useEffect, useRef, useState, useCallback } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { TableRow } from '../types/db'
import '@excalidraw/excalidraw/index.css'
import { supabase } from '../lib/supabase'
import LinkedNotePanel from './LinkedNotePanel'
import { usePages } from '../contexts/PagesContext'
import { useCollaborativeContent } from '../hooks/useCollaborativeContent'
import { useTheme } from '../contexts/ThemeContext'
import { useLanguage } from '../i18n/LanguageContext'
import { classifyLoad, createDebouncedSaver, isNewer, saveVersionedContent, type SaveStatus } from '../lib/contentPersistence'
import SaveStatusBadge, { EditConflictBanner, EditorLoadError } from './SaveStatusBadge'

interface DrawingCanvasProps {
  pageId: string
  showLinkedNotePanel?: boolean
}

/** A cena como o Excalidraw recebe e devolve. */
interface Scene {
  elements: readonly ExcalidrawElement[]
  appState: Partial<AppState>
  files: BinaryFiles
}

export default function DrawingCanvas({ pageId, showLinkedNotePanel }: DrawingCanvasProps) {
  const { userShareRole } = usePages()
  const { theme } = useTheme()
  const { t } = useLanguage()
  const [initialData, setInitialData] = useState<Scene | null>(null)
  const [initialUpdatedAt, setInitialUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const role = userShareRole(pageId)
  const isCollaborative = role !== null
  const canEdit = role === 'owner' || role === 'co_owner' || role === 'editor'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setInitialData(null)

    const load = async () => {
      const result = classifyLoad<Pick<TableRow<'drawing_contents'>, 'elements' | 'app_state' | 'files' | 'updated_at'>>(await supabase
        .from('drawing_contents')
        .select('elements, app_state, files, updated_at')
        .eq('page_id', pageId)
        .maybeSingle())

      if (cancelled) return
      // REL-002: erro de leitura NÃO vira canvas vazio (o autosave apagaria o
      // desenho real). Só a página nova (sem linha) começa vazia.
      if (result.kind === 'error') {
        setLoadError(true)
        setLoading(false)
        return
      }
      const data = result.kind === 'ok' ? result.data : null
      // O jsonb é gravado só por este componente, no formato do próprio Excalidraw.
      setInitialData({
        elements: (data?.elements ?? []) as ExcalidrawElement[],
        appState: data?.app_state ?? {},
        files: (data?.files ?? {}) as BinaryFiles,
      })
      setInitialUpdatedAt(data?.updated_at ?? null)
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [pageId, reloadKey])

  if (loadError) return <EditorLoadError onRetry={() => setReloadKey(k => k + 1)} />

  if (loading || initialData === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>
        {t('drawing_loading')}
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
      onReloadFromServer={() => setReloadKey(k => k + 1)}
    />
  )
}

function CanvasInner({ pageId, initialData, initialUpdatedAt, isCollaborative, readOnly, showLinkedNotePanel, appTheme, onReloadFromServer }: {
  pageId: string
  initialData: Scene
  initialUpdatedAt: string | null
  isCollaborative: boolean
  readOnly: boolean
  showLinkedNotePanel?: boolean
  appTheme: 'light' | 'dark'
  onReloadFromServer: () => void
}) {
  const lastSaveAt = useRef<string | null>(initialUpdatedAt)
  const isDirty = useRef(false)
  const localSavedAt = useRef<number>(0)
  const prevElementsRef = useRef<readonly ExcalidrawElement[]>(initialData.elements)
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null)

  const { remoteContent, remoteUpdatedAt } = useCollaborativeContent(pageId, 'drawing_contents', isCollaborative)

  const POST_SAVE_PROTECTION_MS = 3000

  // REL-002: o desenho só conta como salvo depois que o upsert dá certo (antes,
  // isDirty/localSavedAt eram zerados ao *chamar* o save). Em erro, a edição
  // fica guardada ("Não salvo · Tentar de novo") e o pendente é salvo ao sair.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saver] = useState(() => createDebouncedSaver<{ elements: ExcalidrawElement[]; appState: AppState; files: BinaryFiles }>({
    delayMs: 2000,
    onStatus: setSaveStatus,
    version: initialUpdatedAt,
    save: async ({ elements, appState, files }, { force, version }) => {
      const safeAppState = {
        viewBackgroundColor: appState.viewBackgroundColor,
        currentItemStrokeColor: appState.currentItemStrokeColor,
        currentItemBackgroundColor: appState.currentItemBackgroundColor,
        gridSize: appState.gridSize,
        zoom: appState.zoom,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
      }
      // REL-009: só grava sobre a versão conhecida (lastSaveAt); se outra
      // pessoa salvou antes, o saver para em `conflict` e o aviso pede a escolha.
      return saveVersionedContent(supabase, {
        table: 'drawing_contents',
        pageId,
        values: { elements, app_state: safeAppState, files },
        expected: version,
        force,
      })
    },
  }))
  const [resolving, setResolving] = useState(false)
  const keepMine = async () => {
    setResolving(true)
    try { await saver.flush({ force: true }) } finally { setResolving(false) }
  }
  const loadSaved = () => {
    saver.discard()
    onReloadFromServer()
  }

  useEffect(() => {
    if (!remoteContent || !remoteUpdatedAt) return
    if (isNewer(remoteUpdatedAt, lastSaveAt.current)) {
      const withinProtectionWindow = Date.now() - localSavedAt.current < POST_SAVE_PROTECTION_MS
      if (!isDirty.current && !withinProtectionWindow && excalidrawApi.current) {
        lastSaveAt.current = remoteUpdatedAt
        // REL-009: a cena agora é a versão salva; o próximo save grava sobre ela.
        saver.setVersion(remoteUpdatedAt)
        // Conteúdo remoto da mesma coluna jsonb (ver o load acima).
        excalidrawApi.current.updateScene({ elements: remoteContent as ExcalidrawElement[] })
      }
    }
  }, [remoteContent, remoteUpdatedAt, saver])

  useEffect(() => {
    saver.setOnSaved((at, stillDirty) => {
      if (at) lastSaveAt.current = at
      localSavedAt.current = Date.now()
      if (!stillDirty) isDirty.current = false
    })
  }, [saver])

  useEffect(() => {
    const flush = () => { void saver.flush() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [saver])

  const handleChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
      if (readOnly) return
      // Only react to actual element changes, not appState (pan/zoom/selection)
      if (elements === prevElementsRef.current) return
      prevElementsRef.current = elements
      isDirty.current = true
      saver.schedule({ elements: [...elements], appState, files })
    },
    [saver, readOnly]
  )

  return (
    <div className="flex-1 h-full" style={{ position: 'relative' }}>
      <SaveStatusBadge status={saveStatus} onRetry={() => { void saver.flush() }} />
      {saveStatus === 'conflict' && (
        <EditConflictBanner busy={resolving} onLoadSaved={loadSaved} onKeepMine={() => { void keepMine() }} />
      )}
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
