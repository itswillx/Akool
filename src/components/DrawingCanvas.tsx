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
import { asVersionedClient, chooseInitialContent, classifyLoad, contentDraft, createDebouncedSaver, isNewer, loadContentDraft, markContentOpen, saveVersionedContent, sceneVersion, type SaveStatus } from '../lib/contentPersistence'
import { onReconnect } from '../lib/connectivity'
import { useAuth } from '../contexts/AuthContext'
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

/** A linha como vai para o banco (e como o rascunho offline é guardado). */
type DrawingRow = Pick<TableRow<'drawing_contents'>, 'elements' | 'app_state' | 'files'>

/** O que o saver recebe a cada mudança. */
type SaverScene = { elements: ExcalidrawElement[]; appState: AppState; files: BinaryFiles }

/** Só o que vale guardar do appState (nada de seleção, cursor, UI). */
function safeAppState(appState: AppState) {
  return {
    viewBackgroundColor: appState.viewBackgroundColor,
    currentItemStrokeColor: appState.currentItemStrokeColor,
    currentItemBackgroundColor: appState.currentItemBackgroundColor,
    gridSize: appState.gridSize,
    zoom: appState.zoom,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
  }
}

export default function DrawingCanvas({ pageId, showLinkedNotePanel }: DrawingCanvasProps) {
  const { userShareRole } = usePages()
  const { theme } = useTheme()
  const { t } = useLanguage()
  const { user } = useAuth()
  const userId = user?.id
  const [initialData, setInitialData] = useState<Scene | null>(null)
  const [initialUpdatedAt, setInitialUpdatedAt] = useState<string | null>(null)
  // REL-012: abriu com um rascunho guardado sem conexão (ainda não enviado).
  const [fromDraft, setFromDraft] = useState(false)
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
      // REL-012: edição guardada sem conexão (a linha como iria para o banco)?
      // Abre com ela; o primeiro save grava ou mostra o aviso de conflito.
      const draft = await loadContentDraft(userId, 'drawing_contents', pageId)
      if (cancelled) return
      const chosen = chooseInitialContent<DrawingRow | null>(
        { value: data ? { elements: data.elements, app_state: data.app_state, files: data.files } : null, version: data?.updated_at ?? null },
        draft ? { value: draft.value as DrawingRow, version: draft.version } : null,
      )
      const row = chosen.value
      // O jsonb é gravado só por este componente, no formato do próprio Excalidraw.
      setInitialData({
        elements: (row?.elements ?? []) as ExcalidrawElement[],
        appState: row?.app_state ?? {},
        files: (row?.files ?? {}) as BinaryFiles,
      })
      setInitialUpdatedAt(chosen.version)
      setFromDraft(chosen.fromDraft)
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [pageId, reloadKey, userId])

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
      userId={userId}
      initialData={initialData}
      initialUpdatedAt={initialUpdatedAt}
      fromDraft={fromDraft}
      isCollaborative={isCollaborative}
      readOnly={!canEdit}
      showLinkedNotePanel={showLinkedNotePanel}
      appTheme={theme}
      onReloadFromServer={() => setReloadKey(k => k + 1)}
    />
  )
}

function CanvasInner({ pageId, userId, initialData, initialUpdatedAt, fromDraft, isCollaborative, readOnly, showLinkedNotePanel, appTheme, onReloadFromServer }: {
  pageId: string
  userId: string | undefined
  initialData: Scene
  initialUpdatedAt: string | null
  /** REL-012: a cena inicial é um rascunho local ainda não enviado. */
  fromDraft: boolean
  isCollaborative: boolean
  readOnly: boolean
  showLinkedNotePanel?: boolean
  appTheme: 'light' | 'dark'
  onReloadFromServer: () => void
}) {
  // UX-006: o Excalidraw grava `document.documentElement.lang` com o seu
  // langCode (padrão "en"); com o idioma do app, o <html lang> não muda.
  const { lang } = useLanguage()
  const lastSaveAt = useRef<string | null>(initialUpdatedAt)
  // Um rascunho restaurado conta como edição: o realtime não o substitui.
  const isDirty = useRef(fromDraft)
  const localSavedAt = useRef<number>(0)
  // REL-009: a última versão da cena salva ou aplicada. O onChange da carga,
  // do pan/zoom e do updateScene remoto chega com a mesma versão e não grava.
  const lastSceneVersion = useRef(sceneVersion(initialData.elements))
  const excalidrawApi = useRef<ExcalidrawImperativeAPI | null>(null)

  const { remoteContent, remoteUpdatedAt } = useCollaborativeContent(pageId, 'drawing_contents', isCollaborative)

  const POST_SAVE_PROTECTION_MS = 3000

  // REL-002: o desenho só conta como salvo depois que o upsert dá certo (antes,
  // isDirty/localSavedAt eram zerados ao *chamar* o save). Em erro, a edição
  // fica guardada ("Não salvo · Tentar de novo") e o pendente é salvo ao sair.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saver] = useState(() => createDebouncedSaver<SaverScene>({
    delayMs: 2000,
    onStatus: setSaveStatus,
    version: initialUpdatedAt,
    // REL-012: sem conexão, o pendente vai para o rascunho local, já no
    // formato da linha (é o que o reenvio e a próxima abertura usam).
    draft: contentDraft<SaverScene>(userId, 'drawing_contents', pageId, ({ elements, appState, files }) => ({ elements, app_state: safeAppState(appState), files })),
    save: async ({ elements, appState, files }, { force, version }) => {
      // REL-009: só grava sobre a versão conhecida (lastSaveAt); se outra
      // pessoa salvou antes, o saver para em `conflict` e o aviso pede a escolha.
      return saveVersionedContent(asVersionedClient(supabase), {
        table: 'drawing_contents',
        pageId,
        values: { elements, app_state: safeAppState(appState), files },
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
        // Conteúdo remoto da mesma coluna jsonb (ver o load acima). A versão
        // entra antes do updateScene: o onChange que ele dispara não é edição.
        const remoteElements = remoteContent as ExcalidrawElement[]
        lastSceneVersion.current = sceneVersion(remoteElements)
        excalidrawApi.current.updateScene({ elements: remoteElements })
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

  // REL-012: a página aberta reenvia o rascunho sozinha quando a conexão volta;
  // o reenvio global (offlineSync) pula as páginas abertas.
  useEffect(() => markContentOpen('drawing_contents', pageId), [pageId])
  useEffect(() => onReconnect(() => { void saver.flush() }), [saver])
  // Abriu com o rascunho local: manda já (grava, ou cai no aviso de conflito).
  useEffect(() => {
    if (fromDraft) saver.schedule({ elements: [...initialData.elements], appState: initialData.appState as AppState, files: initialData.files })
  }, [fromDraft, saver, initialData])

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
      // Só edição de verdade: a soma dos `version` muda a cada mutação de
      // elemento, e fica igual em pan/zoom, na carga e no eco do realtime.
      const version = sceneVersion(elements)
      if (version === lastSceneVersion.current) return
      lastSceneVersion.current = version
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
        langCode={lang}
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
