import { useState } from 'react'
import { Gift, RefreshCw, Users } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import ConfirmDeleteModal from '@/shared/ui/ConfirmDeleteModal'
import { AdminTabBtn } from './admin/adminUi'
import { useAdminFeedback } from './admin/adminFeedback'
import { useAdminUsers } from './admin/useAdminUsers'
import { useAdminInvites } from './admin/useAdminInvites'
import UsersTab from './admin/UsersTab'
import InvitesTab from './admin/InvitesTab'
import { FeedbackBanner } from './settings/settingsUi'

// ARCH-008: a casca do painel de admin (cabeçalho, abas, feedback e as
// confirmações). Dados e ações vivem em admin/useAdminUsers e
// admin/useAdminInvites; as consultas, em src/lib/data/admin.ts.

export default function UserManagementPanel() {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [adminTab, setAdminTab] = useState<'users' | 'invites'>('users')
  const feedback = useAdminFeedback()
  const users = useAdminUsers(feedback)
  const invites = useAdminInvites(feedback, adminTab === 'invites')

  const refreshing = users.loading || invites.loading
  const refresh = adminTab === 'users' ? users.refresh : invites.refresh

  return (
    <div style={{ flex: 1, overflow: 'auto', scrollbarGutter: 'stable both-edges', backgroundColor: 'var(--color-bg-tertiary)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '24px 12px 80px' : '40px 32px 80px' }}>
        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>{t('admin_label')}</p>
          <h1 style={{ margin: '4px 0 0', fontSize: 28, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Users size={26} />
            {t('admin_title')}
          </h1>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
          >
            <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            {t('admin_refresh')}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--color-border)', paddingBottom: 0 }}>
          <AdminTabBtn active={adminTab === 'users'} onClick={() => setAdminTab('users')} icon={<Users size={14} />} label={t('admin_tab_users')} />
          <AdminTabBtn active={adminTab === 'invites'} onClick={() => setAdminTab('invites')} icon={<Gift size={14} />} label={t('admin_tab_invites')} />
        </div>

        {feedback.feedback && (
          <FeedbackBanner type={feedback.feedback.type} text={feedback.feedback.msg} style={{ marginBottom: 16, padding: '10px 14px' }} />
        )}

        {adminTab === 'users' && (
          <UsersTab
            users={users.users}
            loading={users.loading}
            actionLoading={users.actionLoading}
            currentUserId={users.currentUserId}
            onToggleRole={u => { void users.toggleRole(u) }}
            onToggleActive={u => { void users.toggleActive(u) }}
            onResetPassword={u => { void users.resetPassword(u) }}
            onDelete={u => { void users.deleteUser(u) }}
          />
        )}
        {adminTab === 'invites' && (
          <InvitesTab
            invites={invites}
            users={users.users}
            usersLoading={users.loading}
            usersActionLoading={users.actionLoading}
            onAddSlot={u => { void users.addSlot(u) }}
            onRemoveSlot={u => { void users.removeSlot(u) }}
          />
        )}
      </div>

      {/* Mesma confirmação acessível do resto do app. */}
      <ConfirmDeleteModal
        open={!!invites.confirmDelete}
        title={t('admin_invites_delete_confirm')}
        message={invites.confirmDelete?.code}
        confirmLabel={t('admin_invites_delete')}
        onConfirm={() => { void invites.confirmDeleteCode() }}
        onCancel={invites.cancelDelete}
      />
      <ConfirmDeleteModal
        open={!!users.confirmDelete}
        title={t('admin_delete')}
        message={users.confirmDelete?.message}
        onConfirm={() => { void users.confirmDelete?.onConfirm() }}
        onCancel={users.cancelDelete}
      />

      <style>{'@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }'}</style>
    </div>
  )
}
