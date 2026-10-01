import { supabase } from '../supabase'
import type { CardPlacement } from '../boardMoves'
import type { ProjectShareRole } from '../../types'
import type { TableInsert, TableUpdate } from '../../types/db'

// ARCH-003: consultas de Projetos num lugar só (antes espalhadas no
// ProjectsPanel e no QueueModal). Cada função devolve a mesma consulta de
// antes: quem chama continua lendo `{ data, error }` e usando
// requireRows/runGuarded. A carga do quadro fica em
// src/modules/projects/boardLoader.ts, que recebe o cliente para ser testada.

// ── Quadros ──────────────────────────────────────────────────────────────────

export function listOwnBoards(userId: string) {
  return supabase.from('project_boards').select('*').eq('user_id', userId).order('sort_order', { ascending: true })
}

export function listSharedBoards(userId: string) {
  return supabase.from('project_shares').select('role, project_boards(*)').eq('shared_with_user_id', userId)
}

export function createBoard(board: { name: string; icon: string; color: string; description: string }) {
  return supabase.rpc('create_project_board', {
    p_name: board.name, p_icon: board.icon, p_color: board.color, p_description: board.description,
  })
}

/** `.select('id')`: o RLS recusa sem erro, com 0 linhas (use requireRows). */
export function updateBoard(boardId: string, values: { name: string; icon: string; color: string; description: string }) {
  return supabase.from('project_boards').update({ ...values, updated_at: new Date().toISOString() }).eq('id', boardId).select('id')
}

export function deleteBoard(boardId: string) {
  return supabase.from('project_boards').delete().eq('id', boardId).select('id')
}

// ── Colunas ──────────────────────────────────────────────────────────────────

export function insertColumn(values: { board_id: string; name: string; color: string; wip_limit: number | null; sort_order: number }) {
  return supabase.from('project_columns').insert(values)
}

export function updateColumn(columnId: string, values: { name: string; color: string; wip_limit: number | null }) {
  return supabase.from('project_columns').update(values).eq('id', columnId).select('id')
}

export function deleteColumn(columnId: string) {
  return supabase.from('project_columns').delete().eq('id', columnId).select('id')
}

// ── Cards ────────────────────────────────────────────────────────────────────

export function insertCard(values: TableInsert<'project_cards'>) {
  return supabase.from('project_cards').insert(values).select('*').single()
}

/** Só o id de volta (o modal de card rápido não precisa do resto). */
export function insertCardReturningId(values: TableInsert<'project_cards'>) {
  return supabase.from('project_cards').insert(values).select('id').single()
}

export function updateCard(cardId: string, values: TableUpdate<'project_cards'>) {
  return supabase.from('project_cards').update(values).eq('id', cardId)
}

export function deleteCard(cardId: string) {
  return supabase.from('project_cards').delete().eq('id', cardId).select('id')
}

/** PERF-004: a ordem em uma requisição, atômica. */
export function reorderCards(boardId: string, moves: CardPlacement[]) {
  return supabase.rpc('reorder_project_cards', { p_board: boardId, p_moves: moves })
}

export function reorderColumns(boardId: string, columns: { id: string; sort_order: number }[]) {
  return supabase.rpc('reorder_project_columns', { p_board: boardId, p_columns: columns })
}

export function scheduleCards(
  boardId: string,
  patches: { id: string; start_date: string | null; due_date: string | null; depends_on: string[] }[],
) {
  return supabase.rpc('schedule_project_cards', { p_board: boardId, p_patches: patches })
}

// ── Compartilhamento ─────────────────────────────────────────────────────────

export function listBoardShares(boardId: string) {
  return supabase
    .from('project_shares')
    .select('*, profiles!project_shares_shared_with_user_id_fkey(email, display_name, avatar_emoji, avatar_color, avatar_url)')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true })
}

export function addBoardShare(share: { board_id: string; owner_id: string; shared_with_user_id: string; role: ProjectShareRole }) {
  return supabase.from('project_shares').insert(share)
}

export function removeBoardShare(shareId: string) {
  return supabase.from('project_shares').delete().eq('id', shareId).select('id')
}

export function searchUsersForShare(term: string) {
  return supabase.rpc('search_users_for_share', { p_term: term })
}

// ── Fila de desenvolvimento (RPCs cq_*) ──────────────────────────────────────

export function listQueue(boardId: string) {
  return supabase.rpc('cq_list', { p_board: boardId })
}

type QueueFilter = string[] | null

/**
 * Filtro ausente ou `null` = sem filtro. Os parâmetros têm `DEFAULT NULL` na
 * função, então omitir e mandar null dão no mesmo; o tipo gerado só aceita a
 * omissão.
 */
export function enqueueCards(boardId: string, filters: { cards?: QueueFilter; columns?: QueueFilter; priorities?: QueueFilter; labels?: QueueFilter }) {
  return supabase.rpc('cq_enqueue', {
    p_board: boardId,
    ...(filters.cards != null ? { p_cards: filters.cards } : {}),
    ...(filters.columns != null ? { p_columns: filters.columns } : {}),
    ...(filters.priorities != null ? { p_priorities: filters.priorities } : {}),
    ...(filters.labels != null ? { p_labels: filters.labels } : {}),
  })
}

export function moveQueueItem(queueId: string, position: number) {
  return supabase.rpc('cq_move', { p_queue_id: queueId, p_position: position })
}

export function removeQueueItem(queueId: string) {
  return supabase.rpc('cq_remove', { p_queue_id: queueId })
}

export function reprioritizeQueue(boardId: string) {
  return supabase.rpc('cq_reprioritize', { p_board: boardId })
}

export function validateQueueCard(boardId: string, cardId: string, approve: boolean, note: string | null) {
  // p_note tem DEFAULT NULL: sem nota, o parâmetro não vai.
  return supabase.rpc('cq_validate', { p_board: boardId, p_card: cardId, p_approve: approve, p_note: note ?? undefined })
}
