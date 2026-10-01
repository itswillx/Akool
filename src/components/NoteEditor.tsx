import { useEffect, useRef, useState, useCallback } from 'react'
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { FolderKanban, PencilRuler } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resolveSignedUrl } from '../lib/storageUrl'
import { prepareUpload, uploadContextBucket } from '../lib/uploadValidation'
import { DiagramBlock } from './DiagramBlock'
import { ProjectCardBlock } from './blocks/ProjectCardBlock'
import ImportProjectCardsModal from './ImportProjectCardsModal'
import { buildCardSnapshot } from '../lib/projectImport'
import type { ProjectBoard, ProjectCard, ProjectColumn } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useCollaborativeContent } from '../hooks/useCollaborativeContent'
import { useLanguage } from '../i18n/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { useToast } from '../contexts/ToastContext'
import { asVersionedClient, classifyLoad, createDebouncedSaver, isNewer, saveVersionedContent, type SaveStatus } from '../lib/contentPersistence'
import SaveStatusBadge, { EditConflictBanner, EditorLoadError } from './SaveStatusBadge'

interface NoteEditorProps {
  pageId: string
}

export default function NoteEditor({ pageId }: NoteEditorProps) {
  const { userShareRole } = usePages()
  const { t } = useLanguage()
  const [initialContent, setInitialContent] = useState<unknown[] | null>(null)
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
    setInitialContent(null)

    const load = async () => {
      const result = classifyLoad<{ content: unknown; updated_at: string | null }>(await supabase
        .from('note_contents')
        .select('content, updated_at')
        .eq('page_id', pageId)
        .maybeSingle())

      if (cancelled) return
      // REL-002: erro de leitura NÃO vira nota vazia — o autosave gravaria vazio
      // por cima do conteúdo real. Só a página nova (sem linha) começa vazia.
      if (result.kind === 'error') {
        setLoadError(true)
        setLoading(false)
        return
      }
      const data = result.kind === 'ok' ? result.data : null
      setInitialContent(data?.content && Array.isArray(data.content) && data.content.length > 0 ? data.content : [])
      setInitialUpdatedAt(data?.updated_at ?? null)
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [pageId, reloadKey])

  if (loadError) return <EditorLoadError onRetry={() => setReloadKey(k => k + 1)} />

  if (loading || initialContent === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-muted)', fontSize: 14 }}>
        {t('app_loading')}
      </div>
    )
  }

  return (
    <EditorInner
      pageId={pageId}
      initialContent={initialContent}
      initialUpdatedAt={initialUpdatedAt}
      isCollaborative={isCollaborative}
      readOnly={!canEdit}
      onReloadFromServer={() => setReloadKey(k => k + 1)}
    />
  )
}


const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, diagram: DiagramBlock(), projectCard: ProjectCardBlock() },
})

// O schema expõe o tipo do bloco parcial (fantasma); evita instanciar os genéricos à mão.
type NoteBlock = typeof schema.PartialBlock

function EditorInner({
  pageId,
  initialContent,
  initialUpdatedAt,
  isCollaborative,
  readOnly,
  onReloadFromServer,
}: {
  pageId: string
  initialContent: unknown[]
  initialUpdatedAt: string | null
  isCollaborative: boolean
  readOnly: boolean
  onReloadFromServer: () => void
}) {
  const { theme } = useTheme()
  const lastSaveAt = useRef<string | null>(initialUpdatedAt)
  const isDirty = useRef(false)
  const localSavedAt = useRef<number>(0)
  const [remoteKey, setRemoteKey] = useState(0)

  const { remoteContent, remoteUpdatedAt } = useCollaborativeContent(pageId, 'note_contents', isCollaborative)

  const POST_SAVE_PROTECTION_MS = 3000

  useEffect(() => {
    if (!remoteContent || !remoteUpdatedAt) return
    if (isNewer(remoteUpdatedAt, lastSaveAt.current)) {
      const withinProtectionWindow = Date.now() - localSavedAt.current < POST_SAVE_PROTECTION_MS
      if (!isDirty.current && !withinProtectionWindow) {
        lastSaveAt.current = remoteUpdatedAt
        setRemoteKey(k => k + 1)
      }
    }
  }, [remoteContent, remoteUpdatedAt])

  const currentContent = remoteKey > 0 && remoteContent
    ? remoteContent as unknown[]
    : initialContent
  // REL-009: a versão do conteúdo com que o editor monta; o save só grava sobre ela.
  const currentVersion = remoteKey > 0 && remoteContent ? remoteUpdatedAt : initialUpdatedAt

  return (
    <EditorCore
      key={`${pageId}-${remoteKey}`}
      pageId={pageId}
      initialContent={currentContent}
      readOnly={readOnly}
      initialVersion={currentVersion}
      onReloadFromServer={onReloadFromServer}
      onSave={(at, stillDirty) => {
        if (at) lastSaveAt.current = at
        localSavedAt.current = Date.now()
        // Só fica "limpo" se não houver edição mais nova esperando o próximo save.
        if (!stillDirty) isDirty.current = false
      }}
      onDirty={() => { isDirty.current = true }}
      appTheme={theme}
    />
  )
}

function EditorCore({ pageId, initialContent, readOnly, initialVersion, onReloadFromServer, onSave, onDirty, appTheme }: {
  pageId: string
  initialContent: unknown[]
  readOnly: boolean
  /** REL-009: a versão (`updated_at`) do conteúdo inicial; o save só grava sobre ela. */
  initialVersion: string | null
  onReloadFromServer: () => void
  onSave: (at: string | null, stillDirty: boolean) => void
  onDirty?: () => void
  appTheme: 'light' | 'dark'
}) {
  const { t } = useLanguage()
  const { showToast } = useToast()

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    // PERF-010: a foto sobe reduzida (lado maior até 2048 px, WebP).
    const result = await prepareUpload('note-image', file)
    if (!result.ok) {
      const message = t(result.reason === 'too_large' ? 'upload_error_too_large' : 'upload_error_invalid_type')
      showToast('error', message)
      throw new Error(message)
    }
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    const uid = currentUser?.id ?? 'anon'
    const path = `${uid}/${pageId}/${Date.now()}.${result.ext}`
    const { error } = await supabase.storage
      .from(uploadContextBucket('note-image'))
      .upload(path, result.file, { contentType: result.file.type, upsert: false })
    if (error) throw new Error(error.message)
    // Bucket privado: persiste o path; a URL assinada e' gerada no render.
    return path
  }, [pageId, t, showToast])

  const resolveFileUrl = useCallback(
    (url: string) => resolveSignedUrl(uploadContextBucket('note-image'), url),
    [],
  )

  const editor = useCreateBlockNote({
    schema,
    uploadFile,
    resolveFileUrl,
    // QA-005: o conteúdo vem do banco como unknown[]; o tipo é o do próprio schema.
    // Passa por unknown de propósito: comparar unknown[] com o bloco do schema faz o
    // TypeScript expandir o schema inteiro ("type instantiation is excessively deep").
    ...(initialContent.length > 0 ? { initialContent: initialContent as unknown as NoteBlock[] } : {}),
  })

  const [importOpen, setImportOpen] = useState(false)
  // Block where the cursor sat when "/" → Projetos was picked; new card blocks
  // are inserted right after it.
  const referenceBlockIdRef = useRef<string | null>(null)

  // REL-002: autosave que confere o erro do upsert, mantém a edição em caso de
  // falha ("Não salvo · Tentar de novo") e salva o pendente ao sair da página.
  // REL-009: o save só grava sobre a versão conhecida; se outra pessoa salvou
  // antes, o saver para em `conflict` e o aviso pede a escolha.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saver] = useState(() => createDebouncedSaver<unknown[]>({
    delayMs: 1000,
    onStatus: setSaveStatus,
    version: initialVersion,
    save: (content, { force, version }) => saveVersionedContent(asVersionedClient(supabase), {
      table: 'note_contents', pageId, values: { content }, expected: version, force,
    }),
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

  useEffect(() => { saver.setOnSaved(onSave) }, [saver, onSave])

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

  const handleChange = useCallback(() => {
    if (readOnly) return
    onDirty?.()
    saver.schedule(editor.document)
  }, [saver, editor, readOnly, onDirty])

  // Slash menu: default items plus a "Projetos" entry that opens the card picker
  // and a "Diagrama" entry that inserts the (lazily loaded) Excalidraw block.
  const getSlashItems = useCallback((query: string): Promise<DefaultReactSuggestionItem[]> => {
    const diagramItem: DefaultReactSuggestionItem = {
      title: t('diagram_slash_title'),
      subtext: t('diagram_slash_subtitle'),
      aliases: ['diagrama', 'diagram', 'desenho', 'draw', 'excalidraw'],
      group: t('page_type_drawing'),
      icon: <PencilRuler size={18} />,
      onItemClick: () => {
        if (readOnly) return
        // Dispara o download do canvas em paralelo com a inserção do bloco, para
        // encurtar o tempo de Suspense. O bloco funciona igual sem isto.
        void import('./DiagramCanvas')
        editor.insertBlocks([{ type: 'diagram' }], editor.getTextCursorPosition().block.id, 'after')
        handleChange()
      },
    }
    const projetosItem: DefaultReactSuggestionItem = {
      title: t('import_cards_slash_title'),
      subtext: t('import_cards_slash_subtitle'),
      aliases: ['projetos', 'projects', 'card', 'cards', 'kanban'],
      group: t('projects_title'),
      icon: <FolderKanban size={18} />,
      onItemClick: () => {
        if (readOnly) return
        referenceBlockIdRef.current = editor.getTextCursorPosition().block.id
        setImportOpen(true)
      },
    }
    return Promise.resolve(filterSuggestionItems([...getDefaultReactSlashMenuItems(editor), diagramItem, projetosItem], query))
  }, [editor, t, readOnly, handleChange])

  const handleImport = useCallback((cards: ProjectCard[], board: ProjectBoard, columns: ProjectColumn[]) => {
    const columnName = (id: string) => columns.find(c => c.id === id)?.name ?? null
    const blocks = cards.map(card => ({
      type: 'projectCard' as const,
      props: {
        cardId: card.id,
        boardId: board.id,
        snapshot: JSON.stringify(buildCardSnapshot(card, board, columnName(card.column_id))),
      },
    }))
    const ref = referenceBlockIdRef.current ?? editor.getTextCursorPosition().block.id
    editor.insertBlocks(blocks, ref, 'after')
    setImportOpen(false)
    handleChange()
  }, [editor, handleChange])

  return (
    <div className="flex-1 overflow-y-auto h-full" style={{ position: 'relative' }}>
      <SaveStatusBadge status={saveStatus} onRetry={() => { void saver.flush() }} />
      {saveStatus === 'conflict' && (
        <EditConflictBanner busy={resolving} onLoadSaved={loadSaved} onKeepMine={() => { void keepMine() }} />
      )}
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
        editable={!readOnly}
        theme={appTheme}
        slashMenu={false}
        style={{ height: '100%' }}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={getSlashItems} />
      </BlockNoteView>
      {!readOnly && (
        <ImportProjectCardsModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}
    </div>
  )
}
