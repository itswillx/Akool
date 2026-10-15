import { supabase } from '../supabase'
import type { TranslationKey } from '../../i18n/translations'

// Criar o workspace, sair dele e remover membro pelas RPCs SECURITY DEFINER
// create_workspace, leave_workspace e remove_workspace_member (migration
// workspace_exit). Sair ou ser removido leva junto as linhas da pessoa (Loja,
// fornecedores, empréstimos, lançamentos, orçamentos, recorrentes, as metas sem
// aporte de outra pessoa e as categorias e contas que ninguém mais usa). O que
// outras pessoas também usam (categorias, contas, metas com aporte delas) fica
// no workspace e passa para o dono; os aportes de quem sai vão para uma cópia
// privada da meta, e as linhas privadas dele nas categorias que ficam, para
// cópias pessoais. Quem chama lê `{ data, error }`, como nas outras funções de
// src/lib/data.

/** Cria o workspace de quem chama (com as categorias padrão); devolve o id. */
export async function createWorkspace(name: string) {
  const { data, error } = await supabase.rpc('create_workspace', { p_name: name })
  return { data: error || typeof data !== 'string' ? null : data, error }
}

/** Sai do workspace. A dona passa a posse ao membro mais antigo; a última pessoa apaga o workspace. */
export async function leaveWorkspace() {
  const { error } = await supabase.rpc('leave_workspace')
  return { error }
}

/** Remove um membro (só a dona). O membro é avisado por notificação. */
export async function removeWorkspaceMember(userId: string) {
  const { error } = await supabase.rpc('remove_workspace_member', { p_user_id: userId })
  return { error }
}

// ─── Erros ───────────────────────────────────────────────────────────────────

type WorkspaceError = { code?: string | null; message?: string | null } | null | undefined

// As RPCs de workspace levantam P0001 com mensagens fixas em inglês; a guarda
// de workspace, 42501. O convite que a saída de quem convidou apagou (ou que
// outra aba já respondeu) chega ao aceitar e ao recusar como "not found" ou
// "no longer pending".
const MESSAGE_KEYS: Record<string, TranslationKey> = {
  'Not authenticated': 'finance_workspace_error_session',
  'Not in a workspace': 'finance_workspace_error_not_in',
  'Only the owner can remove members': 'finance_workspace_error_owner_only',
  'Cannot remove yourself': 'finance_workspace_error_self',
  'User is not a member of this workspace': 'finance_workspace_error_not_member',
  'User already belongs to a workspace': 'finance_workspace_error_already',
  'Invite not found': 'finance_workspace_error_invite_gone',
  'Invite is no longer pending': 'finance_workspace_error_invite_gone',
}

/**
 * A chave de tradução de um erro de criar, sair ou remover, pela mensagem fixa
 * da RPC ou pelo SQLSTATE. Desconhecido: null (quem mostra usa a mensagem crua).
 */
export function workspaceErrorKey(error: WorkspaceError): TranslationKey | null {
  if (!error) return null
  const code = error.code ?? ''
  const message = (error.message ?? '').trim()
  if (code === 'PGRST202' || code === '42883') return 'finance_workspace_error_outdated'
  const known = MESSAGE_KEYS[message]
  if (known) return known
  if (code === '42501') {
    // Um pagamento no workspace de um empréstimo que já saiu dele ainda segura
    // a saída da última pessoa (resíduo conhecido dos empréstimos).
    return message.startsWith('Devedor so pode') ? 'finance_workspace_error_loans' : 'finance_workspace_error_denied'
  }
  return null
}

/** O texto do erro no idioma da tela; sem chave, a mensagem crua ou o aviso genérico. */
export function workspaceErrorText(error: NonNullable<WorkspaceError>, t: (key: TranslationKey) => string): string {
  const key = workspaceErrorKey(error)
  return key ? t(key) : (error.message?.trim() || t('finance_workspace_error_generic'))
}
