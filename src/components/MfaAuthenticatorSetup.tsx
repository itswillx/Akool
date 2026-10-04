import { useEffect, useId, useRef, useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useLanguage } from '../i18n/LanguageContext'
import { copyToClipboard } from '../lib/clipboard'
import { formatTotpSecret, hasCoarsePointer, isOtpauthUri } from '../lib/mfa'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { ghostBtnStyle, primaryBtnStyle, QR_BG } from '@/shared/ui/uiTokens'
import { FeedbackBanner } from './settings/settingsUi'

// Cadastro de um aparelho no MFA: o QR code, gerado aqui a partir da URI
// otpauth (maior e menos denso que o SVG do Supabase), o link que abre o app
// autenticador no próprio celular e a chave para digitar ou copiar. O fluxo
// (enroll, código, cancelar) fica no MfaSection.

const QR_SIZE = 220

interface Props {
  /** `otpauth://totp/…` devolvida pelo enroll. */
  uri: string
  /** SVG do Supabase (data URI), usado só se a URI não vier. */
  qrCode: string
  secret: string
  /** Outro aparelho, com o MFA já ativo. */
  adding: boolean
}

export default function MfaAuthenticatorSetup({ uri, qrCode, secret, adding }: Props) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [coarsePointer] = useState(hasCoarsePointer)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const introId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // O botão que abriu o painel sumiu: o foco vem para cá, e não para o body.
  useEffect(() => { panelRef.current?.focus() }, [])

  const validUri = isOtpauthUri(uri)
  // Desktop não ganha o link: lá ele não abre nada, e o QR resolve.
  const showOpenApp = validUri && (isMobile || coarsePointer)
  // No celular o link vem primeiro e o QR por último (para outro aparelho).
  const phoneFirst = showOpenApp && isMobile

  const copySecret = async () => {
    setCopyState(await copyToClipboard(secret) ? 'copied' : 'failed')
  }

  const qr = validUri
    ? <QRCodeSVG value={uri} size={QR_SIZE} level="M" marginSize={4} aria-label={t('mfa_qr_alt')} style={{ alignSelf: 'center', borderRadius: 8, border: '1px solid var(--color-border)' }} />
    : <img src={qrCode} alt={t('mfa_qr_alt')} width={QR_SIZE} height={QR_SIZE} style={{ alignSelf: 'center', backgroundColor: QR_BG, padding: 8, borderRadius: 8 }} />

  const openApp = showOpenApp && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <a href={uri} style={phoneFirst
        ? { ...primaryBtnStyle, justifyContent: 'center', textDecoration: 'none', padding: '12px 14px' }
        : { ...ghostBtnStyle, justifyContent: 'center', textDecoration: 'none' }}>
        <ExternalLink size={14} aria-hidden="true" />
        {t('mfa_open_app')}
      </a>
      <span style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>{t('mfa_open_app_hint')}</span>
    </div>
  )

  const secretBlock = (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 4 }}>{t('mfa_secret_label')}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, minWidth: 0, fontSize: 13, letterSpacing: '0.04em', padding: '6px 8px', borderRadius: 6, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {formatTotpSecret(secret)}
        </code>
        <button
          type="button"
          onClick={() => { void copySecret() }}
          style={{ ...ghostBtnStyle, padding: '6px 10px', fontSize: 12, fontWeight: 600, color: copyState === 'copied' ? 'var(--color-success)' : 'var(--color-text)', flexShrink: 0 }}
        >
          {copyState === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {copyState === 'copied' ? t('mfa_key_copied') : t('mfa_copy_key')}
        </button>
      </div>
      {copyState === 'failed' && <FeedbackBanner type="error" text={t('mfa_copy_failed')} style={{ marginTop: 8 }} />}
    </div>
  )

  return (
    <div ref={panelRef} tabIndex={-1} role="group" aria-labelledby={introId} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div id={introId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {adding && <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.5 }}>{t('mfa_add_intro')}</p>}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>{phoneFirst ? t('mfa_scan_mobile') : t('mfa_scan')}</p>
      </div>
      {phoneFirst ? (
        <>
          {openApp}
          {secretBlock}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', textAlign: 'center' }}>{t('mfa_scan_other_device')}</span>
            {qr}
          </div>
        </>
      ) : (
        <>
          {qr}
          {openApp}
          {secretBlock}
        </>
      )}
    </div>
  )
}
