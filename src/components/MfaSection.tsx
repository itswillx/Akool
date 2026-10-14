import { useCallback, useEffect, useId, useState } from 'react'
import { localeOf, type TranslationKey } from '../i18n/translations'
import { Fingerprint, Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import type { Factor, PasskeyListItem } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import {
  hasCoarsePointer, isInvalidTotpError, isTotpCode, PASSKEY_ERROR_KEYS, passkeyDevice, passkeyErrorKind, supportsPasskeys,
  TOTP_ISSUER, totpFriendlyName, type MfaError,
} from '../lib/mfa'
import { useLanguage } from '../i18n/LanguageContext'
import { MFA_PASSKEY_ENABLED } from '../lib/env'
import { useIsMobile } from '@/shared/hooks/useIsMobile'
import { ghostBtnStyle } from '@/shared/ui/uiTokens'
import MfaAuthenticatorSetup from './MfaAuthenticatorSetup'
import { FeedbackBanner } from './settings/settingsUi'

// SEC-004: ativação da verificação em duas etapas (TOTP). O login passa a
// pedir o código (MfaChallengePage) para quem tiver um fator verificado.
// Cada aparelho é um fator: com o MFA ativo dá para adicionar outro (celular
// novo, segundo app) e remover os antigos. A passkey de login ("Entrar com o
// celular" na tela do código) dispensa o código; só é oferecida a quem tem o app
// autenticador, porque é na tela do código que ela aparece.

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
const HINT_STYLE = { fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.45 } as const

interface FactorRowProps {
  label: string
  labelId: string
  describedBy: string
  armed: boolean
  buttonText: string
  busy: boolean
  /** Painel de cadastro aberto ou remoção travada. */
  blocked: boolean
  onClick: () => void
  onBlur: () => void
}

function FactorRow({ label, labelId, describedBy, armed, buttonText, busy, blocked, onClick, onBlur }: FactorRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)' }}>
      <span id={labelId} style={{ flex: 1, fontSize: 12.5, color: 'var(--color-text-muted)' }}>{label}</span>
      <button
        type="button"
        disabled={busy || blocked}
        aria-describedby={describedBy}
        onClick={onClick}
        onBlur={onBlur}
        style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${DANGER_BORDER}`, background: armed ? 'var(--color-error)' : 'transparent', color: armed ? 'var(--color-btn-primary-text)' : 'var(--color-error)', fontSize: 12, fontWeight: 600, cursor: busy ? 'wait' : blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.5 : 1 }}
      >
        {buttonText}
      </button>
    </div>
  )
}

export default function MfaSection() {
  const { t, lang } = useLanguage()
  const isMobile = useIsMobile()
  const [factors, setFactors] = useState<Factor[]>([])
  const [passkeys, setPasskeys] = useState<PasskeyListItem[]>([])
  // Até a lista chegar, nada de "Desativada" nem do botão de ativar piscando
  // para quem já tem MFA.
  const [loaded, setLoaded] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [passkeyPending, setPasskeyPending] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [webauthn] = useState(() => MFA_PASSKEY_ENABLED && supportsPasskeys())
  const [coarsePointer] = useState(hasCoarsePointer)
  const rowIdBase = useId()
  const passkeyTitleId = useId()
  const device = passkeyDevice(isMobile, coarsePointer)

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
  const reloadPasskeys = useCallback(async () => {
    const { data } = await supabase.auth.passkey.list()
    setPasskeys(data ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    void supabase.auth.mfa.listFactors().then(result => { if (!cancelled) applyFactors(result) })
    // Passkeys de login só com a flag ligada e navegador compatível.
    if (webauthn) void supabase.auth.passkey.list().then(({ data }) => { if (!cancelled) setPasskeys(data ?? []) })
    return () => { cancelled = true }
  }, [applyFactors, webauthn])

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

  const addPasskey = async () => {
    setBusy(true)
    setPasskeyPending(true)
    setMessage(null)
    // Nada de rede antes: o navegador só abre a passkey perto do clique. O
    // Supabase dá à passkey o nome do provedor (Senhas do iCloud, Google…).
    const { error } = await supabase.auth.registerPasskey()
    setBusy(false)
    setPasskeyPending(false)
    if (error) {
      const kind = passkeyErrorKind(error)
      setMessage({ kind: 'error', text: kind ? t(PASSKEY_ERROR_KEYS[kind]) : errorText(error) })
      return
    }
    setMessage({ kind: 'ok', text: t('mfa_passkey_added_ok') })
    await reloadPasskeys()
  }

  const removePasskey = async (passkeyId: string) => {
    setConfirmRemove(null)
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.passkey.delete({ passkeyId })
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) })
      return
    }
    setMessage({ kind: 'ok', text: t('mfa_passkey_removed_ok') })
    await reloadPasskeys()
  }

  const removeFactor = async (factorId: string, okKey: TranslationKey) => {
    setConfirmRemove(null)
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: errorText(error) })
      return
    }
    setMessage({ kind: 'ok', text: t(okKey) })
    await reload()
  }

  const enabled = factors.length > 0
  const several = factors.length > 1
  const statusColor = enabled ? 'var(--color-success)' : 'var(--color-text-muted)'
  const locale = localeOf(lang)
  const dateTime = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
  const armRemove = (factorId: string, okKey: TranslationKey) => (
    confirmRemove === factorId ? void removeFactor(factorId, okKey) : setConfirmRemove(factorId)
  )
  const disarm = (factorId: string) => setConfirmRemove(id => (id === factorId ? null : id))

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
        return (
          <FactorRow
            key={f.id}
            label={several
              ? t('mfa_device_row', { n: i + 1, date: dateTime(f.created_at) })
              : t('mfa_factor_added', { date: new Date(f.created_at).toLocaleDateString(locale) })}
            labelId={labelId}
            describedBy={labelId}
            armed={armed}
            buttonText={several
              ? (armed ? t('mfa_remove_device_confirm') : t('mfa_remove_device'))
              : (armed ? t('mfa_remove_confirm') : t('mfa_remove'))}
            busy={busy}
            blocked={!!enrollment}
            onClick={() => armRemove(f.id, several ? 'mfa_device_removed_ok' : 'mfa_removed_ok')}
            onBlur={() => disarm(f.id)}
          />
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
            {busy && !passkeyPending ? t('mfa_enabling') : t('mfa_add_device')}
          </button>
          <span style={HINT_STYLE}>{t('mfa_add_device_hint')}</span>
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

      {/* Passkeys de login: as linhas aparecem sempre que houver (para poder
          remover); o botão de adicionar só com app autenticador, a flag e
          navegador compatível. */}
      {loaded && (passkeys.length > 0 || (webauthn && factors.length > 0)) && (
        <div role="group" aria-labelledby={passkeyTitleId} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6, borderTop: '1px solid var(--color-border)' }}>
          <div id={passkeyTitleId} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', paddingTop: 8 }}>{t('mfa_passkey_title')}</div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('mfa_passkey_intro')}</p>
          {passkeys.map((f, i) => {
            const labelId = `${rowIdBase}-${f.id}`
            const armed = confirmRemove === f.id
            return (
              <FactorRow
                key={f.id}
                label={f.friendly_name
                  ? t('mfa_passkey_row_named', { name: f.friendly_name, date: dateTime(f.created_at) })
                  : passkeys.length > 1
                    ? t('mfa_passkey_row_n', { n: i + 1, date: dateTime(f.created_at) })
                    : t('mfa_passkey_row', { date: dateTime(f.created_at) })}
                labelId={labelId}
                describedBy={labelId}
                armed={armed}
                buttonText={armed ? t('mfa_remove_device_confirm') : t('mfa_remove_device')}
                busy={busy}
                blocked={!!enrollment}
                onClick={() => (armed ? void removePasskey(f.id) : setConfirmRemove(f.id))}
                onBlur={() => disarm(f.id)}
              />
            )
          })}
          {webauthn && factors.length > 0 && !enrollment && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                type="button"
                onClick={() => { void addPasskey() }}
                disabled={busy}
                style={{ ...ghostBtnStyle, justifyContent: 'center', color: 'var(--color-text)', fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
              >
                <Fingerprint size={14} />
                {passkeyPending ? t('mfa_passkey_waiting') : t('mfa_passkey_add')}
              </button>
              <span style={HINT_STYLE}>{t(device === 'this' ? 'mfa_passkey_add_hint_mobile' : 'mfa_passkey_add_hint')}</span>
            </div>
          )}
        </div>
      )}

      {message && <FeedbackBanner type={message.kind === 'ok' ? 'success' : 'error'} text={message.text} />}
    </div>
  )
}
