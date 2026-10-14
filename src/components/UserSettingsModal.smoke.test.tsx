// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/rtl'

// ARCH-008: as Configurações montadas inteiras: abre na aba de perfil, salva o
// nome, troca a senha (com a validação local) e lista os convites. A casca tem
// o mesmo tamanho em todas as abas, inclusive nas de admin. O happy-dom descarta
// alturas com min()/dvh, então aqui só a largura é comparada; a altura fica no
// teste de settingsShellSize (settings/settingsTokens.test.ts).

const auth = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
  isAdmin: false,
}))
const invites = vi.hoisted(() => ({ listMyInviteCodes: vi.fn(), profileEmailsById: vi.fn(), generateInviteCode: vi.fn() }))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'eu@example.com' },
    profile: { id: 'u1', email: 'eu@example.com', display_name: 'Eu', language: 'pt-BR', role: 'standard', invite_slots_remaining: 0, avatar_emoji: null, avatar_color: null, avatar_url: null, finance_dashboard_view: 'detailed' },
    ...auth,
  }),
}))
vi.mock('../contexts/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', setTheme: () => {} }) }))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('../lib/data/invites', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/data/invites')>()),
  ...invites,
}))
// API-009: a aba API recebe o atalho para Segurança (erro de segundo fator).
vi.mock('./ApiTokensSection', () => ({
  default: ({ onOpenSecurity }: { onOpenSecurity?: () => void }) => <button type="button" onClick={onOpenSecurity}>api-open-security</button>,
}))
vi.mock('./MfaSection', () => ({ default: () => <div>mfa-section</div> }))
vi.mock('./AvatarCropModal', () => ({ default: () => null }))
vi.mock('./UserManagementPanel', () => ({ default: () => <div>users-panel</div> }))
vi.mock('../modules/backup', () => ({ default: () => <div>backup-panel</div> }))
vi.mock('../modules/audit', () => ({ default: () => <div>audit-panel</div> }))

const { default: UserSettingsModal } = await import('./UserSettingsModal')

beforeEach(() => {
  vi.clearAllMocks()
  auth.isAdmin = false
  auth.updateProfile.mockResolvedValue({ error: null })
  auth.changePassword.mockResolvedValue({ error: null })
  invites.listMyInviteCodes.mockResolvedValue({ data: [], error: null })
  invites.profileEmailsById.mockResolvedValue({})
})

describe('UserSettingsModal (montagem completa)', () => {
  it('NOTIF-001: abre direto na aba pedida; aba de admin para quem não é admin abre no Perfil', async () => {
    const { unmount } = render(<UserSettingsModal open initialTab="notifications" onClose={() => {}} />)
    expect(screen.getByText('notif_prefs_title')).toBeTruthy()
    unmount()
    const second = render(<UserSettingsModal open initialTab="backup" onClose={() => {}} />)
    expect(screen.getByLabelText('settings_display_name')).toBeTruthy()
    second.unmount()
    auth.isAdmin = true
    render(<UserSettingsModal open initialTab="backup" onClose={() => {}} />)
    expect(await screen.findByText('backup-panel')).toBeTruthy()
  })

  it('abre na aba de perfil e salva o nome', async () => {
    render(<UserSettingsModal open onClose={() => {}} />)
    const name = screen.getByLabelText<HTMLInputElement>('settings_display_name')
    expect(name.value).toBe('Eu')
    fireEvent.change(name, { target: { value: 'Outro nome' } })
    fireEvent.click(screen.getByRole('button', { name: /settings_save$/ }))
    await waitFor(() => expect(auth.updateProfile).toHaveBeenCalledWith({ display_name: 'Outro nome', language: 'pt-BR', avatar_emoji: null, avatar_color: null }))
    expect(await screen.findByText('settings_saved')).toBeTruthy()
  })

  it('senha: confirmação diferente avisa sem chamar o Auth; igual, troca', async () => {
    render(<UserSettingsModal open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings_tab_password' }))
    const [current, next, confirm] = screen.getAllByLabelText<HTMLInputElement>(/settings_(current|new|confirm)_password/)
    fireEvent.change(current, { target: { value: 'senha-atual-123' } })
    fireEvent.change(next, { target: { value: 'NovaSenhaForte123!' } })
    fireEvent.change(confirm, { target: { value: 'diferente' } })
    fireEvent.click(screen.getByRole('button', { name: /settings_change_password$/ }))
    expect(await screen.findByText('settings_pwd_mismatch')).toBeTruthy()
    expect(auth.changePassword).not.toHaveBeenCalled()

    fireEvent.change(confirm, { target: { value: 'NovaSenhaForte123!' } })
    fireEvent.click(screen.getByRole('button', { name: /settings_change_password$/ }))
    await waitFor(() => expect(auth.changePassword).toHaveBeenCalledWith('senha-atual-123', 'NovaSenhaForte123!'))
    expect(await screen.findByText('settings_pwd_changed')).toBeTruthy()
  })

  it('convites: lista vazia e botão de gerar desligado sem slots; fechar chama onClose', async () => {
    const onClose = vi.fn()
    render(<UserSettingsModal open onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'settings_tab_invites' }))
    expect(await screen.findByText('settings_invites_empty')).toBeTruthy()
    expect(invites.listMyInviteCodes).toHaveBeenCalledOnce()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /settings_invites_generate_btn$/ }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'dialog_close' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('API-009: o atalho da aba API leva à aba Segurança', () => {
    render(<UserSettingsModal open initialTab="api" onClose={() => {}} />)
    expect(screen.queryByText('mfa-section')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'api-open-security' }))
    expect(screen.getByText('mfa-section')).toBeTruthy()
  })

  it('conta comum: as 6 abas com o mesmo tamanho (640 px)', () => {
    render(<UserSettingsModal open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    const first = dialog.getAttribute('style')
    expect(dialog.style.maxWidth).toBe('640px')
    for (const name of ACCOUNT_TABS) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(dialog.getAttribute('style')).toBe(first)
    }
    expect(screen.queryByRole('button', { name: 'sidebar_backup' })).toBeNull()
  })

  it('admin: as 9 abas com o mesmo tamanho (980 px), painéis de admin incluídos', async () => {
    auth.isAdmin = true
    render(<UserSettingsModal open onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    const first = dialog.getAttribute('style')
    expect(dialog.style.maxWidth).toBe('980px')
    for (const [name, content] of ADMIN_TABS) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(await screen.findByText(content)).toBeTruthy()
      expect(dialog.getAttribute('style')).toBe(first)
    }
    for (const name of ACCOUNT_TABS) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(dialog.getAttribute('style')).toBe(first)
    }
  })
})

const ACCOUNT_TABS = ['settings_tab_password', 'settings_tab_security', 'settings_tab_notifications', 'settings_tab_invites', 'settings_tab_api', 'settings_tab_profile']
const ADMIN_TABS = [['sidebar_users', 'users-panel'], ['sidebar_backup', 'backup-panel'], ['sidebar_audit', 'audit-panel']] as const
