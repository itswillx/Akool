import { useCallback, useEffect, useState } from 'react'
import { localeOf } from '../i18n/translations'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import type { Factor } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { isTotpCode } from '../lib/mfa'
import { useLanguage } from '../i18n/LanguageContext'

// SEC-004: ativação da verificação em duas etapas (TOTP). O login passa a
// pedir o código (MfaChallengePage) para quem tiver um fator verificado.

type ListFactorsResult = Awaited<ReturnType<typeof supabase.auth.mfa.listFactors>>

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

export default function MfaSection() {
  const { t, lang } = useLanguage()
  const [factors, setFactors] = useState<Factor[]>([])
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const errorText = useCallback((msg: string) => t('mfa_error').replace('{message}', msg), [t])

  const applyFactors = useCallback(({ data, error }: ListFactorsResult) => {
    if (error) {
      setMessage({ kind: 'error', text: errorText(error.message) })
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
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Akool ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    })
    setBusy(false)
    if (error || !data) {
      setMessage({ kind: 'error', text: errorText(error?.message ?? 'enroll') })
      return
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
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
      setMessage({ kind: 'error', text: t('mfa_invalid_code') })
      return
    }
    setEnrollment(null)
    setCode('')
    setMessage({ kind: 'ok', text: t('mfa_enabled_ok') })
    await reload()
  }

  const cancelEnrollment = async () => {
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
    setEnrollment(null)
    setCode('')
    setMessage(null)
  }

  const removeFactor = async (factorId: string) => {
    setConfirmRemove(null)
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: errorText(error.message) })
      return
    }
    setMessage({ kind: 'ok', text: t('mfa_removed_ok') })
    await reload()
  }

  const enabled = factors.length > 0
  const statusColor = enabled ? '#22c55e' : '#94a3b8'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {enabled ? <ShieldCheck size={20} color={statusColor} /> : <ShieldOff size={20} color={statusColor} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{t('mfa_title')}</div>
          <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{enabled ? t('mfa_status_on') : t('mfa_status_off')}</span>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('mfa_intro')}</p>

      {factors.map(f => (
        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {t('mfa_factor_added').replace('{date}', new Date(f.created_at).toLocaleDateString(localeOf(lang)))}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => (confirmRemove === f.id ? void removeFactor(f.id) : setConfirmRemove(f.id))}
            onBlur={() => setConfirmRemove(id => (id === f.id ? null : id))}
            style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ef444466', background: confirmRemove === f.id ? '#ef4444' : 'transparent', color: confirmRemove === f.id ? '#fff' : '#ef4444', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
          >
            {confirmRemove === f.id ? t('mfa_remove_confirm') : t('mfa_remove')}
          </button>
        </div>
      ))}

      {!enabled && !enrollment && (
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

      {enrollment && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 10, border: '1px solid var(--color-border)' }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', lineHeight: 1.5 }}>{t('mfa_scan')}</p>
          <img src={enrollment.qrCode} alt={t('mfa_qr_alt')} width={180} height={180} style={{ alignSelf: 'center', backgroundColor: '#fff', padding: 8, borderRadius: 8 }} />
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 4 }}>{t('mfa_secret_label')}</div>
            <code style={{ display: 'block', overflowWrap: 'anywhere', fontSize: 12.5, padding: '6px 8px', borderRadius: 6, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{enrollment.secret}</code>
          </div>
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

      {message && (
        <div role={message.kind === 'error' ? 'alert' : 'status'} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, backgroundColor: message.kind === 'error' ? '#ef444418' : '#22c55e18', color: message.kind === 'error' ? '#ef4444' : '#22c55e' }}>
          {message.text}
        </div>
      )}
    </div>
  )
}
