import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProfileBadge, ProjectCard, ProjectColumn } from '../../types'
import type { CardQueueRow } from '../../lib/cardQueue'
import { fetchAllRows } from '../../lib/fetchAllRows'

// REL-006: ao trocar de quadro rápido, a resposta do quadro anterior podia
// chegar depois e sobrescrever o atual — e handlers que capturaram o id antes
// de um `await` chamavam a recarga do quadro antigo depois da do novo. As
// consultas também ignoravam `error`, e uma falha virava quadro vazio.
//
// A sequência fica num objeto `{ current }` (um useRef no ProjectsPanel) para
// sobreviver às recriações do callback; o resto é injetado, para testar sem
// React nem Supabase.

export interface BoardMember {
  id: string
  email: string
  display_name: string | null
  avatar_emoji?: string | null
  avatar_color?: string | null
  avatar_url?: string | null
}

export interface BoardData {
  columns: ProjectColumn[]
  cards: ProjectCard[]
  queueRows: CardQueueRow[]
  members: BoardMember[]
}

export interface BoardLoadDeps<T> {
  fetch: (boardId: string) => Promise<T>
  /** Se o quadro ainda é o que está na tela. */
  isActive: (boardId: string) => boolean
  apply: (boardId: string, data: T) => void
  fail: (boardId: string, error: unknown, silent: boolean) => void
  setLoading: (loading: boolean) => void
}

/**
 * Carrega o quadro e só aplica a resposta do pedido mais recente, e só se o
 * quadro ainda estiver na tela. Pedido de quadro que já saiu da tela nem entra
 * na sequência: se entrasse, descartaria o carregamento do quadro atual.
 */
export async function loadLatestBoard<T>(
  sequence: { current: number },
  deps: BoardLoadDeps<T>,
  boardId: string,
  silent: boolean,
): Promise<void> {
  if (!deps.isActive(boardId)) return
  const request = ++sequence.current
  if (!silent) deps.setLoading(true)
  const isCurrent = () => request === sequence.current && deps.isActive(boardId)
  try {
    const data = await deps.fetch(boardId)
    if (isCurrent()) deps.apply(boardId, data)
  } catch (error) {
    if (isCurrent()) deps.fail(boardId, error, silent)
  } finally {
    // Só o pedido mais recente encerra o "carregando": um antigo terminando
    // antes apagaria o do novo, e um silencioso que substituiu um visível
    // precisa encerrá-lo mesmo assim.
    if (request === sequence.current) deps.setLoading(false)
  }
}

const QUEUE_OPEN_STATUSES = ['queued', 'in_progress', 'review', 'blocked']

type RawCard = Omit<ProjectCard, 'labels' | 'checklist' | 'links' | 'attachments'> & {
  labels: ProjectCard['labels'] | null
  checklist: ProjectCard['checklist'] | null
  links: ProjectCard['links'] | null
  attachments: ProjectCard['attachments'] | null
  assignee?: ProfileBadge | ProfileBadge[] | null
}

function asError(error: { message: string }): Error {
  return error instanceof Error ? error : Object.assign(new Error(error.message), { cause: error })
}

/**
 * As 5 consultas do quadro. Lança o primeiro `error`: quadro com dado faltando
 * não é mostrado como se estivesse vazio.
 */
export async function fetchBoardData(
  client: SupabaseClient,
  boardId: string,
  memberSeed: (string | null | undefined)[],
): Promise<BoardData> {
  const [cols, cds, queue] = await Promise.all([
    client.from('project_columns').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }),
    // REL-003: paginado; um backlog grande importado passa de 1000 cards, e
    // o PostgREST corta o resto sem erro.
    fetchAllRows<RawCard>((from, to) => client.from('project_cards').select('*, assignee:profiles!project_cards_assignee_user_id_fkey(email, display_name, avatar_emoji, avatar_color, avatar_url)').eq('board_id', boardId).order('sort_order', { ascending: true }).order('id').range(from, to)),
    client.from('project_card_queue').select('id, card_id, position, status, phase').eq('board_id', boardId).in('status', QUEUE_OPEN_STATUSES),
  ])
  for (const res of [cols, cds, queue]) if (res.error) throw asError(res.error)

  const memberIds = new Set(memberSeed.filter((id): id is string => !!id))
  const shares = await client.from('project_shares').select('shared_with_user_id').eq('board_id', boardId)
  if (shares.error) throw asError(shares.error)
  for (const s of (shares.data ?? []) as { shared_with_user_id: string }[]) memberIds.add(s.shared_with_user_id)
  const profs = await client.from('profiles').select('id, email, display_name, avatar_emoji, avatar_color, avatar_url').in('id', [...memberIds])
  if (profs.error) throw asError(profs.error)

  return {
    columns: (cols.data ?? []) as ProjectColumn[],
    cards: (cds.data ?? []).map(({ assignee, ...r }) => ({
      ...r,
      labels: r.labels ?? [],
      checklist: r.checklist ?? [],
      links: r.links ?? [],
      attachments: r.attachments ?? [],
      assignee_profile: (Array.isArray(assignee) ? assignee[0] : assignee) ?? undefined,
    })),
    queueRows: (queue.data ?? []),
    members: (profs.data ?? []),
  }
}
