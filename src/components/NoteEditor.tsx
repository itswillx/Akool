import { useEffect, useRef, useState, useCallback } from 'react'
import type { BlockNoteEditor } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import { useCreateBlockNote } from '@blocknote/react'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { supabase } from '../lib/supabase'
import { DiagramBlock } from './DiagramBlock'
import { usePages } from '../contexts/PagesContext'
import { useCollaborativeContent } from '../hooks/useCollaborativeContent'
import { useLanguage } from '../i18n/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'

interface NoteEditorProps {
  pageId: string
}

export default function NoteEditor({ pageId }: NoteEditorProps) {
  const { userShareRole } = usePages()
  const { t } = useLanguage()
  const [initialContent, setInitialContent] = useState<unknown[] | null>(null)
  const [initialUpdatedAt, setInitialUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const role = userShareRole(pageId)
  const isCollaborative = role !== null
  const canEdit = role === 'owner' || role === 'co_owner' || role === 'editor'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setInitialContent(null)

    const load = async () => {
      const { data } = await supabase
        .from('note_contents')
        .select('content, updated_at')
        .eq('page_id', pageId)
        .single()

      if (!cancelled) {
        if (data?.content && Array.isArray(data.content) && data.content.length > 0) {
          setInitialContent(data.content)
        } else {
          setInitialContent([])
        }
        setInitialUpdatedAt(data?.updated_at ?? null)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [pageId])

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
    />
  )
}


const customSchema = { diagram: DiagramBlock }

function EditorInner({
  pageId,
  initialContent,
  initialUpdatedAt,
  isCollaborative,
  readOnly,
}: {
  pageId: string
  initialContent: unknown[]
  initialUpdatedAt: string | null
  isCollaborative: boolean
  readOnly: boolean
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
    if (!lastSaveAt.current || remoteUpdatedAt > lastSaveAt.current) {
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

  return <EditorCore key={`${pageId}-${remoteKey}`} pageId={pageId} initialContent={currentContent} readOnly={readOnly} onSave={(at) => { lastSaveAt.current = at; localSavedAt.current = Date.now(); isDirty.current = false }} onDirty={() => { isDirty.current = true }} appTheme={theme} />
}

function EditorCore({ pageId, initialContent, readOnly, onSave, onDirty, appTheme }: {
  pageId: string
  initialContent: unknown[]
  readOnly: boolean
  onSave: (at: string) => void
  onDirty?: () => void
  appTheme: 'light' | 'dark'
}) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const uploadFile = useCallback(async (file: File): Promise<string> => {
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    const ext = file.name.split('.').pop() ?? 'bin'
    const uid = currentUser?.id ?? 'anon'
    const path = `${uid}/${pageId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage
      .from('note-images')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw new Error(error.message)
    const { data } = supabase.storage.from('note-images').getPublicUrl(path)
    return data.publicUrl
  }, [pageId])

  const editor = useCreateBlockNote({
    customBlocks: customSchema,
    uploadFile,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(initialContent.length > 0 ? { initialContent: initialContent as any } : {}),
  })

  const save = useCallback(async (ed: BlockNoteEditor) => {
    const content = ed.document
    const { data } = await supabase
      .from('note_contents')
      .upsert({ page_id: pageId, content }, { onConflict: 'page_id' })
      .select('updated_at')
      .single()
    if (data?.updated_at) onSave(data.updated_at)
  }, [pageId, onSave])

  const handleChange = useCallback(() => {
    if (readOnly) return
    onDirty?.()
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(editor), 1000)
  }, [editor, save, readOnly, onDirty])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  return (
    <div className="flex-1 overflow-y-auto h-full">
      <BlockNoteView
        editor={editor}
        onChange={handleChange}
        editable={!readOnly}
        theme={appTheme}
        style={{ height: '100%' }}
      />
    </div>
  )
}
