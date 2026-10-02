import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { deleteInviteCode, listAllInviteCodes, revokeInviteCode } from '../../lib/data/admin'
import { generateInviteCode, inviteStatus, profileEmailsById, type InviteStatus } from '../../lib/data/invites'
import { requireRows } from '../../lib/optimistic'
import type { AdminFeedback } from './adminFeedback'

// ARCH-008: todos os códigos de convite (admin): filtro, gerar, revogar e
// excluir, fora da tela.

export interface AdminInviteCode {
  id: string
  code: string
  created_by: string
  created_by_email?: string | null
  used_by: string | null
  used_by_email?: string | null
  created_at: string
  expires_at: string
  used_at: string | null
}

export type InviteFilter = 'all' | InviteStatus

/** Todos os códigos com os e-mails de quem criou e de quem usou; sem setState (puro). */
async function loadCodes(): Promise<AdminInviteCode[]> {
  const { data } = await listAllInviteCodes()
  const rows: AdminInviteCode[] = data ?? []
  const emails = await profileEmailsById([...rows.map(c => c.created_by), ...rows.flatMap(c => (c.used_by ? [c.used_by] : []))])
  return rows.map(c => ({ ...c, created_by_email: emails[c.created_by] ?? null, used_by_email: c.used_by ? emails[c.used_by] ?? null : null }))
}

export function useAdminInvites({ showFeedback }: AdminFeedback, active: boolean) {
  const { t } = useLanguage()
  const [codes, setCodes] = useState<AdminInviteCode[]>([])
  // `loaded` vira true na primeira resposta; `refreshing` só no botão de
  // atualizar (ligado no clique, nunca de forma síncrona num efeito).
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [filter, setFilter] = useState<InviteFilter>('all')
  const [confirmDelete, setConfirmDelete] = useState<AdminInviteCode | null>(null)

  const applyCodes = useCallback((rows: AdminInviteCode[]) => {
    setCodes(rows)
    setLoaded(true)
    setRefreshing(false)
  }, [])
  const fetchCodes = async () => applyCodes(await loadCodes())

  // Carrega quando a aba abre; aplica a resposta no `.then` (nada de setState
  // síncrono no efeito).
  useEffect(() => {
    if (!active) return
    let cancelled = false
    void loadCodes().then(rows => { if (!cancelled) applyCodes(rows) })
    return () => { cancelled = true }
  }, [active, applyCodes])

  const refresh = () => {
    setRefreshing(true)
    void fetchCodes()
  }

  const generate = async () => {
    setActionLoading('admin_generate')
    const { data, error } = await generateInviteCode()
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_code_generated', { code: (data as { code?: string } | null)?.code ?? '' }))
      await fetchCodes()
    }
    setActionLoading(null)
  }

  const revoke = async (c: AdminInviteCode) => {
    setActionLoading(`${c.id}_revoke`)
    const { error } = await revokeInviteCode(c.id)
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_code_revoked'))
      await fetchCodes()
    }
    setActionLoading(null)
  }

  const confirmDeleteCode = async () => {
    const target = confirmDelete
    if (!target) return
    setActionLoading(`${target.id}_delete`)
    setConfirmDelete(null)
    const result = requireRows(await deleteInviteCode(target.id))
    if (result.error) showFeedback('error', result.error.message)
    else {
      showFeedback('success', t('admin_invites_code_deleted'))
      await fetchCodes()
    }
    setActionLoading(null)
  }

  const filtered = filter === 'all' ? codes : codes.filter(c => inviteStatus(c) === filter)

  return {
    codes: filtered, loading: (active && !loaded) || refreshing, actionLoading, filter, setFilter,
    refresh, generate, revoke,
    requestDelete: (c: AdminInviteCode) => setConfirmDelete(c),
    confirmDelete, confirmDeleteCode, cancelDelete: () => setConfirmDelete(null),
  }
}

export type AdminInvites = ReturnType<typeof useAdminInvites>
