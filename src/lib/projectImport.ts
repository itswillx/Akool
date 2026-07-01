import { supabase } from './supabase'
import type { ProjectBoard, ProjectCard, ProjectCardPriority, ProjectColumn, ProjectShareRole } from '../types'

// Snapshot of a project card embedded inside a note's `projectCard` block. Kept
// flat and JSON-serialisable so it can live in BlockNote's string-only prop
// schema, and self-contained so the block renders even if the source card is
// later changed or removed.
export interface ProjectCardSnapshot {
  title: string
  description: string
  priority: ProjectCardPriority
  startDate: string | null
  dueDate: string | null
  labels: string[]
  checklist: { text: string; completed: boolean }[]
  completed: boolean
  columnName: string | null
  boardName: string
  boardIcon: string
  boardColor: string
}

// Loads the boards the user can read: their own plus the ones shared with them.
// Mirrors ProjectsPanel's `loadBoards` so both surfaces stay consistent.
export async function fetchAccessibleBoards(userId: string): Promise<ProjectBoard[]> {
  const [{ data: own }, { data: shared }] = await Promise.all([
    supabase.from('project_boards').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('project_shares').select('role, project_boards(*)').eq('shared_with_user_id', userId),
  ])
  const ownBoards: ProjectBoard[] = (own as ProjectBoard[] ?? []).map(b => ({ ...b, share_role: 'owner' as const }))
  const sharedBoards: ProjectBoard[] = []
  if (shared) {
    for (const row of shared) {
      const raw = (row as unknown as { project_boards: ProjectBoard | ProjectBoard[] }).project_boards
      const b = Array.isArray(raw) ? raw[0] : raw
      if (b) sharedBoards.push({ ...b, share_role: (row as { role: ProjectShareRole }).role, is_shared: true })
    }
  }
  return [...ownBoards, ...sharedBoards]
}

// Loads a board's columns and cards for the import picker. Mirrors
// ProjectsPanel's `loadBoardData` but skips the assignee join (not needed here).
export async function fetchBoardCards(boardId: string): Promise<{ columns: ProjectColumn[]; cards: ProjectCard[] }> {
  const [{ data: cols }, { data: cds }] = await Promise.all([
    supabase.from('project_columns').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }),
    supabase.from('project_cards').select('*').eq('board_id', boardId).order('sort_order', { ascending: true }),
  ])
  const columns = (cols as ProjectColumn[]) ?? []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cards: ProjectCard[] = ((cds as any[]) ?? []).map((r: any) => ({
    ...r,
    labels: r.labels ?? [],
    checklist: r.checklist ?? [],
    attachments: r.attachments ?? [],
  }))
  return { columns, cards }
}

export function buildCardSnapshot(card: ProjectCard, board: ProjectBoard, columnName: string | null): ProjectCardSnapshot {
  return {
    title: card.title,
    description: card.description,
    priority: card.priority,
    startDate: card.start_date,
    dueDate: card.due_date,
    labels: card.labels ?? [],
    checklist: (card.checklist ?? []).map(c => ({ text: c.text, completed: c.completed })),
    completed: card.completed,
    columnName,
    boardName: board.name,
    boardIcon: board.icon,
    boardColor: board.color,
  }
}
