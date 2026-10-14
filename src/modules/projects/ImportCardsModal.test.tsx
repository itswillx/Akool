// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DomainTFor } from '../../../supabase/functions/_domain/i18n.pt-BR'
import type { ImportIssueKey } from '../../../supabase/functions/_domain/importPlan'
import { getT, loadLang } from '../../i18n/translations'
import { parseBacklogMarkdown } from '../../lib/backlogMarkdownParser'
import { importIssueText, importWarningText, planCardRows } from '../../lib/importProjectCards'
import type { ProjectCard, ProjectColumn } from '../../types'

// UX-009: o modal de importação não perde o texto colado, diz o que foi
// criado antes de um erro, lista os IDs pulados, deixa escolher a coluna e
// aceita o .md arrastado.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const importParsedCards = vi.fn<(...args: unknown[]) => unknown>()
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/importProjectCards', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/importProjectCards')>()),
  importParsedCards: (...args: unknown[]) => importParsedCards(...args),
  ensureTopicColumns: vi.fn(),
}))
// O idioma da tela: pt-BR, e en nos testes que o trocam.
const screen = vi.hoisted((): { lang: 'pt-BR' | 'en' } => ({ lang: 'pt-BR' }))
vi.mock('../../i18n/LanguageContext', async () => {
  const { getT } = await import('../../i18n/translations')
  const ts = { 'pt-BR': getT('pt-BR'), en: getT('en') }
  return { useLanguage: () => ({ lang: screen.lang, t: ts[screen.lang] }) }
})

import ImportCardsModal from './ImportCardsModal'

const BACKLOG = `## Tópico: Segurança

### CARD SEC-001 — Versionar schema

- **ID:** SEC-001
- **Prioridade:** P0
- **Esforço:** L
- **Labels:** segurança

**Problema:** Algo a resolver.

**Subtarefas Kanban:**

- [ ] Fazer a primeira parte
`

const column = (id: string, name: string, sort_order: number): ProjectColumn =>
  ({ id, board_id: 'board-1', name, color: '#6366f1', wip_limit: null, sort_order, created_at: '' })
const COLUMNS = [column('col-1', 'A fazer', 0), column('col-2', 'Fazendo', 1)]
type BoardCard = Pick<ProjectCard, 'id' | 'title' | 'column_id' | 'sort_order' | 'depends_on' | 'created_at'>
const boardCard = (id: string, title: string, depends_on: string[] = [], over: Partial<BoardCard> = {}): BoardCard =>
  ({ id, title, column_id: 'col-1', sort_order: 0, depends_on, created_at: '2026-10-01T12:00:00+00:00', ...over })
let boardCards: BoardCard[] = []

let container: HTMLDivElement
let root: Root
const onClose = vi.fn()
const onImported = vi.fn()

const render = () => act(() => root.render(
  <ImportCardsModal open onClose={onClose} boardId="board-1" columns={COLUMNS} cards={boardCards} onImported={onImported} />,
))
const textarea = () => container.querySelector('textarea')!
const backdrop = () => container.querySelector('[role="presentation"]')!
const text = () => container.textContent ?? ''

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  act(() => {
    setter.call(textarea(), value)
    textarea().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const importButton = (label = 'Importar') => [...container.querySelectorAll('button')].find(b => b.textContent === label)!

async function clickImport(label?: string) {
  await act(async () => { importButton(label).click() })
}

/** Os itens da caixa de avisos. */
const notices = () => [...container.querySelectorAll('li')].map(li => li.textContent)

function drop(file: File) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
  act(() => { textarea().parentElement!.dispatchEvent(event) })
}

beforeEach(() => {
  screen.lang = 'pt-BR'
  boardCards = []
  importParsedCards.mockReset()
  onClose.mockReset()
  onImported.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('ImportCardsModal', () => {
  it('clicking outside closes only while there is no pasted text', () => {
    render()
    act(() => { (backdrop() as HTMLElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)

    type(BACKLOG)
    act(() => { (backdrop() as HTMLElement).click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reports how many cards were created before an error and keeps the text', async () => {
    importParsedCards.mockResolvedValue({ created: 20, skipped: 0, skippedIds: [], errors: ['boom'], warnings: [] })
    render()
    type(BACKLOG)
    await clickImport()
    expect(text()).toContain('20 cards criados antes do erro: boom')
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(textarea().value).toBe(BACKLOG)
  })

  it('imports into the chosen column', async () => {
    importParsedCards.mockResolvedValue({ created: 1, skipped: 0, skippedIds: [], errors: [], warnings: [] })
    render()
    type(BACKLOG)
    const select = container.querySelector('select')!
    act(() => {
      select.value = 'col-2'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await clickImport()
    expect(importParsedCards.mock.calls[0][2]).toBe('col-2')
  })

  it('lists the skipped IDs and stays open so they can be read', async () => {
    vi.useFakeTimers()
    const ids = Array.from({ length: 25 }, (_, i) => `SEC-${String(i + 1).padStart(3, '0')}`)
    importParsedCards.mockResolvedValue({ created: 1, skipped: ids.length, skippedIds: ids, errors: [], warnings: [] })
    render()
    type(BACKLOG)
    await clickImport()
    expect(text()).toContain('Pulados, o ID já existe no quadro: SEC-001, SEC-002')
    expect(text()).toContain('SEC-020 e mais 5')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('loads a dropped .md file and refuses other files', async () => {
    render()
    drop(new File(['imagem'], 'foto.png', { type: 'image/png' }))
    expect(text()).toContain('Arquivo não suportado')

    drop(new File([BACKLOG], 'backlog.md', { type: 'text/markdown' }))
    await vi.waitFor(() => expect(textarea().value).toBe(BACKLOG))
    expect(text()).toContain('1 cards encontrados')
  })
})

// API-033: Depende de na prévia (contra o quadro em memória) e depois de importar.
const withDepends = (value: string, id = 'SEC-001') => BACKLOG
  .replace('### CARD SEC-001', `### CARD ${id}`)
  .replace('- **ID:** SEC-001', `- **ID:** ${id}`)
  .replace('- **Labels:** segurança', `- **Labels:** segurança\n- **Depende de:** ${value}`)

describe('ImportCardsModal: Depende de (API-033)', () => {
  it('the preview resolves dependencies against the board and translates the warnings', () => {
    boardCards = [boardCard('b-perf', 'PERF-001 — no quadro')]
    render()
    type(withDepends('PERF-001, ZZ-999'))
    expect(notices()).toEqual(['SEC-001: a dependência ZZ-999 não está no arquivo nem no quadro e ficou de fora'])
    expect(importButton().disabled).toBe(false)
  })

  it('two invalid dependencies in one card are two items (keys include the index)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render()
      type(withDepends('foo, foo'))
      expect(notices()).toEqual([
        'SEC-001: "foo" em Depende de não é um ID de card e ficou de fora',
        'SEC-001: "foo" em Depende de não é um ID de card e ficou de fora',
      ])
      expect(errors.mock.calls.flat().join(' ')).not.toContain('same key')
    } finally {
      errors.mockRestore()
    }
  })

  it('a cycle shows first and disables the import', async () => {
    render()
    type(`${withDepends('SEC-002')}\n${withDepends('SEC-001', 'SEC-002')}`)
    expect(notices()[0]).toBe('SEC-001: dependência em ciclo (SEC-001 → SEC-002 → SEC-001)')
    expect(importButton().disabled).toBe(true)
    await clickImport()
    expect(importParsedCards).not.toHaveBeenCalled()
  })

  it('a card already on the board warns that its Depende de was not applied', () => {
    boardCards = [boardCard('b-sec', 'SEC-001 — antigo'), boardCard('b-perf', 'PERF-001 — base')]
    render()
    type(withDepends('PERF-001'))
    expect(notices()).toEqual(['SEC-001: já está no quadro, então as dependências PERF-001 não foram gravadas nele'])
    boardCards = [boardCard('b-sec', 'SEC-001 — antigo', ['b-perf']), boardCard('b-perf', 'PERF-001 — base')]
    render()
    expect(notices()).toEqual([])
  })

  // A prévia e a gravação escolhem o mesmo card de cada ID externo: o mais
  // antigo (oldestFirst), não o 1º na ordem do quadro (sort_order).
  it('two board cards with the same external ID: the preview picks the oldest, like the import', () => {
    const md = `${withDepends('PERF-001')}\n${withDepends('SEC-001', 'SEC-002')}`
    const perf = boardCard('b-perf', 'PERF-001 — base', [], { created_at: '2026-10-01T12:00:00.5+00:00' })
    /** Os avisos do plano da gravação, com o quadro já do mais antigo para o mais novo. */
    const sameAsImport = (ordered: BoardCard[]) => {
      const { cards } = parseBacklogMarkdown(md, { newId: () => 'x' })
      const plan = planCardRows({ boardId: 'board-1', fallbackColumnId: 'col-1', cards, existing: ordered, newId: () => '' })
      return plan.warnings.map(w => importWarningText(w, getT('pt-BR')))
    }
    // A cópia mais nova vem antes no quadro; o antigo já tem a dependência.
    let copy = boardCard('b-copy', 'SEC-001 — cópia', [], { sort_order: 0, created_at: '2026-10-02T12:00:00+00:00' })
    let old = boardCard('b-old', 'SEC-001 — antigo', ['b-perf'], { sort_order: 5, created_at: '2026-10-01T12:00:00.123456+00:00' })
    boardCards = [copy, perf, old]
    render()
    type(md)
    expect(notices()).toEqual([])
    expect(notices()).toEqual(sameAsImport([old, perf, copy]))
    // Ao contrário: a cópia tem a dependência, e o antigo, que é o que vale, não.
    copy = { ...copy, depends_on: ['b-perf'] }
    old = { ...old, depends_on: [] }
    boardCards = [copy, perf, old]
    render()
    expect(notices()).toEqual(['SEC-001: já está no quadro, então as dependências PERF-001 não foram gravadas nele'])
    expect(notices()).toEqual(sameAsImport([old, perf, copy]))
  })

  it('more than 8 notices end with "e mais N"', () => {
    render()
    type(withDepends(Array.from({ length: 10 }, (_, i) => `x${i}`).join(', ')))
    expect(notices()).toHaveLength(9)
    expect(notices().at(-1)).toBe('e mais 2')
  })

  it('after importing, the warnings are the import result and the modal stays open', async () => {
    vi.useFakeTimers()
    importParsedCards.mockResolvedValue({
      created: 1, skipped: 0, skippedIds: [], errors: [],
      warnings: [{ code: 'dependency_not_found', cardId: 'SEC-001', detail: 'ZZ-001' }],
    })
    render()
    type(BACKLOG)
    expect(notices()).toEqual([])
    await clickImport()
    expect(notices()).toEqual(['SEC-001: a dependência ZZ-001 não está no arquivo nem no quadro e ficou de fora'])
    // O quadro recarregado já tem o card: a prévia o daria como pulado, mas a caixa segue a gravação.
    boardCards = [boardCard('new', 'SEC-001 — Versionar schema')]
    render()
    expect(notices()).toEqual(['SEC-001: a dependência ZZ-001 não está no arquivo nem no quadro e ficou de fora'])
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('without skipped IDs or warnings, the modal closes by itself', async () => {
    vi.useFakeTimers()
    importParsedCards.mockResolvedValue({ created: 1, skipped: 0, skippedIds: [], errors: [], warnings: [] })
    render()
    type(BACKLOG)
    await clickImport()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// API-033: com a tela em inglês, o que impede importar (ciclo, limites) e o
// erro da gravação saem em inglês, como os outros avisos.
describe('ImportCardsModal: screen in English (API-033)', () => {
  beforeAll(() => loadLang('en'))

  it('a cycle is explained in the screen language', () => {
    screen.lang = 'en'
    render()
    type(`${withDepends('SEC-002')}\n${withDepends('SEC-001', 'SEC-002')}`)
    expect(notices()[0]).toBe('SEC-001: dependency cycle (SEC-001 → SEC-002 → SEC-001)')
    expect(importButton('Import').disabled).toBe(true)
  })

  it('the import gets the screen t, so its errors come in the screen language', async () => {
    screen.lang = 'en'
    importParsedCards.mockImplementation(async (...args: unknown[]) => {
      const { t } = args[4] as { t: DomainTFor<ImportIssueKey> }
      return { created: 0, skipped: 0, skippedIds: [], errors: [importIssueText({ code: 'no_column', cardId: 'SEC-001' }, t)], warnings: [] }
    })
    render()
    type(BACKLOG)
    await clickImport('Import')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('SEC-001: no target column')
  })
})
