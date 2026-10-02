import { memo, useState } from 'react'
import { Crown, MailCheck, Power, PowerOff, Search, Shield, Trash2, User } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { localeOf } from '../../i18n/translations'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { UserAvatar } from '@/shared/ui/UserAvatar'
import { SOFT } from '../settings/settingsTokens'
import { ActionBtn, LegendItem, LoginBadge, TableBox, TableHead, TableNotice } from './adminUi'
import type { UserRow } from './useAdminUsers'

// ARCH-008: aba de usuários do painel de admin (busca, tabela, legenda).

const GRID = '1fr 120px 100px 110px 90px 180px'

export interface UsersTabProps {
  users: UserRow[]
  loading: boolean
  actionLoading: string | null
  currentUserId: string | undefined
  onToggleRole: (u: UserRow) => void
  onToggleActive: (u: UserRow) => void
  onResetPassword: (u: UserRow) => void
  onDelete: (u: UserRow) => void
}

export default function UsersTab({ users, loading, actionLoading, currentUserId, onToggleRole, onToggleActive, onResetPassword, onDelete }: UsersTabProps) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')

  const needle = search.trim().toLowerCase()
  const filtered = needle
    ? users.filter(u => u.email.toLowerCase().includes(needle) || (u.display_name ?? '').toLowerCase().includes(needle))
    : users

  return (
    <>
      <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--color-text-muted)' }}>
        {users.length !== 1 ? t('admin_users_count_plural', { n: users.length }) : t('admin_users_count', { n: users.length })}
      </p>
      <div className="field-box" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', backgroundColor: 'var(--color-surface)', border: '1.5px solid var(--color-border)', borderRadius: 8, marginBottom: 16 }}>
        <Search size={14} color="var(--color-icon)" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin_search_placeholder')}
          aria-label={t('admin_search_placeholder')}
          style={{ flex: 1, border: 'none', fontSize: 14, backgroundColor: 'transparent', color: 'var(--color-text)' }}
        />
      </div>

      <TableBox>
        {!isMobile && (
          <TableHead template={GRID} columns={[t('admin_col_user'), t('admin_col_role'), t('admin_col_status'), t('admin_col_last_access'), t('admin_col_daily_login'), t('admin_col_actions')]} />
        )}
        {loading ? (
          <TableNotice>{t('admin_loading')}</TableNotice>
        ) : filtered.length === 0 ? (
          <TableNotice>{t('admin_no_users')}</TableNotice>
        ) : (
          filtered.map((u, i) => (
            <UserTableRow
              key={u.id}
              user={u}
              isCurrentUser={u.id === currentUserId}
              isLast={i === filtered.length - 1}
              actionLoading={actionLoading}
              isMobile={isMobile}
              onToggleRole={() => onToggleRole(u)}
              onToggleActive={() => onToggleActive(u)}
              onResetPassword={() => onResetPassword(u)}
              onDelete={() => onDelete(u)}
            />
          ))
        )}
      </TableBox>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
        <LegendItem icon={<Crown size={12} />} color="var(--color-warning)" label={t('admin_legend_admin')} />
        <LegendItem icon={<User size={12} />} color="var(--color-text-muted)" label={t('admin_legend_standard')} />
        <LegendItem icon={<Dot color="var(--color-success)" />} color="var(--color-success)" label={t('admin_legend_active')} />
        <LegendItem icon={<Dot color="var(--color-error)" />} color="var(--color-error)" label={t('admin_legend_inactive')} />
      </div>
    </>
  )
}

function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: 999, backgroundColor: color }} />
}

function RoleBadge({ admin }: { admin: boolean }) {
  const { t } = useLanguage()
  const tone = admin ? SOFT.amber : SOFT.gray
  return (
    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, backgroundColor: tone.bg, color: tone.text, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {admin ? <><Shield size={10} /> {t('admin_role_admin')}</> : <><User size={10} /> {t('admin_role_standard')}</>}
    </span>
  )
}

function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useLanguage()
  const box = active ? SOFT.greenBox : SOFT.redBox
  return (
    <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 6, backgroundColor: box.bg, color: box.text, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Dot color={active ? 'var(--color-success)' : 'var(--color-error)'} size={6} />
      {active ? t('admin_active') : t('admin_inactive')}
    </span>
  )
}

function YouBadge() {
  const { t } = useLanguage()
  return <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 999, backgroundColor: SOFT.blue.bg, color: SOFT.blue.text }}>{t('admin_you')}</span>
}

const UserTableRow = memo(function UserTableRow({ user: u, isCurrentUser, isLast, actionLoading, isMobile, onToggleRole, onToggleActive, onResetPassword, onDelete }: {
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
  const busy = !!actionLoading

  const lastSeen = u.last_sign_in
    ? new Date(u.last_sign_in).toLocaleDateString(localeOf(lang), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'
  const name = u.display_name || u.email.split('@')[0]

  const actionButtons = (
    <>
      <ActionBtn title={u.role === 'admin' ? t('admin_demote') : t('admin_promote')} disabled={busy || isCurrentUser} loading={actionLoading === `${u.id}_role`} onClick={onToggleRole} color="var(--color-warning)">
        {u.role === 'admin' ? <User size={13} /> : <Crown size={13} />}
      </ActionBtn>
      <ActionBtn title={u.is_active ? t('admin_deactivate') : t('admin_reactivate')} disabled={busy || isCurrentUser} loading={actionLoading === `${u.id}_active`} onClick={onToggleActive} color={u.is_active ? 'var(--color-error)' : 'var(--color-success)'}>
        {u.is_active ? <PowerOff size={13} /> : <Power size={13} />}
      </ActionBtn>
      <ActionBtn title={t('admin_reset_password')} disabled={busy} loading={actionLoading === `${u.id}_reset`} onClick={onResetPassword} color="var(--color-primary)">
        <MailCheck size={13} />
      </ActionBtn>
      <ActionBtn title={t('admin_delete')} disabled={busy || isCurrentUser} loading={actionLoading === `${u.id}_delete`} onClick={onDelete} color="var(--color-error)">
        <Trash2 size={13} />
      </ActionBtn>
    </>
  )

  const identity = (size: number, bold: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <UserAvatar name={u.display_name || u.email} seed={u.email} emoji={u.avatar_emoji} color={u.avatar_color} url={u.avatar_url} size={size} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: isMobile ? 'wrap' : undefined }}>
          <span style={{ fontSize: 14, fontWeight: bold ? 600 : 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {isCurrentUser && <YouBadge />}
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{u.email}</span>
      </div>
    </div>
  )

  if (isMobile) {
    return (
      <div style={{ padding: '12px 14px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {identity(36, true)}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <RoleBadge admin={u.role === 'admin'} />
          <ActiveBadge active={u.is_active} />
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{lastSeen}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{actionButtons}</div>
      </div>
    )
  }

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: GRID, padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', backgroundColor: hovered ? 'var(--color-hover)' : 'var(--color-surface)', transition: 'background-color 0.1s', alignItems: 'center' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {identity(32, false)}
      <div><RoleBadge admin={u.role === 'admin'} /></div>
      <div><ActiveBadge active={u.is_active} /></div>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{lastSeen}</span>
      <div><LoginBadge lastLoginDate={u.last_login_date ?? null} /></div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{actionButtons}</div>
    </div>
  )
})
