import { useId } from 'react'
import { Pencil } from 'lucide-react'
import { MAX_ACTIVE_TOKENS } from '../../../supabase/functions/_api/catalog'
import { useLanguage } from '../../i18n/LanguageContext'
import { localeOf } from '../../i18n/translations'
import { apiTokenStatus, type ApiTokenRow, type ApiTokenStatus } from '../../lib/data/apiTokens'
import { ConfirmButton } from './ConfirmButton'
import { EditScopesPanel } from './EditScopesPanel'
import {
  levelLabelKey, prefillScopes, sectionLabelKey, subsectionLabelKey, subsectionsOf, summarizeScopes,
  type ScopeMap, type SectionSummary,
} from './scopeModel'
import { chipStyle, hintStyle, smallBtnStyle, statusBadgeStyle } from './tokenStyles'

// API-009: os tokens da pessoa. Ativo: Editar permissões, Revogar e Excluir;
// revogado ou expirado: Excluir. Na lista: Revogar todos e Limpar revogados e
// expirados. As ações destrutivas pedem dois cliques.

export interface TokenListActions {
  onEdit: (id: string | null) => void
  onSaveScopes: (id: string, scopes: ScopeMap) => Promise<boolean>
  onRevoke: (id: string) => void
  onDelete: (id: string) => void
  onRevokeAll: () => void
  onPurge: () => void
}

export function TokenList({ tokens, now, isAdmin, busy, editingId, actions }: {
  tokens: readonly ApiTokenRow[]
  now: number
  isAdmin: boolean
  busy: boolean
  editingId: string | null
  actions: TokenListActions
}) {
  const { t } = useLanguage()
  const titleId = useId()
  const statuses = new Map(tokens.map(token => [token.id, apiTokenStatus(token, now)]))
  const active = tokens.filter(token => statuses.get(token.id) === 'active').length
  const inactive = tokens.length - active

  if (tokens.length === 0) return <p style={{ ...hintStyle, fontSize: 13 }}>{t('settings_api_empty')}</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{t('settings_api_list_label')}</h3>
          <span style={hintStyle}>{t('settings_api_active_count', { n: active })}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {active > 0 && (
            <ConfirmButton
              label={t('settings_api_revoke_all')}
              confirmLabel={t('settings_api_revoke_all_confirm', { n: active })}
              disabled={busy}
              onConfirm={actions.onRevokeAll}
            />
          )}
          {inactive > 0 && (
            <ConfirmButton
              label={t('settings_api_purge')}
              confirmLabel={t('settings_api_purge_confirm', { n: inactive })}
              disabled={busy}
              onConfirm={actions.onPurge}
            />
          )}
        </div>
      </div>
      <ul aria-labelledby={titleId} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tokens.map(token => (
          <TokenRow
            key={token.id}
            token={token}
            status={statuses.get(token.id) ?? 'active'}
            now={now}
            isAdmin={isAdmin}
            busy={busy}
            editing={editingId === token.id}
            actions={actions}
          />
        ))}
      </ul>
      {active >= MAX_ACTIVE_TOKENS && <p style={hintStyle}>{t('settings_api_limit_reached')}</p>}
    </div>
  )
}

function TokenRow({ token, status, now, isAdmin, busy, editing, actions }: {
  token: ApiTokenRow
  status: ApiTokenStatus
  now: number
  isAdmin: boolean
  busy: boolean
  editing: boolean
  actions: TokenListActions
}) {
  const { t, lang } = useLanguage()
  const panelId = useId()
  const fmt = (iso: string) => new Date(iso).toLocaleDateString(localeOf(lang))
  const scopes = prefillScopes(token.scopes, isAdmin)

  const chipText = ({ section, top, count, total, uniform }: SectionSummary) => {
    const vars = { section: t(sectionLabelKey(section)), level: t(levelLabelKey(top)), count, total }
    if (!uniform) return t('settings_api_chip_mixed', vars)
    return count < total ? t('settings_api_chip_partial', vars) : t('settings_api_chip', vars)
  }
  // O detalhe de cada subseção, no title do chip; a edição mostra tudo.
  const chipDetail = ({ section }: SectionSummary) => subsectionsOf(section)
    .flatMap(sub => {
      const level = scopes[sub.key]
      return level ? [`${t(subsectionLabelKey(sub.key))}: ${t(levelLabelKey(level))}`] : []
    })
    .join(' · ')

  const meta = [
    t('settings_api_created_on', { date: fmt(token.created_at) }),
    token.last_used_at ? t('settings_api_last_used', { date: fmt(token.last_used_at) }) : t('settings_api_never_used'),
    ...(token.last_client ? [t('settings_api_last_client', { client: token.last_client })] : []),
    status === 'active' ? t('settings_api_expires', { date: fmt(token.expires_at) })
      : status === 'revoked' && token.revoked_at ? t('settings_api_revoked_on', { date: fmt(token.revoked_at) })
        : t('settings_api_expired_on', { date: fmt(token.expires_at) }),
  ].join(' · ')
  const chips = summarizeScopes(scopes)

  return (
    <li style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</span>
            <span style={statusBadgeStyle(status)}>{t(`settings_api_status_${status}`)}</span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', overflowWrap: 'anywhere' }}>
            <code>{token.prefix}…</code>
            {' · '}
            {meta}
          </span>
          <ul aria-label={t('settings_api_scopes_of', { name: token.name })} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {chips.length === 0
              ? <li style={chipStyle}>{t('settings_api_no_scopes')}</li>
              : chips.map(chip => <li key={chip.section} title={chipDetail(chip)} style={chipStyle}>{chipText(chip)}</li>)}
          </ul>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '0 1 auto' }}>
          {status === 'active' && (
            <button
              type="button"
              aria-expanded={editing}
              aria-controls={editing ? panelId : undefined}
              disabled={busy && !editing}
              onClick={() => actions.onEdit(editing ? null : token.id)}
              style={smallBtnStyle}
            >
              <Pencil size={12} aria-hidden />
              {t('settings_api_edit')}
            </button>
          )}
          {status === 'active' && (
            <ConfirmButton
              label={t('settings_api_revoke')}
              confirmLabel={t('settings_api_revoke_confirm')}
              disabled={busy}
              onConfirm={() => actions.onRevoke(token.id)}
            />
          )}
          <ConfirmButton
            label={t('settings_api_delete')}
            confirmLabel={t('settings_api_delete_confirm')}
            warning={status === 'active' ? t('settings_api_delete_active_warning') : undefined}
            disabled={busy}
            onConfirm={() => actions.onDelete(token.id)}
          />
        </div>
      </div>
      {editing && (
        <EditScopesPanel
          id={panelId}
          token={token}
          isAdmin={isAdmin}
          now={now}
          busy={busy}
          onSave={scopes => actions.onSaveScopes(token.id, scopes)}
          onCancel={() => actions.onEdit(null)}
        />
      )}
    </li>
  )
}
