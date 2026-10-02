import { useCallback, useEffect, useState } from 'react'
import { useAuth, type UserProfile } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { toLang } from '../../i18n/translations'
import { addInviteSlots, callAdminOps, currentAccessToken, lastSignIns, listProfilesForAdmin, resetPasswordForEmail } from '../../lib/data/admin'
import type { AdminFeedback } from './adminFeedback'

// ARCH-008: a lista de contas e as ações de admin sobre elas (role, ativo,
// reset de senha, exclusão, cotas de convite), fora da tela.

/** As colunas que a lista pede, mais o último login do Auth. */
export type UserRow = Pick<UserProfile,
  | 'id' | 'email' | 'display_name' | 'role' | 'is_active' | 'language' | 'invite_slots_remaining'
  | 'last_login_date' | 'avatar_emoji' | 'avatar_color' | 'avatar_url'> & {
  created_at: string
  last_sign_in?: string | null
}

export interface PendingConfirm { message: string; onConfirm: () => Promise<void> }

type LoadResult = { rows: UserRow[] } | { error: string }

/** Perfis (RPC de admin) mais o último login da edge; sem setState (puro). */
async function loadUsers(): Promise<LoadResult> {
  const { data: profiles, error } = await listProfilesForAdmin()
  if (error) return { error: error.message }
  const signIns = await lastSignIns()
  return { rows: profiles.map(p => ({ ...p, language: toLang(p.language), last_sign_in: signIns[p.id] ?? null })) }
}

export function useAdminUsers({ showFeedback, showOpsError }: AdminFeedback) {
  const { user: currentUser, refreshProfile } = useAuth()
  const { t } = useLanguage()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<PendingConfirm | null>(null)

  const applyUsers = useCallback((result: LoadResult) => {
    if ('error' in result) showFeedback('error', result.error)
    else setUsers(result.rows)
    setLoading(false)
  }, [showFeedback])

  // A montagem carrega com `loading` já true e aplica a resposta no `.then`
  // (nada de setState síncrono no efeito); o botão de atualizar liga o
  // `loading` no clique.
  useEffect(() => {
    let cancelled = false
    void loadUsers().then(result => { if (!cancelled) applyUsers(result) })
    return () => { cancelled = true }
  }, [applyUsers])

  const refresh = () => {
    setLoading(true)
    void loadUsers().then(applyUsers)
  }

  const patchUser = (id: string, patch: (u: UserRow) => UserRow) => {
    setUsers(prev => prev.map(x => (x.id === id ? patch(x) : x)))
  }

  /** As ações da edge precisam do token da sessão; sem ele, avisa e não faz nada. */
  const withSession = async (run: (token: string) => void | Promise<void>) => {
    const token = await currentAccessToken()
    if (!token) { showFeedback('error', t('admin_err_no_session')); return }
    await run(token)
  }

  // A troca de role passa pela edge admin-ops: ela valida o admin com service
  // role, barra o rebaixamento do último admin e grava em audit_log. O caminho
  // direto está fechado no banco (sec_lock_profile_role).
  const toggleRole = (u: UserRow) => withSession(async token => {
    setActionLoading(`${u.id}_role`)
    const newRole = u.role === 'admin' ? 'standard' : 'admin'
    const res = await callAdminOps(token, { action: 'set_role', user_id: u.id, role: newRole })
    if (res.error) showOpsError(res.error)
    else {
      showFeedback('success', t('admin_feedback_role', { email: u.email, role: newRole === 'admin' ? t('admin_role_name_admin') : t('admin_role_name_standard') }))
      patchUser(u.id, x => ({ ...x, role: newRole }))
      if (u.id === currentUser?.id) await refreshProfile()
    }
    setActionLoading(null)
  })

  const toggleActive = (u: UserRow) => withSession(async token => {
    setActionLoading(`${u.id}_active`)
    const res = await callAdminOps(token, { action: u.is_active ? 'ban_user' : 'unban_user', user_id: u.id })
    if (res.error) showOpsError(res.error)
    else {
      showFeedback('success', u.is_active ? t('admin_feedback_deactivated', { email: u.email }) : t('admin_feedback_reactivated', { email: u.email }))
      patchUser(u.id, x => ({ ...x, is_active: !u.is_active }))
    }
    setActionLoading(null)
  })

  const resetPassword = async (u: UserRow) => {
    setActionLoading(`${u.id}_reset`)
    const { error } = await resetPasswordForEmail(u.email)
    if (error) showFeedback('error', error.code === 'over_email_send_rate_limit' ? t('admin_reset_rate_limited') : error.message)
    else showFeedback('success', t('admin_feedback_reset', { email: u.email }))
    setActionLoading(null)
  }

  /** Pede confirmação; a exclusão em si corre no `onConfirm`. */
  const deleteUser = (u: UserRow) => withSession(token => {
    setConfirmDelete({
      message: t('admin_confirm_delete', { email: u.email }),
      onConfirm: async () => {
        setActionLoading(`${u.id}_delete`)
        const res = await callAdminOps(token, { action: 'delete_user', user_id: u.id })
        if (res.error) showOpsError(res.error)
        else {
          showFeedback('success', t('admin_feedback_deleted', { email: u.email }))
          setUsers(prev => prev.filter(x => x.id !== u.id))
        }
        setActionLoading(null)
        setConfirmDelete(null)
      },
    })
  })

  const changeSlots = async (u: UserRow, delta: 1 | -1) => {
    setActionLoading(`${u.id}_${delta > 0 ? 'slot' : 'unslot'}`)
    const { error } = await addInviteSlots(u.id, delta)
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t(delta > 0 ? 'admin_invites_slot_added' : 'admin_invites_slot_removed', { email: u.email }))
      patchUser(u.id, x => ({ ...x, invite_slots_remaining: Math.max((x.invite_slots_remaining ?? 0) + delta, 0) }))
    }
    setActionLoading(null)
  }

  return {
    users, loading, actionLoading, currentUserId: currentUser?.id,
    refresh, toggleRole, toggleActive, resetPassword, deleteUser,
    addSlot: (u: UserRow) => changeSlots(u, 1),
    removeSlot: (u: UserRow) => changeSlots(u, -1),
    confirmDelete, cancelDelete: () => setConfirmDelete(null),
  }
}

export type AdminUsers = ReturnType<typeof useAdminUsers>
