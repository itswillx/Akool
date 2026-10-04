import { useCallback, useEffect, useId, useState } from 'react'
import { localeOf } from '../i18n/translations'
import { Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import type { Factor } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isInvalidTotpError, isTotpCode, TOTP_ISSUER, totpFriendlyName, type MfaError } from '../lib/mfa'
import { useLanguage } from '../i18n/LanguageContext'
import { ghostBtnStyle } from '@/shared/ui/uiTokens'
import MfaAuthenticatorSetup from './MfaAuthenticatorSetup'
import { FeedbackBanner } from './settings/settingsUi'

// SEC-004: ativação da verificação em duas etapas (TOTP). O login passa a
// pedir o código (MfaChallengePage) para quem tiver um fator verificado.
// Cada aparelho é um fator: com o MFA ativo dá para adicionar outro (celular
// novo, segundo app) e remover os antigos.

type ListFactorsResult = Awaited<ReturnType<typeof supabase.auth.mfa.listFactors>>

interface Enrollment {
  /** `add`: já havia fator verificado, então é outro aparelho. */
  mode: 'first' | 'add'
  factorId: string
  uri: string
  qrCode: string
  secret: string
}

const DANGER_BORDER = 'color-mix(in srgb, var(--color-error) 40%, transparent)'

export default function MfaSection() {
  const { t, lang } = useLanguage()
  const [factors, setFactors] = useState<Factor[]>([])
  // Até a lista chegar, nada de "Desativada" nem do botão de ativar piscando
  // para quem já tem MFA.
  const [loaded, setLoaded] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const rowIdBase = useId()

  // Quem já tem MFA só mexe nos aparelhos com a sessão em AAL2 (código digitado).
  const errorText = useCallback((error: MfaError) => (
    error.code === 'insufficient_aal' ? t('mfa_need_aal2') : t('mfa_error', { message: error.message })
  ), [t])

  const applyFactors = useCallback(({ data, error }: ListFactorsResult) => {
    setLoaded(true)
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) })
      return
    }
    // `totp` traz só os fatores já verificados.
    setFactors(data?.totp ?? [])
  }, [errorText])

  const reload = useCallback(async () => { applyFactors(await supabase.auth.mfa.listFactors()) }, [applyFactors])

  useEffect(() => {
    let cancelled = false
    void supabase.auth.mfa.listFactors().then(result => { if (!cancelled) applyFactors(result) })
    return () => { cancelled = true }
  }, [applyFactors])

  const startEnrollment = async () => {
    setBusy(true)
    setMessage(null)
    // Tentativas abandonadas deixam fatores `unverified`; limpa antes de criar outro.
    const { data: current } = await supabase.auth.mfa.listFactors()
    for (const stale of (current?.all ?? []).filter(f => f.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id })
    }
    const verifiedCount = (current?.totp ?? factors).length
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      issuer: TOTP_ISSUER,
      friendlyName: totpFriendlyName(new Date()),
    })
    setBusy(false)
    if (error || !data) {
      setMessage({ kind: 'error', text: error ? errorText(error) : t('mfa_error', { message: 'enroll' }) })
      return
    }
    setEnrollment({
      mode: verifiedCount > 0 ? 'add' : 'first',
      factorId: data.id,
      uri: data.totp.uri,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    })
    setCode('')
  }

  const confirmEnrollment = async () => {
    if (!enrollment) return
    if (!isTotpCode(code)) {
      setMessage({ kind: 'error', text: t('mfa_invalid_code') })
      return
    }
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code: code.trim() })
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: isInvalidTotpError(error) ? t('mfa_invalid_code') : errorText(error) })
      return
    }
    setEnrollment(null)
    setCode('')
    setMessage({ kind: 'ok', text: t(enrollment.mode === 'add' ? 'mfa_device_added_ok' : 'mfa_enabled_ok') })
    await reload()
  }

  const cancelEnrollment = async () => {
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
    setEnrollment(null)
    setCode('')
    setMessage(null)
  }

  const removeFactor = async (factorId: string) => {
    const wasLast = factors.length <= 1
    setConfirmRemove(null)
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) })
      return
    }
    setMessage({ kind: 'ok', text: t(wasLast ? 'mfa_removed_ok' : 'mfa_device_removed_ok') })
    await reload()
  }

  const enabled = factors.length > 0
  const several = factors.length > 1
  const statusColor = enabled ? 'var(--color-success)' : 'var(--color-text-muted)'
  const locale = localeOf(lang)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {enabled ? <ShieldCheck size={20} color={statusColor} /> : <ShieldOff size={20} color={statusColor} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{t('mfa_title')}</div>
          {loaded && <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{enabled ? t('mfa_status_on') : t('mfa_status_off')}</span>}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('mfa_intro')}</p>

      {factors.map((f, i) => {
        const labelId = `${rowIdBase}-${f.id}`
        const armed = confirmRemove === f.id
        const added = new Date(f.created_at)
        return (
          <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
            <span id={labelId} style={{ flex: 1, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              {several
                ? t('mfa_device_row', { n: i + 1, date: added.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })
                : t('mfa_factor_added', { date: added.toLocaleDateString(locale) })}
            </span>
            <button
              type="button"
              disabled={busy || !!enrollment}
              aria-describedby={labelId}
              onClick={() => (armed ? void removeFactor(f.id) : setConfirmRemove(f.id))}
              onBlur={() => setConfirmRemove(id => (id === f.id ? null : id))}
              style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${DANGER_BORDER}`, background: armed ? 'var(--color-error)' : 'transparent', color: armed ? 'var(--color-btn-primary-text)' : 'var(--color-error)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : enrollment ? 'not-allowed' : 'pointer', opacity: enrollment ? 0.5 : 1 }}
            >
              {several
                ? (armed ? t('mfa_remove_device_confirm') : t('mfa_remove_device'))
                : (armed ? t('mfa_remove_confirm') : t('mfa_remove'))}
            </button>
          </div>
        )
      })}

      {loaded && !enabled && !enrollment && (
        <button
          type="button"
          onClick={() => { void startEnrollment() }}
          disabled={busy}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
        >
          <ShieldCheck size={14} />
          {busy ? t('mfa_enabling') : t('mfa_enable')}
        </button>
      )}

      {loaded && enabled && !enrollment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            onClick={() => { void startEnrollment() }}
            disabled={busy}
            style={{ ...ghostBtnStyle, justifyContent: 'center', color: 'var(--color-text)', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            <Plus size={14} />
            {busy ? t('mfa_enabling') : t('mfa_add_device')}
          </button>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45 }}>{t('mfa_add_device_hint')}</span>
        </div>
      )}

      {enrollment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--color-border)' }}>
          <MfaAuthenticatorSetup key={enrollment.factorId} uri={enrollment.uri} qrCode={enrollment.qrCode} secret={enrollment.secret} adding={enrollment.mode === 'add'} />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
            {t('mfa_code_label')}
            <input
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              className="keep-font-size"
              style={{ padding: '9px 12px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 18, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'monospace', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { void cancelEnrollment() }} disabled={busy} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}>
              {t('mfa_cancel')}
            </button>
            <button type="button" onClick={() => { void confirmEnrollment() }} disabled={busy || !isTotpCode(code)} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: isTotpCode(code) ? 1 : 0.5 }}>
              {busy ? t('mfa_verifying') : t('mfa_verify')}
            </button>
          </div>
        </div>
      )}

      {message && <FeedbackBanner type={message.kind === 'ok' ? 'success' : 'error'} text={message.text} />}
    </div>
  )
}
