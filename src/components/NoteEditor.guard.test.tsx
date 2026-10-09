// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen, userEvent, waitFor } from '../test/rtl'

// API-020: guarda do NoteEditor. Antes do useCreateBlockNote, as regras fatais
// do validador (supabase/functions/_domain/blocknote) passam pelo conteúdo
// gravado, pelo rascunho offline e pelo remoto. Com problema, a nota aparece só
// para leitura, com o caminho do bloco, e nada é gravado. Sem a guarda, o
// BlockNote lança no render e a seção inteira cai no ErrorBoundary.
// A colagem que o editor mostra mas não reabriria (uma tabela com células
// mescladas fora da grade) é desfeita na hora, com aviso. O autosave também
// passa pela guarda: o que ela recusa por outra via não vai ao servidor, mas
// fica no rascunho local (ao sair, ou sem conexão), e nada some em silêncio.
// E o remoto só desmonta o editor quando é aplicado.

interface Save { values: { content: unknown }; expected: string | null; force?: boolean }

const db = vi.hoisted(() => ({
  row: null as { content: unknown; updated_at: string | null } | null,
  draft: null as { value: unknown; version: string | null } | null,
  saves: [] as Save[],
  /** Com versão, o save só grava sobre ela (REL-009); sem, sempre grava. */
  serverVersion: null as string | null,
  persisted: [] as { value: unknown; version: string | null }[],
  clearDraft: vi.fn(async () => {}),
  toast: vi.fn(),
  role: 'owner',
  setRemote: null as null | ((value: { remoteContent: unknown; remoteUpdatedAt: string | null }) => void),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = {
        select: () => b, eq: () => b,
        maybeSingle: () => Promise.resolve({ data: db.row, error: null }),
      }
      return b
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('../lib/contentPersistence', async importOriginal => {
  const mod = await importOriginal<typeof import('../lib/contentPersistence')>()
  return {
    ...mod,
    loadContentDraft: vi.fn(async () => db.draft),
    contentDraft: vi.fn(() => ({ persist: async (value: unknown, version: string | null) => { db.persisted.push({ value, version }) }, clear: db.clearDraft })),
    saveVersionedContent: vi.fn(async (_client: unknown, args: Save) => {
      db.saves.push(args)
      if (db.serverVersion === null) return { ok: true, at: '2026-10-07T12:00:01Z' }
      if (!args.force && args.expected !== db.serverVersion) return { ok: false, conflict: true, error: 'conflict' }
      db.serverVersion = `2026-10-07T14:00:0${db.saves.length}Z`
      return { ok: true, at: db.serverVersion }
    }),
  }
})
vi.mock('../hooks/useCollaborativeContent', () => ({
  useCollaborativeContent: () => {
    const [state, setState] = useState<{ remoteContent: unknown; remoteUpdatedAt: string | null }>({ remoteContent: null, remoteUpdatedAt: null })
    useEffect(() => { db.setRemote = setState }, [])
    return state
  },
}))
vi.mock('../contexts/PagesContext', () => ({ usePages: () => ({ userShareRole: () => db.role, setActivePanel: () => {} }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: db.toast }) }))
vi.mock('../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'note_invalid_where' ? 'onde: {path}' : k) }),
}))
vi.mock('./DiagramCanvas', () => ({ default: () => null }))

import NoteEditor from './NoteEditor'

const valid = [{ type: 'paragraph', content: 'Nota boa' }]
const invalid = [
  { type: 'heading', props: { level: 2 }, content: 'Título que fica' },
  { type: 'callout', content: 'bloco desconhecido' },
]

beforeEach(() => {
  db.row = { content: valid, updated_at: '2026-10-07T12:00:00Z' }
  db.draft = null
  db.saves = []
  db.serverVersion = null
  db.persisted = []
  db.clearDraft.mockClear()
  db.toast.mockClear()
  db.role = 'owner'
  db.setRemote = null
})

const editorMounted = () => document.querySelector('.bn-editor') !== null
const editorText = () => document.querySelector('.ProseMirror')?.textContent ?? ''
const saved = (text: string) => db.saves.filter(s => JSON.stringify(s.values).includes(text))

/** O tiptap pendura o editor no DOM: digita como a pessoa (dispara o onChange do BlockNote). */
function typeInEditor(text: string) {
  const dom = document.querySelector('.ProseMirror') as unknown as { editor: { commands: { insertContentAt: (pos: number, c: string) => boolean } } }
  act(() => { dom.editor.commands.insertContentAt(3, text) })
}

/** Colar no editor, por evento de verdade (o handler de colagem do BlockNote e o prosemirror-tables). */
function paste(store: Record<string, string>) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { types: Object.keys(store), getData: (type: string) => store[type] ?? '', files: [], items: [] } })
  act(() => { document.querySelector('.ProseMirror')?.dispatchEvent(event) })
}
const pasteHtml = (html: string) => paste({ 'text/html': html, 'text/plain': 'colado' })

/** O mesmo HTML entrando sem colagem (como ao soltar uma tabela arrastada): passa ao largo do pasteHandler. */
function insertHtml(html: string) {
  const dom = document.querySelector('.ProseMirror') as unknown as { editor: { commands: { insertContentAt: (pos: number, c: string) => boolean } } }
  act(() => { dom.editor.commands.insertContentAt(3, html) })
}

// Tabela da web com uma célula em 2 linhas e outra em 2 colunas: o editor normaliza
// para [[vazia, A(rowspan 2), B], [C(colspan 2)]], que ele mostra mas não reabre.
const MERGED_TABLE = '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td colspan="2">C</td></tr></table>'
// Controle: rowspan que fecha a grade, que o editor reabre.
const ROWSPAN_TABLE = '<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>'
const hasTable = () => document.querySelector('.ProseMirror table') !== null
const toasts = (key: string) => db.toast.mock.calls.filter(call => call[1] === key).length

describe('NoteEditor: guarda de conteúdo (API-020)', () => {
  it('conteúdo válido abre o editor', async () => {
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    expect(screen.queryByText('note_invalid_title')).toBeNull()
  })

  it('conteúdo gravado com bloco desconhecido: só leitura, com o caminho, e nada é gravado', async () => {
    db.row = { content: invalid, updated_at: '2026-10-07T12:00:00Z' }
    render(<NoteEditor pageId="p1" />)
    expect(await screen.findByText('note_invalid_title')).toBeTruthy()
    expect(screen.getByText('onde: /1/type (enum)')).toBeTruthy()
    // O texto da nota aparece, extraído com tolerância.
    expect(screen.getByText('Título que fica')).toBeTruthy()
    expect(screen.getByText('bloco desconhecido')).toBeTruthy()
    expect(editorMounted()).toBe(false)
    // Sem rascunho, nada para descartar.
    expect(screen.queryByText('note_invalid_discard_draft')).toBeNull()
    await new Promise(r => setTimeout(r, 1200))
    expect(db.saves).toEqual([])
  })

  it('conteúdo gravado que não é lista não vira nota vazia (o autosave gravaria por cima)', async () => {
    db.row = { content: { type: 'paragraph' }, updated_at: '2026-10-07T12:00:00Z' }
    render(<NoteEditor pageId="p1" />)
    expect(await screen.findByText('onde: / (type)')).toBeTruthy()
    expect(screen.getByText('note_invalid_no_text')).toBeTruthy()
    expect(editorMounted()).toBe(false)
  })

  it('rascunho offline inválido: só leitura, e descartar o rascunho abre a versão salva', async () => {
    db.draft = { value: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', styles: { highlight: true } }] }], version: '2026-10-07T12:00:00Z' }
    render(<NoteEditor pageId="p1" />)
    expect(await screen.findByText('note_invalid_draft')).toBeTruthy()
    expect(screen.getByText('onde: /0/content/0/styles/highlight (enum)')).toBeTruthy()
    db.draft = null
    await userEvent.setup().click(screen.getByRole('button', { name: 'note_invalid_discard_draft' }))
    expect(db.clearDraft).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(editorMounted()).toBe(true))
    expect(screen.queryByText('note_invalid_title')).toBeNull()
  })

  it('conteúdo remoto (realtime) inválido troca o editor pela leitura, sem gravar', async () => {
    db.role = 'editor'
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    await waitFor(() => expect(db.setRemote).not.toBeNull())
    act(() => { db.setRemote?.({ remoteContent: invalid, remoteUpdatedAt: '2026-10-07T13:00:00Z' }) })
    expect(await screen.findByText('onde: /1/type (enum)')).toBeTruthy()
    expect(editorMounted()).toBe(false)
    expect(db.saves).toEqual([])
  })

  it('remoto fatal que chega com a pessoa digitando, depois de um remoto aplicado: o editor fica e o conflito aparece', async () => {
    db.role = 'editor'
    db.serverVersion = '2026-10-07T12:00:00Z'
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    await waitFor(() => expect(db.setRemote).not.toBeNull())
    // 1) Um remoto válido é aplicado (a pessoa está parada): o editor remonta com ele.
    db.serverVersion = '2026-10-07T12:30:00Z'
    act(() => { db.setRemote?.({ remoteContent: [{ type: 'paragraph', content: 'do colega v1' }], remoteUpdatedAt: '2026-10-07T12:30:00Z' }) })
    await waitFor(() => expect(editorText()).toContain('do colega v1'))
    // 2) A pessoa digita; 3) antes do save, o colega grava algo que esta versão do app não abre.
    typeInEditor('MINHA EDICAO ')
    db.serverVersion = '2026-10-07T13:00:00Z'
    act(() => { db.setRemote?.({ remoteContent: invalid, remoteUpdatedAt: '2026-10-07T13:00:00Z' }) })
    // O remoto não foi aplicado: o save cai no conflito do REL-009, e o editor continua.
    expect(await screen.findByText('editor_conflict_title', {}, { timeout: 3000 })).toBeTruthy()
    expect(editorMounted()).toBe(true)
    expect(screen.queryByText('note_invalid_title')).toBeNull()
    expect(editorText()).toContain('MINHA EDICAO')
    // "Manter a minha" grava o que foi digitado (fireEvent: o mousemove do
    // userEvent aciona o menu lateral do BlockNote, que o happy-dom não suporta).
    fireEvent.click(screen.getByRole('button', { name: 'editor_conflict_keep' }))
    await waitFor(() => expect(saved('MINHA EDICAO').some(s => s.force)).toBe(true))
  })

  it('desmontar com o conflito na tela guarda a edição no rascunho local (nada some em silêncio)', async () => {
    db.role = 'editor'
    db.serverVersion = '2026-10-07T12:00:00Z'
    const view = render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    typeInEditor('EDICAO EM CONFLITO ')
    db.serverVersion = '2026-10-07T13:00:00Z'
    expect(await screen.findByText('editor_conflict_title', {}, { timeout: 3000 })).toBeTruthy()
    expect(db.persisted).toEqual([])
    view.unmount()
    await waitFor(() => expect(db.persisted.some(d => JSON.stringify(d.value).includes('EDICAO EM CONFLITO'))).toBe(true))
    // Sobre a versão em que a edição foi feita: ao abrir, o primeiro save mostra o aviso de novo.
    expect(db.persisted.at(-1)?.version).toBe('2026-10-07T12:00:00Z')
  })

  it('colar uma tabela que o editor não reabriria: a colagem é desfeita, avisa, e o texto seguinte salva', async () => {
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    pasteHtml(MERGED_TABLE)
    expect(hasTable()).toBe(false)
    await waitFor(() => expect(db.toast).toHaveBeenCalledWith('error', 'note_paste_blocked'))
    typeInEditor('DEPOIS DA COLAGEM ')
    await waitFor(() => expect(saved('DEPOIS DA COLAGEM')).toHaveLength(1), { timeout: 3000 })
    expect(db.saves.some(s => JSON.stringify(s.values).includes('"table"'))).toBe(false)
    expect(screen.queryByText('editor_save_error')).toBeNull()
    expect(db.toast).toHaveBeenCalledTimes(1)
  })

  it('o que foi digitado logo antes da colagem (o undo levaria junto) fica; só a tabela sai', async () => {
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    typeInEditor('LOGO ANTES ')
    pasteHtml(MERGED_TABLE)
    expect(hasTable()).toBe(false)
    expect(editorText()).toBe('LOGO ANTES Nota boa')
    await waitFor(() => expect(saved('LOGO ANTES')).toHaveLength(1), { timeout: 3000 })
    expect(db.saves.some(s => JSON.stringify(s.values).includes('"table"'))).toBe(false)
    expect(toasts('note_paste_blocked')).toBe(1)
  })

  it('controle: tabela com rowspan que fecha a grade é colada e salva', async () => {
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    pasteHtml(ROWSPAN_TABLE)
    expect(hasTable()).toBe(true)
    await waitFor(() => expect(db.saves.some(s => JSON.stringify(s.values).includes('"table"'))).toBe(true), { timeout: 3000 })
    expect(db.toast).not.toHaveBeenCalled()
  })

  it('conteúdo recusado sem colagem: não grava, avisa, e ao desmontar o texto digitado fica no rascunho local', async () => {
    const view = render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    insertHtml(MERGED_TABLE)
    await waitFor(() => expect(db.toast).toHaveBeenCalledWith('error', 'note_save_blocked'), { timeout: 3000 })
    expect(screen.getByText('editor_save_error')).toBeTruthy()
    typeInEditor('ESCRITO DEPOIS ')
    await new Promise(r => setTimeout(r, 1200))
    expect(db.saves).toEqual([])
    expect(db.persisted).toEqual([])
    view.unmount()
    await waitFor(() => expect(db.persisted.some(d => JSON.stringify(d.value).includes('ESCRITO DEPOIS'))).toBe(true))
    // Sobre a versão em que foi feito; ao abrir, a guarda mostra o rascunho só leitura.
    expect(db.persisted.at(-1)?.version).toBe('2026-10-07T12:00:00Z')
    expect(db.saves).toEqual([])
    expect(toasts('note_save_blocked')).toBe(1)
  })

  it('conteúdo recusado e a aba fechada (pagehide, sem desmonte): o texto digitado fica no rascunho local', async () => {
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    insertHtml(MERGED_TABLE)
    await waitFor(() => expect(db.toast).toHaveBeenCalledWith('error', 'note_save_blocked'), { timeout: 3000 })
    typeInEditor('ANTES DE FECHAR ')
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    await waitFor(() => expect(db.persisted.some(d => JSON.stringify(d.value).includes('ANTES DE FECHAR'))).toBe(true))
    expect(db.saves).toEqual([])
  })

  it('sem conexão, o conteúdo recusado vai para o rascunho local, mas o status é "Não salvo"', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      render(<NoteEditor pageId="p1" />)
      await waitFor(() => expect(editorMounted()).toBe(true))
      insertHtml(MERGED_TABLE)
      await waitFor(() => expect(db.toast).toHaveBeenCalledWith('error', 'note_save_blocked'), { timeout: 3000 })
      expect(db.persisted.some(d => JSON.stringify(d.value).includes('"table"'))).toBe(true)
      expect(db.saves).toEqual([])
      // Fica no aparelho, mas nunca vai ao servidor: "Não salvo", e não "guardado neste aparelho".
      expect(screen.getByText('editor_save_error')).toBeTruthy()
      expect(screen.queryByText('editor_save_offline')).toBeNull()
    } finally {
      onLine.mockRestore()
    }
  })

  it('com a nota já recusada por outra via, colar algo inofensivo não é desfeito (a culpa não é da colagem)', async () => {
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true))
    insertHtml(MERGED_TABLE)
    await waitFor(() => expect(db.toast).toHaveBeenCalledWith('error', 'note_save_blocked'), { timeout: 3000 })
    paste({ 'text/plain': 'TEXTO COLADO' })
    expect(editorText()).toContain('TEXTO COLADO')
    expect(toasts('note_paste_blocked')).toBe(0)
  })

  it('rascunho restaurado que o editor devolve numa forma que não reabriria: não grava e avisa', async () => {
    // Dois trechos de 16 mil nós passam na guarda (cada um é um push), mas o
    // editor os junta num só, de 32 mil, ao devolver o documento.
    const lines = 'a\n'.repeat(8_000)
    db.draft = { value: [{ type: 'paragraph', content: [{ type: 'text', text: lines, styles: {} }, { type: 'text', text: lines, styles: {} }] }], version: '2026-10-07T12:00:00Z' }
    render(<NoteEditor pageId="p1" />)
    await waitFor(() => expect(editorMounted()).toBe(true), { timeout: 5000 })
    await waitFor(() => expect(db.toast).toHaveBeenCalledWith('error', 'note_save_blocked'), { timeout: 3000 })
    expect(db.saves).toEqual([])
    expect(db.persisted).toEqual([])
  })

  it('nível de título fora de 1..6 também é barrado (no navegador, createElement lança)', async () => {
    db.row = { content: [{ type: 'heading', props: { level: '1 2' }, content: 'x' }], updated_at: null }
    render(<NoteEditor pageId="p1" />)
    expect(await screen.findByText('onde: /0/props/level (enum)')).toBeTruthy()
    expect(editorMounted()).toBe(false)
  })
})
