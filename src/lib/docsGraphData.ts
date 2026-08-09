import { supabase } from './supabase'
import { fetchAccessibleBoards } from './projectImport'
import type { ProfileBadge, ProjectBoard, ProjectCard } from '../types'

// Loader for the documents "Rede" section. Everything the graph needs beyond
// pages (from PagesContext) and quick notes (from useQuickNotes), in two waves.
//
// Deliberately NOT reusing ProjectsPanel's inline loaders: those write into five
// of the panel's useState, consult refs to decide whether a refresh is silent,
// and drive the card-modal restore — untangling them would be a real refactor of
// a 2789-line file with no tests. This mirrors them the same way
// projectImport.ts's fetchAccessibleBoards already does.

export interface DocsGraphRemote {
  boards: ProjectBoard[]
  columns: { id: string; board_id: string; name: string }[]
  cards: ProjectCard[]
  pageShares: { page_id: string; shared_with_user_id: string }[]
  boardShares: { board_id: string; shared_with_user_id: string }[]
  /** Keyed by user id, WITHOUT the signed-in user (never a graph node). */
  profiles: Map<string, ProfileBadge>
}

const EMPTY: DocsGraphRemote = {
  boards: [], columns: [], cards: [], pageShares: [], boardShares: [], profiles: new Map(),
}

// PostgREST puts .in() lists in the URL, so a few hundred uuids overflow it.
// Query in batches and concatenate.
async function chunkedIn<T>(
  ids: string[],
  size: number,
  run: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return []
  const out: T[] = []
  for (let i = 0; i < ids.length; i += size) {
    out.push(...await run(ids.slice(i, i + size)))
  }
  return out
}

const CHUNK = 200

export async function fetchDocsGraphData(userId: string, pageIds: string[]): Promise<DocsGraphRemote> {
  const boards = await fetchAccessibleBoards(userId)
  const boardIds = boards.map(b => b.id)
  if (boardIds.length === 0 && pageIds.length === 0) return EMPTY

  const [rawCards, columns, boardShares, pageShares] = await Promise.all([
    chunkedIn(boardIds, CHUNK, async batch => {
      const { data } = await supabase.from('project_cards').select('*').in('board_id', batch)
      return (data ?? []) as ProjectCard[]
    }),
    chunkedIn(boardIds, CHUNK, async batch => {
      const { data } = await supabase.from('project_columns').select('id, board_id, name').in('board_id', batch)
      return (data ?? []) as { id: string; board_id: string; name: string }[]
    }),
    chunkedIn(boardIds, CHUNK, async batch => {
      const { data } = await supabase.from('project_shares').select('board_id, shared_with_user_id').in('board_id', batch)
      return (data ?? []) as { board_id: string; shared_with_user_id: string }[]
    }),
    chunkedIn(pageIds, CHUNK, async batch => {
      const { data } = await supabase.from('page_shares').select('page_id, shared_with_user_id').in('page_id', batch)
      return (data ?? []) as { page_id: string; shared_with_user_id: string }[]
    }),
  ])

  // JSONB columns come back null when never written; the graph builder reads
  // them as arrays. Same normalization ProjectsPanel does after its query.
  const cards: ProjectCard[] = rawCards.map(c => ({
    ...c,
    labels: c.labels ?? [],
    checklist: c.checklist ?? [],
    attachments: c.attachments ?? [],
    links: c.links ?? [],
    depends_on: c.depends_on ?? [],
  }))

  const peopleIds = new Set<string>()
  for (const c of cards) if (c.assignee_user_id) peopleIds.add(c.assignee_user_id)
  for (const s of boardShares) peopleIds.add(s.shared_with_user_id)
  for (const s of pageShares) peopleIds.add(s.shared_with_user_id)
  // Owners of boards shared WITH me are people too — they don't appear in any
  // share row pointing at themselves.
  for (const b of boards) if (b.is_shared && b.user_id) peopleIds.add(b.user_id)
  peopleIds.delete(userId)

  const profileRows = await chunkedIn([...peopleIds], CHUNK, async batch => {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, display_name, avatar_emoji, avatar_color, avatar_url')
      .in('id', batch)
    return (data ?? []) as (ProfileBadge & { id: string })[]
  })

  return {
    boards,
    columns,
    cards,
    pageShares,
    boardShares,
    profiles: new Map(profileRows.map(p => [p.id, p])),
  }
}
