import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { filterSuggestionItems } from '@blocknote/core'
import type { BlockNoteEditor } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react'
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { FolderKanban, PencilRuler } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { resolveSignedUrl } from '../lib/storageUrl'
import { prepareUpload, uploadContextBucket } from '../lib/uploadValidation'
import { noteSchema, type NoteBlock } from './noteSchema'
import NoteInvalidContent from './NoteInvalidContent'
import ImportProjectCardsModal from './ImportProjectCardsModal'
import { buildCardSnapshot } from '../lib/projectImport'
import type { ProjectBoard, ProjectCard, ProjectColumn } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useCollaborativeContent } from '../hooks/useCollaborativeContent'
import { useLanguage } from '../i18n/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { useToast } from '../contexts/ToastContext'
import { asVersionedClient, chooseInitialContent, classifyLoad, contentDraft, createDebouncedSaver, isNewer, loadContentDraft, markContentOpen, saveVersionedContent, type DraftHooks, type SaveStatus } from '../lib/contentPersistence'
import { onReconnect } from '../lib/connectivity'
import { useAuth } from '../contexts/AuthContext'
import SaveStatusBadge, { EditConflictBanner, EditorLoadError } from './SaveStatusBadge'
import { findFatalNoteIssue, type BlockIssue } from '../../supabase/functions/_domain/blocknote/schema'

interface NoteEditorProps {
  pageId: string
}

export default function NoteEditor({ pageId }: NoteEditorProps) {
  const { userShareRole } = usePages()
  const { t } = useLanguage()
  const { user } = useAuth()
  const userId = user?.id
  const [initialContent, setInitialContent] = useState<unknown[] | null>(null)
  const [initialUpdatedAt, setInitialUpdatedAt] = useState<string | null>(null)
  // REL-012: abriu com um rascunho guardado sem conexão (ainda não enviado).
  const [fromDraft, setFromDraft] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  // API-020: conteúdo que derrubaria o editor; a nota abre só para leitura.
  const [invalid, setInvalid] = useState<{ content: unknown; issue: BlockIssue } | null>(null)

  const role = userShareRole(pageId)
  const isCollaborative = role !== null
  const canEdit = role === 'owner' || role === 'co_owner' || role === 'editor'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    setInitialContent(null)
    setInvalid(null)

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
      // API-020: conteúdo gravado que não é lista não vira nota vazia (o
      // autosave gravaria por cima): passa pela guarda abaixo, como o resto.
      const stored: unknown = data?.content ?? []
      const remote = { value: stored, version: data?.updated_at ?? null }
      // REL-012: edição guardada sem conexão? Abre com ela; o primeiro save
      // grava ou, se alguém salvou depois, mostra o aviso de conflito.
      const draft = await loadContentDraft(userId, 'note_contents', pageId)
      if (cancelled) return
      const chosen = chooseInitialContent<unknown>(remote, draft && Array.isArray(draft.value) ? { value: draft.value, version: draft.version } : null)
      // API-020: só as regras fatais, antes do useCreateBlockNote (que lança no
      // render e leva a seção inteira para o ErrorBoundary, para todo mundo).
      const issue = findFatalNoteIssue(chosen.value)
      setInvalid(issue ? { content: chosen.value, issue } : null)
      setInitialContent(Array.isArray(chosen.value) ? chosen.value : [])
      setInitialUpdatedAt(chosen.version)
      setFromDraft(chosen.fromDraft)
      setLoading(false)
    }

    void load()
    return () => { cancelled = true }
  }, [pageId, reloadKey, userId])

  // API-020: a tela só leitura do rascunho inválido conta como página aberta:
  // o reenvio global (offlineSync) não manda o rascunho enquanto ela está na
  // tela (e, mesmo fechada, ele recusa rascunho com problema fatal).
  const invalidDraftOnScreen = !loading && invalid !== null && fromDraft
  useEffect(() => (invalidDraftOnScreen ? markContentOpen('note_contents', pageId) : undefined), [invalidDraftOnScreen, pageId])

  if (loadError) return <EditorLoadError onRetry={() => setReloadKey(k => k + 1)} />

  if (!loading && invalid) {
    const discardDraft = async () => {
      await contentDraft<unknown[]>(userId, 'note_contents', pageId)?.clear()
      setReloadKey(k => k + 1)
    }
    return <NoteInvalidContent content={invalid.content} issue={invalid.issue} fromDraft={fromDraft} onDiscardDraft={() => { void discardDraft() }} />
  }

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
      userId={userId}
      initialContent={initialContent}
      initialUpdatedAt={initialUpdatedAt}
      fromDraft={fromDraft}
      isCollaborative={isCollaborative}
      readOnly={!canEdit}
      onReloadFromServer={() => setReloadKey(k => k + 1)}
    />
  )
}


function EditorInner({
  pageId,
  userId,
  initialContent,
  initialUpdatedAt,
  fromDraft,
  isCollaborative,
  readOnly,
  onReloadFromServer,
}: {
  pageId: string
  userId: string | undefined
  initialContent: unknown[]
  initialUpdatedAt: string | null
  /** REL-012: o conteúdo inicial é um rascunho local ainda não enviado. */
  fromDraft: boolean
  isCollaborative: boolean
  readOnly: boolean
  onReloadFromServer: () => void
}) {
  const { theme } = useTheme()
  const lastSaveAt = useRef<string | null>(initialUpdatedAt)
  // Um rascunho restaurado conta como edição: o realtime não o substitui.
  const isDirty = useRef(fromDraft)
  const localSavedAt = useRef<number>(0)
  // API-020: o conteúdo remoto efetivamente aplicado, com a versão. A guarda
  // roda só sobre ele: o remoto que chega com a pessoa editando (ou na janela
  // depois do save) não é aplicado e segue o conflito do REL-009, sem desmontar
  // o editor no meio da digitação.
  const [applied, setApplied] = useState<{ key: number; content: unknown; version: string | null } | null>(null)

  const { remoteContent, remoteUpdatedAt } = useCollaborativeContent(pageId, 'note_contents', isCollaborative)

  const POST_SAVE_PROTECTION_MS = 3000

  useEffect(() => {
    if (!remoteContent || !remoteUpdatedAt) return
    if (isNewer(remoteUpdatedAt, lastSaveAt.current)) {
      const withinProtectionWindow = Date.now() - localSavedAt.current < POST_SAVE_PROTECTION_MS
      if (!isDirty.current && !withinProtectionWindow) {
        lastSaveAt.current = remoteUpdatedAt
        setApplied(prev => ({ key: (prev?.key ?? 0) + 1, content: remoteContent, version: remoteUpdatedAt }))
      }
    }
  }, [remoteContent, remoteUpdatedAt])

  const remoteKey = applied?.key ?? 0
  const currentContent = applied ? applied.content as unknown[] : initialContent
  // REL-009: a versão do conteúdo com que o editor monta; o save só grava sobre ela.
  const currentVersion = applied ? applied.version : initialUpdatedAt
  // API-020: o remoto aplicado passa pela mesma guarda; com problema fatal, o
  // editor (que montaria com ele) dá lugar à leitura.
  const remoteIssue = useMemo(() => (applied ? findFatalNoteIssue(applied.content) : null), [applied])

  if (remoteIssue) return <NoteInvalidContent content={currentContent} issue={remoteIssue} fromDraft={false} onDiscardDraft={() => {}} />

  return (
    <EditorCore
      key={`${pageId}-${remoteKey}`}
      pageId={pageId}
      userId={userId}
      initialContent={currentContent}
      readOnly={readOnly}
      initialVersion={currentVersion}
      restoredDraft={fromDraft && remoteKey === 0}
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

/**
 * O autosave da nota (REL-002, REL-009, REL-012). API-020: o que a guarda
 * (findFatalNoteIssue) recusa não vai ao servidor, senão a nota ficaria só
 * leitura para todos. A colagem que produziria isso é desfeita na hora (o
 * `pasteHandler` do EditorCore); esta guarda cobre as outras origens (soltar
 * uma tabela arrastada, um bloco de código enorme virando parágrafo). Ela roda
 * uma vez por save (depois do debounce), não a cada tecla; `onBlocked` avisa na
 * passagem de liberado para recusado, e `unblock` (tentar de novo) deixa avisar
 * outra vez. O rascunho local guarda também o recusado: o offlineSync não o
 * envia, e a página o abre só leitura, com o texto e o botão de descartar.
 * `isBlocked` diz se o último conteúdo conferido foi recusado: ao sair, o
 * EditorCore guarda o pendente no aparelho (keepPending), e a colagem não leva
 * a culpa do que já estava recusado.
 */
function createNoteSaver({ userId, pageId, version, onStatus, onBlocked }: {
  userId: string | undefined
  pageId: string
  version: string | null
  onStatus: (status: SaveStatus) => void
  onBlocked: () => void
}) {
  let blocked = false
  const refuse = (content: unknown[]): boolean => {
    const fatal = findFatalNoteIssue(content) !== null
    if (fatal && !blocked) onBlocked()
    blocked = fatal
    return fatal
  }
  const hooks = contentDraft<unknown[]>(userId, 'note_contents', pageId)
  const draft: DraftHooks<unknown[]> | undefined = hooks && {
    // Confere só para o status e o aviso: guardar no aparelho é sempre seguro.
    persist: (value, base) => {
      refuse(value)
      return hooks.persist(value, base)
    },
    clear: hooks.clear,
  }
  const saver = createDebouncedSaver<unknown[]>({
    delayMs: 1000,
    // Sem conexão e recusado: fica no aparelho, mas nunca vai ao servidor, então é "Não salvo".
    onStatus: status => onStatus(blocked && status === 'offline' ? 'error' : status),
    version,
    // REL-012: sem conexão, o pendente vai para o rascunho local.
    draft,
    save: (content, { force, version: expected }) => (refuse(content)
      ? Promise.resolve({ ok: false, error: 'note_content_invalid' })
      : saveVersionedContent(asVersionedClient(supabase), { table: 'note_contents', pageId, values: { content }, expected, force })),
  })
  return { saver, draft, unblock: () => { blocked = false }, isBlocked: () => blocked }
}

type EditorDoc = BlockNoteEditor['prosemirrorState']['doc']

/**
 * API-020: desfaz só a colagem, voltando ao documento de antes (`before`). O
 * histórico do editor junta passos vizinhos feitos em menos de 500 ms, e o undo
 * levaria junto o que a pessoa digitou logo antes de colar. Nesse caso, refaz e
 * troca só o trecho que a colagem mudou pelo de antes.
 */
function undoPaste(editor: Pick<BlockNoteEditor, 'undo' | 'redo' | 'transact' | 'prosemirrorState'>, before: EditorDoc) {
  editor.undo()
  if (editor.prosemirrorState.doc.eq(before)) return
  editor.redo()
  editor.transact(tr => {
    const start = before.content.findDiffStart(tr.doc.content)
    const end = before.content.findDiffEnd(tr.doc.content)
    if (start === null || end === null) return
    // As pontas se cruzam quando o trecho colado repete o que vem em volta.
    const overlap = Math.max(0, start - Math.min(end.a, end.b))
    tr.replace(start, end.b + overlap, before.slice(start, end.a + overlap))
    if (!tr.doc.eq(before)) tr.replaceWith(0, tr.doc.content.size, before.content)
  })
}

function EditorCore({ pageId, userId, initialContent, readOnly, initialVersion, restoredDraft, onReloadFromServer, onSave, onDirty, appTheme }: {
  pageId: string
  userId: string | undefined
  initialContent: unknown[]
  readOnly: boolean
  /** REL-009: a versão (`updated_at`) do conteúdo inicial; o save só grava sobre ela. */
  initialVersion: string | null
  /** REL-012: montou com o rascunho local; manda já. */
  restoredDraft: boolean
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

  // REL-002: autosave que confere o erro do upsert, mantém a edição em caso de
  // falha ("Não salvo · Tentar de novo") e salva o pendente ao sair da página.
  // REL-009: o save só grava sobre a versão conhecida; se outra pessoa salvou
  // antes, o saver para em `conflict` e o aviso pede a escolha.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  // API-020: um aviso por recusa, da guarda do saver (createNoteSaver) ou da
  // colagem desfeita (pasteHandler, abaixo).
  const [notice, setNotice] = useState<{ count: number; key: 'note_save_blocked' | 'note_paste_blocked' }>({ count: 0, key: 'note_save_blocked' })
  const shownNotices = useRef(0)
  useEffect(() => {
    if (notice.count <= shownNotices.current) return
    shownNotices.current = notice.count
    showToast('error', t(notice.key))
  }, [notice, showToast, t])
  const [{ saver, draft, unblock, isBlocked }] = useState(() => createNoteSaver({
    userId, pageId, version: initialVersion, onStatus: setSaveStatus,
    onBlocked: () => setNotice(prev => ({ count: prev.count + 1, key: 'note_save_blocked' })),
  }))

  const editor = useCreateBlockNote({
    schema: noteSchema,
    uploadFile,
    resolveFileUrl,
    // API-020: a colagem que deixaria a nota sem reabrir (uma tabela com células
    // mescladas fora da grade, que o editor mostra mas não reabre) é desfeita na
    // hora, com aviso, e o que a pessoa escreve depois continua salvando. Se a
    // nota já estava recusada antes da colagem, a culpa não é dela: fica com a
    // guarda do saver.
    pasteHandler: ({ defaultPasteHandler, editor: target }) => {
      const wasFatal = isBlocked() && findFatalNoteIssue(target.document) !== null
      const before = target.prosemirrorState.doc
      const handled = defaultPasteHandler()
      if (!wasFatal && findFatalNoteIssue(target.document) !== null) {
        undoPaste(target, before)
        setNotice(prev => ({ count: prev.count + 1, key: 'note_paste_blocked' }))
      }
      return handled
    },
    // QA-005: o conteúdo vem do banco como unknown[]; o tipo é o do próprio schema.
    // Passa por unknown de propósito: comparar unknown[] com o bloco do schema faz o
    // TypeScript expandir o schema inteiro ("type instantiation is excessively deep").
    ...(initialContent.length > 0 ? { initialContent: initialContent as unknown as NoteBlock[] } : {}),
  })

  const [importOpen, setImportOpen] = useState(false)
  // Block where the cursor sat when "/" → Projetos was picked; new card blocks
  // are inserted right after it.
  const referenceBlockIdRef = useRef<string | null>(null)

  // A última edição agendada e a versão sobre a qual ela foi feita (o que vai
  // para o aparelho ao sair, em conflito ou recusado: keepPending, abaixo).
  const pending = useRef<unknown[] | null>(null)
  const baseVersion = useRef(initialVersion)
  const schedule = useCallback((content: unknown[]) => {
    pending.current = content
    saver.schedule(content)
  }, [saver])
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
    saver.setOnSaved((at, stillDirty) => {
      if (at) baseVersion.current = at
      onSave(at, stillDirty)
    })
  }, [saver, onSave])

  // REL-012: a página aberta reenvia o rascunho sozinha quando a conexão volta;
  // o reenvio global (offlineSync) pula as páginas abertas.
  useEffect(() => markContentOpen('note_contents', pageId), [pageId])
  useEffect(() => onReconnect(() => { void saver.flush() }), [saver])
  // Abriu com o rascunho local: manda já (grava, ou cai no aviso de conflito).
  useEffect(() => {
    if (restoredDraft) schedule(editor.document)
  }, [restoredDraft, schedule, editor])

  // API-020: ao sair (desmonte, pagehide, aba escondida), manda o pendente e
  // guarda no aparelho o que não foi e o saver não guardou: a edição em
  // conflito (o aviso some junto com o editor) e o conteúdo que a guarda recusa.
  // Vai sobre a versão em que foi feito; ao abrir, a página mostra o aviso de
  // conflito ou a leitura com o texto e o botão de descartar.
  const keepPending = useCallback(() => saver.flush().then(() => {
    if ((saver.status === 'conflict' || isBlocked()) && pending.current) return draft?.persist(pending.current, baseVersion.current)
  }), [saver, draft, isBlocked])

  useEffect(() => {
    const flush = () => { void keepPending() }
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [keepPending])

  const handleChange = useCallback(() => {
    if (readOnly) return
    onDirty?.()
    schedule(editor.document)
  }, [schedule, editor, readOnly, onDirty])

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
      <SaveStatusBadge status={saveStatus} onRetry={() => { unblock(); void saver.flush() }} />
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
