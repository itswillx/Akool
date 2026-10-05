import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Field } from '@/shared/ui/Field'
import { primaryBtnStyle } from '@/shared/ui/uiTokens'
import { useLanguage } from '../../i18n/LanguageContext'
import { inputStyle } from '../settings/settingsTokens'
import { clampExpiry, createLimits, expiryOptions, type ScopeMap } from './scopeModel'
import { SegmentedRadio } from './SegmentedRadio'
import { TokenScopePicker } from './TokenScopePicker'
import { fieldLabelStyle, hintStyle, panelStyle, smallBtnStyle } from './tokenStyles'

// API-009: novo token. Nome, permissões e validade; a validade fica limitada
// pelo nível escolhido (até 90 dias com escrita, até 30 com Administração),
// como o banco exige.

export interface CreateTokenInput {
  name: string
  expiresInDays: number
  scopes: ScopeMap
}

export function CreateTokenForm({ isAdmin, busy, onCreate, onCancel }: {
  isAdmin: boolean
  busy: boolean
  /** Resolve true quando o token foi criado (o formulário fecha). */
  onCreate: (input: CreateTokenInput) => Promise<boolean>
  onCancel: () => void
}) {
  const { t } = useLanguage()
  const id = useId()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ScopeMap>({})
  const [days, setDays] = useState(30)
  // Abrir o formulário leva o foco ao nome (o botão que abriu sai da tela).
  const nameInput = useRef<HTMLInputElement>(null)
  useEffect(() => { nameInput.current?.focus() }, [])
  // A escolha fica guardada: tirar a escrita devolve a validade que a pessoa pediu.
  const effectiveDays = clampExpiry(days, scopes)
  const empty = Object.keys(scopes).length === 0
  const disabled = busy || empty

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled) return
    await onCreate({ name, expiresInDays: effectiveDays, scopes })
  }

  return (
    <form onSubmit={event => { void submit(event) }} aria-labelledby={`${id}-title`} style={panelStyle}>
      <h3 id={`${id}-title`} style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{t('settings_api_form_title')}</h3>

      <div>
        <Field label={t('settings_api_name_label')} labelStyle={fieldLabelStyle}>
          {control => (
            <input
              {...control}
              ref={nameInput}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder={t('settings_api_name_placeholder')}
              maxLength={80}
              style={inputStyle}
            />
          )}
        </Field>
      </div>

      <TokenScopePicker value={scopes} onChange={setScopes} isAdmin={isAdmin} limits={createLimits(isAdmin)} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span id={`${id}-expiry`} style={{ ...fieldLabelStyle, marginBottom: 0 }}>{t('settings_api_expiry_label')}</span>
        <SegmentedRadio
          labelledBy={`${id}-expiry`}
          describedBy={`${id}-expiry-hint`}
          value={effectiveDays}
          onChange={setDays}
          options={expiryOptions(scopes).map(({ days: n, allowed }) => ({ value: n, label: t('settings_api_expiry_days', { n }), disabled: !allowed }))}
        />
        <p id={`${id}-expiry-hint`} style={hintStyle}>{t('settings_api_expiry_hint')}</p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={disabled}
          style={{ ...primaryBtnStyle, ...(disabled ? { background: 'var(--color-btn-disabled)', color: 'var(--color-btn-disabled-text)', cursor: busy ? 'wait' : 'not-allowed' } : null) }}
        >
          <KeyRound size={14} aria-hidden />
          {busy ? t('settings_api_generating') : t('settings_api_generate')}
        </button>
        <button type="button" onClick={onCancel} style={smallBtnStyle}>{t('settings_api_cancel')}</button>
      </div>
    </form>
  )
}
