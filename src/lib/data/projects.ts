import { supabase } from '../supabase'
import type { CardPlacement } from '../boardMoves'
import type { WriteError } from '../optimistic'
import type { ProjectCard, ProjectShareRole } from '../../types'
import type { TableInsert, TableRow } from '../../types/db'

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

// API-013: o gatilho project_cards_integrity é dono de duas colunas. A posição
// de um card novo é o fim da coluna, e o updated_at é a versão do conteúdo
// (mover não muda). O app não manda nenhuma das duas.

/** Os campos que a pessoa edita no card (são os do formulário). */
export const CARD_FIELDS = [
  'title', 'description', 'priority', 'start_date', 'due_date', 'estimated_days', 'assignee_user_id', 'labels',
  'linked_page_id', 'parent_card_id', 'depends_on', 'completed', 'checklist', 'links', 'attachments',
] as const

export type CardField = typeof CARD_FIELDS[number]
export type CardFields = Pick<ProjectCard, CardField>
export type CardPatch = Partial<CardFields>
export type CardInsert = Omit<TableInsert<'project_cards'>, 'sort_order' | 'updated_at'>

/** Uma versão do card: o updated_at do servidor e os campos daquele momento. */
export interface CardBase {
  version: string
  fields: CardFields
}

/**
 * Chaves em ordem: o jsonb devolve os objetos (itens de checklist, anexos,
 * links) com as chaves na ordem dele, não na que o app gravou.
 */
const canonical = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
      : value

export const sameCardValue = (a: unknown, b: unknown) => JSON.stringify(canonical(a ?? null)) === JSON.stringify(canonical(b ?? null))
const sameValue = sameCardValue

/** Linha do banco com os jsonb nulos como lista vazia (como a carga do quadro faz). */
export function normalizeCard(row: TableRow<'project_cards'>): ProjectCard {
  return {
    ...row,
    labels: row.labels ?? [],
    checklist: row.checklist ?? [],
    links: row.links ?? [],
    attachments: row.attachments ?? [],
    depends_on: row.depends_on ?? [],
  }
}

export function cardFields(card: CardFields): CardFields {
  return Object.fromEntries(CARD_FIELDS.map(key => [key, card[key]])) as CardFields
}

export const baseOf = (card: ProjectCard): CardBase => ({ version: card.updated_at, fields: cardFields(card) })

/** Os campos de `next` que mudaram em relação a `base`. */
export function diffCardFields(base: CardPatch, next: CardPatch): CardPatch {
  return Object.fromEntries(
    (Object.keys(next) as CardField[]).filter(key => !sameValue(base[key], next[key])).map(key => [key, next[key]]),
  )
}

/** Os campos de `patch` já estão assim em `row`? */
export function cardPatchMatches(row: CardPatch, patch: CardPatch): boolean {
  return (Object.keys(patch) as CardField[]).every(key => sameValue(row[key], patch[key]))
}

export function insertCard(values: CardInsert) {
  return supabase.from('project_cards').insert(values).select('*').single()
}

/** Datas da linha do tempo, sem versão: a última que chega vale. */
export function rescheduleCard(cardId: string, dates: { start_date: string | null; due_date: string | null }) {
  return supabase.from('project_cards').update(dates).eq('id', cardId).select('id, updated_at')
}

export type CardSave =
  | { status: 'saved'; at: string; current?: ProjectCard }
  | { status: 'conflict'; current: ProjectCard }
  | { status: 'gone' }
  | { status: 'denied' }
  | { status: 'error'; error: WriteError }

/**
 * Grava `patch` só se o card ainda estiver na versão `expected` (o updated_at
 * que o servidor devolveu por último). Com zero linhas, relê o card:
 * - não existe mais (ou saiu do alcance da pessoa) → `gone`;
 * - já tem exatamente esses campos (reenvio duplicado) → `saved`, com o card
 *   de lá (outra pessoa pode ter mudado outros campos);
 * - na mesma versão e sem o patch → `denied`: a linha não mudou e mesmo assim
 *   o UPDATE não pegou, então o RLS recusou (editor que virou leitor);
 * - outra versão → `conflict`, com o card como está no servidor.
 */
export async function saveCardVersioned(id: string, patch: CardPatch, expected: string): Promise<CardSave> {
  const { data, error } = await supabase.from('project_cards').update(patch).eq('id', id).eq('updated_at', expected).select('id, updated_at')
  if (error) return { status: 'error', error }
  if (data.length > 0) return { status: 'saved', at: data[0].updated_at }

  const { data: row, error: readError } = await supabase.from('project_cards').select('*').eq('id', id).maybeSingle()
  if (readError) return { status: 'error', error: readError }
  if (!row) return { status: 'gone' }
  const current = normalizeCard(row)
  if (cardPatchMatches(current, patch)) return { status: 'saved', at: current.updated_at, current }
  if (current.updated_at === expected) return { status: 'denied' }
  return { status: 'conflict', current }
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
