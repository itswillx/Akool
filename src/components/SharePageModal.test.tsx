// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor } from '../test/rtl'

// QA-003: compartilhar página — a busca de pessoas (a partir de 3 letras, sem
// você nem quem já tem acesso), o convite como editor e os erros.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => {
  const empty: Res = { data: [], error: null }
  const state: { search: Res; shares: Res; insert: Res; inserts: unknown[] } = { search: empty, shares: empty, insert: empty, inserts: [] }
  return Object.assign(state, { rpc: vi.fn() })
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => { db.rpc(fn, args); return Promise.resolve(db.search) },
    from: () => {
      let op = 'select'
      const b = {
        select: () => b, eq: () => b, order: () => b,
        insert: (row: unknown) => { op = 'insert'; db.inserts.push(row); return b },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(op === 'insert' ? db.insert : db.shares).then(resolve, reject),
      }
      return b
    },
  },
}))
const showToast = vi.fn()
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast }) }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

import SharePageModal from './SharePageModal'

const person = (id: string, email: string) => ({ id, email, display_name: null, avatar_emoji: null, avatar_color: null, avatar_url: null })

beforeEach(() => {
  db.search = { data: [], error: null }
  db.shares = { data: [], error: null }
  db.insert = { data: null, error: null }
  db.rpc.mockReset()
  db.inserts = []
  showToast.mockReset()
})

function setup() {
  render(<SharePageModal open onClose={() => {}} pageId="p1" pageTitle="Minha página" />)
  return { user: userEvent.setup(), search: screen.getByPlaceholderText('share_search_placeholder') }
}

describe('SharePageModal', () => {
  it('menos de 3 letras não busca', async () => {
    const { user, search } = setup()
    await user.type(search, 'an')
    await new Promise(r => setTimeout(r, 400))
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('busca, esconde você e quem já tem acesso, e convida como editor', async () => {
    db.shares = { data: [{ id: 's1', page_id: 'p1', owner_id: 'me', shared_with_user_id: 'u2', role: 'viewer', created_at: '', profiles: person('u2', 'bia@example.com') }], error: null }
    db.search = { data: [person('me', 'eu@example.com'), person('u2', 'bia@example.com'), person('u3', 'ana@example.com')], error: null } satisfies Res
    const { user, search } = setup()
    await user.type(search, 'ana')
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith('search_users_for_share', { p_term: 'ana' }))
    const invite = await screen.findAllByRole('button', { name: /share_invite_btn/ })
    expect(invite).toHaveLength(1)
    expect(screen.getByText('ana@example.com')).toBeTruthy()
    await user.click(invite[0])
    expect(db.inserts).toEqual([{ page_id: 'p1', owner_id: 'me', shared_with_user_id: 'u3', role: 'editor' }])
  })

  it('convite recusado mostra o erro no modal', async () => {
    db.search = { data: [person('u3', 'ana@example.com')], error: null }
    db.insert = { data: null, error: { message: 'duplicate key' } }
    const { user, search } = setup()
    await user.type(search, 'ana')
    await user.click(await screen.findByRole('button', { name: /share_invite_btn/ }))
    expect(await screen.findByText('share_invite_error')).toBeTruthy()
  })

  it('limite de buscas avisa em vez de dizer "ninguém encontrado"', async () => {
    db.search = { data: null, error: { message: 'too many', code: 'rate_limited' } }
    const { user, search } = setup()
    await user.type(search, 'ana')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('warning', 'search_rate_limited', { dedupeKey: 'user-search-rate-limited' }))
  })
})
