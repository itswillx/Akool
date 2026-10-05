import { supabase } from '../supabase'
import { fetchAllRows, mapAllRows } from '../fetchAllRows'
import type { Page } from '../../types'
import type { TableInsert, TableRow, TableUpdate } from '../../types/db'

// ARCH-003: consultas de páginas num lugar só (antes espalhadas no
// PagesContext). Cada função devolve a mesma consulta de antes: quem chama
// continua lendo `{ data, error }` e usando requireRows/runGuarded.

/**
 * ARCH-004: `icon`, `sort_order` e `is_favorite` têm default no banco mas não
 * são NOT NULL (nenhuma linha nula hoje). O app as trata como preenchidas;
 * aqui entra o mesmo default do banco, e o resto do app não vê `null`.
 */
export function toPage(row: TableRow<'pages'>): Page {
  return { ...row, icon: row.icon ?? '📄', sort_order: row.sort_order ?? 0, is_favorite: row.is_favorite ?? false }
}

/** Páginas do usuário, todas (paginado: o PostgREST corta em 1000). */
export async function listOwnPages(userId: string) {
  return mapAllRows(await fetchAllRows((from, to) => supabase.from('pages').select('*').eq('user_id', userId)
    .order('sort_order', { ascending: true }).order('id').range(from, to)), toPage)
}

/** Uma página pelo id (NOTIF-001: abrir a página de uma notificação antes de a árvore recarregar). Null se não existe ou o RLS esconde. */
export async function getPageById(id: string): Promise<Page | null> {
  const { data, error } = await supabase.from('pages').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return toPage(data)
}

/** Compartilhamentos recebidos, com a página junto (`pages` é null se o RLS esconder). */
export async function listSharesWithPages(userId: string) {
  const { data, error } = await supabase.from('page_shares').select('role, pages(*)').eq('shared_with_user_id', userId)
  if (error) return { data: null, error }
  return { data: data.map(row => ({ role: row.role, page: row.pages ? toPage(row.pages) : null })), error: null }
}

/** Todas as páginas dos donos que compartilharam algo (a árvore de cada um). */
export async function listPagesOfOwners(ownerIds: string[]) {
  return mapAllRows(await fetchAllRows((from, to) => supabase
    .from('pages')
    .select('*')
    .in('user_id', ownerIds)
    .order('sort_order', { ascending: true })
    .order('id')
    .range(from, to)), toPage)
}

export async function insertPage(values: TableInsert<'pages'>) {
  const { data, error } = await supabase.from('pages').insert(values).select().single()
  return { data: data ? toPage(data) : null, error }
}

export function insertNoteContent(pageId: string) {
  return supabase.from('note_contents').insert({ page_id: pageId, content: [] })
}

export function insertDrawingContent(pageId: string) {
  return supabase.from('drawing_contents').insert({ page_id: pageId, elements: [], app_state: {}, files: {} })
}

/** `.select('id')`: um UPDATE barrado pelo RLS volta sem erro e com 0 linhas. */
export function updatePageColumns(id: string, columns: TableUpdate<'pages'>) {
  return supabase.from('pages').update(columns).eq('id', id).select('id')
}

export function deletePageRow(id: string) {
  return supabase.from('pages').delete().eq('id', id)
}

export type ContentTable = 'note_contents' | 'drawing_contents'

/**
 * O conteúdo "principal" da página (blocos da nota ou elementos do desenho) e
 * quando mudou. Usado pela colaboração ao abrir a página.
 */
export async function fetchPageContent(table: ContentTable, pageId: string) {
  if (table === 'note_contents') {
    const { data, error } = await supabase.from('note_contents').select('content, updated_at').eq('page_id', pageId).single()
    return { data: data && { value: data.content, updatedAt: data.updated_at }, error }
  }
  const { data, error } = await supabase.from('drawing_contents').select('elements, updated_at').eq('page_id', pageId).single()
  return { data: data && { value: data.elements, updatedAt: data.updated_at }, error }
}
