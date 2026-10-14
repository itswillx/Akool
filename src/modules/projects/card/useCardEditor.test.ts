// @vitest-environment happy-dom
import { createElement, StrictMode, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '../../../test/rtl'
import type { CardPatch, CardSave } from '../../../lib/data/projects'
import type { ProjectCard, ProjectCardAttachment } from '../../../types'
import type { PendingFile } from './cardDraft'
import type { CardIO } from './useCardEditor'

// API-013: o editor do card aberto. Cada caso reproduz um defeito achado na
// revisão do lote 03 (os nomes entre parênteses são os do plano).

const toasts = vi.hoisted(() => [] as [string, string][])
vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../contexts/ToastContext', () => ({
  useToast: () => ({ showToast: (kind: string, message: string) => { toasts.push([kind, message]) } }),
}))
vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { useCardEditor } = await import('./useCardEditor')
const { cardFormFrom, draftKeyFor, loadCardDraft, saveCardDraft } = await import('./cardDraft')

const card = (extra: Partial<ProjectCard> = {}): ProjectCard => ({
  id: 'c1', board_id: 'b1', column_id: 'col1', title: 'A', description: 'd', priority: 'medium',
  start_date: null, due_date: null, estimated_days: 1, assignee_user_id: null, labels: [], linked_page_id: null,
  parent_card_id: null, depends_on: [], completed: false, checklist: [], attachments: [], links: [],
  sort_order: 0, created_at: '', updated_at: 'v1', ...extra,
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

type SaveStep = CardSave | ReturnType<typeof deferred<CardSave>>

/** E/S falsa: as respostas de gravar saem da fila `steps` (um deferred segura a resposta). */
function fakeIO(steps: SaveStep[] = []) {
  const saves: [CardPatch, string][] = []
  const inserts: Record<string, unknown>[] = []
  const uploads: string[] = []
  const removed: string[][] = []
  let insertGate: ReturnType<typeof deferred<void>> | null = null
  const io: CardIO = {
    userId: 'u1',
    insert: vi.fn(async values => {
      inserts.push(values as Record<string, unknown>)
      if (insertGate) await insertGate.promise
      return { card: card({ ...values, id: 'novo', updated_at: 'n1' } as Partial<ProjectCard>) }
    }),
    save: vi.fn((_id: string, patch: CardPatch, version: string): Promise<CardSave> => {
      saves.push([patch, version])
      const step = steps.shift()
      if (!step) return Promise.resolve({ status: 'saved', at: `${version}+` })
      return 'promise' in step ? step.promise : Promise.resolve(step)
    }),
    upload: vi.fn(async (_b: string, _c: string, pending: PendingFile): Promise<ProjectCardAttachment> => {
      uploads.push(pending.id)
      return { id: `att-${pending.id}`, url: `u1/b1/novo/${pending.id}.png`, name: 'x.png' }
    }),
    removeUploads: vi.fn(async (paths: string[]) => { removed.push(paths) }),
    onInserted: vi.fn(),
    onSaved: vi.fn(),
    onDenied: vi.fn(),
  }
  return { io, saves, inserts, uploads, removed, gateInsert: () => { insertGate = deferred<void>(); return insertGate } }
}

const mount = (io: CardIO, open: ProjectCard | null = card(), strict = false) => renderHook(
  () => useCardEditor({ card: open, boardId: 'b1', columnId: 'col1', canEdit: true, io }),
  strict ? { wrapper: ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children) } : undefined,
)

const settle = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })

beforeEach(() => {
  toasts.length = 0
  sessionStorage.clear()
})
afterEach(() => vi.useRealTimers())

describe('uma gravação por vez, sempre do formulário mais novo', () => {
  it('Salvar com o debounce ainda pendente e outra edição no meio do insert: um insert só (A2)', async () => {
    const { io, inserts, saves, gateInsert } = fakeIO()
    const { result } = mount(io, null)
    act(() => result.current.patchForm(f => ({ ...f, title: 'Novo' })))           // debounce pendente
    const gate = gateInsert()
    let flushed!: Promise<boolean>
    act(() => { flushed = result.current.flush() })                               // Salvar
    await settle()                                                                // o insert está em voo
    act(() => result.current.patchForm(f => ({ ...f, priority: 'urgent' }), true)) // no meio do insert
    gate.resolve()
    await act(async () => { await flushed })
    await settle()
    expect(inserts).toHaveLength(1)
    expect(saves).toEqual([[{ priority: 'urgent' }, 'n1']])
  })

  it('refazer por cima da outra pessoa não reverte o campo dela com um retrato velho (A3, contraexemplo i)', async () => {
    const second = deferred<CardSave>()
    const { io, saves } = fakeIO([
      { status: 'conflict', current: card({ description: 'x', updated_at: 'v2' }) },
      second,
    ])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'A1' }), true))
    await settle()
    // A pessoa continua digitando no título enquanto o segundo UPDATE está em voo.
    act(() => result.current.patchForm(f => ({ ...f, title: 'A12' }), true))
    second.resolve({ status: 'saved', at: 'v3' })
    await settle()
    expect(saves).toEqual([[{ title: 'A1' }, 'v1'], [{ title: 'A1' }, 'v2'], [{ title: 'A12' }, 'v3']])
    expect(result.current.form.description).toBe('x')
  })

  it('mudança minha seguida de uma dela no mesmo campo: fica a dela, sem aviso (contraexemplo ii)', async () => {
    const { io } = fakeIO([
      { status: 'saved', at: 'v2' },
      { status: 'conflict', current: card({ title: 'C', updated_at: 'v3' }) },
      { status: 'saved', at: 'v4' },
    ])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'B' }), true))
    await settle()
    act(() => result.current.patchForm(f => ({ ...f, priority: 'high' }), true))
    await settle()
    expect(result.current.conflict).toBeNull()
    expect(result.current.form).toMatchObject({ title: 'C', priority: 'high' })
  })

  it('campo mexido durante o voo que a outra pessoa também mudou vira aviso (1e)', async () => {
    const second = deferred<CardSave>()
    const { io } = fakeIO([{ status: 'conflict', current: card({ description: 'dela', updated_at: 'v2' }) }, second])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' }), true))
    await settle()
    act(() => result.current.patchForm(f => ({ ...f, description: 'digitei' })))   // debounce: não grava ainda
    second.resolve({ status: 'saved', at: 'v3' })
    await settle()
    expect(result.current.conflict?.fields).toEqual(['description'])
    expect(result.current.form.description).toBe('digitei')
  })

  it('"saved" pela releitura traz o que a outra pessoa mudou nos outros campos (A5)', async () => {
    const { io } = fakeIO([{ status: 'saved', at: 'v2', current: card({ title: 'meu', description: 'dela', updated_at: 'v2' }) }])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' }), true))
    await settle()
    expect(result.current.form.description).toBe('dela')
  })
})

describe('sessão e fechamento', () => {
  it('foto que termina de comprimir depois de fechar não entra, e nada é gravado (A1)', async () => {
    const { io, saves } = fakeIO()
    const { result, unmount } = mount(io)
    const add = result.current.addPending
    unmount()
    expect(add({ id: 'p1', file: new Blob() as File, preview: 'blob:x' })).toBe('closed')
    await settle()
    expect(saves).toEqual([])
  })

  it('debounce pendente ao desmontar não grava depois', async () => {
    vi.useFakeTimers()
    const { io, saves } = fakeIO()
    const { result, unmount } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'x' })))
    unmount()
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(saves).toEqual([])
  })

  it('fechar com uma gravação em voo: a última parte da versão que a anterior deixou (A2b)', async () => {
    const first = deferred<CardSave>()
    const { io, saves } = fakeIO([first])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'um' }), true))
    await settle()                                                                // a primeira está em voo
    act(() => result.current.patchForm(f => ({ ...f, priority: 'high' }), true))
    act(() => result.current.finish())
    first.resolve({ status: 'saved', at: 'v2' })
    await settle()
    expect(saves).toEqual([[{ title: 'um' }, 'v1'], [{ priority: 'high' }, 'v2']])
  })

  it('conflito numa gravação depois de fechar: toast e rascunho com a base, para reabrir com o aviso (H9)', async () => {
    const first = deferred<CardSave>()
    const { io } = fakeIO([first])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' }), true))
    act(() => result.current.finish())
    first.resolve({ status: 'conflict', current: card({ title: 'dela', updated_at: 'v2' }) })
    await settle()
    expect(toasts).toContainEqual(['error', 'projects_card_conflict_closed'])
    const draft = loadCardDraft(draftKeyFor('b1', 'c1'))
    expect(draft).toMatchObject({ form: { title: 'meu' }, base: { version: 'v1' } })
  })

  it('rascunho com mudança pendente grava uma vez ao montar, também em StrictMode (H1)', async () => {
    const opened = card({ description: 'dela', updated_at: 'v5' })
    saveCardDraft(draftKeyFor('b1', 'c1'), {
      form: { ...cardFormFrom(card()), title: 'meu' }, savedAt: '', removedAttachmentIds: [],
      base: { version: 'v1', fields: { ...cardFormFrom(card()), start_date: null, due_date: null } },
    })
    const { io, saves } = fakeIO([{ status: 'conflict', current: opened }, { status: 'saved', at: 'v6' }])
    const { result } = mount(io, opened, true)
    await settle()
    // A primeira vai na versão do rascunho e manda só a mudança; a dela entra pelo refazer (A4).
    expect(saves[0]).toEqual([{ title: 'meu' }, 'v1'])
    expect(saves[1]).toEqual([{ title: 'meu' }, 'v5'])
    expect(saves).toHaveLength(2)
    expect(result.current.form).toMatchObject({ title: 'meu', description: 'dela' })
  })

  it('Aprovar espera a gravação em voo (H10)', async () => {
    const first = deferred<CardSave>()
    const { io } = fakeIO([first])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'x' }), true))
    let done = false
    let flushed!: Promise<boolean>
    act(() => { flushed = result.current.flush().then(ok => { done = true; return ok }) })
    await settle()
    expect(done).toBe(false)
    first.resolve({ status: 'saved', at: 'v2' })
    await act(async () => { expect(await flushed).toBe(true) })
  })
})

describe('falhas e aviso', () => {
  it('sem permissão: avisa, relê os quadros e para de gravar (U4)', async () => {
    const { io, saves } = fakeIO([{ status: 'denied' }])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'x' }), true))
    await settle()
    act(() => result.current.patchForm(f => ({ ...f, title: 'y' }), true))
    await settle()
    expect(saves).toHaveLength(1)
    expect(io.onDenied).toHaveBeenCalled()
    expect(toasts).toContainEqual(['error', 'projects_card_denied'])
    expect(result.current.status).toBe('error')
  })

  it('aviso: nada grava até a escolha; "manter a minha" grava sobre a versão dela', async () => {
    const { io, saves } = fakeIO([{ status: 'conflict', current: card({ title: 'dela', description: 'nota', updated_at: 'v3' }) }])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' }), true))
    await settle()
    expect(result.current.conflict?.fields).toEqual(['title'])
    act(() => result.current.patchForm(f => ({ ...f, priority: 'high' }), true))
    await settle()
    expect(saves).toHaveLength(1)
    act(() => result.current.resolve('mine'))
    await settle()
    expect(saves[1]).toEqual([{ title: 'meu', priority: 'high' }, 'v3'])
    expect(result.current.form.description).toBe('nota')
  })

  it('imagem sobe uma vez só e sobrevive ao conflito (H7a); a que não entrou é apagada ao fechar', async () => {
    const { io, uploads, saves, removed } = fakeIO([{ status: 'conflict', current: card({ title: 'dela', updated_at: 'v3' }) }])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' })))
    act(() => { result.current.addPending({ id: 'p1', file: new Blob() as File, preview: 'blob:x' }) })
    await settle()
    expect(result.current.conflict).not.toBeNull()
    act(() => result.current.resolve('theirs'))
    await settle()
    expect(uploads).toEqual(['p1'])
    expect(saves[1][0]).toEqual({ attachments: [{ id: 'att-p1', url: 'u1/b1/novo/p1.png', name: 'x.png' }] })
    expect(result.current.pendingFiles).toEqual([])
    act(() => result.current.finish())
    await settle()
    expect(removed).toEqual([])
  })

  it('limite de anexos conta as pendentes', () => {
    const { io } = fakeIO()
    const full = card({ attachments: Array.from({ length: 49 }, (_, i) => ({ id: `a${i}`, url: `u/${i}`, name: 'x' })) })
    const { result } = mount(io, full)
    let first = ''
    let second = ''
    act(() => { first = result.current.addPending({ id: 'p1', file: new Blob() as File, preview: 'x' }) })
    act(() => { second = result.current.addPending({ id: 'p2', file: new Blob() as File, preview: 'y' }) })
    expect([first, second]).toEqual(['added', 'full'])
  })
})

// Segunda revisão do lote 03.
describe('correções da segunda revisão', () => {
  it('conflito disputado num segundo refazer: as escolhas não desfazem o que a outra pessoa gravou antes', async () => {
    const steps = () => [
      { status: 'conflict', current: card({ description: 'dela', updated_at: 'v2' }) },
      { status: 'conflict', current: card({ description: 'dela', title: 'T dela', updated_at: 'v3' }) },
    ] as CardSave[]
    for (const choice of ['mine', 'theirs'] as const) {
      sessionStorage.clear()
      const { io, saves } = fakeIO(steps())
      const { result, unmount } = mount(io)
      act(() => result.current.patchForm(f => ({ ...f, title: 'meu' }), true))
      await settle()
      expect(result.current.conflict?.fields).toEqual(['title'])
      act(() => result.current.resolve(choice))
      await settle()
      const sent = saves.slice(2).map(([patch]) => patch)
      expect(sent.some(p => 'description' in p)).toBe(false)
      expect(result.current.form.description).toBe('dela')
      if (choice === 'mine') expect(saves.at(-1)).toEqual([{ title: 'meu' }, 'v3'])
      unmount()
    }
  })

  it('a descrição que veio de outra pessoa avisa o editor de texto (descRev sobe)', async () => {
    const { io } = fakeIO([{ status: 'conflict', current: card({ description: 'dela', updated_at: 'v2' }) }])
    const { result } = mount(io)
    const before = result.current.descRev
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' }), true))
    await settle()
    expect(result.current.form.description).toBe('dela')
    expect(result.current.descRev).toBe(before + 1)
  })

  it('remover a imagem pendente com a gravação em voo: ela sai do card, e o arquivo é apagado ao fechar', async () => {
    const first = deferred<CardSave>()
    const { io, saves, removed } = fakeIO([first])
    const { result } = mount(io)
    act(() => { result.current.addPending({ id: 'p1', file: new Blob() as File, preview: 'blob:x' }) })
    await settle() // subiu e o UPDATE com o anexo está em voo
    act(() => result.current.removePending('p1'))
    first.resolve({ status: 'saved', at: 'v2' })
    await settle()
    expect(saves[0][0]).toMatchObject({ attachments: [{ id: 'att-p1' }] })
    expect(saves.at(-1)).toEqual([{ attachments: [] }, 'v2'])
    act(() => result.current.finish())
    await settle()
    expect(removed).toEqual([['u1/b1/novo/p1.png']])
  })

  it('fechar com o aviso na tela: a imagem que subiu não é apagada e vai para o rascunho', async () => {
    const { io, removed } = fakeIO([{ status: 'conflict', current: card({ title: 'dela', updated_at: 'v3' }) }])
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'meu' })))
    act(() => { result.current.addPending({ id: 'p1', file: new Blob() as File, preview: 'blob:x' }) })
    await settle()
    expect(result.current.conflict).not.toBeNull()
    act(() => result.current.finish())
    await settle()
    expect(removed).toEqual([])
    expect(loadCardDraft(draftKeyFor('b1', 'c1'))?.uploaded).toEqual([{ id: 'att-p1', url: 'u1/b1/novo/p1.png', name: 'x.png' }])
  })

  it('a imagem do rascunho entra no card na reabertura, sem subir de novo', async () => {
    saveCardDraft(draftKeyFor('b1', 'c1'), {
      form: cardFormFrom(card()), savedAt: '', removedAttachmentIds: [],
      base: { version: 'v1', fields: { ...cardFormFrom(card()), start_date: null, due_date: null } },
      uploaded: [{ id: 'att-old', url: 'u1/b1/c1/old.png', name: 'old.png' }],
    })
    const { io, saves, uploads } = fakeIO()
    mount(io)
    await settle()
    expect(uploads).toEqual([])
    expect(saves).toEqual([[{ attachments: [{ id: 'att-old', url: 'u1/b1/c1/old.png', name: 'old.png' }] }, 'v1']])
  })

  it('card novo fechado com o insert em voo e uma edição no debounce: a edição vai depois do insert', async () => {
    const { io, inserts, saves, gateInsert } = fakeIO()
    const { result } = mount(io, null)
    const gate = gateInsert()
    act(() => result.current.patchForm(f => ({ ...f, title: 'Novo' }), true))
    await settle()
    act(() => result.current.patchForm(f => ({ ...f, priority: 'urgent' })))  // debounce
    act(() => result.current.finish())
    gate.resolve()
    await settle()
    expect(inserts).toHaveLength(1)
    expect(saves).toEqual([[{ priority: 'urgent' }, 'n1']])
  })

  it('excluir que falha: a edição do debounce é gravada ao retomar', async () => {
    const { io, saves } = fakeIO()
    const { result } = mount(io)
    act(() => result.current.patchForm(f => ({ ...f, title: 'x' })))  // debounce
    await act(async () => { await result.current.stop() })
    expect(saves).toEqual([])
    act(() => result.current.resume())
    await settle()
    expect(saves).toEqual([[{ title: 'x' }, 'v1']])
  })

  it('recarregar com uma gravação em voo: o servidor ter o que ia não é conflito contra a própria pessoa', async () => {
    // A edição anterior mandava título 'ab' (v1 → v2) e a pessoa já tinha digitado 'abc'.
    const fields = { ...cardFormFrom(card()), start_date: null, due_date: null }
    saveCardDraft(draftKeyFor('b1', 'c1'), {
      form: { ...cardFormFrom(card()), title: 'abc' }, savedAt: '', removedAttachmentIds: [],
      base: { version: 'v1', fields }, sentPatch: { title: 'ab' },
    })
    const { io, saves } = fakeIO([{ status: 'conflict', current: card({ title: 'ab', updated_at: 'v2' }) }])
    const { result } = mount(io)
    await settle()
    expect(result.current.conflict).toBeNull()
    expect(saves.at(-1)).toEqual([{ title: 'abc' }, 'v2'])
  })
})

