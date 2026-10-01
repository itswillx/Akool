import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Page } from '../types'

// PERF-006: as consultas saem em lote (e não por página), e o Excalidraw só é
// carregado quando alguma página exportada tem desenho.

const state = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {}
  return { excalidrawLoaded: false, queries: [] as { table: string; ids: string[] }[], rows }
})

vi.mock('@excalidraw/excalidraw', () => {
  state.excalidrawLoaded = true
  return { exportToBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }
})

vi.mock('jspdf', () => ({
  jsPDF: class {
    splitTextToSize(text: string) { return [text] }
    addImage() {} addPage() {} line() {} rect() {} save() {}
    setDrawColor() {} setFillColor() {} setFont() {} setFontSize() {} setTextColor() {} text() {}
  },
}))

// Cliente falso: registra cada consulta (tabela + ids do `.in`) e devolve as
// linhas configuradas cujo page_id está no lote.
function fakeClient() {
  return {
    from(table: string) {
      let ids: string[] = []
      const run = () => Promise.resolve({ data: (state.rows[table] ?? []).filter(r => ids.includes(String(r.page_id))), error: null })
      const builder = {
        select: () => builder,
        order: () => builder,
        in: (_col: string, values: string[]) => { ids = values; state.queries.push({ table, ids: values }); return builder },
        then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => run().then(onOk, onErr),
      }
      return builder
    },
  }
}

vi.mock('../lib/supabase', () => ({ supabase: fakeClient() }))

import { exportPagesToPdf, fetchPageContents, groupByPage, pdfSafe } from './usePdfExport'
import { getT } from '../i18n/translations'

const page = (id: string, type: Page['type']) => ({ id, type, title: id, updated_at: '2026-09-26T12:00:00Z' }) as Page

beforeEach(() => {
  state.queries = []
  state.rows = {}
})

describe('groupByPage', () => {
  it('agrupa mantendo a ordem de chegada', () => {
    const grouped = groupByPage([
      { page_id: 'a', n: 1 }, { page_id: 'b', n: 2 }, { page_id: 'a', n: 3 },
    ])
    expect(grouped.get('a')!.map(r => r.n)).toEqual([1, 3])
    expect(grouped.get('b')!.map(r => r.n)).toEqual([2])
  })
})

describe('fetchPageContents', () => {
  it('uma consulta por tabela, em vez de uma por página', async () => {
    state.rows = {
      note_contents: [{ page_id: 'n1', content: [1] }, { page_id: 'b1', content: [2] }],
      drawing_contents: [{ page_id: 'b1', elements: [] }],
      todos: [{ page_id: 't1', text: 'um' }, { page_id: 't1', text: 'dois' }],
    }
    const contents = await fetchPageContents(fakeClient() as unknown as SupabaseClient,
      [page('n1', 'note'), page('n2', 'note'), page('b1', 'both'), page('d1', 'drawing'), page('t1', 'todo')])
    expect(state.queries.map(q => q.table).sort()).toEqual(['drawing_contents', 'note_contents', 'todos'])
    expect(state.queries.find(q => q.table === 'note_contents')!.ids).toEqual(['n1', 'n2', 'b1'])
    expect(state.queries.find(q => q.table === 'drawing_contents')!.ids).toEqual(['b1', 'd1'])
    expect(contents.notes.get('b1')?.content).toEqual([2])
    expect(contents.todos.get('t1')!.map(t => t.text)).toEqual(['um', 'dois'])
  })

  it('sem páginas de um tipo, não consulta a tabela dele', async () => {
    await fetchPageContents(fakeClient() as unknown as SupabaseClient, [page('n1', 'note')])
    expect(state.queries.map(q => q.table)).toEqual(['note_contents'])
  })

  it('lotes de até 100 ids por consulta', async () => {
    const pages = Array.from({ length: 250 }, (_, i) => page(`p${i}`, 'todo'))
    await fetchPageContents(fakeClient() as unknown as SupabaseClient, pages)
    expect(state.queries.map(q => q.ids.length)).toEqual([100, 100, 50])
  })
})

describe('exportPagesToPdf', () => {
  it('não carrega o Excalidraw sem desenho; carrega quando há', async () => {
    state.rows = { note_contents: [{ page_id: 'n1', content: [] }] }
    await exportPagesToPdf([page('n1', 'note')], 'x.pdf', getT('pt-BR'))
    expect(state.excalidrawLoaded).toBe(false)

    state.rows = { drawing_contents: [{ page_id: 'd1', elements: [{ id: 'e1', isDeleted: false }], app_state: {}, files: {} }] }
    // Sem canvas no ambiente de teste o desenho cai no aviso de indisponível;
    // o que importa aqui é que o Excalidraw só foi pedido nesse caso.
    await exportPagesToPdf([page('d1', 'drawing')], 'y.pdf', getT('pt-BR')).catch(() => {})
    expect(state.excalidrawLoaded).toBe(true)
  })
})

describe('pdfSafe (UX-011)', () => {
  it('drops only the accents, keeping the letters', () => {
    expect(pdfSafe('Relatório de Ação')).toBe('Relatorio de Acao')
    expect(pdfSafe('Sem título 🚀')).toBe('Sem titulo ')
  })
})
