// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { Users } from 'lucide-react'
import { useState } from 'react'
import { FieldGroup } from '../../../components/Field'
import { UserAvatar } from '../../../components/UserAvatar'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { localeOf } from '../../../i18n/translations'
import { supabase } from '../../../lib/supabase'
import type { FinanceWorkspace, FinanceWorkspaceInvite, FinanceWorkspaceMember } from '../../../types'
import {
FIN_POS,
inputStyle, labelStyle,
Modal
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'
import { InviteAutocomplete } from './pickers'

// ─── Workspace Modal ──────────────────────────────────────────────────────────

export function WorkspaceModal({
  workspace, members, invites, pendingInvitesForMe, partnerProfiles, onClose, onReload,
}: {
  workspace: FinanceWorkspace | null
  members: FinanceWorkspaceMember[]
  invites: FinanceWorkspaceInvite[]
  pendingInvitesForMe: FinanceWorkspaceInvite[]
  partnerProfiles: PartnerProfile[]
  onClose: () => void
  onReload: () => Promise<void>
}) {
  const { t, lang } = useLanguage()
  const { user } = useAuth()
  const [creating, setCreating] = useState(false)
  const [wsName, setWsName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [activeTab, setActiveTab] = useState<'members' | 'invites' | 'received'>(pendingInvitesForMe.length > 0 && !workspace ? 'received' : 'members')

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 3500)
  }

  const handleCreate = async () => {
    if (!wsName.trim()) return
    setCreating(true)
    const { error } = await supabase.rpc('create_workspace', { p_name: wsName.trim() })
    if (error) showFeedback('error', error.message)
    else { await onReload(); showFeedback('success', t('finance_workspace_created')) }
    setCreating(false)
  }

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !workspace) return
    setSending(true)
    const { error } = await supabase.rpc('invite_member', { p_workspace_id: workspace.id, p_email: inviteEmail.trim() })
    if (error) showFeedback('error', error.message)
    else { setInviteEmail(''); await onReload(); showFeedback('success', t('finance_workspace_invite_sent')) }
    setSending(false)
  }

  const handleAccept = async (inviteId: string) => {
    setActing(true)
    const { error } = await supabase.rpc('accept_workspace_invite', { p_invite_id: inviteId })
    if (error) showFeedback('error', error.message)
    else { await onReload(); showFeedback('success', t('finance_workspace_invite_accepted_toast')) }
    setActing(false)
  }

  const handleDecline = async (inviteId: string) => {
    setActing(true)
    const { error } = await supabase.rpc('decline_workspace_invite', { p_invite_id: inviteId })
    if (error) showFeedback('error', error.message)
    else { await onReload(); showFeedback('success', t('finance_workspace_invite_declined_toast')) }
    setActing(false)
  }

  const handleLeave = async () => {
    setActing(true)
    const { error } = await supabase.rpc('leave_workspace')
    if (error) showFeedback('error', error.message)
    else { await onReload(); setConfirmLeave(false); onClose() }
    setActing(false)
  }

  const handleRemoveMember = async (userId: string) => {
    setActing(true)
    const { error } = await supabase.rpc('remove_workspace_member', { p_user_id: userId })
    if (error) showFeedback('error', error.message)
    else { await onReload(); setConfirmRemove(null); showFeedback('success', t('finance_workspace_member_removed')) }
    setActing(false)
  }

  const isOwner = workspace && members.some(m => m.user_id === user?.id && m.role === 'owner')
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))
  const getMemberName = (m: FinanceWorkspaceMember) => {
    if (m.user_id === user?.id) return user?.email?.split('@')[0] ?? 'Você'
    const p = profileMap.get(m.user_id) ?? m.profile
    return p?.display_name || p?.email || m.user_id.slice(0, 8)
  }

  return (
    <Modal title={workspace ? workspace.name : t('finance_workspace_title')} onClose={onClose}>
      {feedback && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`, color: feedback.type === 'success' ? '#15803d' : '#dc2626', fontSize: 13 }}>
          {feedback.msg}
        </div>
      )}

      {/* No workspace: create or accept invites */}
      {!workspace && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pending invites for me */}
          {pendingInvitesForMe.length > 0 && (
            <FieldGroup label={t('finance_workspace_invites_received')} labelStyle={labelStyle}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pendingInvitesForMe.map(inv => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: 'var(--color-active)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Users size={14} color="var(--color-text)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_workspace_invite_title')}</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{t('finance_workspace_invite_from', { name: inv.inviter_profile?.display_name || inv.inviter_profile?.email || inv.invited_by.slice(0, 8) })}</p>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button disabled={acting} onClick={() => handleAccept(inv.id)}
                        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: FIN_POS, color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                        {t('finance_workspace_invite_accept')}
                      </button>
                      <button disabled={acting} onClick={() => handleDecline(inv.id)}
                        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                        {t('finance_workspace_invite_decline')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </FieldGroup>
          )}

          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Users size={32} color="var(--color-text-muted)" style={{ marginBottom: 8 }} />
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_workspace_empty')}</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_workspace_empty_desc')}</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} type="text" value={wsName} onChange={e => setWsName(e.target.value)}
              placeholder={t('finance_workspace_create_placeholder')} onKeyDown={e => { if (e.key === 'Enter') handleCreate() }} />
            <button onClick={handleCreate} disabled={creating || !wsName.trim()}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: creating || !wsName.trim() ? 'not-allowed' : 'pointer', opacity: creating || !wsName.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
              {t('finance_workspace_create')}
            </button>
          </div>
        </div>
      )}

      {/* Has workspace: manage */}
      {workspace && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--color-border)' }}>
            {(['members', 'invites', ...(pendingInvitesForMe.length > 0 ? ['received' as const] : [])] as const).map(tabId => (
              <button key={tabId} onClick={() => setActiveTab(tabId)}
                style={{ padding: '8px 14px', border: 'none', borderBottom: activeTab === tabId ? '2px solid var(--color-text)' : '2px solid transparent', backgroundColor: 'transparent', color: activeTab === tabId ? 'var(--color-text)' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 13, fontWeight: activeTab === tabId ? 600 : 400, transition: 'color 0.15s' }}>
                {tabId === 'members' ? t('finance_workspace_members') : tabId === 'invites' ? t('finance_workspace_invites_sent') : t('finance_workspace_invites_received')}
                {tabId === 'received' && pendingInvitesForMe.length > 0 && (
                  <span style={{ marginLeft: 4, minWidth: 16, height: 16, borderRadius: 999, backgroundColor: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                    {pendingInvitesForMe.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Members tab */}
          {activeTab === 'members' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {members.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                  <UserAvatar name={getMemberName(m)} seed={m.profile?.email} emoji={m.profile?.avatar_emoji} color={m.profile?.avatar_color} url={m.profile?.avatar_url} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {getMemberName(m)} {m.user_id === user?.id && <span style={{ fontSize: 10, color: 'var(--color-text)', fontWeight: 600 }}>{t('finance_workspace_you')}</span>}
                    </p>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 4, backgroundColor: m.role === 'owner' ? '#fef3c7' : '#f3f4f6', color: m.role === 'owner' ? '#d97706' : '#6b7280' }}>
                      {m.role === 'owner' ? t('finance_workspace_owner') : t('finance_workspace_member')}
                    </span>
                  </div>
                  {isOwner && m.user_id !== user?.id && (
                    <>
                      {confirmRemove === m.user_id ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button disabled={acting} onClick={() => handleRemoveMember(m.user_id)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer' }}>
                            {t('finance_confirm')}
                          </button>
                          <button onClick={() => setConfirmRemove(null)}
                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, cursor: 'pointer' }}>
                            {t('finance_cancel')}
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmRemove(m.user_id)}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', fontSize: 12, cursor: 'pointer' }}>
                          {t('finance_workspace_remove')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}

              {/* Invite new member */}
              <InviteAutocomplete value={inviteEmail} onChange={setInviteEmail} onSubmit={handleInvite} sending={sending} excludeIds={members.map(m => m.user_id)} />

              {/* Leave workspace */}
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12, marginTop: 4 }}>
                {confirmLeave ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 13, color: '#dc2626' }}>{t('finance_workspace_leave_confirm')}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button disabled={acting} onClick={handleLeave}
                        style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#ef4444', color: '#fff', fontSize: 13, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                        {t('finance_workspace_leave_confirm_btn')}
                      </button>
                      <button onClick={() => setConfirmLeave(false)}
                        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, cursor: 'pointer' }}>
                        {t('finance_cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmLeave(true)}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 500, cursor: 'pointer', width: '100%' }}>
                    {t('finance_workspace_leave')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Invites sent tab */}
          {activeTab === 'invites' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {invites.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16 }}>{t('finance_workspace_no_invites_sent')}</p>
              ) : invites.map(inv => {
                const statusColors: Record<string, { bg: string; text: string; label: string }> = {
                  pending: { bg: '#dcfce7', text: '#15803d', label: t('finance_workspace_invite_pending') },
                  accepted: { bg: '#e0e7ff', text: '#4338ca', label: t('finance_workspace_invite_accepted') },
                  declined: { bg: '#fee2e2', text: '#dc2626', label: t('finance_workspace_invite_declined') },
                }
                const sc = statusColors[inv.status] ?? statusColors.pending
                return (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inv.invited_email}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>{new Date(inv.created_at).toLocaleDateString(localeOf(lang))}</p>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text }}>{sc.label}</span>
                  </div>
                )
              })}

              {/* Invite new member */}
              <InviteAutocomplete value={inviteEmail} onChange={setInviteEmail} onSubmit={handleInvite} sending={sending} excludeIds={members.map(m => m.user_id)} />
            </div>
          )}

          {/* Received invites tab */}
          {activeTab === 'received' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pendingInvitesForMe.length === 0 ? (
                <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: 16 }}>{t('finance_workspace_no_invites_pending')}</p>
              ) : pendingInvitesForMe.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{t('finance_workspace_invite_title')}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {t('finance_workspace_invite_from', { name: inv.inviter_profile?.display_name || inv.inviter_profile?.email || inv.invited_by.slice(0, 8) })}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button disabled={acting} onClick={() => handleAccept(inv.id)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: 'none', backgroundColor: FIN_POS, color: '#fff', fontSize: 12, fontWeight: 600, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                      {t('finance_workspace_invite_accept')}
                    </button>
                    <button disabled={acting} onClick={() => handleDecline(inv.id)}
                      style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', fontSize: 12, fontWeight: 500, cursor: acting ? 'not-allowed' : 'pointer', opacity: acting ? 0.6 : 1 }}>
                      {t('finance_workspace_invite_decline')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
