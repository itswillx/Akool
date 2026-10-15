// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '../test/rtl'
import type { Todo } from '../types'

// REL-004: a lista de tarefas de uma página. Carrega ordenada, adiciona do
// servidor, e marcar/editar/excluir são otimistas com rollback da linha
// tocada. Leitor (viewer) só vê; página compartilhada recarrega pelo realtime.

type Op = 'select' | 'insert' | 'update' | 'delete'
type Res = { data: unknown; error: { message: string; code?: string } | null }

const db = vi.hoisted(() => {
  const results: Partial<Record<Op, Res | Res[]>> = {}
  return {
    results,
    calls: [] as { op: Op; filters: string[]; payload?: unknown; orders: string[] }[],
    channels: [] as { name: string; onChange: () => void }[],
    removed: [] as string[],
  }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const call = { op: 'select' as Op, filters: [] as string[], payload: undefined as unknown, orders: [] as string[] }
      const b = {
        select: () => b, single: () => b,
        order: (col: string) => { call.orders.push(col); return b },
        eq: (col: string, value: unknown) => { call.filters.push(`${col}=${String(value)}`); return b },
        insert: (row: unknown) => { call.op = 'insert'; call.payload = row; return b },
        update: (values: unknown) => { call.op = 'update'; call.payload = values; return b },
        delete: () => { call.op = 'delete'; return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          db.calls.push(call)
          const result = db.results[call.op]
          const next = Array.isArray(result) ? result.shift() : result
          return Promise.resolve(next ?? { data: [{ id: 'ok' }], error: null }).then(resolve, reject)
        },
      }
      return b
    },
    channel: (name: string) => {
      const ch = { name, onChange: () => {} }
      const api = {
        on: (_event: string, _filter: unknown, cb: () => void) => { ch.onChange = cb; return api },
        subscribe: () => { db.channels.push(ch); return ch },
      }
      return api
    },
    removeChannel: (ch: { name: string }) => { db.removed.push(ch.name) },
  },
}))

const showToast = vi.fn()
const pages = vi.hoisted(() => ({ role: null as null | 'viewer' | 'editor' }))
const ui = vi.hoisted(() => ({ mobile: false }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../contexts/PagesContext', () => ({ usePages: () => ({ userShareRole: () => pages.role }) }))
vi.mock('../i18n/LanguageContext', () => ({
  useLanguage: () => ({ t: (k: string, vars?: Record<string, unknown>) => (vars ? `${k} ${JSON.stringify(vars)}` : k) }),
}))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => ui.mobile }))

import TodoList from './TodoList'

const todo = (id: string, text: string, extra: Partial<Todo> = {}): Todo => ({
  id, page_id: 'p1', user_id: 'u1', text, completed: false, due_date: null, priority: 'medium',
  sort_order: 1, created_at: null, updated_at: null, ...extra,
})

beforeEach(() => {
  db.results = {}
  db.calls = []
  db.channels = []
  db.removed = []
  pages.role = null
  ui.mobile = false
  showToast.mockReset()
})

async function mount(rows: Todo[], props: { embedded?: boolean } = {}) {
  db.results.select = { data: rows, error: null }
  const view = render(<TodoList pageId="p1" {...props} />)
  await waitFor(() => expect(screen.queryByText('todo_loading')).toBeNull())
  return view
}
const item = (text: string) => screen.getByText(text).closest('li') as HTMLElement
const writes = (op: Op) => db.calls.filter(c => c.op === op)

describe('TodoList', () => {
  it('carrega as tarefas da página, em ordem (abertas primeiro), com o resumo', async () => {
    await mount([todo('a', 'Comprar pão'), todo('b', 'Pagar luz', { completed: true })])
    expect(db.calls[0]).toMatchObject({ op: 'select', filters: ['page_id=p1'], orders: ['completed', 'sort_order'] })
    expect(screen.getByText('todo_stats {"open":1,"done":1,"total":2}')).toBeTruthy()
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Comprar pão'), expect.stringContaining('Pagar luz'),
    ])
  })

  it('embutida não tem título; sem tarefas mostra o vazio', async () => {
    await mount([], { embedded: true })
    expect(screen.queryByText('todo_title')).toBeNull()
    expect(screen.getByText('todo_empty_all')).toBeTruthy()
  })

  it('erro ao carregar vira lista vazia (e vai para o console)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.results.select = { data: null, error: { message: 'boom' } }
    render(<TodoList pageId="p1" />)
    expect(await screen.findByText('todo_empty_all')).toBeTruthy()
    expect(spy).toHaveBeenCalledWith('todos refresh error:', { message: 'boom' })
    spy.mockRestore()
  })

  it('adicionar grava texto aparado, com página e dono, e põe a linha no fim', async () => {
    await mount([todo('a', 'Primeira')])
    db.results.insert = { data: todo('n', 'Nova tarefa', { sort_order: 2 }), error: null }
    const input = screen.getByPlaceholderText('todo_add_placeholder')
    fireEvent.change(input, { target: { value: '  Nova tarefa  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('Nova tarefa')
    expect(writes('insert')).toHaveLength(1)
    expect(writes('insert')[0].payload).toMatchObject({ page_id: 'p1', user_id: 'u1', text: 'Nova tarefa' })
    expect((input as HTMLInputElement).value).toBe('')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('o botão só liga com texto; em branco não grava nada', async () => {
    await mount([])
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'todo_add_btn' })
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('todo_add_placeholder'), { target: { value: '   ' } })
    fireEvent.submit(button.closest('form')!)
    await act(async () => {})
    expect(writes('insert')).toHaveLength(0)
  })

  it('falha ao adicionar avisa e devolve o texto ao campo', async () => {
    await mount([])
    db.results.insert = { data: null, error: { message: 'falhou' } }
    const input = screen.getByPlaceholderText<HTMLInputElement>('todo_add_placeholder')
    fireEvent.change(input, { target: { value: 'Não some' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'toast_error_save'))
    expect(input.value).toBe('Não some')
    expect(screen.getByText('todo_empty_all')).toBeTruthy()
  })

  it('marcar como feita é otimista e volta quando o RLS não grava nenhuma linha', async () => {
    await mount([todo('a', 'Comprar pão')])
    db.results.update = { data: [], error: null }
    fireEvent.click(within(item('Comprar pão')).getByTitle('todo_mark_done'))
    expect(within(item('Comprar pão')).getByTitle('todo_mark_open')).toBeTruthy()
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'toast_error_permission'))
    expect(within(item('Comprar pão')).getByTitle('todo_mark_done')).toBeTruthy()
    expect(writes('update')[0]).toMatchObject({ filters: ['id=a'], payload: { completed: true } })
  })

  it('editar com duplo clique: Enter grava o texto aparado; Esc desiste', async () => {
    await mount([todo('a', 'Comprar pão')])
    fireEvent.doubleClick(screen.getByText('Comprar pão'))
    const field = screen.getByDisplayValue('Comprar pão')
    fireEvent.change(field, { target: { value: '  Comprar pão integral ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(await screen.findByText('Comprar pão integral')).toBeTruthy()
    expect(writes('update')[0].payload).toMatchObject({ text: 'Comprar pão integral' })

    fireEvent.doubleClick(screen.getByText('Comprar pão integral'))
    const again = screen.getByDisplayValue('Comprar pão integral')
    fireEvent.change(again, { target: { value: 'Outra coisa' } })
    fireEvent.keyDown(again, { key: 'Escape' })
    expect(screen.getByText('Comprar pão integral')).toBeTruthy()
    expect(writes('update')).toHaveLength(1)
  })

  it('apagar o texto na edição não grava e devolve o original', async () => {
    await mount([todo('a', 'Comprar pão')])
    fireEvent.doubleClick(screen.getByText('Comprar pão'))
    const field = screen.getByDisplayValue('Comprar pão')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.blur(field)
    expect(screen.getByText('Comprar pão')).toBeTruthy()
    expect(writes('update')).toHaveLength(0)
  })

  it('prioridade e prazo gravam só o campo; falha desfaz o campo', async () => {
    await mount([todo('a', 'Comprar pão')])
    fireEvent.change(within(item('Comprar pão')).getByTitle('projects_priority'), { target: { value: 'high' } })
    await waitFor(() => expect(writes('update')).toHaveLength(1))
    expect(writes('update')[0].payload).toMatchObject({ priority: 'high' })

    db.results.update = { data: null, error: { message: 'falhou' } }
    const date = item('Comprar pão').querySelector('input[type="date"]') as HTMLInputElement
    fireEvent.change(date, { target: { value: '2030-05-01' } })
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'toast_error_reverted'))
    expect(writes('update')[1].payload).toMatchObject({ due_date: '2030-05-01' })
    expect((item('Comprar pão').querySelector('input[type="date"]') as HTMLInputElement).value).toBe('')
  })

  it('prazo vencido de tarefa aberta fica em vermelho; tarefa feita não', async () => {
    await mount([todo('a', 'Atrasada', { due_date: '2020-01-01' }), todo('b', 'Feita', { due_date: '2020-01-01', completed: true })])
    expect(within(item('Atrasada')).getByTitle('todo_due_date').style.color).toBe('var(--color-error)')
    expect(within(item('Feita')).getByTitle('todo_due_date').style.color).toBe('var(--color-text-muted)')
  })

  it('excluir tira da lista e, se o banco recusar, volta na mesma posição', async () => {
    await mount([todo('a', 'Um'), todo('b', 'Dois'), todo('c', 'Três')])
    db.results.delete = [{ data: [{ id: 'b' }], error: null }, { data: null, error: { message: 'falhou' } }]
    fireEvent.click(within(item('Dois')).getByTitle('todo_delete'))
    await waitFor(() => expect(screen.queryByText('Dois')).toBeNull())

    fireEvent.click(within(item('Um')).getByTitle('todo_delete'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('error', 'toast_error_reverted'))
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Um'), expect.stringContaining('Três'),
    ])
    expect(writes('delete').map(c => c.filters)).toEqual([['id=b'], ['id=a']])
  })

  it('filtros: abertas, feitas e o aviso quando o filtro não acha nada', async () => {
    await mount([todo('a', 'Aberta')])
    fireEvent.click(screen.getByRole('button', { name: 'todo_filter_done' }))
    expect(screen.queryByText('Aberta')).toBeNull()
    expect(screen.getByText('todo_empty_filter')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'todo_filter_open' }))
    expect(screen.getByText('Aberta')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'todo_filter_all' }))
    expect(screen.getByText('Aberta')).toBeTruthy()
  })

  it('leitor só vê: sem campo, sem excluir, controles desligados e clique sem efeito', async () => {
    pages.role = 'viewer'
    await mount([todo('a', 'Comprar pão')])
    expect(screen.queryByPlaceholderText('todo_add_placeholder')).toBeNull()
    expect(within(item('Comprar pão')).queryByTitle('todo_delete')).toBeNull()
    expect(within(item('Comprar pão')).getByTitle<HTMLSelectElement>('projects_priority').disabled).toBe(true)
    fireEvent.click(within(item('Comprar pão')).getByTitle('todo_mark_done'))
    fireEvent.doubleClick(screen.getByText('Comprar pão'))
    expect(screen.queryByDisplayValue('Comprar pão')).toBeNull()
    await act(async () => {})
    expect(writes('update')).toHaveLength(0)
  })

  it('página compartilhada assina o realtime, recarrega na mudança e sai ao desmontar', async () => {
    pages.role = 'editor'
    const view = await mount([todo('a', 'Comprar pão')])
    expect(db.channels.map(c => c.name)).toEqual(['todos:p1'])
    db.results.select = { data: [todo('a', 'Comprar pão'), todo('b', 'Do colega')], error: null }
    act(() => { db.channels[0].onChange() })
    expect(await screen.findByText('Do colega')).toBeTruthy()
    view.unmount()
    expect(db.removed).toEqual(['todos:p1'])
  })

  it('página só minha não assina o realtime', async () => {
    await mount([todo('a', 'Comprar pão')])
    expect(db.channels).toEqual([])
  })

  it('celular: título numa linha, prioridade e prazo na de baixo, excluir sempre visível', async () => {
    ui.mobile = true
    await mount([todo('a', 'Comprar pão')])
    const li = item('Comprar pão')
    expect(li.style.flexDirection).toBe('column')
    expect(within(li).getByTitle('todo_delete').style.opacity).toBe('1')
  })

  it('no desktop, o excluir aparece inteiro só com o mouse em cima', async () => {
    await mount([todo('a', 'Comprar pão')])
    const li = item('Comprar pão')
    const del = within(li).getByTitle('todo_delete')
    expect(del.style.opacity).toBe('0.4')
    fireEvent.mouseEnter(li)
    expect(del.style.opacity).toBe('1')
    fireEvent.mouseLeave(li)
    expect(del.style.opacity).toBe('0.4')
  })
})
