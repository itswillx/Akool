import { AlertTriangle, Loader2 } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import type { SaveStatus } from '../lib/contentPersistence'

// Selo discreto de autosave (REL-002): "Salvando…" ou "Não salvo · Tentar de
// novo". Some quando está tudo salvo, para não poluir o editor.
export default function SaveStatusBadge({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const { t } = useLanguage()
  if (status !== 'saving' && status !== 'error') return null

  const error = status === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={{
        position: 'absolute', top: 10, right: 14, zIndex: 5,
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
        fontSize: 12, fontWeight: 600, pointerEvents: 'auto',
        backgroundColor: error ? '#ef444418' : 'var(--color-surface)',
        border: `1px solid ${error ? '#ef444466' : 'var(--color-border)'}`,
        color: error ? '#ef4444' : 'var(--color-text-muted)',
      }}
    >
      {error ? <AlertTriangle size={12} /> : <Loader2 size={12} className="animate-spin" />}
      {error ? t('editor_save_error') : t('editor_saving')}
      {error && (
        <button
          type="button"
          onClick={onRetry}
          style={{ border: 'none', background: 'none', padding: 0, color: '#ef4444', fontSize: 12, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer' }}
        >
          {t('editor_retry')}
        </button>
      )}
    </div>
  )
}

// Leitura falhou (REL-002): o editor NÃO monta, para o autosave não gravar vazio
// por cima do conteúdo real. Só resta tentar de novo.
export function EditorLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useLanguage()
  return (
    <div role="alert" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, height: '100%', padding: 24, textAlign: 'center' }}>
      <AlertTriangle size={22} color="#ef4444" />
      <p style={{ margin: 0, maxWidth: 380, fontSize: 14, color: 'var(--color-text)', lineHeight: 1.5 }}>{t('editor_load_error')}</p>
      <button
        type="button"
        onClick={onRetry}
        style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
      >
        {t('editor_retry')}
      </button>
    </div>
  )
}

// REL-009: alguém salvou esta página depois da versão que este editor carregou.
// A edição local continua guardada até a pessoa escolher: carregar a versão
// salva (descarta a sua) ou manter a sua (grava por cima, de propósito).
export function EditConflictBanner({ onLoadSaved, onKeepMine, busy }: {
  onLoadSaved: () => void
  onKeepMine: () => void
  busy?: boolean
}) {
  const { t } = useLanguage()
  const button = {
    padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
    border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)',
  } as const
  return (
    <div
      role="alert"
      style={{
        position: 'absolute', top: 10, left: 14, right: 14, zIndex: 6,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 10,
        backgroundColor: 'var(--color-surface)', border: '1px solid #f59e0b', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        fontSize: 13, color: 'var(--color-text)',
      }}
    >
      <AlertTriangle size={14} color="#f59e0b" style={{ flexShrink: 0 }} />
      <span style={{ flex: '1 1 220px', lineHeight: 1.4 }}>{t('editor_conflict_title')}</span>
      <button type="button" onClick={onLoadSaved} disabled={busy} style={button}>{t('editor_conflict_load')}</button>
      <button type="button" onClick={onKeepMine} disabled={busy} style={{ ...button, borderColor: '#f59e0b' }}>{t('editor_conflict_keep')}</button>
    </div>
  )
}
