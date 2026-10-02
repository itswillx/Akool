import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { isPasswordValid } from '../../lib/passwordPolicy'
import { PasswordInput, PasswordStrengthMeter } from '../PasswordFields'
import { FeedbackBanner, FieldLabel } from './settingsUi'
import { submitBtnStyle } from './settingsTokens'

// ARCH-008: aba de senha das Configurações. A troca reautentica num cliente
// à parte (AuthContext.changePassword) e devolve códigos conhecidos de erro.

type Msg = { type: 'success' | 'error'; text: string }

export default function PasswordTab() {
  const { changePassword } = useAuth()
  const { t } = useLanguage()
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (!isPasswordValid(newPwd)) { setMsg({ type: 'error', text: t('settings_pwd_short') }); return }
    if (newPwd !== confirmPwd) { setMsg({ type: 'error', text: t('settings_pwd_mismatch') }); return }
    setLoading(true)
    const { error } = await changePassword(currentPwd, newPwd)
    if (error === 'wrong_password') setMsg({ type: 'error', text: t('settings_pwd_wrong') })
    else if (error === 'same_password') setMsg({ type: 'error', text: t('settings_pwd_same') })
    else if (error === 'weak_password') setMsg({ type: 'error', text: t('auth_password_weak') })
    else if (error) setMsg({ type: 'error', text: error })
    else {
      setMsg({ type: 'success', text: t('settings_pwd_changed') })
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    }
    setLoading(false)
  }

  const incomplete = !currentPwd || !newPwd || !confirmPwd

  return (
    <form onSubmit={e => { void handleSubmit(e) }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <FieldLabel label={t('settings_current_password')}>{control => (
        <PasswordInput control={control} autoComplete="current-password" t={t} value={currentPwd} onChange={setCurrentPwd} show={showCurrent} onToggleShow={() => setShowCurrent(v => !v)} placeholder="••••••••" />
      )}</FieldLabel>

      <FieldLabel label={t('settings_new_password')}>{control => (
        <PasswordInput control={control} autoComplete="new-password" t={t} value={newPwd} onChange={setNewPwd} show={showNew} onToggleShow={() => setShowNew(v => !v)} placeholder={t('settings_password_min')} />
      )}</FieldLabel>

      {newPwd.length > 0 && <PasswordStrengthMeter password={newPwd} t={t} />}

      <FieldLabel label={t('settings_confirm_password')}>{control => (
        <PasswordInput control={control} autoComplete="new-password" t={t} value={confirmPwd} onChange={setConfirmPwd} show={showConfirm} onToggleShow={() => setShowConfirm(v => !v)} placeholder={t('settings_password_repeat')} />
      )}</FieldLabel>

      {msg && <FeedbackBanner type={msg.type} text={msg.text} />}

      <button type="submit" disabled={loading || incomplete} style={submitBtnStyle(loading || incomplete)}>
        {loading ? t('settings_changing') : <><Lock size={14} /> {t('settings_change_password')}</>}
      </button>
    </form>
  )
}
