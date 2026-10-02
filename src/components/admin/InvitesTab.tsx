import { useState } from 'react'
import { Gift, Trash2 } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { localeOf, type TranslationKey } from '../../i18n/translations'
import { inviteStatus } from '../../lib/data/invites'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { InviteStatusBadge } from '../settings/settingsUi'
import { ActionBtn, CopyCodeButton, InviteSubTabBtn, SoftButton, TableBox, TableHead, TableNotice } from './adminUi'
import type { AdminInvites, AdminInviteCode, InviteFilter } from './useAdminInvites'
import type { UserRow } from './useAdminUsers'

// ARCH-008: aba de convites do painel de admin: todos os códigos (filtro,
// gerar, revogar, excluir) e as cotas por usuário.

const CODES_GRID = '1fr 110px 90px 90px 100px 1fr 60px'
const QUOTAS_GRID = '1fr 120px 160px'
const FILTERS: InviteFilter[] = ['all', 'pending', 'used', 'expired']

export interface InvitesTabProps {
  invites: AdminInvites
  users: UserRow[]
  usersLoading: boolean
  usersActionLoading: string | null
  onAddSlot: (u: UserRow) => void
  onRemoveSlot: (u: UserRow) => void
}

export default function InvitesTab({ invites, users, usersLoading, usersActionLoading, onAddSlot, onRemoveSlot }: InvitesTabProps) {
  const { t } = useLanguage()
  const [subTab, setSubTab] = useState<'codes' | 'quotas'>('codes')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <InviteSubTabBtn active={subTab === 'codes'} onClick={() => setSubTab('codes')} label={t('admin_invites_all_codes')} />
        <InviteSubTabBtn active={subTab === 'quotas'} onClick={() => setSubTab('quotas')} label={t('admin_invites_quotas')} />
      </div>
      {subTab === 'codes'
        ? <CodesSubTab invites={invites} />
        : <QuotasSubTab users={users} loading={usersLoading} actionLoading={usersActionLoading} onAddSlot={onAddSlot} onRemoveSlot={onRemoveSlot} />}
    </div>
  )
}

const filterKey = (f: InviteFilter) => `admin_invites_filter_${f}` as TranslationKey

function CodesSubTab({ invites }: { invites: AdminInvites }) {
  const { t, lang } = useLanguage()
  const isMobile = useIsMobile()
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const busy = !!invites.actionLoading
  const generating = invites.actionLoading === 'admin_generate'

  const copy = (c: AdminInviteCode) => {
    void navigator.clipboard.writeText(c.code)
    setCopiedCode(c.id)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(f => {
            const active = invites.filter === f
            return (
              <button
                key={f}
                type="button"
                aria-pressed={active}
                onClick={() => invites.setFilter(f)}
                style={{ padding: '5px 12px', borderRadius: 20, border: '1.5px solid', borderColor: active ? 'var(--color-text)' : 'var(--color-border)', backgroundColor: active ? 'var(--color-bg-secondary)' : 'var(--color-surface)', color: active ? 'var(--color-text)' : 'var(--color-text-muted)', fontSize: 12, fontWeight: active ? 600 : 400, cursor: 'pointer', transition: 'all 0.15s' }}
              >
                {t(filterKey(f))}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => { void invites.generate() }}
          disabled={generating}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer', opacity: generating ? 0.6 : 1 }}
        >
          <Gift size={13} /> {t('admin_invites_generate')}
        </button>
      </div>

      <TableBox>
        {!isMobile && (
          <TableHead template={CODES_GRID} columns={[t('admin_invites_col_creator'), t('admin_invites_col_code'), t('admin_invites_col_created'), t('admin_invites_col_expires'), t('admin_invites_col_status'), t('admin_invites_col_used_by'), '']} />
        )}
        {invites.loading ? (
          <TableNotice>{t('admin_invites_loading')}</TableNotice>
        ) : invites.codes.length === 0 ? (
          <TableNotice>{t('admin_invites_empty')}</TableNotice>
        ) : invites.codes.map((c, i) => {
          const status = inviteStatus(c)
          const statusLabel = t(filterKey(status))
          const isLast = i === invites.codes.length - 1
          const copied = copiedCode === c.id
          if (isMobile) {
            return (
              <div key={c.id} style={{ padding: '12px 14px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text)' }}>{c.code}</span>
                  <InviteStatusBadge status={status} label={statusLabel} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('admin_invites_col_creator')}: {c.created_by_email ?? c.created_by}</span>
                {c.used_by_email && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('admin_invites_col_used_by')}: {c.used_by_email}</span>}
                <div style={{ display: 'flex', gap: 6 }}>
                  {status === 'pending' && <CopyCodeButton copied={copied} onCopy={() => copy(c)} />}
                  {status === 'pending' && <SoftButton tone="red" disabled={busy} onClick={() => { void invites.revoke(c) }}>{t('admin_invites_revoke')}</SoftButton>}
                  {status !== 'pending' && <SoftButton tone="red" disabled={busy} onClick={() => invites.requestDelete(c)}><Trash2 size={12} /> {t('admin_invites_delete')}</SoftButton>}
                </div>
              </div>
            )
          }
          return (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: CODES_GRID, padding: '10px 16px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', alignItems: 'center', backgroundColor: 'var(--color-surface)' }}>
              <span style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.created_by_email ?? c.created_by}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text)' }}>{c.code}</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(c.created_at).toLocaleDateString(localeOf(lang))}</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{new Date(c.expires_at).toLocaleDateString(localeOf(lang))}</span>
              <InviteStatusBadge status={status} label={statusLabel} fit />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.used_by_email ?? (c.used_by ? `${c.used_by.slice(0, 8)}…` : '—')}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {status === 'pending' && (
                  <>
                    <CopyCodeButton compact copied={copied} onCopy={() => copy(c)} />
                    <ActionBtn title={t('admin_invites_revoke')} disabled={busy} loading={invites.actionLoading === `${c.id}_revoke`} onClick={() => { void invites.revoke(c) }} color="var(--color-error)">
                      <Trash2 size={12} />
                    </ActionBtn>
                  </>
                )}
                {status !== 'pending' && (
                  <ActionBtn title={t('admin_invites_delete')} disabled={busy} loading={invites.actionLoading === `${c.id}_delete`} onClick={() => invites.requestDelete(c)} color="var(--color-error)">
                    <Trash2 size={12} />
                  </ActionBtn>
                )}
              </div>
            </div>
          )
        })}
      </TableBox>
    </div>
  )
}

function QuotasSubTab({ users, loading, actionLoading, onAddSlot, onRemoveSlot }: {
  users: UserRow[]
  loading: boolean
  actionLoading: string | null
  onAddSlot: (u: UserRow) => void
  onRemoveSlot: (u: UserRow) => void
}) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const busy = !!actionLoading
  const rows = users.filter(u => u.role !== 'admin')
  return (
    <TableBox>
      {!isMobile && <TableHead template={QUOTAS_GRID} columns={[t('admin_col_user'), t('admin_invites_col_slots'), t('admin_col_actions')]} />}
      {loading ? (
        <TableNotice>{t('admin_loading')}</TableNotice>
      ) : rows.length === 0 ? (
        <TableNotice>{t('admin_no_users')}</TableNotice>
      ) : rows.map((u, i) => {
        const slots = u.invite_slots_remaining ?? 0
        return (
          <div key={u.id} style={{ display: isMobile ? 'flex' : 'grid', gridTemplateColumns: QUOTAS_GRID, flexDirection: isMobile ? 'row' : undefined, alignItems: 'center', justifyContent: isMobile ? 'space-between' : undefined, padding: '10px 16px', borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--color-border)', gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.display_name || u.email.split('@')[0]}</p>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: slots > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>{slots}</span>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('admin_invites_col_slots')}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <SoftButton tone="red" disabled={busy || slots <= 0} onClick={() => onRemoveSlot(u)}>{t('admin_invites_remove_slot')}</SoftButton>
              <SoftButton tone="green" disabled={busy} onClick={() => onAddSlot(u)}>{t('admin_invites_add_slot')}</SoftButton>
            </div>
          </div>
        )
      })}
    </TableBox>
  )
}
