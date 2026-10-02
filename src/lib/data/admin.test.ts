import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ARCH-008: cada função pede ao banco exatamente o que o painel pedia antes,
// e a edge admin-ops nunca vira promessa rejeitada.

const calls = vi.hoisted((): { chain: string[]; session: string | null } => ({ chain: [], session: 'tok' }))
vi.mock('../supabase', () => {
  const record = (name: string) => (...args: unknown[]) => { calls.chain.push(`${name}(${args.map(a => JSON.stringify(a)).join(',')})`); return builder }
  const builder: Record<string, unknown> = {}
  for (const m of ['from', 'rpc', 'select', 'order', 'in', 'eq', 'delete']) builder[m] = record(m)
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ id: 'p1', email: 'a@x.io' }], error: null }).then(ok)
  return {
    supabase: {
      ...builder,
      auth: {
        getSession: async () => ({ data: { session: calls.session ? { access_token: calls.session } : null } }),
        resetPasswordForEmail: record('resetPasswordForEmail'),
      },
    },
  }
})
vi.mock('../env', () => ({ SUPABASE_URL: 'http://sb.test', SUPABASE_ANON_KEY: 'anon' }))

const admin = await import('./admin')
const invites = await import('./invites')

beforeEach(() => { calls.chain = []; calls.session = 'tok' })
afterEach(() => { vi.unstubAllGlobals() })

describe('inviteStatus', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  it('usado vence; expirado só sem uso; senão pendente', () => {
    expect(invites.inviteStatus({ used_at: '2026-09-01', expires_at: '2026-09-02' }, now)).toBe('used')
    expect(invites.inviteStatus({ used_at: null, expires_at: '2026-09-02' }, now)).toBe('expired')
    expect(invites.inviteStatus({ used_at: null, expires_at: '2026-12-02' }, now)).toBe('pending')
  })
})

describe('consultas', () => {
  it('lista perfis pela RPC de admin, por data de criação', async () => {
    await admin.listProfilesForAdmin()
    expect(calls.chain).toEqual([
      'rpc("admin_list_profiles")', `select(${JSON.stringify(admin.ADMIN_PROFILE_COLUMNS)})`, 'order("created_at",{"ascending":true})',
    ])
  })

  it('todos os códigos, os meus, e as RPCs de cota/revogação', async () => {
    await admin.listAllInviteCodes()
    await invites.listMyInviteCodes()
    await admin.addInviteSlots('u1', -1)
    await admin.revokeInviteCode('c1')
    await admin.deleteInviteCode('c2')
    await invites.generateInviteCode()
    expect(calls.chain).toEqual([
      'from("invite_codes")', 'select("id, code, created_by, used_by, created_at, expires_at, used_at")', 'order("created_at",{"ascending":false})',
      'from("invite_codes")', 'select("id, code, created_at, expires_at, used_at, used_by")', 'order("created_at",{"ascending":false})',
      'rpc("admin_add_invite_slots",{"p_user_id":"u1","p_slots":-1})',
      'rpc("admin_revoke_invite_code",{"p_code_id":"c1"})',
      'from("invite_codes")', 'delete()', 'eq("id","c2")', 'select("id")',
      'rpc("generate_invite_code")',
    ])
  })

  it('e-mails por id: sem ids não consulta; ids repetidos viram um', async () => {
    expect(await invites.profileEmailsById([])).toEqual({})
    expect(calls.chain).toEqual([])
    expect(await invites.profileEmailsById(['p1', 'p1'])).toEqual({ p1: 'a@x.io' })
    expect(calls.chain).toEqual(['from("profiles")', 'select("id, email")', 'in("id",["p1"])'])
  })

  it('reset de senha volta para a origem do app', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://app.test' } })
    await admin.resetPasswordForEmail('a@x.io')
    expect(calls.chain).toEqual(['resetPasswordForEmail("a@x.io",{"redirectTo":"http://app.test"})'])
  })
})

describe('callAdminOps', () => {
  it('manda token e apikey, e devolve o JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await admin.callAdminOps('tok', { action: 'set_role' })).toEqual({ success: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://sb.test/functions/v1/admin-ops')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', apikey: 'anon' })
  })

  it('backend fora vira admin_err_backend; status de erro vira a mensagem ou HTTP <status>', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect(await admin.callAdminOps('tok', {})).toEqual({ error: 'admin_err_backend' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })))
    expect(await admin.callAdminOps('tok', {})).toEqual({ error: 'HTTP 502' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid role' }), { status: 400 })))
    expect(await admin.callAdminOps('tok', {})).toEqual({ error: 'Invalid role' })
  })

  it('último login: vazio sem sessão; mapa por id com sessão', async () => {
    calls.session = null
    expect(await admin.lastSignIns()).toEqual({})
    calls.session = 'tok'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ users: [{ id: 'u1', last_sign_in_at: '2026-10-01' }, { id: 'u2' }] }), { status: 200 })))
    expect(await admin.lastSignIns()).toEqual({ u1: '2026-10-01', u2: null })
  })
})
