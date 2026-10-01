// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ProjectColumn } from '../../types'

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
vi.mock('../../i18n/LanguageContext', async () => {
  const { getT } = await import('../../i18n/translations')
  return { useLanguage: () => ({ lang: 'pt-BR', t: getT('pt-BR') }) }
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

let container: HTMLDivElement
let root: Root
const onClose = vi.fn()
const onImported = vi.fn()

const render = () => act(() => root.render(
  <ImportCardsModal open onClose={onClose} boardId="board-1" columns={COLUMNS} onImported={onImported} />,
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

async function clickImport() {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Importar')!
  await act(async () => { button.click() })
}

function drop(file: File) {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
  act(() => { textarea().parentElement!.dispatchEvent(event) })
}

beforeEach(() => {
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
    importParsedCards.mockResolvedValue({ created: 20, skipped: 0, skippedIds: [], errors: ['boom'] })
    render()
    type(BACKLOG)
    await clickImport()
    expect(text()).toContain('20 cards criados antes do erro: boom')
    expect(onImported).toHaveBeenCalledTimes(1)
    expect(textarea().value).toBe(BACKLOG)
  })

  it('imports into the chosen column', async () => {
    importParsedCards.mockResolvedValue({ created: 1, skipped: 0, skippedIds: [], errors: [] })
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
    importParsedCards.mockResolvedValue({ created: 1, skipped: ids.length, skippedIds: ids, errors: [] })
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
