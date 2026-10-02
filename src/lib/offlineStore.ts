// REL-012: rascunhos locais em IndexedDB (banco `akool-offline`, store `drafts`).
// Guardam a última edição que não chegou ao servidor (sem conexão ou erro de
// rede) para sobreviver a recarregar ou fechar a aba, e são reenviados quando
// a conexão volta ou a página abre de novo. Este arquivo carrega sob demanda
// (`import()`), fora do boot. Sem IndexedDB (modo privado antigo, storage
// bloqueado) as funções não falham: gravam nada, leem nada.

export type DraftTable = 'note_contents' | 'drawing_contents' | 'quick_notes'

export interface Draft {
  /** `${userId}:${table}:${id}`. */
  key: string
  userId: string
  table: DraftTable
  /** page_id (notas e desenhos) ou o id da quick note. */
  id: string
  value: unknown
  /** A versão (`updated_at`) sobre a qual a edição foi feita; null para linha nova. */
  version: string | null
  /** Quando foi guardado (Date.now()). */
  savedAt: number
}

const DB_NAME = 'akool-offline'
const STORE = 'drafts'
const DB_VERSION = 1

export function draftKey(userId: string, table: DraftTable, id: string): string {
  return `${userId}:${table}:${id}`
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexeddb'))
  })
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore(STORE, { keyPath: 'key' })
      store.createIndex('userId', 'userId', { unique: false })
    }
    open.onsuccess = () => {
      const db = open.result
      // Outra aba pediu uma versão nova: fecha e deixa a próxima chamada reabrir.
      db.onversionchange = () => { db.close(); dbPromise = null }
      resolve(db)
    }
    open.onerror = () => { dbPromise = null; reject(open.error ?? new Error('indexeddb')) }
    open.onblocked = () => { dbPromise = null; reject(new Error('indexeddb blocked')) }
  })
  return dbPromise
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return request(run(db.transaction(STORE, mode).objectStore(STORE)))
}

/** Grava (ou substitui) o rascunho; silencioso se o IndexedDB não existir. */
export async function putDraft(draft: Omit<Draft, 'key'>): Promise<void> {
  if (!hasIndexedDb()) return
  try {
    await withStore('readwrite', store => store.put({ ...draft, key: draftKey(draft.userId, draft.table, draft.id) }))
  } catch { /* storage bloqueado: fica só em memória */ }
}

export async function getDraft(key: string): Promise<Draft | null> {
  if (!hasIndexedDb()) return null
  try {
    return (await withStore('readonly', store => store.get(key) as IDBRequest<Draft | undefined>)) ?? null
  } catch { return null }
}

export function getDraftFor(userId: string, table: DraftTable, id: string): Promise<Draft | null> {
  return getDraft(draftKey(userId, table, id))
}

export function deleteDraftFor(userId: string, table: DraftTable, id: string): Promise<void> {
  return deleteDraft(draftKey(userId, table, id))
}

export async function deleteDraft(key: string): Promise<void> {
  if (!hasIndexedDb()) return
  try { await withStore('readwrite', store => store.delete(key)) } catch { /* ignore */ }
}

/** Todos os rascunhos de uma conta (para reenviar ao voltar a conexão). */
export async function listDrafts(userId: string): Promise<Draft[]> {
  if (!hasIndexedDb()) return []
  try {
    return await withStore('readonly', store => store.index('userId').getAll(userId) as IDBRequest<Draft[]>)
  } catch { return [] }
}

/** Apaga os rascunhos da conta (sair da conta num aparelho compartilhado). */
export async function clearDrafts(userId: string): Promise<void> {
  for (const draft of await listDrafts(userId)) await deleteDraft(draft.key)
}
