import type { SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '../../types'

// ARCH-005 · PERF-006: tudo o que o export lê, em lotes de 100 páginas por
// tabela, em paralelo (antes eram uma ou duas consultas por página).

export interface NoteRow { page_id: string; content: unknown }
export interface DrawingRow { page_id: string; elements: unknown; app_state: unknown; files: unknown }
export interface TodoRow { page_id: string; text?: string | null; completed?: boolean | null; priority?: string | null }

export interface PageContents {
  notes: Map<string, NoteRow>
  drawings: Map<string, DrawingRow>
  todos: Map<string, TodoRow[]>
}

// Keeps the `page_id=in.(…)` query string well under proxy URL limits.
const IDS_PER_QUERY = 100

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Rows grouped by page_id, keeping the order they came in. */
export function groupByPage<T extends { page_id: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const list = out.get(row.page_id)
    if (list) list.push(row)
    else out.set(row.page_id, [row])
  }
  return out
}

/** A failed query leaves that content empty, as before. */
export async function fetchPageContents(
  client: SupabaseClient,
  pages: Pick<Page, 'id' | 'type'>[],
): Promise<PageContents> {
  const idsOf = (types: Page['type'][]) => pages.filter(p => types.includes(p.type)).map(p => p.id)
  const select = async <T>(ids: string[], run: (batch: string[]) => PromiseLike<{ data: unknown }>): Promise<T[]> => {
    const results = await Promise.all(chunk(ids, IDS_PER_QUERY).map(run))
    return results.flatMap(r => (r.data as T[] | null) ?? [])
  }
  const [notes, drawings, todos] = await Promise.all([
    select<NoteRow>(idsOf(['note', 'both']), batch =>
      client.from('note_contents').select('page_id, content').in('page_id', batch)),
    select<DrawingRow>(idsOf(['drawing', 'both']), batch =>
      client.from('drawing_contents').select('page_id, elements, app_state, files').in('page_id', batch)),
    select<TodoRow>(idsOf(['todo']), batch =>
      client.from('todos').select('*').in('page_id', batch)
        .order('completed', { ascending: true })
        .order('sort_order', { ascending: true })),
  ])
  return {
    notes: new Map(notes.map(n => [n.page_id, n])),
    drawings: new Map(drawings.map(d => [d.page_id, d])),
    todos: groupByPage(todos),
  }
}
