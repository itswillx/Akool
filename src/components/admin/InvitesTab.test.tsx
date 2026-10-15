// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '../../test/rtl'

// ARCH-008: a aba de convites do painel de admin, montada com o hook de
// verdade e a camada de dados simulada: filtro por status, copiar, revogar,
// excluir com confirmação (e a recusa do RLS), o layout de celular e as cotas.

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
const ui = vi.hoisted(() => ({ mobile: false }))

vi.mock('../../lib/data/admin', () => ({
  ADMIN_OPS_ERROR_KEYS: {},
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
vi.mock('../../lib/data/invites', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/data/invites')>()),
  generateInviteCode: data.generateInviteCode,
  profileEmailsById: data.profileEmailsById,
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, refreshProfile: async () => {} }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => ui.mobile }))

const { default: UserManagementPanel } = await import('../UserManagementPanel')

const profile = (id: string, email: string, role: 'admin' | 'standard', slots = 0) => ({
  id, email, display_name: null, role, is_active: true, language: 'pt-BR', created_at: '2026-01-01',
  invite_slots_remaining: slots, last_login_date: null, avatar_emoji: null, avatar_color: null, avatar_url: null,
})
const code = (id: string, value: string, extra: { used_by?: string; used_at?: string; expires_at?: string } = {}) => ({
  id, code: value, created_by: 'u2', used_by: extra.used_by ?? null, created_at: '2026-09-01',
  expires_at: extra.expires_at ?? '2099-01-01', used_at: extra.used_at ?? null,
})

const writeText = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ui.mobile = false
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  data.listProfilesForAdmin.mockResolvedValue({
    data: [profile('u1', 'eu@example.com', 'admin'), profile('u2', 'ana@example.com', 'standard', 2), profile('u3', 'bia@example.com', 'standard', 0)],
    error: null,
  })
  data.lastSignIns.mockResolvedValue({})
  data.listAllInviteCodes.mockResolvedValue({
    data: [
      code('c1', 'PEND01'),
      code('c2', 'USED02', { used_by: 'u3', used_at: '2026-09-02' }),
      code('c3', 'EXPI03', { expires_at: '2020-01-01' }),
      code('c4', 'USED04', { used_by: 'zz-unknown-id', used_at: '2026-09-03' }),
    ],
    error: null,
  })
  data.profileEmailsById.mockResolvedValue({ u2: 'ana@example.com', u3: 'bia@example.com' })
  data.revokeInviteCode.mockResolvedValue({ data: null, error: null })
  data.deleteInviteCode.mockResolvedValue({ data: [{ id: 'c2' }], error: null })
  data.addInviteSlots.mockResolvedValue({ data: null, error: null })
})

afterEach(() => { vi.useRealTimers() })

async function openInvites() {
  render(<UserManagementPanel />)
  await screen.findByText('ana@example.com')
  fireEvent.click(screen.getByRole('button', { name: 'admin_tab_invites' }))
  await screen.findByText('PEND01')
}

describe('InvitesTab: códigos', () => {
  it('filtra por status e mostra quem usou (e-mail, ou o id curto sem e-mail)', async () => {
    await openInvites()
    expect(screen.getByText('bia@example.com')).toBeTruthy()
    expect(screen.getByText('zz-unkno…')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_filter_pending' }))
    expect(screen.getByRole('button', { name: 'admin_invites_filter_pending' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('PEND01')).toBeTruthy()
    expect(screen.queryByText('USED02')).toBeNull()
    expect(screen.queryByText('EXPI03')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_filter_used' }))
    expect(screen.getByText('USED02')).toBeTruthy()
    expect(screen.getByText('USED04')).toBeTruthy()
    expect(screen.queryByText('PEND01')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_filter_expired' }))
    expect(screen.getByText('EXPI03')).toBeTruthy()
    expect(screen.queryByText('USED02')).toBeNull()
  })

  it('só o pendente tem copiar e revogar; os outros têm excluir', async () => {
    await openInvites()
    expect(screen.getAllByRole('button', { name: 'settings_invites_copy' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'admin_invites_revoke' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'admin_invites_delete' })).toHaveLength(3)
  })

  it('copiar põe o código na área de transferência e volta ao normal depois de 2 s', async () => {
    await openInvites()
    vi.useFakeTimers()
    const copy = screen.getByRole('button', { name: 'settings_invites_copy' })
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('PEND01')
    expect(copy.style.color).toBe('var(--color-success)')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(copy.style.color).toBe('var(--color-text-muted)')
  })

  it('revogar chama a RPC, avisa e recarrega a lista', async () => {
    await openInvites()
    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_revoke' }))
    await waitFor(() => expect(data.revokeInviteCode).toHaveBeenCalledWith('c1'))
    expect(await screen.findByText('admin_invites_code_revoked')).toBeTruthy()
    expect(data.listAllInviteCodes).toHaveBeenCalledTimes(2)
  })

  it('revogar com erro mostra a mensagem e não recarrega', async () => {
    data.revokeInviteCode.mockResolvedValue({ data: null, error: { message: 'sem permissão' } })
    await openInvites()
    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_revoke' }))
    expect((await screen.findByRole('alert')).textContent).toBe('sem permissão')
    expect(data.listAllInviteCodes).toHaveBeenCalledOnce()
  })

  it('excluir pede confirmação: cancelar não apaga, confirmar apaga e recarrega', async () => {
    await openInvites()
    fireEvent.click(screen.getAllByRole('button', { name: 'admin_invites_delete' })[0])
    let dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('admin_invites_delete_confirm')).toBeTruthy()
    expect(within(dialog).getByText('USED02')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'confirm_delete_cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(data.deleteInviteCode).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'admin_invites_delete' })[0])
    dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'admin_invites_delete' }))
    await waitFor(() => expect(data.deleteInviteCode).toHaveBeenCalledWith('c2'))
    expect(await screen.findByText('admin_invites_code_deleted')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(data.listAllInviteCodes).toHaveBeenCalledTimes(2)
  })

  it('exclusão que não apaga nenhuma linha (RLS) vira erro', async () => {
    data.deleteInviteCode.mockResolvedValue({ data: [], error: null })
    await openInvites()
    fireEvent.click(screen.getAllByRole('button', { name: 'admin_invites_delete' })[0])
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'admin_invites_delete' }))
    expect((await screen.findByRole('alert')).textContent).toBe('No rows affected')
    expect(data.listAllInviteCodes).toHaveBeenCalledOnce()
  })

  it('gerar com erro mostra a mensagem e não recarrega', async () => {
    data.generateInviteCode.mockResolvedValue({ data: null, error: { message: 'limite atingido' } })
    await openInvites()
    fireEvent.click(screen.getByRole('button', { name: /admin_invites_generate$/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('limite atingido')
    expect(data.listAllInviteCodes).toHaveBeenCalledOnce()
  })

  it('atualizar recarrega os códigos; lista vazia mostra o aviso', async () => {
    await openInvites()
    data.listAllInviteCodes.mockResolvedValue({ data: [], error: null })
    fireEvent.click(screen.getByRole('button', { name: 'admin_refresh' }))
    expect(await screen.findByText('admin_invites_empty')).toBeTruthy()
    expect(data.listAllInviteCodes).toHaveBeenCalledTimes(2)
    expect(data.listProfilesForAdmin).toHaveBeenCalledOnce() // na aba de convites, só os códigos
  })

  it('celular: cartões com criador, quem usou e os botões com texto', async () => {
    ui.mobile = true
    await openInvites()
    expect(screen.queryByText('admin_invites_col_code')).toBeNull() // sem cabeçalho de tabela
    expect(screen.getAllByText(/admin_invites_col_creator: ana@example.com/)).toHaveLength(4)
    expect(screen.getByText('admin_invites_col_used_by: bia@example.com')).toBeTruthy()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'settings_invites_copy' }))
    expect(screen.getByRole('button', { name: 'settings_invites_copied' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByRole('button', { name: 'settings_invites_copy' })).toBeTruthy()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_revoke' }))
    await waitFor(() => expect(data.revokeInviteCode).toHaveBeenCalledWith('c1'))
    fireEvent.click(screen.getAllByRole('button', { name: 'admin_invites_delete' })[1])
    expect(within(await screen.findByRole('alertdialog')).getByText('EXPI03')).toBeTruthy()
  })
})

describe('InvitesTab: cotas', () => {
  it('remover cota chama a RPC com -1 e baixa o número; sem cota, o botão fica desligado', async () => {
    await openInvites()
    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_quotas' }))
    const remove = await screen.findAllByRole('button', { name: 'admin_invites_remove_slot' })
    expect(remove).toHaveLength(2) // a admin não aparece
    expect((remove[1] as HTMLButtonElement).disabled).toBe(true) // bia, 0 cotas
    expect(screen.getByText('2')).toBeTruthy()

    fireEvent.click(remove[0])
    await waitFor(() => expect(data.addInviteSlots).toHaveBeenCalledWith('u2', -1))
    expect(await screen.findByText('admin_invites_slot_removed')).toBeTruthy()
    expect(screen.queryByText('2')).toBeNull()
    expect(screen.getByText('1')).toBeTruthy()

    // Voltar aos códigos e à aba de usuários mantém o que já foi carregado.
    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_all_codes' }))
    expect(screen.getByText('PEND01')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'admin_tab_users' }))
    expect(screen.getByText('ana@example.com')).toBeTruthy()
    expect(data.listProfilesForAdmin).toHaveBeenCalledOnce()
  })

  it('erro na cota aparece no aviso e o número não muda', async () => {
    data.addInviteSlots.mockResolvedValue({ data: null, error: { message: 'falhou' } })
    await openInvites()
    fireEvent.click(screen.getByRole('button', { name: 'admin_invites_quotas' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'admin_invites_add_slot' }))[0])
    expect((await screen.findByRole('alert')).textContent).toBe('falhou')
    expect(screen.getByText('2')).toBeTruthy()
  })
})
