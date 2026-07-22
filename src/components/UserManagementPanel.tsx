import { memo, useEffect, useState, useCallback } from 'react'
import { Users, Shield, User, Trash2, MailCheck, Power, PowerOff, Search, RefreshCw, Crown, Gift, Copy, CheckCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useIsMobile } from '../hooks/useIsMobile'
import type { UserProfile } from '../contexts/AuthContext'
import ConfirmDeleteModal from './ConfirmDeleteModal'

interface UserRow extends UserProfile {
  last_sign_in?: string | null
}

function LoginBadge({ lastLoginDate }: { lastLoginDate: string | null }) {
  if (!lastLoginDate) return <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (lastLoginDate === today) {
    return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: '#dcfce7', color: '#15803d' }}>Hoje</span>
  }
  if (lastLoginDate === yesterday) {
    return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: '#fef9c3', color: '#854d0e' }}>Ontem</span>
  }
  const days = Math.floor((Date.now() - new Date(lastLoginDate).getTime()) / 86400000)
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: '#fee2e2', color: '#dc2626' }}>{days}d atrás</span>
}

interface AdminInviteCode {
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

const EDGE_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-ops`

async function callAdminOps(session: string, body: Record<string, unknown>) {
  const res = await fetch(EDGE_FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session}`,
    },
    body: JSON.stringify(body),
  })
  return res.json()
}

export default function UserManagementPanel() {
  const { session, user: currentUser, refreshProfile } = useAuth()
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // Admin tabs
  const [adminTab, setAdminTab] = useState<'users' | 'invites'>('users')

  // Invites tab state
  const [allInvites, setAllInvites] = useState<AdminInviteCode[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [inviteFilter, setInviteFilter] = useState<'all' | 'pending' | 'used' | 'expired'>('all')
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [inviteSubTab, setInviteSubTab] = useState<'codes' | 'quotas'>('codes')
  const [confirmDelete, setConfirmDelete] = useState<AdminInviteCode | null>(null)
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<{ message: string; onConfirm: () => void } | null>(null)

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3500)
  }

  const fetchUsers = async () => {
    setLoading(true)
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, display_name, role, is_active, language, created_at, invite_slots_remaining, last_login_date')
      .order('created_at', { ascending: true })

    if (error) { showFeedback('error', error.message); setLoading(false); return }  

    let authUsers: Record<string, { last_sign_in_at?: string | null }> = {}
    if (session?.access_token) {
      const res = await callAdminOps(session.access_token, { action: 'list_users' })
      if (res.users) {
        res.users.forEach((u: { id: string; last_sign_in_at?: string }) => {
          authUsers[u.id] = { last_sign_in_at: u.last_sign_in_at }
        })
      }
    }

    setUsers(
      (profiles as unknown as UserProfile[]).map(p => ({
        ...p,
        last_sign_in: authUsers[p.id]?.last_sign_in_at ?? null,
      }))
    )
    setLoading(false)
  }

  const fetchAllInvites = useCallback(async () => {
    setInvitesLoading(true)
    const { data } = await supabase
      .from('invite_codes')
      .select('id, code, created_by, used_by, created_at, expires_at, used_at')
      .order('created_at', { ascending: false })
    const codes = (data ?? []) as AdminInviteCode[]
    const allIds = [
      ...codes.map(c => c.created_by),
      ...codes.map(c => c.used_by).filter(Boolean) as string[],
    ].filter((v, i, a) => a.indexOf(v) === i)
    if (allIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, email').in('id', allIds)
      const em: Record<string, string> = {}
      ;(profs ?? []).forEach((p: { id: string; email: string }) => { em[p.id] = p.email })
      codes.forEach(c => {
        c.created_by_email = em[c.created_by] ?? null
        if (c.used_by) c.used_by_email = em[c.used_by] ?? null
      })
    }
    setAllInvites(codes)
    setInvitesLoading(false)
  }, [])

  const getCodeStatus = (c: AdminInviteCode): 'pending' | 'used' | 'expired' => {
    if (c.used_at) return 'used'
    if (new Date(c.expires_at) < new Date()) return 'expired'
    return 'pending'
  }

  const handleAddSlot = async (u: UserRow) => {
    setActionLoading(u.id + '_slot')
    const { error } = await supabase.rpc('admin_add_invite_slots', { p_user_id: u.id, p_slots: 1 })
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_slot_added', { email: u.email }))
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, invite_slots_remaining: (x.invite_slots_remaining ?? 0) + 1 } : x))
    }
    setActionLoading(null)
  }

  const handleRemoveSlot = async (u: UserRow) => {
    setActionLoading(u.id + '_unslot')
    const { error } = await supabase.rpc('admin_add_invite_slots', { p_user_id: u.id, p_slots: -1 })
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_slot_removed', { email: u.email }))
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, invite_slots_remaining: Math.max((x.invite_slots_remaining ?? 0) - 1, 0) } : x))
    }
    setActionLoading(null)
  }

  const handleRevokeCode = async (c: AdminInviteCode) => {
    setActionLoading(c.id + '_revoke')
    const { error } = await supabase.rpc('admin_revoke_invite_code', { p_code_id: c.id })
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_code_revoked'))
      await fetchAllInvites()
    }
    setActionLoading(null)
  }

  const handleDeleteCode = async (c: AdminInviteCode) => {
    setConfirmDelete(c)
  }

  const confirmDeleteCode = async () => {
    if (!confirmDelete) return
    setActionLoading(confirmDelete.id + '_delete')
    setConfirmDelete(null)
    const { error } = await supabase.from('invite_codes').delete().eq('id', confirmDelete.id)
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_code_deleted'))
      await fetchAllInvites()
    }
    setActionLoading(null)
  }

  const handleAdminGenerate = async () => {
    setActionLoading('admin_generate')
    const { data, error } = await supabase.rpc('generate_invite_code')
    if (error) showFeedback('error', error.message)
    else {
      showFeedback('success', t('admin_invites_code_generated', { code: (data as { code: string })?.code ?? '' }))
      await fetchAllInvites()
    }
    setActionLoading(null)
  }

  useEffect(() => { fetchUsers() }, [])

  useEffect(() => {
    if (adminTab === 'invites') fetchAllInvites()
  }, [adminTab, fetchAllInvites])

  const toggleRole = async (u: UserRow) => {
    setActionLoading(u.id + '_role')
    const newRole = u.role === 'admin' ? 'standard' : 'admin'
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', u.id)
    if (error) { showFeedback('error', error.message) }
    else {
      showFeedback('success', t('admin_feedback_role', { email: u.email, role: newRole === 'admin' ? t('admin_role_name_admin') : t('admin_role_name_standard') }))
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, role: newRole } : x))
      if (u.id === currentUser?.id) await refreshProfile()
    }
    setActionLoading(null)
  }

  const toggleActive = async (u: UserRow) => {
    if (!session?.access_token) return
    setActionLoading(u.id + '_active')
    const action = u.is_active ? 'ban_user' : 'unban_user'
    const res = await callAdminOps(session.access_token, { action, user_id: u.id })
    if (res.error) { showFeedback('error', res.error) }
    else {
      showFeedback('success', u.is_active ? t('admin_feedback_deactivated', { email: u.email }) : t('admin_feedback_reactivated', { email: u.email }))
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !u.is_active } : x))
    }
    setActionLoading(null)
  }

  const resetPassword = async (u: UserRow) => {
    setActionLoading(u.id + '_reset')
    const { error } = await supabase.auth.resetPasswordForEmail(u.email, {
      redirectTo: window.location.origin,
    })
    if (error) {
      showFeedback('error', error.code === 'over_email_send_rate_limit' ? t('admin_reset_rate_limited') : error.message)
    } else {
      showFeedback('success', t('admin_feedback_reset', { email: u.email }))
    }
    setActionLoading(null)
  }

  const deleteUser = async (u: UserRow) => {
    if (!session?.access_token) return
    setConfirmDeleteUser({
      message: t('admin_confirm_delete', { email: u.email }),
      onConfirm: async () => {
        setActionLoading(u.id + '_delete')
        const res = await callAdminOps(session.access_token, { action: 'delete_user', user_id: u.id })
        if (res.error) { showFeedback('error', res.error) }
        else {
          showFeedback('success', t('admin_feedback_deleted', { email: u.email }))
          setUsers(prev => prev.filter(x => x.id !== u.id))
        }
        setActionLoading(null)
        setConfirmDeleteUser(null)
      },
    })
  }

  const filtered = search.trim()
    ? users.filter(u =>
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        (u.display_name ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : users

  const filteredInvites = allInvites.filter(c => {
    if (inviteFilter === 'all') return true
    return getCodeStatus(c) === inviteFilter
  })

  return (
    <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '24px 12px 80px' : '40px 32px 80px' }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>{t('admin_label')}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Users size={26} />
              {t('admin_title')}
            </h1>
            <button
              onClick={adminTab === 'users' ? fetchUsers : fetchAllInvites}
              disabled={loading || invitesLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
            >
              <RefreshCw size={13} style={{ animation: (loading || invitesLoading) ? 'spin 1s linear infinite' : 'none' }} />
              {t('admin_refresh')}
            </button>
          </div>
        </div>

        {/* Admin tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
          <AdminTabBtn active={adminTab === 'users'} onClick={() => setAdminTab('users')} icon={<Users size={14} />} label={t('admin_tab_users')} />
          <AdminTabBtn active={adminTab === 'invites'} onClick={() => setAdminTab('invites')} icon={<Gift size={14} />} label={t('admin_tab_invites')} />
        </div>

        {/* Feedback */}
        {feedback && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`, color: feedback.type === 'success' ? '#15803d' : '#dc2626', fontSize: 13 }}>
            {feedback.msg}
          </div>
        )}

        {/* ====== USERS TAB ====== */}
        {adminTab === 'users' && (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--color-text-muted)' }}>
              {users.length !== 1 ? t('admin_users_count_plural', { n: users.length }) : t('admin_users_count', { n: users.length })}
            </p>
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 8, marginBottom: 16 }}>
              <Search size={14} color="#9b9a97" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('admin_search_placeholder')}
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, backgroundColor: 'transparent', color: 'var(--color-text)' }}
              />
            </div>

            {/* Table */}
            <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
              {!isMobile && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 110px 90px 180px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                  {[t('admin_col_user'), t('admin_col_role'), t('admin_col_status'), t('admin_col_last_access'), 'Login diário', t('admin_col_actions')].map(h => (
                    <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
                  ))}
                </div>
              )}
              {loading ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin_loading')}</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin_no_users')}</div>
              ) : (
                filtered.map((u, i) => (
                  <UserTableRow
                    key={u.id}
                    user={u}
                    isCurrentUser={u.id === currentUser?.id}
                    isLast={i === filtered.length - 1}
                    actionLoading={actionLoading}
                    isMobile={isMobile}
                    onToggleRole={() => toggleRole(u)}
                    onToggleActive={() => toggleActive(u)}
                    onResetPassword={() => resetPassword(u)}
                    onDelete={() => deleteUser(u)}
                  />
                ))
              )}
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
              <LegendItem icon={<Crown size={12} />} color="#f59e0b" label={t('admin_legend_admin')} />
              <LegendItem icon={<User size={12} />} color="#6b7280" label={t('admin_legend_standard')} />
              <LegendItem icon={<div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: '#10b981' }} />} color="#10b981" label={t('admin_legend_active')} />
              <LegendItem icon={<div style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: '#ef4444' }} />} color="#ef4444" label={t('admin_legend_inactive')} />
            </div>
          </>
        )}

        {/* ====== INVITES TAB ====== */}
        {adminTab === 'invites' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: 8 }}>
              <InviteSubTabBtn active={inviteSubTab === 'codes'} onClick={() => setInviteSubTab('codes')} label={t('admin_invites_all_codes')} />
              <InviteSubTabBtn active={inviteSubTab === 'quotas'} onClick={() => setInviteSubTab('quotas')} label={t('admin_invites_quotas')} />
            </div>

            {/* ---- CODES sub-tab ---- */}
            {inviteSubTab === 'codes' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  {/* Filter pills */}
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(['all', 'pending', 'used', 'expired'] as const).map(f => (
                      <button
                        key={f}
                        onClick={() => setInviteFilter(f)}
                        style={{ padding: '5px 12px', borderRadius: 20, border: '1.5px solid', borderColor: inviteFilter === f ? 'var(--color-text)' : 'var(--color-border)', backgroundColor: inviteFilter === f ? 'var(--color-bg-secondary)' : 'var(--color-surface)', color: inviteFilter === f ? 'var(--color-text)' : 'var(--color-text-muted)', fontSize: 12, fontWeight: inviteFilter === f ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}
                      >
                        {t(('admin_invites_filter_' + f) as Parameters<typeof t>[0])}
                      </button>
                    ))}
                  </div>
                  {/* Admin generate */}
                  <button
                    onClick={handleAdminGenerate}
                    disabled={actionLoading === 'admin_generate'}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: actionLoading === 'admin_generate' ? 'not-allowed' : 'pointer', opacity: actionLoading === 'admin_generate' ? 0.6 : 1 }}
                  >
                    <Gift size={13} /> {t('admin_invites_generate')}
                  </button>
                </div>

                {/* Codes table */}
                <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                  {!isMobile && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px 90px 100px 1fr 60px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                      {[t('admin_invites_col_creator'), t('admin_invites_col_code'), t('admin_invites_col_created'), t('admin_invites_col_expires'), t('admin_invites_col_status'), t('admin_invites_col_used_by'), ''].map((h, i) => (
                        <span key={i} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
                      ))}
                    </div>
                  )}
                  {invitesLoading ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin_invites_loading')}</div>
                  ) : filteredInvites.length === 0 ? (
                    <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin_invites_empty')}</div>
                  ) : filteredInvites.map((c, i) => {
                    const status = getCodeStatus(c)
                    const statusColors: Record<string, { bg: string; text: string }> = {
                      pending: { bg: '#dcfce7', text: '#15803d' },
                      used:    { bg: '#e0e7ff', text: '#4338ca' },
                      expired: { bg: '#f3f4f6', text: '#6b7280' },
                    }
                    const sc = statusColors[status]
                    const isLast = i === filteredInvites.length - 1
                    if (isMobile) {
                      return (
                        <div key={c.id} style={{ padding: '12px 14px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text)' }}>{c.code}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text }}>{t(('admin_invites_filter_' + status) as Parameters<typeof t>[0])}</span>
                          </div>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('admin_invites_col_creator')}: {c.created_by_email ?? c.created_by}</span>
                          {c.used_by_email && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('admin_invites_col_used_by')}: {c.used_by_email}</span>}
                          {status === 'pending' && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => { navigator.clipboard.writeText(c.code); setCopiedCode(c.id); setTimeout(() => setCopiedCode(null), 2000) }} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', fontSize: 12, color: copiedCode === c.id ? '#16a34a' : 'var(--color-text-muted)' }}>
                                {copiedCode === c.id ? <><CheckCheck size={12} /> Copiado</> : <><Copy size={12} /> Copiar</>}
                              </button>
                              <button onClick={() => handleRevokeCode(c)} disabled={!!actionLoading} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fef2f2', cursor: !!actionLoading ? 'not-allowed' : 'pointer', fontSize: 12, color: '#dc2626', opacity: !!actionLoading ? 0.5 : 1 }}>
                                {t('admin_invites_revoke')}
                              </button>
                            </div>
                          )}
                          {(status === 'used' || status === 'expired') && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => handleDeleteCode(c)} disabled={!!actionLoading} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fef2f2', cursor: !!actionLoading ? 'not-allowed' : 'pointer', fontSize: 12, color: '#dc2626', opacity: !!actionLoading ? 0.5 : 1 }}>
                                <Trash2 size={12} /> {t('admin_invites_delete')}
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    }
                    return (
                      <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 90px 90px 100px 1fr 60px', padding: '10px 16px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', alignItems: 'center', backgroundColor: 'var(--color-surface)' }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.created_by_email ?? c.created_by}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text)' }}>{c.code}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(c.created_at).toLocaleDateString()}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(c.expires_at).toLocaleDateString()}</span>
                        <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text, width: 'fit-content' }}>{t(('admin_invites_filter_' + status) as Parameters<typeof t>[0])}</span>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.used_by_email ?? (c.used_by ? c.used_by.slice(0, 8) + '…' : '—')}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {status === 'pending' && (
                            <>
                              <button onClick={() => { navigator.clipboard.writeText(c.code); setCopiedCode(c.id); setTimeout(() => setCopiedCode(null), 2000) }} title="Copiar" style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: copiedCode === c.id ? '#16a34a' : 'var(--color-text-muted)' }}>
                                {copiedCode === c.id ? <CheckCheck size={12} /> : <Copy size={12} />}
                              </button>
                              <ActionBtn title={t('admin_invites_revoke')} disabled={!!actionLoading} loading={actionLoading === c.id + '_revoke'} onClick={() => handleRevokeCode(c)} color="#ef4444">
                                <Trash2 size={12} />
                              </ActionBtn>
                            </>
                          )}
                          {(status === 'used' || status === 'expired') && (
                            <ActionBtn title={t('admin_invites_delete')} disabled={!!actionLoading} loading={actionLoading === c.id + '_delete'} onClick={() => handleDeleteCode(c)} color="#ef4444">
                              <Trash2 size={12} />
                            </ActionBtn>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ---- QUOTAS sub-tab ---- */}
            {inviteSubTab === 'quotas' && (
              <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                {!isMobile && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px', padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
                    {[t('admin_col_user'), t('admin_invites_col_slots'), t('admin_col_actions')].map(h => (
                      <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
                    ))}
                  </div>
                )}
                {loading ? (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin_loading')}</div>
                ) : users.filter(u => u.role !== 'admin').length === 0 ? (
                  <div style={{ padding: '32px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('admin_no_users')}</div>
                ) : users.filter(u => u.role !== 'admin').map((u, i, arr) => (
                  <div key={u.id} style={{ display: isMobile ? 'flex' : 'grid', gridTemplateColumns: '1fr 120px 160px', flexDirection: isMobile ? 'row' : undefined, alignItems: 'center', justifyContent: isMobile ? 'space-between' : undefined, padding: '10px 16px', borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--color-border)', gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.display_name || u.email.split('@')[0]}</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: (u.invite_slots_remaining ?? 0) > 0 ? '#16a34a' : '#dc2626' }}>{u.invite_slots_remaining ?? 0}</span>
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('admin_invites_col_slots')}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => handleRemoveSlot(u)}
                        disabled={!!actionLoading || (u.invite_slots_remaining ?? 0) <= 0}
                        style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: !!actionLoading || (u.invite_slots_remaining ?? 0) <= 0 ? 'not-allowed' : 'pointer', opacity: !!actionLoading || (u.invite_slots_remaining ?? 0) <= 0 ? 0.4 : 1, whiteSpace: 'nowrap' }}
                      >
                        {t('admin_invites_remove_slot')}
                      </button>
                      <button
                        onClick={() => handleAddSlot(u)}
                        disabled={!!actionLoading}
                        style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #bbf7d0', backgroundColor: '#f0fdf4', color: '#15803d', fontSize: 12, fontWeight: 600, cursor: !!actionLoading ? 'not-allowed' : 'pointer', opacity: !!actionLoading ? 0.5 : 1, whiteSpace: 'nowrap' }}
                      >
                        {t('admin_invites_add_slot')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div
          onClick={() => setConfirmDelete(null)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ backgroundColor: 'var(--color-surface)', borderRadius: 14, padding: '24px 28px', maxWidth: 360, width: '100%', boxShadow: '0 8px 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Trash2 size={18} color="#dc2626" />
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{t('admin_invites_delete_confirm')}</p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-muted)', fontFamily: 'monospace', letterSpacing: '0.05em' }}>{confirmDelete.code}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDelete(null)}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >
                {t('confirm_delete_cancel')}
              </button>
              <button
                onClick={confirmDeleteCode}
                style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#dc2626', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                {t('admin_invites_delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={!!confirmDeleteUser}
        title={t('admin_delete')}
        message={confirmDeleteUser?.message}
        onConfirm={confirmDeleteUser?.onConfirm ?? (() => {})}
        onCancel={() => setConfirmDeleteUser(null)}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const UserTableRow = memo(function UserTableRow({
  user: u,
  isCurrentUser,
  isLast,
  actionLoading,
  isMobile,
  onToggleRole,
  onToggleActive,
  onResetPassword,
  onDelete,
}: {
  user: UserRow
  isCurrentUser: boolean
  isLast: boolean
  actionLoading: string | null
  isMobile: boolean
  onToggleRole: () => void
  onToggleActive: () => void
  onResetPassword: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const { t, lang } = useLanguage()

  const lastSeen = u.last_sign_in
    ? new Date(u.last_sign_in).toLocaleDateString(lang === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'

  const actionButtons = (
    <>
      <ActionBtn
        title={u.role === 'admin' ? t('admin_demote') : t('admin_promote')}
        disabled={!!actionLoading || isCurrentUser}
        loading={actionLoading === u.id + '_role'}
        onClick={onToggleRole}
        color="#d97706"
      >
        {u.role === 'admin' ? <User size={13} /> : <Crown size={13} />}
      </ActionBtn>

      <ActionBtn
        title={u.is_active ? t('admin_deactivate') : t('admin_reactivate')}
        disabled={!!actionLoading || isCurrentUser}
        loading={actionLoading === u.id + '_active'}
        onClick={onToggleActive}
        color={u.is_active ? '#ef4444' : '#10b981'}
      >
        {u.is_active ? <PowerOff size={13} /> : <Power size={13} />}
      </ActionBtn>

      <ActionBtn
        title={t('admin_reset_password')}
        disabled={!!actionLoading}
        loading={actionLoading === u.id + '_reset'}
        onClick={onResetPassword}
        color="#3b82f6"
      >
        <MailCheck size={13} />
      </ActionBtn>

      <ActionBtn
        title={t('admin_delete')}
        disabled={!!actionLoading || isCurrentUser}
        loading={actionLoading === u.id + '_delete'}
        onClick={onDelete}
        color="#ef4444"
      >
        <Trash2 size={13} />
      </ActionBtn>
    </>
  )

  if (isMobile) {
    return (
      <div
        style={{ padding: '12px 14px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {/* User info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: u.role === 'admin' ? '#fef3c7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: u.role === 'admin' ? '#d97706' : '#6b7280' }}>
            {u.role === 'admin' ? <Crown size={16} /> : <User size={16} />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.display_name || u.email.split('@')[0]}
              </span>
              {isCurrentUser && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, backgroundColor: '#dbeafe', color: '#2563eb' }}>{t('admin_you')}</span>
              )}
            </div>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{u.email}</span>
          </div>
        </div>

        {/* Badges + last access */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, backgroundColor: u.role === 'admin' ? '#fef3c7' : '#f3f4f6', color: u.role === 'admin' ? '#d97706' : '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {u.role === 'admin' ? <><Shield size={10} /> {t('admin_role_admin')}</> : <><User size={10} /> {t('admin_role_standard')}</>}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 6, backgroundColor: u.is_active ? '#f0fdf4' : '#fef2f2', color: u.is_active ? '#15803d' : '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: u.is_active ? '#10b981' : '#ef4444' }} />
            {u.is_active ? t('admin_active') : t('admin_inactive')}
          </span>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{lastSeen}</span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {actionButtons}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 110px 90px 180px', padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', backgroundColor: hovered ? 'var(--color-hover)' : 'var(--color-surface)', transition: 'background-color 0.1s', alignItems: 'center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* User info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: u.role === 'admin' ? '#fef3c7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: u.role === 'admin' ? '#d97706' : '#6b7280' }}>
          {u.role === 'admin' ? <Crown size={15} /> : <User size={15} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {u.display_name || u.email.split('@')[0]}
            </span>
            {isCurrentUser && (
              <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, backgroundColor: '#dbeafe', color: '#2563eb' }}>{t('admin_you')}</span>
            )}
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{u.email}</span>
        </div>
      </div>

      {/* Role badge */}
      <div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, backgroundColor: u.role === 'admin' ? '#fef3c7' : '#f3f4f6', color: u.role === 'admin' ? '#d97706' : '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {u.role === 'admin' ? <><Shield size={10} /> {t('admin_role_admin')}</> : <><User size={10} /> {t('admin_role_standard')}</>}
        </span>
      </div>

      {/* Active status */}
      <div>
        <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 6, backgroundColor: u.is_active ? '#f0fdf4' : '#fef2f2', color: u.is_active ? '#15803d' : '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: u.is_active ? '#10b981' : '#ef4444' }} />
          {u.is_active ? t('admin_active') : t('admin_inactive')}
        </span>
      </div>

      {/* Last sign in */}
      <span style={{ fontSize: 12, color: '#9b9a97' }}>{lastSeen}</span>

      {/* Daily login badge */}
      <div><LoginBadge lastLoginDate={u.last_login_date ?? null} /></div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {actionButtons}
      </div>
    </div>
  )
})

function ActionBtn({ title, disabled, loading, onClick, color, children }: {
  title: string
  disabled: boolean
  loading: boolean
  onClick: () => void
  color: string
  children: React.ReactNode
}) {
  const [hov, setHov] = useState(false)
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 30, height: 30, borderRadius: 6, border: '1px solid',
        borderColor: hov && !disabled ? color : 'var(--color-border)',
        backgroundColor: hov && !disabled ? `${color}15` : 'transparent',
        color: disabled ? 'var(--color-border)' : hov ? color : 'var(--color-text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.15s',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  )
}

function LegendItem({ icon, color, label }: { icon: React.ReactNode; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--color-text-muted)' }}>
      <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
      {label}
    </div>
  )
}

function AdminTabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
        borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
        backgroundColor: active ? 'var(--color-surface)' : 'transparent',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontSize: 14, fontWeight: active ? 600 : 400,
        borderBottom: active ? '2px solid var(--color-text)' : '2px solid transparent',
        transition: 'all 0.15s',
      }}
    >
      {icon}{label}
    </button>
  )
}

function InviteSubTabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: 8, border: '1.5px solid',
        borderColor: active ? 'var(--color-text)' : 'var(--color-border)',
        backgroundColor: active ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
        color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
        fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}
