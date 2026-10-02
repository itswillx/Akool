import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  fieldsUnchanged, mapWriteError, pickFields, reinsertAt, requireRows, revertFields, runGuarded, runOptimistic,
  type WriteError,
} from '../lib/optimistic'
import { useToast } from '../contexts/ToastContext'
import { useLanguage } from '../i18n/LanguageContext'
import { isOnline, onReconnect } from '../lib/connectivity'
import { classifySupabaseError } from '../lib/supabaseErrors'
import type { Draft } from '../lib/offlineStore'
import type { QuickNote, QuickNoteColor } from '../types'

type QuickNotePatch = Partial<Pick<QuickNote, 'content' | 'color' | 'linked_items'>>

// REL-012: os rascunhos guardados sem conexão (o IndexedDB carrega sob demanda).
async function loadQuickDrafts(userId: string): Promise<Draft[]> {
  const store = await import('../lib/offlineStore')
  return (await store.listDrafts(userId)).filter(d => d.table === 'quick_notes')
}

async function persistQuickDraft(userId: string, id: string, patch: QuickNotePatch & { updated_at: string }): Promise<void> {
  const store = await import('../lib/offlineStore')
  const current = await store.getDraftFor(userId, 'quick_notes', id)
  const merged = { ...((current?.value as object | null) ?? {}), ...patch }
  await store.putDraft({ userId, table: 'quick_notes', id, value: merged, version: null, savedAt: Date.now() })
}

function normalize(row: QuickNote): QuickNote {
  return { ...row, linked_items: (row.linked_items ?? []) }
}

const NO_NOTES: QuickNote[] = []

export function useQuickNotes(userId: string | undefined) {
  const [notes, setNotes] = useState<QuickNote[]>([])
  // REL-004: `loading` sai de qual usuário já carregou. Sem usuário não há o
  // que carregar, então não fica preso em true.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loading = !!userId && loadedFor !== userId
  const { showToast } = useToast()
  const { t } = useLanguage()

  // O estado atual para os snapshots do rollback, sem recriar os callbacks.
  const notesRef = useRef(notes)
  useEffect(() => { notesRef.current = notes }, [notes])

  // Ref para os callbacks não mudarem de identidade quando o idioma troca.
  const notifyRef = useRef({ t, showToast })
  useEffect(() => { notifyRef.current = { t, showToast } }, [t, showToast])
  const reverted = useCallback((error: WriteError) => {
    notifyRef.current.showToast('error', mapWriteError(error, notifyRef.current.t, 'toast_error_reverted'))
  }, [])

  useEffect(() => {
    if (!userId) return
    supabase
      .from('quick_notes').select('*').eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('quick notes:', error)
        else setNotes((data ?? []).map(normalize))
        setLoadedFor(userId)
      }, err => {
        console.error('quick notes:', err)
        setLoadedFor(userId)
      })
  }, [userId])

  // REL-012: rascunhos guardados sem conexão entram por cima da lista e são
  // reenviados agora e sempre que a conexão voltar.
  const applyDrafts = useCallback((pending: Draft[]) => {
    if (pending.length === 0) return
    setNotes(prev => prev.map(n => {
      const d = pending.find(p => p.id === n.id)
      return d ? { ...n, ...(d.value as QuickNotePatch) } : n
    }))
  }, [])

  useEffect(() => {
    if (!userId || loadedFor !== userId) return
    let cancelled = false
    const sync = () => {
      void loadQuickDrafts(userId).then(async pending => {
        if (cancelled) return
        applyDrafts(pending)
        if (pending.length > 0 && isOnline()) await (await import('../lib/offlineSync')).flushDrafts(userId, 'quick_notes')
      })
    }
    sync()
    const stop = onReconnect(sync)
    return () => { cancelled = true; stop() }
  }, [userId, loadedFor, applyDrafts])

  /** `true` quando a nota foi gravada; na falha, avisa e o chamador mantém o rascunho. */
  const createNote = useCallback(async (input: { content: string; color: QuickNoteColor }): Promise<boolean> => {
    if (!userId) return false
    const res = await runGuarded(
      () => supabase
        .from('quick_notes')
        .insert({ user_id: userId, content: input.content, color: input.color })
        .select('*').single(),
      {
        label: 'quick note create',
        onError: error => notifyRef.current.showToast('error', mapWriteError(error, notifyRef.current.t, 'toast_error_save')),
      },
    )
    if (!res.ok) return false
    const row = res.data
    if (row) setNotes(prev => [normalize(row), ...prev])
    return true
  }, [userId])

  // REL-004: editar e excluir são otimistas, com rollback só da nota e dos
  // campos tocados. .select('id') + requireRows: o RLS recusa com 0 linhas.
  const updateNote = useCallback(async (id: string, patch: QuickNotePatch) => {
    const before = notesRef.current.find(n => n.id === id)
    if (!before) return
    const applied = { ...patch, updated_at: new Date().toISOString() }
    const previous = pickFields(before, applied)
    // REL-012: sem conexão a edição fica na tela e num rascunho local, e volta
    // a ser enviada quando a conexão voltar (ver o efeito acima).
    const offline = (error: WriteError) => classifySupabaseError(error) === 'network' || !isOnline()
    await runOptimistic({
      apply: () => setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...applied } : n))),
      write: async () => requireRows(await supabase.from('quick_notes').update(applied).eq('id', id).select('id')),
      revert: () => setNotes(prev => revertFields(prev, id, previous, { onlyIf: cur => fieldsUnchanged(cur, applied) })),
      keepOnError: offline,
      onError: error => {
        if (offline(error) && userId) void persistQuickDraft(userId, id, applied)
        else reverted(error)
      },
      label: 'quick note update',
    })
  }, [reverted, userId])

  const deleteNote = useCallback(async (id: string) => {
    const index = notesRef.current.findIndex(n => n.id === id)
    if (index === -1) return
    const row = notesRef.current[index]
    await runOptimistic({
      apply: () => setNotes(prev => prev.filter(n => n.id !== id)),
      write: async () => requireRows(await supabase.from('quick_notes').delete().eq('id', id).select('id')),
      revert: () => setNotes(prev => reinsertAt(prev, row, index)),
      onError: reverted,
      label: 'quick note delete',
    })
  }, [reverted])

  return { notes: userId ? notes : NO_NOTES, loading, createNote, updateNote, deleteNote }
}
