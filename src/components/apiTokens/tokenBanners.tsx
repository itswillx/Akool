import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, ShieldCheck } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { TranslationKey } from '../../i18n/translations'
import { copyToClipboard } from '../../lib/clipboard'
import type { ApiTokenErrorKind } from '../../lib/data/apiTokens'
import { bannerStyle, smallBtnStyle, srOnlyStyle } from './tokenStyles'

// API-009: as faixas da aba API: o token recém-criado (mostrado uma vez) e o
// erro, com o atalho para Segurança quando falta o segundo fator.

export interface ApiTokenProblem {
  kind: ApiTokenErrorKind
  /** Texto do servidor, usado em "inválido" e "outro". */
  message: string
}

const PROBLEM_TEXT: Record<Exclude<ApiTokenErrorKind, 'invalid' | 'other'>, TranslationKey> = {
  mfa: 'settings_api_error_mfa',
  admin_only: 'settings_api_error_admin_only',
  limit: 'settings_api_error_limit',
  not_found: 'settings_api_error_not_found',
  session: 'settings_api_error_session',
}

export function NewTokenBanner({ token, onDismiss }: { token: string; onDismiss: () => void }) {
  const { t } = useLanguage()
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle')
  // O formulário fecha ao criar: o foco vem para o Copiar, não cai no body.
  const copyRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { copyRef.current?.focus() }, [])
  // O foco chega no Copiar; a instrução é o nome do grupo, lida ao entrar nele.
  const hintId = useId()

  return (
    <div role="group" aria-labelledby={hintId} style={{ ...bannerStyle('warning'), display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span id={hintId}>{t('settings_api_new_token')}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <code style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {token}
        </code>
        <button ref={copyRef} type="button" onClick={() => { void copyToClipboard(token).then(ok => setCopy(ok ? 'copied' : 'failed')) }} style={smallBtnStyle}>
          {copy === 'copied' ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copy === 'copied' ? t('settings_api_copied') : t('settings_api_copy')}
        </button>
        <button type="button" onClick={onDismiss} style={smallBtnStyle}>{t('settings_api_dismiss')}</button>
      </div>
      {copy === 'failed' && <span role="alert">{t('settings_api_copy_failed')}</span>}
      {/* Região viva montada desde o início: o "Copiado" é anunciado. */}
      <span role="status" style={srOnlyStyle}>{copy === 'copied' ? t('settings_api_copied') : ''}</span>
    </div>
  )
}

export function ProblemBanner({ problem, onOpenSecurity }: { problem: ApiTokenProblem; onOpenSecurity?: () => void }) {
  const { t } = useLanguage()
  const ref = useRef<HTMLDivElement>(null)
  // A aba rola; o erro de uma ação lá embaixo não pode ficar fora da vista.
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'nearest' }) }, [problem])

  const text = problem.kind === 'invalid'
    ? t('settings_api_error_invalid', { message: problem.message })
    : problem.kind === 'other'
      ? t('settings_api_error', { message: problem.message })
      : t(PROBLEM_TEXT[problem.kind])

  return (
    <div ref={ref} role="alert" style={{ ...bannerStyle('error'), display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <span>{text}</span>
      {problem.kind === 'mfa' && onOpenSecurity && (
        <button type="button" onClick={onOpenSecurity} style={smallBtnStyle}>
          <ShieldCheck size={13} aria-hidden />
          {t('settings_api_open_security')}
        </button>
      )}
    </div>
  )
}
