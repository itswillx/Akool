import { useId, useState } from 'react'
import { Fingerprint, QrCode } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import type { TranslationKey } from '../i18n/translations'
import { MFA_PASSKEY_ENABLED } from '../lib/env'
import { hasCoarsePointer, isPasskeyErrorKind, PASSKEY_ERROR_KEYS, passkeyDevice, supportsPasskeys, type PasskeyDevice } from '../lib/mfa'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { ghostBtnStyle } from '@/shared/ui/uiTokens'

// Tela do código do MFA: "Entrar com o celular" com a passkey de MFA. No
// computador o navegador mostra um QR para ler com a câmera do celular; no
// celular, Face ID ou digital. O código continua valendo. O `t` vem por prop
// porque a tela fica fora do LanguageProvider.

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string

export function MfaPasskeyOption({ t }: { t: Translate }) {
  const { hasPasskey, verifyMfaPasskey } = useAuth()
  const isMobile = useIsMobile()
  const [supported] = useState(() => MFA_PASSKEY_ENABLED && supportsPasskeys())
  const [coarsePointer] = useState(hasCoarsePointer)
  if (!hasPasskey || !supported) return null
  return <MfaPasskeyButton t={t} device={passkeyDevice(isMobile, coarsePointer)} onAuthenticate={verifyMfaPasskey} />
}

interface ButtonProps {
  t: Translate
  device: PasskeyDevice
  onAuthenticate: (device: PasskeyDevice) => Promise<{ error: string | null }>
}

export function MfaPasskeyButton({ t, device, onAuthenticate }: ButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const hintId = useId()
  // No computador a passkey está no celular: o navegador mostra o QR.
  const viaPhone = device === 'phone'

  const start = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    const { error: err } = await onAuthenticate(device)
    setBusy(false)
    if (err) setError(isPasskeyErrorKind(err) ? t(PASSKEY_ERROR_KEYS[err]) : t('mfa_error', { message: err }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
        <span aria-hidden="true" style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border)' }} />
        {t('mfa_passkey_or')}
        <span aria-hidden="true" style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border)' }} />
      </div>
      {/* aria-disabled em vez de disabled: o foco fica no botão enquanto espera. */}
      <button
        type="button"
        onClick={() => { void start() }}
        aria-disabled={busy}
        aria-describedby={hintId}
        style={{ ...ghostBtnStyle, width: '100%', justifyContent: 'center', padding: '11px', fontSize: 14, fontWeight: 600, color: 'var(--color-text)', cursor: busy ? 'progress' : 'pointer' }}
      >
        {viaPhone ? <QrCode size={16} aria-hidden="true" /> : <Fingerprint size={16} aria-hidden="true" />}
        {busy ? t('mfa_passkey_waiting') : t(viaPhone ? 'mfa_passkey_signin' : 'mfa_passkey_signin_mobile')}
      </button>
      <p id={hintId} style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>
        {t(viaPhone ? 'mfa_passkey_signin_hint' : 'mfa_passkey_signin_hint_mobile')}
      </p>
      {error && (
        <p role="alert" style={{ margin: 0, padding: '8px 12px', borderRadius: 8, fontSize: 13, color: 'var(--color-text)', backgroundColor: 'color-mix(in srgb, var(--color-error) 16%, var(--color-bg))' }}>
          {error}
        </p>
      )}
    </div>
  )
}
