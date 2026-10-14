import { useCallback, useEffect, useRef, useState } from 'react'
import { mapWriteError, pickFields, reinsertAt, requireRows, revertFields, runGuarded, runOptimistic, type WriteError } from '../lib/optimistic'
import { useToast } from '../contexts/ToastContext'
import { useLanguage } from '../i18n/LanguageContext'
import { isOnline, onReconnect } from '../lib/connectivity'
import { classifySupabaseError } from '../lib/supabaseErrors'
import {
  deleteQuickNote, insertQuickNote, listQuickNotes, normalizeQuickNote, patchMatches, quickDraftPatch, saveQuickNote,
  type QuickNotePatch,
} from '../lib/data/quickNotes'
import type { Draft } from '../lib/offlineStore'
import type { FlushItem } from '../lib/offlineSync'
import type { QuickNote, QuickNoteColor } from '../types'

export type { QuickNotePatch }

/** Os campos novos, ou uma operação sobre a nota mais recente (vínculos: acrescentar ou tirar um item). */
export type QuickNoteChange = QuickNotePatch | ((current: QuickNote) => QuickNotePatch)

/** API-003: alguém salvou a nota depois da versão que esta tela conhecia. */
export interface QuickNoteConflict {
  /** A edição daqui que ainda não foi salva. */
  mine: QuickNotePatch
  /** A nota como está no servidor. */
  theirs: QuickNote
}

// REL-012: os rascunhos guardados sem conexão (o IndexedDB carrega sob demanda).
async function loadQuickDrafts(userId: string): Promise<Draft[]> {
  const store = await import('../lib/offlineStore')
  return (await store.listDrafts(userId)).filter(d => d.table === 'quick_notes')
}

/** API-003: a versão do rascunho é a da primeira edição não enviada; as seguintes só somam campos. */
async function persistQuickDraft(userId: string, id: string, patch: QuickNotePatch, base: string): Promise<void> {
  const store = await import('../lib/offlineStore')
  const current = await store.getDraftFor(userId, 'quick_notes', id)
  const value = { ...(current ? quickDraftPatch(current.value) : {}), ...patch }
  await store.putDraft({ userId, table: 'quick_notes', id, value, version: current ? current.version : base, savedAt: Date.now() })
}

/** Depois de gravar `written` online: esses campos saem do rascunho, e o resto passa a valer sobre a versão nova. */
async function settleQuickDraft(userId: string, id: string, written: QuickNotePatch, at: string): Promise<void> {
  const store = await import('../lib/offlineStore')
  const current = await store.getDraftFor(userId, 'quick_notes', id)
  if (!current) return
  const rest = Object.fromEntries(Object.entries(quickDraftPatch(current.value)).filter(([key]) => !(key in written)))
  if (Object.keys(rest).length === 0) await store.deleteDraftFor(userId, 'quick_notes', id)
  else await store.putDraft({ userId, table: 'quick_notes', id, value: rest, version: at, savedAt: Date.now() })
}

async function dropQuickDraft(userId: string, id: string): Promise<void> {
  await (await import('../lib/offlineStore')).deleteDraftFor(userId, 'quick_notes', id)
}

const NO_NOTES: QuickNote[] = []
const NO_CONFLICTS: Record<string, QuickNoteConflict> = {}

export function useQuickNotes(userId: string | undefined) {
  const [notes, setNotes] = useState<QuickNote[]>([])
  const [conflicts, setConflicts] = useState<Record<string, QuickNoteConflict>>({})
  // REL-004: `loading` sai de qual usuário já carregou. Sem usuário não há o
  // que carregar, então não fica preso em true.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const loading = !!userId && loadedFor !== userId
  const { showToast } = useToast()
  const { t } = useLanguage()

  // O estado atual, sempre em dia para quem roda fora do render (a fila de
  // gravações e os rollbacks): toda mudança passa por `update`.
  const notesRef = useRef<QuickNote[]>([])
  const update = useCallback((fn: (prev: QuickNote[]) => QuickNote[]) => {
    notesRef.current = fn(notesRef.current)
    setNotes(notesRef.current)
  }, [])
  const conflictsRef = useRef<Record<string, QuickNoteConflict>>({})
  const updateConflicts = useCallback((fn: (prev: Record<string, QuickNoteConflict>) => Record<string, QuickNoteConflict>) => {
    conflictsRef.current = fn(conflictsRef.current)
    setConflicts(conflictsRef.current)
  }, [])
  const clearConflict = useCallback((id: string) => {
    if (conflictsRef.current[id]) updateConflicts(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)))
  }, [updateConflicts])
  /** API-003: a última versão (updated_at do servidor) de cada nota, base da próxima gravação. */
  const versionsRef = useRef(new Map<string, string>())
  /** Gravações de cada nota, uma depois da outra: a próxima usa a versão que a anterior devolveu. */
  const chainsRef = useRef(new Map<string, Promise<void>>())
  const enqueue = useCallback((id: string, run: () => Promise<void>): Promise<void> => {
    const next = (chainsRef.current.get(id) ?? Promise.resolve()).then(run, run)
    chainsRef.current.set(id, next)
    return next
  }, [])

  // Ref para os callbacks não mudarem de identidade quando o idioma troca.
  const notifyRef = useRef({ t, showToast })
  useEffect(() => { notifyRef.current = { t, showToast } }, [t, showToast])
  const reverted = useCallback((error: WriteError) => {
    notifyRef.current.showToast('error', mapWriteError(error, notifyRef.current.t, 'toast_error_reverted'))
  }, [])

  const forget = useCallback((id: string) => {
    update(prev => prev.filter(n => n.id !== id))
    versionsRef.current.delete(id)
    clearConflict(id)
  }, [update, clearConflict])

  useEffect(() => {
    if (!userId) return
    listQuickNotes(userId).then(({ data, error }) => {
      if (error) console.error('quick notes:', error)
      else {
        const rows = (data ?? []).map(normalizeQuickNote)
        versionsRef.current = new Map(rows.map(n => [n.id, n.updated_at]))
        update(() => rows)
      }
      setLoadedFor(userId)
    }, err => {
      console.error('quick notes:', err)
      setLoadedFor(userId)
    })
  }, [userId, update])

  // O resultado do reenvio de um rascunho (por esta tela ou pelo App).
  const settleFlush = useCallback((item: FlushItem, server: QuickNote[], pending: Draft[]) => {
    const at = item.at
    if (item.status === 'sent' && at) {
      versionsRef.current.set(item.id, at)
      update(prev => prev.map(n => (n.id === item.id ? { ...n, updated_at: at } : n)))
    } else if (item.status === 'dropped') {
      forget(item.id)
      notifyRef.current.showToast('warning', notifyRef.current.t('quick_notes_gone'))
    } else if (item.status === 'conflict') {
      // Sem `current`, o rascunho é antigo (sem versão): o servidor é a nota que a lista carregou.
      const theirs = item.current ?? server.find(n => n.id === item.id)
      const draft = pending.find(d => d.id === item.id)
      if (theirs && draft) updateConflicts(prev => ({ ...prev, [item.id]: { mine: quickDraftPatch(draft.value), theirs } }))
    }
  }, [update, forget, updateConflicts])

  // REL-012: rascunhos guardados sem conexão entram por cima da lista e são
  // reenviados agora e sempre que a conexão voltar.
  useEffect(() => {
    if (!userId || loadedFor !== userId) return
    let cancelled = false
    const sync = () => {
      void loadQuickDrafts(userId).then(async pending => {
        if (cancelled || pending.length === 0) return
        const server = notesRef.current
        update(prev => prev.map(n => {
          const d = pending.find(p => p.id === n.id)
          return d ? { ...n, ...quickDraftPatch(d.value) } : n
        }))
        if (!isOnline()) return
        const report = await (await import('../lib/offlineSync')).flushDrafts(userId, 'quick_notes')
        if (cancelled) return
        for (const item of report.results) settleFlush(item, server, pending)
      })
    }
    sync()
    const stop = onReconnect(sync)
    return () => { cancelled = true; stop() }
  }, [userId, loadedFor, update, settleFlush])

  /** `true` quando a nota foi gravada; na falha, avisa e o chamador mantém o rascunho. */
  const createNote = useCallback(async (input: { content: string; color: QuickNoteColor }): Promise<boolean> => {
    if (!userId) return false
    const res = await runGuarded(
      () => insertQuickNote(userId, input),
      {
        label: 'quick note create',
        onError: error => notifyRef.current.showToast('error', mapWriteError(error, notifyRef.current.t, 'toast_error_save')),
      },
    )
    if (!res.ok) return false
    const row = res.data
    if (row) {
      const created = normalizeQuickNote(row)
      versionsRef.current.set(created.id, created.updated_at)
      update(prev => [created, ...prev])
    }
    return true
  }, [userId, update])

  /**
   * Grava `patch` sobre a versão conhecida. `base` são os valores desses campos
   * antes da edição; `op`, a operação que gerou o patch (vínculos).
   * Zero linhas com outra versão no servidor:
   * - operação: refaz sobre a nota do servidor e grava de novo;
   * - ninguém mexeu nesses campos (a versão mudou por outro campo ou por um
   *   reenvio nosso): grava de novo sobre a versão nova;
   * - senão, é conflito: a edição fica na tela e num rascunho, e a pessoa escolhe.
   */
  const write = useCallback(async (id: string, patch: QuickNotePatch, base: QuickNotePatch, op?: (current: QuickNote) => QuickNotePatch) => {
    const expected = versionsRef.current.get(id)
    if (!expected) return
    let sent = patch
    let result = await saveQuickNote(id, sent, expected)
    if (result.status === 'conflict') {
      const theirs = result.current
      const retry = op ? op(theirs) : patchMatches(theirs, base) ? patch : null
      if (retry) {
        versionsRef.current.set(id, theirs.updated_at)
        sent = retry
        result = await saveQuickNote(id, sent, theirs.updated_at)
      }
    }

    switch (result.status) {
      case 'saved': {
        const at = result.at
        versionsRef.current.set(id, at)
        update(prev => prev.map(n => (n.id === id ? { ...n, ...(op ? sent : {}), updated_at: at } : n)))
        if (userId) void settleQuickDraft(userId, id, sent, at)
        return
      }
      case 'conflict': {
        const theirs = result.current
        updateConflicts(prev => ({ ...prev, [id]: { mine: { ...prev[id]?.mine, ...sent }, theirs } }))
        if (userId) void persistQuickDraft(userId, id, sent, expected)
        return
      }
      case 'gone':
        forget(id)
        if (userId) void dropQuickDraft(userId, id)
        notifyRef.current.showToast('warning', notifyRef.current.t('quick_notes_gone'))
        return
      case 'error': {
        const error = result.error
        console.error('[optimistic] quick note update', error)
        // REL-012: sem conexão a edição fica na tela e num rascunho local, e volta
        // a ser enviada quando a conexão voltar (ver o efeito acima).
        if (classifySupabaseError(error) === 'network' || !isOnline()) {
          if (userId) void persistQuickDraft(userId, id, sent, expected)
          return
        }
        update(prev => revertFields<QuickNote>(prev, id, base, { onlyIf: cur => patchMatches(cur, patch) }))
        reverted(error)
      }
    }
  }, [userId, update, updateConflicts, forget, reverted])

  // REL-004: editar é otimista, com rollback só da nota e dos campos tocados.
  const updateNote = useCallback((id: string, change: QuickNoteChange): Promise<void> => {
    const before = notesRef.current.find(n => n.id === id)
    if (!before) return Promise.resolve()
    const op = typeof change === 'function' ? change : undefined
    const patch = op ? op(before) : (change as QuickNotePatch)
    if (Object.keys(patch).length === 0) return Promise.resolve()
    const base = pickFields(before, patch)
    update(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)))
    // Em conflito, nada vai ao servidor até a pessoa escolher: a edição entra na "minha versão".
    if (conflictsRef.current[id]) {
      updateConflicts(prev => ({ ...prev, [id]: { ...prev[id], mine: { ...prev[id].mine, ...patch } } }))
      if (userId) void persistQuickDraft(userId, id, patch, versionsRef.current.get(id) ?? before.updated_at)
      return Promise.resolve()
    }
    return enqueue(id, () => write(id, patch, base, op))
  }, [userId, update, updateConflicts, enqueue, write])

  /** API-003: "carregar a versão salva" descarta a edição daqui; "manter a minha" grava por cima da versão nova. */
  const resolveConflict = useCallback((id: string, choice: 'load' | 'keep'): Promise<void> => {
    const conflict = conflictsRef.current[id]
    if (!conflict) return Promise.resolve()
    clearConflict(id)
    versionsRef.current.set(id, conflict.theirs.updated_at)
    if (choice === 'load') {
      update(prev => prev.map(n => (n.id === id ? conflict.theirs : n)))
      if (userId) void dropQuickDraft(userId, id)
      return Promise.resolve()
    }
    return enqueue(id, () => write(id, conflict.mine, pickFields(conflict.theirs, conflict.mine)))
  }, [userId, update, clearConflict, enqueue, write])

  const deleteNote = useCallback(async (id: string) => {
    const index = notesRef.current.findIndex(n => n.id === id)
    if (index === -1) return
    const row = notesRef.current[index]
    const ok = await runOptimistic({
      apply: () => update(prev => prev.filter(n => n.id !== id)),
      write: async () => requireRows(await deleteQuickNote(id)),
      revert: () => update(prev => reinsertAt(prev, row, index)),
      onError: reverted,
      label: 'quick note delete',
    })
    if (ok) {
      versionsRef.current.delete(id)
      clearConflict(id)
      if (userId) void dropQuickDraft(userId, id)
    }
  }, [userId, update, clearConflict, reverted])

  return {
    notes: userId ? notes : NO_NOTES,
    conflicts: userId ? conflicts : NO_CONFLICTS,
    loading,
    createNote,
    updateNote,
    deleteNote,
    resolveConflict,
  }
}
