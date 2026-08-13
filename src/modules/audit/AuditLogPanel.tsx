import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { ScrollText, RefreshCw, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { AuditLogEntry } from '../../types'

type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string

// audit_log cresce sem teto (toda ação administrativa vira uma linha), então
// aqui a paginação é por range de verdade, não um .limit() fixo como no resto
// do app.
const PAGE_SIZE = 50

const GRID_COLUMNS = '20px 150px 1fr 150px 1fr 90px'

const ACTION_FILTERS = ['all', 'set_role', 'ban_user', 'unban_user', 'delete_user', 'restore_backup', 'delete_backup'] as const
type ActionFilter = typeof ACTION_FILTERS[number]

// Rótulo por ação conhecida; ações novas (ou vindas de outra edge function)
// caem no nome cru em vez de sumir da lista.
const ACTION_LABEL_KEYS: Record<string, TranslationKey> = {
  set_role: 'audit_action_set_role',
  ban_user: 'audit_action_ban_user',
  unban_user: 'audit_action_unban_user',
  delete_user: 'audit_action_delete_user',
  restore_backup: 'audit_action_restore_backup',
  delete_backup: 'audit_action_delete_backup',
}

function formatDate(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function actionLabel(action: string, t: TFn): string {
  const key = ACTION_LABEL_KEYS[action]
  return key ? t(key) : action
}

// O alvo é gravado como uuid; quando a edge conseguiu ler o e-mail antes da
// ação (o delete apaga o profile), ele vem em details.target_email.
function targetLabel(entry: AuditLogEntry): string {
  const email = entry.details?.target_email
  if (typeof email === 'string' && email) return email
  return entry.target_id ?? '—'
}

export default function AuditLogPanel() {
  const { isAdmin } = useAuth()
  const { t, lang } = useLanguage()
  const isMobile = useIsMobile()

  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [filter, setFilter] = useState<ActionFilter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showError = useCallback((msg: string) => {
    setFeedback(msg)
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 4000)
  }, [])

  // Limpa o timer pendente no unmount para não dar setState after unmount.
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current) }, [])

  // `offset` null = primeira página (substitui a lista); número = carregar mais.
  const fetchPage = useCallback(async (offset: number | null) => {
    if (offset === null) setLoading(true)
    else setLoadingMore(true)

    const from = offset ?? 0
    let query = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (filter !== 'all') query = query.eq('action', filter)

    const { data, error } = await query

    if (error) {
      showError(error.message)
    } else {
      const rows = (data ?? []) as AuditLogEntry[]
      setEntries(prev => (offset === null ? rows : [...prev, ...rows]))
      setHasMore(rows.length === PAGE_SIZE)
    }
    setLoading(false)
    setLoadingMore(false)
  }, [filter, showError])

  useEffect(() => {
    if (!isAdmin) return
    setExpanded(null)
    fetchPage(null)
  }, [isAdmin, fetchPage])

  // A RLS já barra não-admin, mas o painel avisa em vez de mostrar lista vazia.
  if (!isAdmin) {
    return (
      <div style={{ flex: 1, overflow: 'auto', backgroundColor: 'var(--color-bg-tertiary)' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', padding: isMobile ? '24px 16px 60px' : '32px 24px 80px', textAlign: 'center' }}>
          <AlertTriangle size={40} style={{ color: 'var(--color-text-muted)', marginBottom: 16 }} />
          <p style={{ color: 'var(--color-text-muted)', fontSize: 15 }}>{t('audit_access_denied')}</p>
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
              <ScrollText size={isMobile ? 22 : 26} />
              {t('audit_title')}
            </h1>
            <button
              onClick={() => fetchPage(null)}
              disabled={loading || loadingMore}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: (loading || loadingMore) ? 'not-allowed' : 'pointer', opacity: (loading || loadingMore) ? 0.6 : 1 }}
            >
              <RefreshCw size={13} style={{ animation: (loading || loadingMore) ? 'spin 1s linear infinite' : 'none' }} />
              {!isMobile && t('audit_refresh')}
            </button>
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>{t('audit_subtitle')}</p>
        </div>

        {feedback && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}>
            {feedback}
          </div>
        )}

        {/* Filtro por ação */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {ACTION_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${filter === f ? 'var(--color-text)' : 'var(--color-border)'}`,
                backgroundColor: filter === f ? 'var(--color-text)' : 'var(--color-surface)',
                color: filter === f ? 'var(--color-bg)' : 'var(--color-text-muted)',
              }}
            >
              {f === 'all' ? t('audit_filter_all') : actionLabel(f, t)}
            </button>
          ))}
        </div>

        {/* Tabela */}
        <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
          {!isMobile && !loading && entries.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)' }}>
              {['', t('audit_col_when'), t('audit_col_actor'), t('audit_col_action'), t('audit_col_target'), t('audit_col_status')].map((h, i) => (
                <span key={i} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</span>
              ))}
            </div>
          )}

          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('app_loading')}</div>
          ) : entries.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 14 }}>{t('audit_empty')}</div>
          ) : (
            entries.map((entry, i) => (
              <AuditRow
                key={entry.id}
                entry={entry}
                lang={lang}
                t={t}
                isMobile={isMobile}
                isLast={i === entries.length - 1}
                isExpanded={expanded === entry.id}
                onToggle={() => setExpanded(prev => (prev === entry.id ? null : entry.id))}
              />
            ))
          )}
        </div>

        {hasMore && !loading && (
          <button
            onClick={() => fetchPage(entries.length)}
            disabled={loadingMore}
            style={{ marginTop: 12, width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 500, cursor: loadingMore ? 'not-allowed' : 'pointer', opacity: loadingMore ? 0.6 : 1 }}
          >
            {loadingMore ? t('app_loading') : t('audit_load_more')}
          </button>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

const AuditRow = memo(function AuditRow({
  entry, lang, t, isMobile, isLast, isExpanded, onToggle,
}: {
  entry: AuditLogEntry
  lang: string
  t: TFn
  isMobile: boolean
  isLast: boolean
  isExpanded: boolean
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)

  const status = entry.success
    ? { bg: '#dcfce7', text: '#15803d', label: t('audit_status_success') }
    : { bg: '#fee2e2', text: '#dc2626', label: t('audit_status_failed') }

  const statusBadge = (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, backgroundColor: status.bg, color: status.text, justifySelf: 'start' }}>
      {status.label}
    </span>
  )

  // details tem formato variável por ação (e o app não tem visualizador de
  // JSON), então a linha expandida mostra o objeto cru.
  const detailsBlock = isExpanded && (
    <div style={{ padding: '10px 16px 14px', backgroundColor: 'var(--color-bg-tertiary)', borderTop: '1px solid var(--color-border)' }}>
      {entry.error_message && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#dc2626', fontWeight: 500 }}>{entry.error_message}</p>
      )}
      <pre style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace' }}>
        {JSON.stringify(entry.details ?? {}, null, 2)}
      </pre>
    </div>
  )

  if (isMobile) {
    return (
      <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
        <div onClick={onToggle} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{actionLabel(entry.action, t)}</span>
            {statusBadge}
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{targetLabel(entry)}</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {formatDate(entry.created_at, lang)} · {entry.actor_label ?? '—'}
          </span>
        </div>
        {detailsBlock}
      </div>
    )
  }

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--color-border)' }}>
      <div
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: 8, alignItems: 'center',
          padding: '10px 16px', cursor: 'pointer',
          backgroundColor: hovered ? 'var(--color-hover)' : 'var(--color-surface)',
        }}
      >
        {isExpanded ? <ChevronDown size={14} color="var(--color-text-muted)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{formatDate(entry.created_at, lang)}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.actor_label ?? '—'}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{actionLabel(entry.action, t)}</span>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{targetLabel(entry)}</span>
        {statusBadge}
      </div>
      {detailsBlock}
    </div>
  )
})
