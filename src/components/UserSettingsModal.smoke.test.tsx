// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/rtl'

// ARCH-008: as Configurações montadas inteiras: abre na aba de perfil, salva o
// nome, troca a senha (com a validação local) e lista os convites.

const auth = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  signOut: vi.fn(),
  refreshProfile: vi.fn(),
}))
const invites = vi.hoisted(() => ({ listMyInviteCodes: vi.fn(), profileEmailsById: vi.fn(), generateInviteCode: vi.fn() }))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'eu@example.com' },
    profile: { id: 'u1', email: 'eu@example.com', display_name: 'Eu', language: 'pt-BR', role: 'standard', invite_slots_remaining: 0, avatar_emoji: null, avatar_color: null, avatar_url: null, finance_dashboard_view: 'detailed' },
    isAdmin: false,
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
vi.mock('./ApiTokensSection', () => ({ default: () => <div>api-section</div> }))
vi.mock('./MfaSection', () => ({ default: () => <div>mfa-section</div> }))
vi.mock('./AvatarCropModal', () => ({ default: () => null }))

const { default: UserSettingsModal } = await import('./UserSettingsModal')

beforeEach(() => {
  vi.clearAllMocks()
  auth.updateProfile.mockResolvedValue({ error: null })
  auth.changePassword.mockResolvedValue({ error: null })
  invites.listMyInviteCodes.mockResolvedValue({ data: [], error: null })
  invites.profileEmailsById.mockResolvedValue({})
})

describe('UserSettingsModal (montagem completa)', () => {
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
})
