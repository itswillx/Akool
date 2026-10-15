// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent } from '../../../test/rtl'
import { getT } from '../../../i18n/translations'
import type { FinanceWorkspace, FinanceWorkspaceInvite, FinanceWorkspaceMember } from '../../../types'

// Saída do workspace: o WorkspaceModal cria, sai e remove membro pela camada de dados
// (src/lib/data/financeWorkspace.ts). O Remover e o Sair dizem o que vai com a
// pessoa e o que fica no workspace, e o erro das RPCs aparece traduzido (antes
// era o texto cru do banco, como "Somente o autor pode realocar o lancamento").
// A última pessoa vê que o workspace será apagado, e o convite que a saída de
// quem convidou apagou dá um aviso traduzido ao aceitar ou recusar. Com a RPC
// falsa, o teste prende a fiação; o aceite "membro com lançamentos é
// removido" é do harness supabase/checks/workspace-exit.sql.

const rpc = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: { code: string; message: string } | null }>>())
vi.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))
vi.mock('../../../i18n/LanguageContext', async () => {
  const { getT: realT } = await import('../../../i18n/translations')
  return { useLanguage: () => ({ lang: 'pt-BR', t: realT('pt-BR') }) }
})
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'dona', email: 'dona@example.invalid' } }) }))
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

const { WorkspaceModal } = await import('./WorkspaceModal')

const t = getT('pt-BR')
const workspace: FinanceWorkspace = { id: 'w', name: 'Família', owner_id: 'dona', created_at: '2026-10-01T00:00:00Z' }
const members = [
  { id: 'm1', workspace_id: 'w', user_id: 'dona', role: 'owner', joined_at: '2026-10-01T00:00:00Z', profile: { email: 'dona@example.invalid', display_name: 'Dona' } },
  { id: 'm2', workspace_id: 'w', user_id: 'f', role: 'member', joined_at: '2026-10-02T00:00:00Z', profile: { email: 'f@example.invalid', display_name: 'Fabi' } },
] as unknown as FinanceWorkspaceMember[]

function setup(ws: FinanceWorkspace | null = workspace, opts: { members?: FinanceWorkspaceMember[]; pending?: FinanceWorkspaceInvite[] } = {}) {
  const onReload = vi.fn(() => Promise.resolve())
  const onClose = vi.fn()
  render(<WorkspaceModal workspace={ws} members={opts.members ?? (ws ? members : [])} invites={[]} pendingInvitesForMe={opts.pending ?? []}
    partnerProfiles={[]} onClose={onClose} onReload={onReload} />)
  return { onReload, onClose, user: userEvent.setup() }
}

beforeEach(() => { rpc.mockReset() })

describe('WorkspaceModal: remover membro', () => {
  it('a confirmação diz quem sai e o que fica; confirmar remove, recarrega e avisa', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    const { onReload, user } = setup()
    await user.click(screen.getByRole('button', { name: t('finance_workspace_remove') }))
    expect(screen.getByText(t('finance_workspace_remove_confirm', { name: 'Fabi' }))).toBeTruthy()
    expect(screen.getByText(t('finance_workspace_remove_detail'))).toBeTruthy()

    await user.click(screen.getByRole('button', { name: t('finance_confirm') }))
    expect(rpc).toHaveBeenCalledWith('remove_workspace_member', { p_user_id: 'f' })
    expect(await screen.findByText(t('finance_workspace_member_removed'))).toBeTruthy()
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(t('finance_workspace_remove_detail'))).toBeNull()
  })

  it('o erro do servidor aparece traduzido, sem recarregar e com a confirmação aberta', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'User is not a member of this workspace' } })
    const { onReload, user } = setup()
    await user.click(screen.getByRole('button', { name: t('finance_workspace_remove') }))
    await user.click(screen.getByRole('button', { name: t('finance_confirm') }))

    expect(await screen.findByText(t('finance_workspace_error_not_member'))).toBeTruthy()
    expect(screen.queryByText('User is not a member of this workspace')).toBeNull()
    expect(onReload).not.toHaveBeenCalled()
    expect(screen.getByText(t('finance_workspace_remove_detail'))).toBeTruthy()
  })
})

describe('WorkspaceModal: sair', () => {
  it('a confirmação diz o que vai junto; confirmar sai, recarrega e fecha', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    const { onReload, onClose, user } = setup()
    await user.click(screen.getByRole('button', { name: t('finance_workspace_leave') }))
    expect(screen.getByText(t('finance_workspace_leave_confirm'))).toBeTruthy()
    expect(screen.getByText(t('finance_workspace_leave_detail'))).toBeTruthy()

    await user.click(screen.getByRole('button', { name: t('finance_workspace_leave_confirm_btn') }))
    expect(rpc).toHaveBeenCalledWith('leave_workspace')
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a última pessoa vê que o workspace será apagado (e não o texto do sucessor)', async () => {
    const { user } = setup(workspace, { members: [members[0]] })
    await user.click(screen.getByRole('button', { name: t('finance_workspace_leave') }))
    expect(screen.getByText(t('finance_workspace_leave_detail_last'))).toBeTruthy()
    expect(screen.queryByText(t('finance_workspace_leave_detail'))).toBeNull()
  })

  it('o pagamento de empréstimo que ainda segura o workspace (resíduo conhecido) aparece traduzido e o modal fica', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Devedor so pode anexar comprovante e nota ao proprio reporte' } })
    const { onReload, onClose, user } = setup()
    await user.click(screen.getByRole('button', { name: t('finance_workspace_leave') }))
    await user.click(screen.getByRole('button', { name: t('finance_workspace_leave_confirm_btn') }))

    expect(await screen.findByText(t('finance_workspace_error_loans'))).toBeTruthy()
    expect(onReload).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('WorkspaceModal: convite recebido', () => {
  const invite = {
    id: 'i1', workspace_id: 'w', invited_by: 'f', invited_email: 'dona@example.invalid', invited_user_id: 'dona',
    status: 'pending', created_at: '2026-10-01T00:00:00Z', responded_at: null, inviter_profile: { email: 'f@example.invalid', display_name: 'Fabi' },
  } as unknown as FinanceWorkspaceInvite

  it('aceitar um convite que a saída de quem convidou apagou: o aviso sai traduzido e a lista recarrega', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Invite not found' } })
    const { onReload, user } = setup(null, { pending: [invite] })
    await user.click(screen.getByRole('button', { name: t('finance_workspace_invite_accept') }))

    expect(rpc).toHaveBeenCalledWith('accept_workspace_invite', { p_invite_id: 'i1' })
    expect(await screen.findByText(t('finance_workspace_error_invite_gone'))).toBeTruthy()
    expect(screen.queryByText('Invite not found')).toBeNull()
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('recusar um convite que já não está pendente: o mesmo aviso', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'Invite is no longer pending' } })
    const { onReload, user } = setup(null, { pending: [invite] })
    await user.click(screen.getByRole('button', { name: t('finance_workspace_invite_decline') }))

    expect(await screen.findByText(t('finance_workspace_error_invite_gone'))).toBeTruthy()
    expect(onReload).toHaveBeenCalledTimes(1)
  })
})

describe('WorkspaceModal: criar', () => {
  it('cria pela camada de dados e traduz quem já tem workspace', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'User already belongs to a workspace' } })
    const { onReload, user } = setup(null)
    fireEvent.change(screen.getByPlaceholderText(t('finance_workspace_create_placeholder')), { target: { value: ' Casa ' } })
    await user.click(screen.getByRole('button', { name: t('finance_workspace_create') }))

    expect(rpc).toHaveBeenCalledWith('create_workspace', { p_name: 'Casa' })
    expect(await screen.findByText(t('finance_workspace_error_already'))).toBeTruthy()
    expect(onReload).not.toHaveBeenCalled()
  })
})
