// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '../../test/rtl'
import { localDateKey } from '../../lib/localDate'

// ARCH-008: a aba de usuários do painel de admin, montada com o hook de
// verdade e a camada de dados simulada: busca, ações pela edge admin-ops
// (desativar, excluir com confirmação, sem sessão), reset de senha, o selo do
// login diário e o layout de celular.

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
}))
const ui = vi.hoisted(() => ({ mobile: false }))

vi.mock('../../lib/data/admin', () => ({
  ADMIN_OPS_ERROR_KEYS: { 'User not found': 'admin_err_user_not_found' },
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
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' }, refreshProfile: async () => {} }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => ui.mobile }))

const { default: UserManagementPanel } = await import('../UserManagementPanel')

const daysAgo = (n: number) => localDateKey(new Date(Date.now() - n * 86_400_000))
const profile = (id: string, email: string, extra: Record<string, unknown> = {}) => ({
  id, email, display_name: null, role: 'standard', is_active: true, language: 'pt-BR', created_at: '2026-01-01',
  invite_slots_remaining: 0, last_login_date: null, avatar_emoji: null, avatar_color: null, avatar_url: null, ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  ui.mobile = false
  data.listProfilesForAdmin.mockResolvedValue({
    data: [
      profile('u1', 'eu@example.com', { role: 'admin', last_login_date: daysAgo(0) }),
      profile('u2', 'ana@example.com', { display_name: 'Ana Lima', last_login_date: daysAgo(1) }),
      profile('u3', 'bia@example.com', { last_login_date: daysAgo(5), is_active: false }),
    ],
    error: null,
  })
  data.lastSignIns.mockResolvedValue({ u2: '2026-10-01T10:00:00Z' })
  data.currentAccessToken.mockResolvedValue('tok')
  data.callAdminOps.mockResolvedValue({ success: true })
  data.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
})

async function mount() {
  render(<UserManagementPanel />)
  await screen.findByText('ana@example.com')
}
/** A linha (ou o cartão) de uma conta, pelo e-mail. */
const rowOf = (email: string) => screen.getByText(email).closest('div[style*="border-bottom"]') as HTMLElement

describe('UsersTab', () => {
  it('busca por e-mail ou nome; sem resultado mostra o aviso', async () => {
    await mount()
    expect(screen.getByText('admin_users_count_plural')).toBeTruthy()
    const search = screen.getByRole('textbox', { name: 'admin_search_placeholder' })
    fireEvent.change(search, { target: { value: 'LIMA' } })
    expect(screen.getByText('ana@example.com')).toBeTruthy()
    expect(screen.queryByText('bia@example.com')).toBeNull()
    fireEvent.change(search, { target: { value: 'bia@' } })
    expect(screen.getByText('bia@example.com')).toBeTruthy()
    expect(screen.queryByText('ana@example.com')).toBeNull()
    fireEvent.change(search, { target: { value: 'ninguém' } })
    expect(screen.getByText('admin_no_users')).toBeTruthy()
  })

  it('selo do login diário: hoje, ontem e há N dias; o último acesso vem do Auth', async () => {
    await mount()
    expect(within(rowOf('eu@example.com')).getByText('users_login_today')).toBeTruthy()
    expect(within(rowOf('ana@example.com')).getByText('users_login_yesterday')).toBeTruthy()
    expect(within(rowOf('bia@example.com')).getByText('users_login_days_ago')).toBeTruthy()
    expect(within(rowOf('ana@example.com')).getByText(new Date('2026-10-01T10:00:00Z').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }))).toBeTruthy()
    expect(within(rowOf('bia@example.com')).getByText('—')).toBeTruthy()
  })

  it('a própria conta leva o selo "você" e não pode ser rebaixada, desativada nem excluída', async () => {
    await mount()
    const mine = rowOf('eu@example.com')
    expect(within(mine).getByText('admin_you')).toBeTruthy()
    for (const name of ['admin_demote', 'admin_deactivate', 'admin_delete']) {
      expect(within(mine).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true)
    }
    expect(within(mine).getByRole<HTMLButtonElement>('button', { name: 'admin_reset_password' }).disabled).toBe(false)
  })

  it('desativar passa pela edge (ban_user), troca o selo e avisa; reativar usa unban_user', async () => {
    await mount()
    fireEvent.click(within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_deactivate' }))
    await waitFor(() => expect(data.callAdminOps).toHaveBeenCalledWith('tok', { action: 'ban_user', user_id: 'u2' }))
    expect(await screen.findByText('admin_feedback_deactivated')).toBeTruthy()
    expect(within(rowOf('ana@example.com')).getByText('admin_inactive')).toBeTruthy()

    fireEvent.click(within(rowOf('bia@example.com')).getByRole('button', { name: 'admin_reactivate' }))
    await waitFor(() => expect(data.callAdminOps).toHaveBeenCalledWith('tok', { action: 'unban_user', user_id: 'u3' }))
    expect(await screen.findByText('admin_feedback_reactivated')).toBeTruthy()
  })

  it('o hover acende o contorno do botão de ação, mas não quando está desligado', async () => {
    await mount()
    const promote = within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_promote' })
    fireEvent.mouseEnter(promote)
    expect(promote.style.borderColor).toBe('var(--color-warning)')
    fireEvent.mouseLeave(promote)
    expect(promote.style.borderColor).toBe('var(--color-border)')
    const own = within(rowOf('eu@example.com')).getByRole('button', { name: 'admin_demote' })
    fireEvent.mouseEnter(own)
    expect(own.style.borderColor).toBe('var(--color-border)')
  })

  it('reset de senha: sucesso avisa; o limite de envio vira mensagem traduzida', async () => {
    await mount()
    fireEvent.click(within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_reset_password' }))
    await waitFor(() => expect(data.resetPasswordForEmail).toHaveBeenCalledWith('ana@example.com'))
    expect(await screen.findByText('admin_feedback_reset')).toBeTruthy()

    data.resetPasswordForEmail.mockResolvedValue({ data: null, error: { code: 'over_email_send_rate_limit', message: 'rate' } })
    fireEvent.click(within(rowOf('bia@example.com')).getByRole('button', { name: 'admin_reset_password' }))
    expect((await screen.findByRole('alert')).textContent).toBe('admin_reset_rate_limited')
  })

  it('excluir conta pede confirmação; confirmar chama delete_user e tira a linha', async () => {
    await mount()
    fireEvent.click(within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('admin_confirm_delete')).toBeTruthy()
    expect(data.callAdminOps).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'confirm_delete_confirm' }))
    await waitFor(() => expect(data.callAdminOps).toHaveBeenCalledWith('tok', { action: 'delete_user', user_id: 'u2' }))
    expect(await screen.findByText('admin_feedback_deleted')).toBeTruthy()
    expect(screen.queryByText('ana@example.com')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('erro conhecido da edge na exclusão sai traduzido e a conta fica', async () => {
    data.callAdminOps.mockResolvedValue({ error: 'User not found' })
    await mount()
    fireEvent.click(within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_delete' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'confirm_delete_confirm' }))
    expect((await screen.findByRole('alert')).textContent).toBe('admin_err_user_not_found')
    expect(screen.getByText('ana@example.com')).toBeTruthy()
  })

  it('cancelar a exclusão fecha a confirmação sem chamar a edge', async () => {
    await mount()
    fireEvent.click(within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_delete' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'confirm_delete_cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(data.callAdminOps).not.toHaveBeenCalled()
  })

  it('sem sessão, as ações da edge avisam e não chamam nada', async () => {
    data.currentAccessToken.mockResolvedValue(null)
    await mount()
    fireEvent.click(within(rowOf('ana@example.com')).getByRole('button', { name: 'admin_promote' }))
    expect((await screen.findByRole('alert')).textContent).toBe('admin_err_no_session')
    expect(data.callAdminOps).not.toHaveBeenCalled()
  })

  it('erro ao listar os perfis aparece no aviso; atualizar tenta de novo', async () => {
    data.listProfilesForAdmin.mockResolvedValueOnce({ data: null, error: { message: 'rls recusou' } })
    render(<UserManagementPanel />)
    expect((await screen.findByRole('alert')).textContent).toBe('rls recusou')
    expect(screen.getByText('admin_no_users')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'admin_refresh' }))
    expect(await screen.findByText('ana@example.com')).toBeTruthy()
    expect(data.listProfilesForAdmin).toHaveBeenCalledTimes(2)
  })

  it('celular: cartões sem cabeçalho de tabela, com as mesmas ações', async () => {
    ui.mobile = true
    await mount()
    expect(screen.queryByText('admin_col_role')).toBeNull()
    const card = rowOf('bia@example.com')
    expect(within(card).getByText('admin_inactive')).toBeTruthy()
    expect(within(card).getByText('admin_role_standard')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'admin_promote' }))
    await waitFor(() => expect(data.callAdminOps).toHaveBeenCalledWith('tok', { action: 'set_role', user_id: 'u3', role: 'admin' }))
    expect(await screen.findByText('admin_feedback_role')).toBeTruthy()
    expect(within(rowOf('bia@example.com')).getByText('admin_role_admin')).toBeTruthy()
  })
})
