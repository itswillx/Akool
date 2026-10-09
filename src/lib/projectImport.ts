import { supabase } from './supabase'
import type { ProjectBoard, ProjectCard, ProjectColumn } from '../types'
// API-020: o snapshot do bloco projectCard mora no módulo puro das notas, que
// o valida (o API-044 monta o mesmo snapshot no servidor). Só tipo: nada no bundle.
import type { ProjectCardSnapshot } from '../../supabase/functions/_domain/blocknote/projectCard'

export type { ProjectCardSnapshot }

// Loads the boards the user can read: their own plus the ones shared with them.
// Mirrors ProjectsPanel's `loadBoards` so both surfaces stay consistent.
export async function fetchAccessibleBoards(userId: string): Promise<ProjectBoard[]> {
  const [{ data: own }, { data: shared }] = await Promise.all([
    supabase.from('project_boards').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('project_shares').select('role, project_boards(*)').eq('shared_with_user_id', userId),
  ])
  const ownBoards: ProjectBoard[] = (own ?? []).map(b => ({ ...b, share_role: 'owner' as const }))
  const sharedBoards: ProjectBoard[] = []
  if (shared) {
    for (const { role, project_boards: b } of shared) {
      if (b) sharedBoards.push({ ...b, share_role: role, is_shared: true })
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
  const columns: ProjectColumn[] = cols ?? []
  const cards: ProjectCard[] = (cds ?? []).map(r => ({
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
