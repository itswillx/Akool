import { useEffect, useState } from 'react'
import { Database, RefreshCw, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'
import type { TranslationKey } from '../i18n/translations'
import { useIsMobile } from '../hooks/useIsMobile'
import { useSiteBackup, formatBackupSize, mapBackupError } from '../hooks/useSiteBackup'
import type { SiteBackup } from '../types'
import ConfirmDeleteModal from './ConfirmDeleteModal'

function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function BackupPanel() {
  const { session, isAdmin } = useAuth()
  const { refreshPages } = usePages()
  const { t, lang } = useLanguage()
  const isMobile = useIsMobile()
  const {
    backups, settings, loading, runningAction,
    refreshList, createManualBackup,
    restoreBackup, deleteBackup, toggleAutoBackup,
  } = useSiteBackup(isAdmin && !!session)

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<SiteBackup | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SiteBackup | null>(null)

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg })
    setTimeout(() => setFeedback(null), 4000)
  }

  const showError = (err: unknown) => {
    showFeedback('error', mapBackupError(err, t))
  }

  useEffect(() => {
    if (!isAdmin || !session) return
    let cancelled = false
    refreshList({ initial: true, runAuto: true }).catch(err => {
      if (!cancelled) showError(err)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per admin session
  }, [isAdmin, session?.user?.id])

  const handleCreate = async () => {
    try {
      await createManualBackup()
      showFeedback('success', t('backup_success'))
    } catch (err) {
      showError(err)
    }
  }

  const handleRestore = async () => {
    if (!confirmRestore) return
    const id = confirmRestore.id
    setConfirmRestore(null)
    try {
      await restoreBackup(id)
      await refreshPages()
      showFeedback('success', t('backup_success'))
      window.location.reload()
    } catch (err) {
      showError(err)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    const id = confirmDelete.id
    setConfirmDelete(null)
    try {
      await deleteBackup(id)
      showFeedback('success', t('backup_success'))
    } catch (err) {
      showError(err)
    }
  }

  const handleToggleAuto = async () => {
    if (!settings) return
    try {
      await toggleAutoBackup(!settings.auto_enabled)
      showFeedback('success', settings.auto_enabled ? t('backup_auto_disabled') : t('backup_auto_enabled'))
      await refreshList()
    } catch (err) {
      showError(err)
    }
  }

  const isBusy = runningAction !== null

  if (!isAdmin) {
    return (
      <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? '24px 16px 60px' : '32px 24px 80px', textAlign: 'center' }}>
          <AlertTriangle size={40} style={{ color: 'var(--color-text-muted)', marginBottom: 16 }} />
          <p style={{ color: 'var(--color-text-muted)', fontSize: 15 }}>{t('backup_access_denied')}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '24px 16px 60px' : '32px 24px 80px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 26, fontWeight: 700, color: 'var(--color-text)' }}>{t('backup_title')}</h1>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{t('backup_subtitle')}</p>
          </div>
        </div>

        {feedback && (
          <div style={{
            marginTop: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            backgroundColor: feedback.type === 'success' ? '#dcfce7' : '#fee2e2',
            color: feedback.type === 'success' ? '#15803d' : '#dc2626',
          }}>
            {feedback.msg}
          </div>
        )}

        {isBusy && (
          <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 8, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {runningAction?.startsWith('restore') ? t('backup_restoring') : t('backup_running')}
          </div>
        )}

        <div style={{ marginTop: 24, padding: 20, borderRadius: 12, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <button
              onClick={handleCreate}
              disabled={isBusy}
              style={{
                padding: '10px 18px', borderRadius: 8, border: 'none', cursor: isBusy ? 'not-allowed' : 'pointer',
                backgroundColor: 'var(--color-primary)', color: '#fff', fontSize: 14, fontWeight: 600, opacity: isBusy ? 0.6 : 1,
              }}
            >
              {t('backup_create_now')}
            </button>
            <button
              onClick={() => refreshList()}
              disabled={isBusy}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 8,
                border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)', fontSize: 13, cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} /> {t('backup_refresh')}
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{t('backup_auto_toggle')}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{t('backup_auto_interval')}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {settings?.last_auto_at
                  ? t('backup_last_auto', { date: formatDate(settings.last_auto_at, lang) })
                  : t('backup_last_auto_never')}
              </div>
            </div>
            <button
              onClick={handleToggleAuto}
              disabled={isBusy || !settings}
              style={{
                width: 48, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative',
                backgroundColor: settings?.auto_enabled ? 'var(--color-primary)' : 'var(--color-border)',
                transition: 'background-color 0.2s',
              }}
              aria-pressed={settings?.auto_enabled ?? false}
            >
              <span style={{
                position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#fff',
                transition: 'left 0.2s', left: settings?.auto_enabled ? 25 : 3,
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
          </div>

          <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, backgroundColor: 'var(--color-bg-tertiary)', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 6px' }}>{t('backup_auth_note')}</p>
            <p style={{ margin: 0 }}>{t('backup_storage_note')}</p>
          </div>
        </div>

        <h2 style={{ margin: '28px 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('backup_restore_points')}</h2>

        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{t('app_loading')}</p>
        ) : backups.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{t('backup_empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {backups.map(backup => (
              <BackupRow
                key={backup.id}
                backup={backup}
                lang={lang}
                t={t}
                isBusy={isBusy}
                runningAction={runningAction}
                onRestore={() => setConfirmRestore(backup)}
                onDelete={() => setConfirmDelete(backup)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDeleteModal
        open={!!confirmRestore}
        title={t('backup_confirm_restore')}
        message={t('backup_confirm_restore_desc')}
        confirmLabel={t('backup_restore')}
        onConfirm={handleRestore}
        onCancel={() => setConfirmRestore(null)}
      />

      <ConfirmDeleteModal
        open={!!confirmDelete}
        title={t('backup_delete')}
        message={formatDate(confirmDelete?.created_at ?? '', lang)}
        confirmLabel={t('backup_delete')}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function BackupRow({
  backup, lang, t, isBusy, runningAction, onRestore, onDelete,
}: {
  backup: SiteBackup
  lang: string
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
  isBusy: boolean
  runningAction: string | null
  onRestore: () => void
  onDelete: () => void
}) {
  const statusLabel = backup.status === 'running'
    ? t('backup_status_running')
    : backup.status === 'failed'
      ? t('backup_status_failed')
      : t('backup_status_completed')

  const typeLabel = backup.type === 'automatic' ? t('backup_type_automatic') : t('backup_type_manual')
  const rowBusy = runningAction === `restore-${backup.id}` || runningAction === `delete-${backup.id}`

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '12px 14px',
      borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
      opacity: rowBusy ? 0.7 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
          {formatDate(backup.created_at, lang)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {typeLabel} · {statusLabel} · {formatBackupSize(backup.size_bytes)}
        </div>
        {backup.error_message && (
          <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{backup.error_message}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {backup.status === 'completed' && (
          <button
            onClick={onRestore}
            disabled={isBusy}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 7,
              border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)', fontSize: 12, cursor: isBusy ? 'not-allowed' : 'pointer', fontWeight: 500,
            }}
          >
            <RotateCcw size={13} /> {t('backup_restore')}
          </button>
        )}
        <button
          onClick={onDelete}
          disabled={isBusy || backup.status === 'running'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 7,
            border: 'none', backgroundColor: '#fee2e2', color: '#dc2626',
            fontSize: 12, cursor: isBusy ? 'not-allowed' : 'pointer', fontWeight: 500,
          }}
        >
          <Trash2 size={13} /> {t('backup_delete')}
        </button>
      </div>
    </div>
  )
}
