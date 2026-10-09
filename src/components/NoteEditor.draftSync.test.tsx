// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor } from '../test/rtl'

// API-020 + REL-012: o rascunho offline que o editor não abriria (uma tabela
// colada com células mescladas, sem conexão) nunca vai ao servidor pelo reenvio
// global (offlineSync.flushDrafts, que o App chama no login e na volta da
// conexão). Sem isso, a "versão salva" que a tela da guarda promete abrir viraria
// o próprio rascunho inválido, só leitura para todos. Aqui com o NoteEditor e o
// flushDrafts de verdade; só o IndexedDB, o banco e o realtime são falsos.

interface StoredDraft { key: string; userId: string; table: 'note_contents'; id: string; value: unknown; version: string; savedAt: number }

const S = vi.hoisted(() => ({
  row: { content: [] as unknown, updated_at: '' },
  draft: null as StoredDraft | null,
  saves: [] as unknown[],
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: S.row, error: null }) }
      return b
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
  },
}))
vi.mock('../lib/offlineStore', () => ({
  getDraftFor: async () => S.draft,
  deleteDraftFor: async () => { S.draft = null },
  deleteDraft: async () => { S.draft = null },
  listDrafts: async () => (S.draft ? [S.draft] : []),
  putDraft: async () => {},
}))
vi.mock('../lib/contentPersistence', async importOriginal => {
  const mod = await importOriginal<typeof import('../lib/contentPersistence')>()
  return {
    ...mod,
    // Ninguém gravou depois do rascunho: um save sobre a versão dele passaria.
    saveVersionedContent: vi.fn(async (_client: unknown, args: { values: { content: unknown }; expected: string }) => {
      S.saves.push(args)
      if (args.expected !== S.row.updated_at) return { ok: false, conflict: true, error: 'conflict' }
      S.row = { content: args.values.content, updated_at: '2026-10-07T12:05:00Z' }
      return { ok: true, at: S.row.updated_at }
    }),
  }
})
vi.mock('../hooks/useCollaborativeContent', () => ({ useCollaborativeContent: () => ({ remoteContent: null, remoteUpdatedAt: null }) }))
vi.mock('../contexts/PagesContext', () => ({ usePages: () => ({ userShareRole: () => 'owner', setActivePanel: () => {} }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => '' }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'note_invalid_where' ? 'onde: {path}' : k) }) }))
vi.mock('./DiagramCanvas', () => ({ default: () => null }))

import NoteEditor from './NoteEditor'
import { isContentOpen } from '../lib/contentPersistence'
import { flushDrafts } from '../lib/offlineSync'

const SAVED = [{ type: 'paragraph', content: 'versão salva boa' }]
const VERSION = '2026-10-07T12:00:00Z'

// O que o próprio editor grava ao colar a tabela mesclada sem conexão.
const cell = (props: Record<string, number>, text: string) => ({
  type: 'tableCell',
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left', colspan: 1, rowspan: 1, ...props },
  content: text ? [{ type: 'text', text, styles: {} }] : [],
})
const pastedOffline = [{
  id: 'b1', type: 'table', props: { textColor: 'default' }, children: [],
  content: { type: 'tableContent', columnWidths: [null, null, null], rows: [
    { cells: [cell({}, ''), cell({ rowspan: 2 }, 'A'), cell({}, 'B')] },
    { cells: [cell({ colspan: 2 }, 'C')] },
  ] },
}]

beforeEach(() => {
  S.row = { content: SAVED, updated_at: VERSION }
  S.draft = { key: 'u1:note_contents:p1', userId: 'u1', table: 'note_contents', id: 'p1', value: JSON.parse(JSON.stringify(pastedOffline)) as unknown, version: VERSION, savedAt: 1 }
  S.saves = []
})

describe('rascunho inválido e o reenvio global (API-020 + REL-012)', () => {
  it('com a tela da guarda aberta, a página conta como aberta e o reenvio não manda o rascunho', async () => {
    const view = render(<NoteEditor pageId="p1" />)
    expect(await screen.findByText('note_invalid_discard_draft')).toBeTruthy()
    expect(isContentOpen('note_contents', 'p1')).toBe(true)
    const report = await flushDrafts('u1')
    expect(report.results.map(r => r.status)).toEqual(['kept'])
    expect(S.saves).toEqual([])
    expect(S.draft).not.toBeNull()
    view.unmount()
    expect(isContentOpen('note_contents', 'p1')).toBe(false)
  })

  it('com a página fechada, o reenvio também guarda o rascunho, e descartar abre a versão boa', async () => {
    const report = await flushDrafts('u1')
    expect(report).toMatchObject({ sent: 0, kept: 1, dropped: 0 })
    expect(S.saves).toEqual([])
    expect(S.row.content).toBe(SAVED)

    render(<NoteEditor pageId="p1" />)
    await userEvent.setup().click(await screen.findByRole('button', { name: 'note_invalid_discard_draft' }))
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull())
    expect(document.querySelector('.ProseMirror')?.textContent).toContain('versão salva boa')
    expect(S.draft).toBeNull()
  })

  it('rascunho válido continua indo normalmente', async () => {
    S.draft = { ...S.draft!, value: [{ type: 'paragraph', content: 'editado sem conexão' }] }
    expect(await flushDrafts('u1')).toMatchObject({ sent: 1, kept: 0 })
    expect(S.saves).toHaveLength(1)
    expect(S.draft).toBeNull()
  })
})
