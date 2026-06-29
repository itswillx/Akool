import { useEffect, useRef, useState, memo } from 'react'
import { Database, RefreshCw, Trash2, RotateCcw, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { usePages } from '../../contexts/PagesContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useSiteBackup, formatBackupSize, mapBackupError } from './useSiteBackup'
import type { SiteBackup } from '../../types'
import ConfirmDeleteModal from '../../components/ConfirmDeleteModal'

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string

function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_COLORS: Record<SiteBackup['status'], { bg: string; text: string }> = {
  completed: { bg: '#dcfce7', text: '#15803d' },
  running: { bg: '#fef9c3', text: '#854d0e' },
  failed: { bg: '#fee2e2', text: '#dc2626' },
}

const GRID_COLUMNS = '1fr 100px 120px 90px 220px'

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
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = (type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg })
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
  }

  const showError = (err: unknown) => {
    showFeedback('error', mapBackupError(err, t))
  }

  // Clear any pending feedback timer on unmount to avoid setState-after-unmount.
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current) }, [])

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
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: isMobile ? '24px 12px 80px' : '40px 32px 80px' }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', fontWeight: 500 }}>{t('admin_label')}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
            <h1 style={{ margin: 0, fontSize: isMobile ? 22 : 28, fontWeight: 700, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Database size={isMobile ? 22 : 26} />
              {t('backup_title')}
            </h1>
            <button
              onClick={() => refreshList().catch(showError)}
              disabled={isBusy}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1 }}
            >
              <RefreshCw size={13} style={{ animation: loading || isBusy ? 'spin 1s linear infinite' : 'none' }} />
              {!isMobile && t('backup_refresh')}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{t('backup_subtitle')}</p>
        </div>

        {feedback && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            backgroundColor: feedback.type === 'success' ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${feedback.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
            color: feedback.type === 'success' ? '#15803d' : '#dc2626',
          }}>
            {feedback.msg}
          </div>
        )}

        {isBusy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '12px 16px', borderRadius: 8, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} />
            {runningAction?.startsWith('restore') ? t('backup_restoring') : t('backup_running')}
          </div>
        )}

        {/* Actions + automatic backup */}
        <div style={{ padding: 20, borderRadius: 12, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <button
            onClick={handleCreate}
            disabled={isBusy}
            className="backup-primary-btn"
            style={{
              padding: '10px 18px', borderRadius: 8, border: 'none', cursor: isBusy ? 'not-allowed' : 'pointer',
              backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 14, fontWeight: 600, opacity: isBusy ? 0.6 : 1,
            }}
          >
            {t('backup_create_now')}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 0 12px', marginTop: 16, borderTop: '1px solid var(--color-border)' }}>
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
                flexShrink: 0,
                width: 48, height: 26, borderRadius: 13, border: 'none', cursor: (isBusy || !settings) ? 'not-allowed' : 'pointer', position: 'relative',
                backgroundColor: settings?.auto_enabled ? 'var(--color-done)' : 'var(--color-border)',
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

          <div style={{ padding: '10px 12px', borderRadius: 8, backgroundColor: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 6px' }}>{t('backup_auth_note')}</p>
            <p style={{ margin: 0 }}>{t('backup_storage_note')}</p>
          </div>
        </div>

        <h2 style={{ margin: '28px 0 12px', fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('backup_restore_points')}</h2>

        <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          {!isMobile && !loading && backups.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {[t('backup_col_date'), t('backup_col_type'), t('backup_col_status'), t('backup_col_size'), t('backup_col_actions')].map(h => (
                <span key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('app_loading')}</div>
          ) : backups.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('backup_empty')}</div>
          ) : (
            backups.map((backup, i) => (
              <BackupRow
                key={backup.id}
                backup={backup}
                lang={lang}
                t={t}
                isBusy={isBusy}
                isMobile={isMobile}
                isLast={i === backups.length - 1}
                runningAction={runningAction}
                onRestore={() => setConfirmRestore(backup)}
                onDelete={() => setConfirmDelete(backup)}
              />
            ))
          )}
        </div>
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
        message={confirmDelete ? t('backup_confirm_delete_desc', { date: formatDate(confirmDelete.created_at, lang) }) : ''}
        confirmLabel={t('backup_delete')}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .backup-primary-btn:hover:not(:disabled) { background-color: var(--color-btn-primary-hover) !important; }
      `}</style>
    </div>
  )
}

const BackupRow = memo(function BackupRow({
  backup, lang, t, isBusy, isMobile, isLast, runningAction, onRestore, onDelete,
}: {
  backup: SiteBackup
  lang: string
  t: TFn
  isBusy: boolean
  isMobile: boolean
  isLast: boolean
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
  const sc = STATUS_COLORS[backup.status] ?? STATUS_COLORS.completed

  const statusPill = (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text, width: 'fit-content', display: 'inline-block' }}>
      {statusLabel}
    </span>
  )

  const actions = (
    <div style={{ display: 'flex', gap: 6 }}>
      {backup.status === 'completed' && (
        <button
          onClick={onRestore}
          disabled={isBusy}
          style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 7,
            border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)', fontSize: 12, cursor: isBusy ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: isBusy ? 0.5 : 1,
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
          border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626',
          fontSize: 12, cursor: (isBusy || backup.status === 'running') ? 'not-allowed' : 'pointer', fontWeight: 500,
          opacity: (isBusy || backup.status === 'running') ? 0.5 : 1,
        }}
      >
        <Trash2 size={13} /> {t('backup_delete')}
      </button>
    </div>
  )

  if (isMobile) {
    return (
      <div style={{ padding: '12px 14px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 8, opacity: rowBusy ? 0.6 : 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{formatDate(backup.created_at, lang)}</span>
          {statusPill}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{typeLabel} · {formatBackupSize(backup.size_bytes)}</div>
        {backup.error_message && <div style={{ fontSize: 11, color: '#dc2626' }}>{backup.error_message}</div>}
        {actions}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--color-border)', alignItems: 'center', backgroundColor: 'var(--color-surface)', opacity: rowBusy ? 0.6 : 1 }}>
      <div style={{ minWidth: 0, paddingRight: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{formatDate(backup.created_at, lang)}</div>
        {backup.error_message && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{backup.error_message}</div>}
      </div>
      <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{typeLabel}</span>
      <div>{statusPill}</div>
      <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{formatBackupSize(backup.size_bytes)}</span>
      {actions}
    </div>
  )
})
