import { CheckCheck, Copy, Gift } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { localeOf } from '../../i18n/translations'
import { inviteStatus } from '../../lib/data/invites'
import { InviteStatusBadge } from './settingsUi'
import { SOFT } from './settingsTokens'
import { useMyInvites } from './useMyInvites'

// ARCH-008: aba de convites das Configurações: slots que restam e os códigos
// que eu gerei.

export default function MyInvitesTab() {
  const { profile } = useAuth()
  const { t, lang } = useLanguage()
  const { invites, loading, generating, copiedId, generate, copy } = useMyInvites()

  const isAdmin = profile?.role === 'admin'
  const slots = profile?.invite_slots_remaining ?? 0
  const canGenerate = isAdmin || slots > 0
  const generateDisabled = generating || !canGenerate

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: canGenerate ? SOFT.green.bg : 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: canGenerate ? 'var(--color-success)' : 'var(--color-text-muted)', flexShrink: 0 }}>
            <Gift size={17} />
          </div>
          <div>
            {isAdmin ? (
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-success)' }}>∞ {t('settings_tab_invites')}</p>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {slots === 1 ? t('settings_invites_slots_available', { n: 1 }) : t('settings_invites_slots_available_plural', { n: slots })}
                </p>
                {slots === 0 && (
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('settings_invites_no_slots')}</p>
                )}
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={generateDisabled}
          onClick={() => { void generate() }}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: generateDisabled ? 'not-allowed' : 'pointer', backgroundColor: generateDisabled ? 'var(--color-btn-disabled)' : 'var(--color-btn-primary)', color: generateDisabled ? 'var(--color-btn-disabled-text)' : 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
        >
          {generating ? t('settings_invites_generating') : <><Gift size={13} />{t('settings_invites_generate_btn')}</>}
        </button>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>{t('settings_invites_loading')}</p>
      ) : invites.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>{t('settings_invites_empty')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {invites.map(inv => {
            const status = inviteStatus(inv)
            const copied = copiedId === inv.id
            return (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1.5px solid var(--color-border)', borderRadius: 10, backgroundColor: 'var(--color-surface)', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '0.1em' }}>{inv.code}</span>
                    <InviteStatusBadge status={status} label={t(`settings_invites_status_${status}`)} />
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {status === 'used'
                      ? t('settings_invites_used_by', { email: inv.used_by_email ?? inv.used_by ?? '?' })
                      : t('settings_invites_expires', { date: new Date(inv.expires_at).toLocaleDateString(localeOf(lang)) })}
                  </p>
                </div>
                {status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => copy(inv)}
                    title={t('settings_invites_copy')}
                    style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', color: copied ? 'var(--color-success)' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, flexShrink: 0, transition: 'color 0.15s' }}
                  >
                    {copied ? <><CheckCheck size={13} />{t('settings_invites_copied')}</> : <><Copy size={13} />{t('settings_invites_copy')}</>}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
