import { useId, useMemo, useState } from 'react'
import { primaryBtnStyle } from '@/shared/ui/uiTokens'
import { useLanguage } from '../../i18n/LanguageContext'
import { localeOf } from '../../i18n/translations'
import type { ApiTokenRow } from '../../lib/data/apiTokens'
import { editLimits, prefillScopes, sameScopes, type ScopeMap } from './scopeModel'
import { TokenScopePicker } from './TokenScopePicker'
import { bannerStyle, hintStyle, panelStyle, smallBtnStyle } from './tokenStyles'

// API-009: editar as permissões de um token ativo. Abre com o nível atual de
// cada subseção; o segredo não muda. A validade que resta trava o nível como o
// banco faz: Escrever e Excluir só com até 90 dias, Administração com até 30.

export function EditScopesPanel({ id, token, isAdmin, now, busy, onSave, onCancel }: {
  /** Para o aria-controls do botão Editar. */
  id: string
  token: ApiTokenRow
  isAdmin: boolean
  now: number
  busy: boolean
  onSave: (scopes: ScopeMap) => Promise<boolean>
  onCancel: () => void
}) {
  const { t, lang } = useLanguage()
  const titleId = useId()
  const initial = useMemo(() => prefillScopes(token.scopes, isAdmin), [token.scopes, isAdmin])
  const [scopes, setScopes] = useState(initial)
  const limits = editLimits(token, isAdmin, now)
  const canSave = !busy && Object.keys(scopes).length > 0 && !sameScopes(scopes, initial)
  const expires = new Date(token.expires_at).toLocaleDateString(localeOf(lang))

  return (
    <section id={id} aria-labelledby={titleId} style={{ ...panelStyle, marginTop: 10 }}>
      <h4 id={titleId} style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)' }}>
        {t('settings_api_edit_title', { name: token.name })}
      </h4>
      <p style={hintStyle}>{t('settings_api_edit_same_secret')}</p>
      {limits.maxLevel === 'read' && <p style={{ ...bannerStyle('warning'), margin: 0 }}>{t('settings_api_lock_write', { date: expires })}</p>}
      {isAdmin && !limits.admin && <p style={hintStyle}>{t('settings_api_lock_admin')}</p>}

      <TokenScopePicker value={scopes} onChange={setScopes} isAdmin={isAdmin} limits={limits} emptyHint={t('settings_api_edit_empty')} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => { void onSave(scopes) }}
          style={{ ...primaryBtnStyle, ...(canSave ? null : { background: 'var(--color-btn-disabled)', color: 'var(--color-btn-disabled-text)', cursor: busy ? 'wait' : 'not-allowed' }) }}
        >
          {busy ? t('settings_api_saving') : t('settings_api_save_scopes')}
        </button>
        <button type="button" onClick={onCancel} style={smallBtnStyle}>{t('settings_api_cancel')}</button>
      </div>
    </section>
  )
}
