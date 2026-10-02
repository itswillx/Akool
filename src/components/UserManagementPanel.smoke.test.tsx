// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/rtl'

// ARCH-008: o painel de admin montado inteiro, com a camada de dados simulada:
// lista as contas, troca de aba, gera um código e mexe nas cotas.

const data = vi.hoisted(() => ({
  listProfilesForAdmin: vi.fn(),
  lastSignIns: vi.fn(),
  listAllInviteCodes: vi.fn(),
  addInviteSlots: vi.fn(),
  revokeInviteCode: vi.fn(),
  deleteInviteCode: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  callAdminOps: vi.fn(),
  currentAccessToken: vi.fn(),
  generateInviteCode: vi.fn(),
  profileEmailsById: vi.fn(),
}))

vi.mock('../lib/data/admin', () => ({
  ADMIN_OPS_ERROR_KEYS: { 'Forbidden: admin only': 'admin_err_forbidden' },
  listProfilesForAdmin: data.listProfilesForAdmin,
  lastSignIns: data.lastSignIns,
  listAllInviteCodes: data.listAllInviteCodes,
  addInviteSlots: data.addInviteSlots,
  revokeInviteCode: data.revokeInviteCode,
  deleteInviteCode: data.deleteInviteCode,
  resetPasswordForEmail: data.resetPasswordForEmail,
  callAdminOps: data.callAdminOps,
  currentAccessToken: data.currentAccessToken,
}))
vi.mock('../lib/data/invites', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/data/invites')>()),
  generateInviteCode: data.generateInviteCode,
  profileEmailsById: data.profileEmailsById,
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, refreshProfile: async () => {} }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

const { default: UserManagementPanel } = await import('./UserManagementPanel')

const profile = (id: string, email: string, role: 'admin' | 'standard', slots = 0) => ({
  id, email, display_name: null, role, is_active: true, language: 'pt-BR', created_at: '2026-01-01',
  invite_slots_remaining: slots, last_login_date: null, avatar_emoji: null, avatar_color: null, avatar_url: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  data.listProfilesForAdmin.mockResolvedValue({ data: [profile('u1', 'eu@example.com', 'admin'), profile('u2', 'ana@example.com', 'standard', 1)], error: null })
  data.lastSignIns.mockResolvedValue({ u1: '2026-10-01T10:00:00Z' })
  data.listAllInviteCodes.mockResolvedValue({ data: [{ id: 'c1', code: 'ABC123', created_by: 'u2', used_by: null, created_at: '2026-09-01', expires_at: '2099-01-01', used_at: null }], error: null })
  data.profileEmailsById.mockResolvedValue({ u2: 'ana@example.com' })
  data.generateInviteCode.mockResolvedValue({ data: { code: 'NEW999' }, error: null })
  data.addInviteSlots.mockResolvedValue({ data: null, error: null })
  data.currentAccessToken.mockResolvedValue('tok')
  data.callAdminOps.mockResolvedValue({ success: true })
})

describe('UserManagementPanel (montagem completa)', () => {
  it('lista as contas com o último login e troca para convites', async () => {
    render(<UserManagementPanel />)
    expect(await screen.findByText('ana@example.com')).toBeTruthy()
    expect(screen.getByText('eu@example.com')).toBeTruthy()
    expect(data.lastSignIns).toHaveBeenCalledOnce()
    expect(data.listAllInviteCodes).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'admin_tab_invites' }))
    expect(await screen.findByText('ABC123')).toBeTruthy()
    expect(data.listAllInviteCodes).toHaveBeenCalledOnce()
  })

  it('gera um código pela RPC e mostra o feedback', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('ana@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'admin_tab_invites' }))
    await screen.findByText('ABC123')
    fireEvent.click(screen.getByRole('button', { name: /admin_invites_generate$/ }))
    await waitFor(() => expect(data.generateInviteCode).toHaveBeenCalledOnce())
    expect(await screen.findByText('admin_invites_code_generated')).toBeTruthy()
    expect(data.listAllInviteCodes).toHaveBeenCalledTimes(2)
  })

  it('cotas: adiciona um slot a quem não é admin', async () => {
    render(<UserManagementPanel />)
    await screen.findByText('ana@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'admin_tab_invites' }))
    fireEvent.click(await screen.findByRole('button', { name: 'admin_invites_quotas' }))
    const add = await screen.findAllByRole('button', { name: 'admin_invites_add_slot' })
    expect(add).toHaveLength(1) // só a conta padrão; a admin não tem cota
    fireEvent.click(add[0])
    await waitFor(() => expect(data.addInviteSlots).toHaveBeenCalledWith('u2', 1))
    expect(await screen.findByText('admin_invites_slot_added')).toBeTruthy()
  })

  it('a troca de role passa pela edge e o erro conhecido sai traduzido', async () => {
    data.callAdminOps.mockResolvedValue({ error: 'Forbidden: admin only' })
    render(<UserManagementPanel />)
    await screen.findByText('ana@example.com')
    fireEvent.click(screen.getAllByRole('button', { name: 'admin_promote' })[0])
    await waitFor(() => expect(data.callAdminOps).toHaveBeenCalledWith('tok', { action: 'set_role', user_id: 'u2', role: 'admin' }))
    expect(await screen.findByText('admin_err_forbidden')).toBeTruthy()
  })
})
