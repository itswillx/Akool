// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor } from '../test/rtl'

// API-020: a nota ao lado do desenho (LinkedNotePanel) usa o mesmo NoteEditor
// e a mesma guarda: um bloco que derrubaria o editor deixa a nota só para
// leitura dentro do painel, e o desenho continua na tela.

interface FakeDb { content: unknown; saves: unknown[] }
const db = vi.hoisted((): FakeDb => ({ content: null, saves: [] }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const b = {
        select: () => b, eq: () => b,
        // ensureNote (LinkedNotePanel) e a carga do NoteEditor.
        single: () => Promise.resolve({ data: { id: 'n1' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: { content: db.content, updated_at: '2026-10-07T12:00:00Z' }, error: null }),
        insert: () => Promise.resolve({ error: null }),
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
    loadContentDraft: vi.fn(async () => null),
    contentDraft: vi.fn(() => undefined),
    saveVersionedContent: vi.fn(async (_client: unknown, args: unknown) => { db.saves.push(args); return { ok: true, updatedAt: null } }),
  }
})
vi.mock('../hooks/useCollaborativeContent', () => ({ useCollaborativeContent: () => ({ remoteContent: null, remoteUpdatedAt: null }) }))
vi.mock('../contexts/PagesContext', () => ({ usePages: () => ({ userShareRole: () => 'owner', setActivePanel: () => {} }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }))
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'note_invalid_where' ? 'onde: {path}' : k) }),
}))
vi.mock('./DiagramCanvas', () => ({ default: () => null }))

import LinkedNotePanel from './LinkedNotePanel'

beforeEach(() => {
  db.saves = []
})

async function openPanel() {
  render(<LinkedNotePanel pageId="p1" />)
  await userEvent.setup().click(screen.getByTitle('linked_note_title'))
}

describe('LinkedNotePanel: guarda de conteúdo (API-020)', () => {
  it('nota com card de rótulos em texto (derrubaria o render): só leitura no painel, sem gravar', async () => {
    const snapshot = JSON.stringify({ title: 'Card', labels: 'abc' })
    db.content = [{ type: 'paragraph', content: 'ao lado do desenho' }, { type: 'projectCard', props: { snapshot } }]
    await openPanel()
    expect(await screen.findByText('note_invalid_title')).toBeTruthy()
    expect(screen.getByText('onde: /1/props/snapshot (snapshot)')).toBeTruthy()
    expect(screen.getByText('ao lado do desenho')).toBeTruthy()
    expect(document.querySelector('.bn-editor')).toBeNull()
    expect(db.saves).toEqual([])
  })

  it('nota válida abre o editor no painel', async () => {
    db.content = [{ type: 'paragraph', content: 'ok' }]
    await openPanel()
    await waitFor(() => expect(document.querySelector('.bn-editor')).not.toBeNull())
    expect(screen.queryByText('note_invalid_title')).toBeNull()
  })
})
