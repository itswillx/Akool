import { useState } from 'react'
import { Camera, Check, ChevronDown, ChevronUp, Crop, LayoutDashboard, LayoutList, Moon, Sun, Trash2 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTheme } from '../../contexts/ThemeContext'
import { useLanguage } from '../../i18n/LanguageContext'
import type { Lang } from '../../i18n/translations'
import { AVATAR_COLORS } from '../../lib/avatar'
import { UserAvatar } from '@/shared/ui/UserAvatar'
import AvatarCropModal from '../AvatarCropModal'
import { FeedbackBanner, FieldLabel, OptionButton } from './settingsUi'
import { SOFT, inputStyle, submitBtnStyle } from './settingsTokens'
import { useAvatarUpload } from './useAvatarUpload'

// ARCH-008: aba de perfil das Configurações: avatar (emoji, cor, foto), nome,
// idioma, tema e a visão do painel financeiro.

// Escolhas que ficam legíveis no tamanho de um avatar (rostos, pessoas, símbolos).
const AVATAR_EMOJIS = [
  '😀', '😎', '🤓', '😇', '🥳', '🤠', '👻', '🤖',
  '🦊', '🐱', '🐶', '🐼', '🦁', '🐸', '🦉', '🐝',
  '🌟', '⚡', '🔥', '🌈', '🌻', '🍀', '🏗️', '🎯',
]

type Msg = { type: 'success' | 'error'; text: string }

/** Os campos do perfil que o formulário espelha, numa string comparável. */
const formSnapshot = (p: { display_name?: string | null; language?: Lang | null; avatar_emoji?: string | null; avatar_color?: string | null } | null) =>
  [p?.display_name ?? '', p?.language ?? 'pt-BR', p?.avatar_emoji ?? '', p?.avatar_color ?? ''].join('\u0000')

export default function ProfileTab() {
  const { user, profile, isAdmin, updateProfile } = useAuth()
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [language, setLanguage] = useState<Lang>(profile?.language ?? 'pt-BR')
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(profile?.avatar_emoji ?? null)
  const [avatarColor, setAvatarColor] = useState<string | null>(profile?.avatar_color ?? null)
  // A grade de emoji/cor nasce fechada para o cartão ficar curto.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  // O perfil pode chegar (ou mudar) com a aba aberta: o formulário acompanha
  // quando algum dos campos espelhados muda no servidor. Ajuste de estado
  // durante o render, como a documentação do React recomenda em vez de um
  // efeito; compara os valores, não o objeto, para não reiniciar à toa.
  const snapshot = formSnapshot(profile)
  const [synced, setSynced] = useState(snapshot)
  if (snapshot !== synced) {
    setSynced(snapshot)
    setDisplayName(profile?.display_name ?? '')
    setLanguage(profile?.language ?? 'pt-BR')
    setAvatarEmoji(profile?.avatar_emoji ?? null)
    setAvatarColor(profile?.avatar_color ?? null)
  }

  const avatar = useAvatarUpload(text => setMsg({ type: 'error', text }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    const { error } = await updateProfile({
      display_name: displayName.trim() || null,
      language,
      avatar_emoji: avatarEmoji,
      avatar_color: avatarColor,
    })
    setMsg(error ? { type: 'error', text: error } : { type: 'success', text: t('settings_saved') })
    setSaving(false)
  }

  const chipStyle = (busy: boolean, active = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '7px 11px', borderRadius: 8,
    border: '1px solid var(--color-border)', backgroundColor: active ? 'var(--color-active)' : 'var(--color-surface)', color: 'var(--color-text)',
    cursor: 'pointer', opacity: busy ? 0.6 : 1,
  })

  return (
    <>
      <form onSubmit={e => { void handleSave(e) }} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ padding: '14px 16px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <button type="button" onClick={() => setPickerOpen(o => !o)} title={t('settings_avatar_customize')} aria-label={t('settings_avatar_customize')}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}>
              <UserAvatar
                name={profile?.display_name || user?.email || '?'}
                seed={user?.email}
                emoji={avatarEmoji}
                color={avatarColor}
                url={profile?.avatar_url}
                size={52}
              />
            </button>
            <div>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                {profile?.display_name || user?.email?.split('@')[0]}
              </p>
              <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: isAdmin ? SOFT.amber.bg : 'var(--color-border)', color: isAdmin ? SOFT.amber.text : 'var(--color-text-muted)', display: 'inline-block', marginTop: 2 }}>
                {isAdmin ? t('settings_role_admin') : t('settings_role_standard')}
              </span>
            </div>
          </div>

          {/* A foto (quando há) vence o emoji/cor em todo lugar. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setPickerOpen(o => !o)} style={chipStyle(false, pickerOpen)}>
              {pickerOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              {t('settings_avatar_customize')}
            </button>
            <label style={chipStyle(avatar.busy)}>
              <Camera size={13} />
              {t('settings_avatar_photo')}
              <input type="file" accept="image/*" hidden disabled={avatar.busy}
                onChange={e => { avatar.pickPhoto(e.target.files?.[0] ?? null); e.target.value = '' }} />
            </label>
            {profile?.avatar_url && (
              <button type="button" onClick={() => { void avatar.adjustPhoto() }} disabled={avatar.busy} style={chipStyle(avatar.busy)}>
                <Crop size={13} />{t('settings_avatar_photo_adjust')}
              </button>
            )}
            {profile?.avatar_url && (
              <button type="button" onClick={() => { void avatar.removePhoto() }} disabled={avatar.busy} style={{ ...chipStyle(avatar.busy), color: 'var(--color-error)' }}>
                <Trash2 size={13} />{t('settings_avatar_photo_remove')}
              </button>
            )}
          </div>

          {pickerOpen && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('settings_avatar_emoji_hint')}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 10 }}>
                {AVATAR_EMOJIS.map(em => (
                  <button key={em} type="button" aria-pressed={avatarEmoji === em}
                    onClick={() => setAvatarEmoji(prev => (prev === em ? null : em))}
                    style={{ width: 28, height: 28, borderRadius: 7, fontSize: 15, lineHeight: 1, cursor: 'pointer', border: avatarEmoji === em ? '2px solid var(--color-text)' : '1px solid var(--color-border)', backgroundColor: avatarEmoji === em ? 'var(--color-active)' : 'transparent' }}>
                    {em}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {AVATAR_COLORS.map(c => (
                  <button aria-label={t('common_color', { color: c })} aria-pressed={avatarColor === c} key={c} type="button"
                    onClick={() => setAvatarColor(prev => (prev === c ? null : c))}
                    style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: avatarColor === c ? '2.5px solid var(--color-text)' : '1px solid var(--color-border)' }} />
                ))}
              </div>
            </div>
          )}
        </div>

        <FieldLabel label={t('settings_display_name')}>{control => (
          <input
            {...control}
            autoComplete="nickname"
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder={user?.email?.split('@')[0]}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = 'var(--color-text)')}
            onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
          />
        )}</FieldLabel>

        <FieldLabel label={t('settings_email')}>{control => (
          <input
            {...control}
            type="email"
            autoComplete="email"
            value={user?.email ?? ''}
            disabled
            style={{ ...inputStyle, backgroundColor: 'var(--color-input-disabled-bg)', color: 'var(--color-text-muted)', cursor: 'not-allowed' }}
          />
        )}</FieldLabel>

        <FieldLabel label={t('settings_language')}>
          <div style={{ display: 'flex', gap: 8 }}>
            <OptionButton selected={language === 'pt-BR'} onClick={() => setLanguage('pt-BR')} icon={<span style={{ fontSize: 16 }}>🇧🇷</span>} label={t('settings_lang_pt')} />
            <OptionButton selected={language === 'en'} onClick={() => setLanguage('en')} icon={<span style={{ fontSize: 16 }}>🇺🇸</span>} label={t('settings_lang_en')} />
          </div>
        </FieldLabel>

        <FieldLabel label={t('settings_theme')}>
          <div style={{ display: 'flex', gap: 8 }}>
            <OptionButton selected={theme === 'light'} onClick={() => setTheme('light')} icon={<Sun size={15} />} label={t('settings_theme_light')} />
            <OptionButton selected={theme === 'dark'} onClick={() => setTheme('dark')} icon={<Moon size={15} />} label={t('settings_theme_dark')} />
          </div>
        </FieldLabel>

        {/* Aplica na hora, como o tema (updateProfile atualiza o perfil de forma
            otimista), por isso fica fora do submit do formulário. */}
        <FieldLabel label={t('settings_fin_dashboard')}>
          <div style={{ display: 'flex', gap: 8 }}>
            <OptionButton
              selected={(profile?.finance_dashboard_view ?? 'detailed') === 'detailed'}
              onClick={() => { void updateProfile({ finance_dashboard_view: 'detailed' }) }}
              icon={<LayoutDashboard size={15} />}
              label={t('settings_fin_dashboard_detailed')}
            />
            <OptionButton
              selected={profile?.finance_dashboard_view === 'simple'}
              onClick={() => { void updateProfile({ finance_dashboard_view: 'simple' }) }}
              icon={<LayoutList size={15} />}
              label={t('settings_fin_dashboard_simple')}
            />
          </div>
        </FieldLabel>

        {msg && <FeedbackBanner type={msg.type} text={msg.text} />}

        <button type="submit" disabled={saving} style={submitBtnStyle(saving)}>
          {saving ? t('settings_saving') : <><Check size={14} /> {t('settings_save')}</>}
        </button>
      </form>
      {avatar.cropSource && (
        <AvatarCropModal imageSrc={avatar.cropSource.url} onClose={avatar.closeCrop} onSave={avatar.uploadCropped} />
      )}
    </>
  )
}
