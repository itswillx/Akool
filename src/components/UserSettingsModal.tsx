import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react'
import { X, User, Lock, Check, Sun, Moon, Gift, Copy, CheckCheck, Users, Database, LogOut, Camera, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { PasswordInput, PasswordStrengthMeter } from './PasswordFields'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { supabase } from '../lib/supabase'
import { AVATAR_BUCKET, UserAvatar } from './UserAvatar'
import { AVATAR_COLORS } from '../lib/avatar'
import type { Lang } from '../i18n/translations'

// Curated picks that read well at avatar sizes (faces, people, symbols).
const AVATAR_EMOJIS = [
  '😀', '😎', '🤓', '😇', '🥳', '🤠', '👻', '🤖',
  '🦊', '🐱', '🐶', '🐼', '🦁', '🐸', '🦉', '🐝',
  '🌟', '⚡', '🔥', '🌈', '🌻', '🍀', '🏗️', '🎯',
]

const UserManagementPanel = lazy(() => import('./UserManagementPanel'))
const BackupPanel = lazy(() => import('../modules/backup'))

interface Props {
  open: boolean
  onClose: () => void
}

type Tab = 'profile' | 'password' | 'invites' | 'users' | 'backup'

interface InviteCode {
  id: string
  code: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by: string | null
  used_by_email?: string | null
}

export default function UserSettingsModal({ open, onClose }: Props) {
  const { user, profile, isAdmin, changePassword, updateProfile, refreshProfile, signOut } = useAuth()
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const [tab, setTab] = useState<Tab>('profile')
  const overlayRef = useRef<HTMLDivElement>(null)

  // Profile tab state
  const [displayName, setDisplayName] = useState('')
  const [language, setLanguage] = useState<Lang>('pt-BR')
  const [avatarEmoji, setAvatarEmoji] = useState<string | null>(null)
  const [avatarColor, setAvatarColor] = useState<string | null>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  // The emoji/color grid is collapsed by default so the profile card stays
  // short; the avatar preview and the customize button both toggle it.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Password tab state
  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pwdLoading, setPwdLoading] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Invites tab state
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true)
    const { data } = await supabase
      .from('invite_codes')
      .select('id, code, created_at, expires_at, used_at, used_by')
      .order('created_at', { ascending: false })
    const codes = (data ?? []) as InviteCode[]
    const usedByIds = codes.map(c => c.used_by).filter(Boolean) as string[]
    if (usedByIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', usedByIds)
      const emailMap: Record<string, string> = {}
      ;(profiles ?? []).forEach((p: { id: string; email: string }) => { emailMap[p.id] = p.email })
      codes.forEach(c => { if (c.used_by) c.used_by_email = emailMap[c.used_by] ?? null })
    }
    setInvites(codes)
    setInvitesLoading(false)
  }, [])

  // Reset only when the modal OPENS. This must NOT depend on `profile`:
  // changePassword re-authenticates, which fires SIGNED_IN → loadProfile →
  // new profile object — depending on it here reset the tab back to
  // "profile" mid password change and swallowed the feedback message.
  useEffect(() => {
    if (open) {
      setTab('profile')
      setProfileMsg(null)
      setPwdMsg(null)
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    }
  }, [open])

  // Keep the profile form in sync with the loaded profile (it may arrive
  // after the modal is already open) without touching the active tab.
  useEffect(() => {
    if (open) {
      setDisplayName(profile?.display_name ?? '')
      setLanguage(profile?.language ?? 'pt-BR')
      setAvatarEmoji(profile?.avatar_emoji ?? null)
      setAvatarColor(profile?.avatar_color ?? null)
    } else {
      setPickerOpen(false)
    }
  }, [open, profile])

  // Photo actions are self-contained (not part of the form submit): the object
  // upload and the profile column change move together, so a picked photo can
  // never end up orphaned in the bucket by closing the modal without saving.
  const handlePhotoPick = async (file: File | null) => {
    if (!file || !user || !file.type.startsWith('image/')) return
    setAvatarBusy(true)
    const previous = profile?.avatar_url ?? null
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file)
    if (upErr) {
      setProfileMsg({ type: 'error', text: upErr.message })
    } else {
      const { error } = await updateProfile({ avatar_url: path })
      if (error) setProfileMsg({ type: 'error', text: error })
      else if (previous) await supabase.storage.from(AVATAR_BUCKET).remove([previous])
    }
    setAvatarBusy(false)
  }

  const handlePhotoRemove = async () => {
    if (!profile?.avatar_url) return
    setAvatarBusy(true)
    const { error } = await updateProfile({ avatar_url: null })
    if (error) setProfileMsg({ type: 'error', text: error })
    else await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_url])
    setAvatarBusy(false)
  }

  useEffect(() => {
    if (open && tab === 'invites') loadInvites()
  }, [open, tab, loadInvites])

  const handleGenerateInvite = async () => {
    setGenerating(true)
    const { error } = await supabase.rpc('generate_invite_code')
    if (!error) {
      await loadInvites()
      await refreshProfile()
    }
    setGenerating(false)
  }

  const handleCopy = (code: InviteCode) => {
    navigator.clipboard.writeText(code.code)
    setCopiedId(code.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const getInviteStatus = (inv: InviteCode): 'pending' | 'used' | 'expired' => {
    if (inv.used_at) return 'used'
    if (new Date(inv.expires_at) < new Date()) return 'expired'
    return 'pending'
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose()
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileLoading(true)
    setProfileMsg(null)
    const { error } = await updateProfile({
      display_name: displayName.trim() || null,
      language,
      avatar_emoji: avatarEmoji,
      avatar_color: avatarColor,
    })
    setProfileMsg(error ? { type: 'error', text: error } : { type: 'success', text: t('settings_saved') })
    setProfileLoading(false)
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdMsg(null)
    if (newPwd.length < 6) { setPwdMsg({ type: 'error', text: t('settings_pwd_short') }); return }
    if (newPwd !== confirmPwd) { setPwdMsg({ type: 'error', text: t('settings_pwd_mismatch') }); return }
    setPwdLoading(true)
    const { error } = await changePassword(currentPwd, newPwd)
    if (error === 'wrong_password') { setPwdMsg({ type: 'error', text: t('settings_pwd_wrong') }) }
    else if (error === 'same_password') { setPwdMsg({ type: 'error', text: t('settings_pwd_same') }) }
    else if (error === 'weak_password') { setPwdMsg({ type: 'error', text: t('auth_password_weak') }) }
    else if (error) { setPwdMsg({ type: 'error', text: error }) }
    else {
      setPwdMsg({ type: 'success', text: t('settings_pwd_changed') })
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    }
    setPwdLoading(false)
  }

  if (!open) return null

  // The Users/Backup admin panels need a much wider, taller shell than the
  // account tabs, which stay compact.
  const wideTab = tab === 'users' || tab === 'backup'

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 24 }}
    >
      <div style={{ backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.24)', width: '100%', maxWidth: wideTab ? (isMobile ? '100%' : 980) : 460, height: wideTab ? 'calc(100dvh - 48px)' : undefined, maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Modal header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('settings_title')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{user?.email}</p>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="finance-hide-scrollbar" style={{ display: 'flex', gap: 3, padding: '16px 24px 0', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon={<User size={13} />} label={t('settings_tab_profile')} />
          <TabBtn active={tab === 'password'} onClick={() => setTab('password')} icon={<Lock size={13} />} label={t('settings_tab_password')} />
          <TabBtn active={tab === 'invites'} onClick={() => setTab('invites')} icon={<Gift size={13} />} label={t('settings_tab_invites')} />
          {isAdmin && <TabBtn active={tab === 'users'} onClick={() => setTab('users')} icon={<Users size={13} />} label={t('sidebar_users')} />}
          {isAdmin && <TabBtn active={tab === 'backup'} onClick={() => setTab('backup')} icon={<Database size={13} />} label={t('sidebar_backup')} />}
        </div>

        {/* Divider */}
        <div style={{ height: 1, backgroundColor: 'var(--color-border)', margin: '12px 0 0' }} />

        <div style={wideTab
          ? { flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }
          : { padding: '20px 24px 24px', overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {tab === 'users' && (
            <Suspense fallback={<PanelFallback />}><UserManagementPanel /></Suspense>
          )}
          {tab === 'backup' && (
            <Suspense fallback={<PanelFallback />}><BackupPanel /></Suspense>
          )}
          {/* Profile tab */}
          {tab === 'profile' && (
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Avatar picker: live preview + emoji grid + color swatches + photo */}
              <div style={{ padding: '14px 16px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                  <button type="button" onClick={() => setPickerOpen(o => !o)} title={t('settings_avatar_customize')}
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
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: isAdmin ? '#fef3c7' : 'var(--color-border)', color: isAdmin ? '#d97706' : 'var(--color-text-muted)', display: 'inline-block', marginTop: 2 }}>
                      {isAdmin ? t('settings_role_admin') : t('settings_role_standard')}
                    </span>
                  </div>
                </div>

                {/* The photo (when set) wins over emoji/color in every render. */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => setPickerOpen(o => !o)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: pickerOpen ? 'var(--color-active)' : 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer' }}>
                    {pickerOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    {t('settings_avatar_customize')}
                  </button>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', opacity: avatarBusy ? 0.6 : 1 }}>
                    <Camera size={13} />
                    {t('settings_avatar_photo')}
                    <input type="file" accept="image/*" hidden disabled={avatarBusy}
                      onChange={e => { handlePhotoPick(e.target.files?.[0] ?? null); e.target.value = '' }} />
                  </label>
                  {profile?.avatar_url && (
                    <button type="button" onClick={handlePhotoRemove} disabled={avatarBusy}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '7px 11px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-error)', cursor: 'pointer', opacity: avatarBusy ? 0.6 : 1 }}>
                      <Trash2 size={13} />{t('settings_avatar_photo_remove')}
                    </button>
                  )}
                </div>

                {pickerOpen && (
                  <div style={{ marginTop: 12 }}>
                    <p style={{ margin: '0 0 6px', fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>{t('settings_avatar_emoji_hint')}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 10 }}>
                      {AVATAR_EMOJIS.map(em => (
                        <button key={em} type="button"
                          onClick={() => setAvatarEmoji(prev => (prev === em ? null : em))}
                          style={{ width: 28, height: 28, borderRadius: 7, fontSize: 15, lineHeight: 1, cursor: 'pointer', border: avatarEmoji === em ? '2px solid var(--color-text)' : '1px solid var(--color-border)', backgroundColor: avatarEmoji === em ? 'var(--color-active)' : 'transparent' }}>
                          {em}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {AVATAR_COLORS.map(c => (
                        <button key={c} type="button"
                          onClick={() => setAvatarColor(prev => (prev === c ? null : c))}
                          style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: avatarColor === c ? '2.5px solid var(--color-text)' : '1px solid var(--color-border)' }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <FieldLabel label={t('settings_display_name')}>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder={user?.email?.split('@')[0]}
                  style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = 'var(--color-text)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
                />
              </FieldLabel>

              <FieldLabel label={t('settings_email')}>
                <input
                  type="email"
                  value={user?.email ?? ''}
                  disabled
                  style={{ ...inputStyle, backgroundColor: 'var(--color-input-disabled-bg)', color: 'var(--color-text-muted)', cursor: 'not-allowed' }}
                />
              </FieldLabel>

              {/* Language picker */}
              <FieldLabel label={t('settings_language')}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <LangOption
                    selected={language === 'pt-BR'}
                    onClick={() => setLanguage('pt-BR')}
                    flag="🇧🇷"
                    label={t('settings_lang_pt')}
                  />
                  <LangOption
                    selected={language === 'en'}
                    onClick={() => setLanguage('en')}
                    flag="🇺🇸"
                    label={t('settings_lang_en')}
                  />
                </div>
              </FieldLabel>

              {/* Theme picker */}
              <FieldLabel label={t('settings_theme')}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <ThemeOption
                    selected={theme === 'light'}
                    onClick={() => setTheme('light')}
                    icon={<Sun size={15} />}
                    label={t('settings_theme_light')}
                  />
                  <ThemeOption
                    selected={theme === 'dark'}
                    onClick={() => setTheme('dark')}
                    icon={<Moon size={15} />}
                    label={t('settings_theme_dark')}
                  />
                </div>
              </FieldLabel>

              {profileMsg && <FeedbackBanner type={profileMsg.type} text={profileMsg.text} />}

              <button
                type="submit"
                disabled={profileLoading}
                style={submitBtnStyle(profileLoading)}
              >
                {profileLoading ? t('settings_saving') : <><Check size={14} /> {t('settings_save')}</>}
              </button>
            </form>
          )}

          {/* Password tab */}
          {tab === 'password' && (
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <FieldLabel label={t('settings_current_password')}>
                <PasswordInput
                  value={currentPwd}
                  onChange={setCurrentPwd}
                  show={showCurrent}
                  onToggleShow={() => setShowCurrent(v => !v)}
                  placeholder="••••••••"
                />
              </FieldLabel>

              <FieldLabel label={t('settings_new_password')}>
                <PasswordInput
                  value={newPwd}
                  onChange={setNewPwd}
                  show={showNew}
                  onToggleShow={() => setShowNew(v => !v)}
                  placeholder={t('settings_password_min')}
                />
              </FieldLabel>

              {newPwd.length > 0 && (
                <PasswordStrengthMeter password={newPwd} t={t} />
              )}

              <FieldLabel label={t('settings_confirm_password')}>
                <PasswordInput
                  value={confirmPwd}
                  onChange={setConfirmPwd}
                  show={showConfirm}
                  onToggleShow={() => setShowConfirm(v => !v)}
                  placeholder={t('settings_password_repeat')}
                />
              </FieldLabel>

              {pwdMsg && <FeedbackBanner type={pwdMsg.type} text={pwdMsg.text} />}

              <button
                type="submit"
                disabled={pwdLoading || !currentPwd || !newPwd || !confirmPwd}
                style={submitBtnStyle(pwdLoading || !currentPwd || !newPwd || !confirmPwd)}
              >
                {pwdLoading ? t('settings_changing') : <><Lock size={14} /> {t('settings_change_password')}</>}
              </button>
            </form>
          )}
          {/* Invites tab */}
          {tab === 'invites' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Slot counter */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', backgroundColor: 'var(--color-bg-secondary)', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: (profile?.role === 'admin' || (profile?.invite_slots_remaining ?? 0) > 0) ? '#dcfce7' : 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: (profile?.role === 'admin' || (profile?.invite_slots_remaining ?? 0) > 0) ? '#16a34a' : 'var(--color-text-muted)', flexShrink: 0 }}>
                    <Gift size={17} />
                  </div>
                  <div>
                    {profile?.role === 'admin' ? (
                      <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#16a34a' }}>∞ {t('settings_tab_invites')}</p>
                    ) : (
                      <>
                        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                          {(profile?.invite_slots_remaining ?? 0) === 1
                            ? t('settings_invites_slots_available', { n: 1 })
                            : t('settings_invites_slots_available_plural', { n: profile?.invite_slots_remaining ?? 0 })}
                        </p>
                        {(profile?.invite_slots_remaining ?? 0) === 0 && (
                          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('settings_invites_no_slots')}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={generating || (profile?.role !== 'admin' && (profile?.invite_slots_remaining ?? 0) <= 0)}
                  onClick={handleGenerateInvite}
                  style={{ padding: '7px 14px', borderRadius: 8, border: 'none', cursor: generating || (profile?.role !== 'admin' && (profile?.invite_slots_remaining ?? 0) <= 0) ? 'not-allowed' : 'pointer', backgroundColor: generating || (profile?.role !== 'admin' && (profile?.invite_slots_remaining ?? 0) <= 0) ? 'var(--color-btn-disabled)' : 'var(--color-btn-primary)', color: generating || (profile?.role !== 'admin' && (profile?.invite_slots_remaining ?? 0) <= 0) ? 'var(--color-btn-disabled-text)' : 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}
                >
                  {generating ? t('settings_invites_generating') : <><Gift size={13} />{t('settings_invites_generate_btn')}</>}
                </button>
              </div>

              {/* Invite codes list */}
              {invitesLoading ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>{t('settings_invites_loading')}</p>
              ) : invites.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>{t('settings_invites_empty')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {invites.map(inv => {
                    const status = getInviteStatus(inv)
                    const statusColors: Record<string, { bg: string; text: string }> = {
                      pending: { bg: '#dcfce7', text: '#15803d' },
                      used:    { bg: '#e0e7ff', text: '#4338ca' },
                      expired: { bg: '#f3f4f6', text: '#6b7280' },
                    }
                    const sc = statusColors[status]
                    const statusLabel = t(('settings_invites_status_' + status) as Parameters<typeof t>[0])
                    return (
                      <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1.5px solid var(--color-border)', borderRadius: 10, backgroundColor: 'var(--color-surface)', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '0.1em' }}>{inv.code}</span>
                            <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: sc.bg, color: sc.text }}>{statusLabel}</span>
                          </div>
                          <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-muted)' }}>
                            {status === 'used'
                              ? t('settings_invites_used_by', { email: inv.used_by_email ?? inv.used_by ?? '?' })
                              : t('settings_invites_expires', { date: new Date(inv.expires_at).toLocaleDateString() })}
                          </p>
                        </div>
                        {status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleCopy(inv)}
                            title={t('settings_invites_copy')}
                            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', color: copiedId === inv.id ? '#16a34a' : 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, flexShrink: 0, transition: 'color 0.15s' }}
                          >
                            {copiedId === inv.id ? <><CheckCheck size={13} />{t('settings_invites_copied')}</> : <><Copy size={13} />{t('settings_invites_copy')}</>}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fixed footer, outside the scrolling body: sign out lives with the
            account info (moved here from the sidebar's "More options"). */}
        <div style={{ borderTop: '1px solid var(--color-border)', padding: '12px 24px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => { onClose(); signOut() }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)', fontSize: 13, fontWeight: 600, padding: '6px 4px' }}
          >
            <LogOut size={14} />
            {t('sidebar_signout')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LangOption({ selected, onClick, flag, label }: { selected: boolean; onClick: () => void; flag: string; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: selected ? 600 : 400,
        border: selected ? '2px solid var(--color-text)' : '1.5px solid var(--color-border)',
        backgroundColor: selected ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
        color: selected ? 'var(--color-text)' : 'var(--color-text-muted)',
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 16 }}>{flag}</span>
      {label}
    </button>
  )
}

function ThemeOption({ selected, onClick, icon, label }: { selected: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: selected ? 600 : 400,
        border: selected ? '2px solid var(--color-text)' : '1.5px solid var(--color-border)',
        backgroundColor: selected ? 'var(--color-bg-secondary)' : 'var(--color-surface)',
        color: selected ? 'var(--color-text)' : 'var(--color-text-muted)',
        transition: 'all 0.15s',
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function PanelFallback() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--color-text-muted)', fontSize: 14 }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, backgroundColor: 'var(--color-logo-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-logo-text)', fontWeight: 700, fontSize: 13 }}>A</div>
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 9px', borderRadius: 8, border: 'none', cursor: 'pointer', backgroundColor: active ? 'var(--color-active)' : 'transparent', color: active ? 'var(--color-text)' : 'var(--color-text-muted)', fontSize: 13, fontWeight: active ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s' }}
    >
      {icon}{label}
    </button>
  )
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text)', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  )
}

function FeedbackBanner({ type, text }: { type: 'success' | 'error'; text: string }) {
  return (
    <div style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: type === 'success' ? '#f0fdf4' : '#fef2f2', border: `1px solid ${type === 'success' ? '#bbf7d0' : '#fecaca'}`, color: type === 'success' ? '#15803d' : '#dc2626', fontSize: 13 }}>
      {text}
    </div>
  )
}


const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1.5px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 14,
  outline: 'none',
  color: 'var(--color-text)',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
  backgroundColor: 'var(--color-surface)',
}

const submitBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  backgroundColor: disabled ? 'var(--color-btn-disabled)' : 'var(--color-btn-primary)',
  color: disabled ? 'var(--color-btn-disabled-text)' : 'var(--color-btn-primary-text)',
  padding: '10px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background-color 0.15s',
})
