import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, UserPlus, ChevronDown, Trash2, Search, Crown, Eye, Pencil } from 'lucide-react'
import type { PageShare, PageShareRole } from '../types'
import { supabase } from '../lib/supabase'
import { sanitizeIlikeTerm } from '../lib/profileSearch'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'

interface UserProfile {
  id: string
  email: string
  display_name: string | null
}

interface SharePageModalProps {
  open: boolean
  onClose: () => void
  pageId: string
  pageTitle: string
}

function useRoleLabels(): Record<PageShareRole, string> {
  const { t } = useLanguage()
  return {
    viewer: t('share_role_viewer'),
    editor: t('share_role_editor'),
    co_owner: t('share_role_co_owner'),
  }
}

const ROLE_ICONS: Record<PageShareRole, React.ReactNode> = {
  viewer: <Eye size={13} />,
  editor: <Pencil size={13} />,
  co_owner: <Crown size={13} />,
}

const ROLES: PageShareRole[] = ['viewer', 'editor', 'co_owner']

function RoleDropdown({
  value,
  onChange,
  disabled,
}: {
  value: PageShareRole
  onChange: (r: PageShareRole) => void
  disabled?: boolean
}) {
  const DROPDOWN_W = 168
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const ROLE_LABELS = useRoleLabels()

  const handleOpen = () => {
    if (disabled) return
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const left = Math.min(r.right - DROPDOWN_W, window.innerWidth - DROPDOWN_W - 8)
      setPos({ top: r.bottom + 4, left: Math.max(8, left) })
    }
    setOpen(o => !o)
  }

  return (
    <div>
      <button
        ref={btnRef}
        disabled={disabled}
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px',
          borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)',
          cursor: disabled ? 'default' : 'pointer', fontSize: 12, color: 'var(--color-text)',
          opacity: disabled ? 0.6 : 1, whiteSpace: 'nowrap',
        }}
      >
        {ROLE_ICONS[value]}
        <span>{ROLE_LABELS[value]}</span>
        {!disabled && <ChevronDown size={11} />}
      </button>
      {open && !disabled && pos && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          <div style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 9999, minWidth: DROPDOWN_W, overflow: 'hidden',
          }}>
            {ROLES.map(r => (
              <button
                key={r}
                onClick={() => { onChange(r); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '9px 14px', border: 'none',
                  cursor: 'pointer', background: r === value ? 'var(--color-hover)' : 'transparent',
                  fontSize: 13, color: 'var(--color-text)', textAlign: 'left',
                  fontWeight: r === value ? 600 : 400,
                }}
              >
                {ROLE_ICONS[r]}
                <span>{ROLE_LABELS[r]}</span>
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  )
}

export default function SharePageModal({ open, onClose, pageId, pageTitle }: SharePageModalProps) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const ROLE_LABELS = useRoleLabels()
  const [shares, setShares] = useState<PageShare[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UserProfile[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [loadingShares, setLoadingShares] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadShares = useCallback(async () => {
    setLoadingShares(true)
    const { data } = await supabase
      .from('page_shares')
      .select('*, profiles!page_shares_shared_with_user_id_profiles_fkey(email, display_name)')
      .eq('page_id', pageId)
      .order('created_at', { ascending: true })
    if (data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setShares(data.map((row: any) => ({
        ...row,
        profile: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles,
      })))
    }
    setLoadingShares(false)
  }, [pageId])

  useEffect(() => {
    if (open) {
      loadShares()
      setSearchQuery('')
      setSearchResults([])
    }
  }, [open, loadShares])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setSearchResults([]); return }
    debounceRef.current = setTimeout(async () => {
      const term = sanitizeIlikeTerm(q)
      if (!term) { setSearchResults([]); return }
      const existingIds = new Set([user?.id, ...shares.map(s => s.shared_with_user_id)])
      const { data } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .or(`email.ilike.%${term}%,display_name.ilike.%${term}%`)
        .limit(8)
      if (data) {
        setSearchResults((data as UserProfile[]).filter(p => !existingIds.has(p.id)))
      }
    }, 300)
  }

  const handleAddUser = async (profile: UserProfile, role: PageShareRole = 'editor') => {
    if (!user) return
    setAdding(profile.id)
    setErrorMsg(null)
    const { error } = await supabase.from('page_shares').insert({
      page_id: pageId,
      owner_id: user.id,
      shared_with_user_id: profile.id,
      role,
    })
    if (error) {
      setErrorMsg(t('share_invite_error'))
    } else {
      await loadShares()
      setSearchQuery('')
      setSearchResults([])
      setSearchOpen(false)
    }
    setAdding(null)
  }

  const handleRoleChange = async (shareId: string, role: PageShareRole) => {
    setSaving(shareId)
    await supabase.from('page_shares').update({ role }).eq('id', shareId)
    await loadShares()
    setSaving(null)
  }

  const handleRemove = async (shareId: string) => {
    setSaving(shareId)
    await supabase.from('page_shares').delete().eq('id', shareId)
    await loadShares()
    setSaving(null)
  }

  if (!open) return null

  const displayName = (s: PageShare) =>
    s.profile?.display_name || s.profile?.email || t('share_untitled_user')

  const avatarInitial = (s: PageShare) =>
    (s.profile?.display_name || s.profile?.email || '?')[0].toUpperCase()

  const avatarColor = (email: string) => {
    const colors = ['#4f6ef7', '#e96c6c', '#43c59e', '#f0a500', '#9b59b6']
    return colors[(email.charCodeAt(0) + email.charCodeAt(email.length - 1)) % colors.length]
  }

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)', zIndex: 100 }}
        onClick={onClose}
      />
      <div style={{
        position: 'fixed', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'var(--color-surface)', borderRadius: 14,
        boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
        zIndex: 101, width: 'min(94vw, 480px)',
        display: 'flex', flexDirection: 'column',
        maxHeight: 'min(80vh, 560px)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '18px 20px 14px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{t('share_title')}</h2>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
              {pageTitle || t('share_no_title')}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ flexShrink: 0, marginLeft: 12, width: 28, height: 28, border: 'none', borderRadius: 7, background: 'var(--color-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div style={{ padding: '12px 20px', flexShrink: 0, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg-tertiary)' }}>
            <Search size={14} color="#9b9a97" style={{ flexShrink: 0 }} />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={e => { handleSearch(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              placeholder={t('share_search_placeholder')}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, background: 'transparent', color: 'var(--color-text)' }}
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(''); setSearchResults([]); setSearchOpen(false) }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0, display: 'flex' }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {searchOpen && searchResults.length > 0 && (
            <div style={{
              position: 'absolute', left: 20, right: 20, top: 'calc(100% - 2px)',
              backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 110, overflow: 'hidden',
            }}>
              {searchResults.map(p => (
                <div
                  key={p.id}
                  style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid var(--color-border)', gap: 10 }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: avatarColor(p.email), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                    {(p.display_name || p.email)[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {p.display_name && <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.display_name}</p>}
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</p>
                  </div>
                  <button
                    onClick={() => handleAddUser(p)}
                    disabled={adding === p.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: 'none', background: 'var(--color-btn-primary)', cursor: adding === p.id ? 'default' : 'pointer', fontSize: 12, color: 'var(--color-btn-primary-text)', flexShrink: 0, opacity: adding === p.id ? 0.6 : 1 }}
                  >
                    <UserPlus size={12} />
                    <span>{adding === p.id ? t('share_inviting') : t('share_invite_btn')}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div style={{ margin: '0 20px 8px', padding: '8px 12px', borderRadius: 7, backgroundColor: 'rgba(233,108,108,0.12)', border: '1px solid rgba(233,108,108,0.35)', fontSize: 12, color: '#e96c6c' }}>
            {errorMsg}
          </div>
        )}

        {/* Divider */}
        {shares.length > 0 && (
          <div style={{ marginBottom: 4, paddingLeft: 20, paddingRight: 20, flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {shares.length} {shares.length === 1 ? t('share_collaborator') : t('share_collaborators')}
            </p>
          </div>
        )}

        {/* Collaborators list */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 4 }}>
          {loadingShares ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: '20px 0' }}>{t('share_loading')}</p>
          ) : shares.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13, padding: '20px 0' }}>{t('share_no_collaborators')}</p>
          ) : (
            shares.map(s => (
              <div
                key={s.id}
                style={{ display: 'flex', alignItems: 'center', padding: '9px 20px', gap: 10 }}
              >
                {/* Avatar */}
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: avatarColor(s.profile?.email ?? ''),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, color: '#fff',
                }}>
                  {avatarInitial(s)}
                </div>

                {/* Name + email */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayName(s)}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.profile?.email}
                  </p>
                </div>

                {/* Role + remove */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <RoleDropdown
                    value={s.role}
                    onChange={r => handleRoleChange(s.id, r)}
                    disabled={saving === s.id}
                  />
                  <button
                    onClick={() => handleRemove(s.id)}
                    disabled={saving === s.id}
                    title={t('share_remove_access')}
                    style={{ width: 28, height: 28, border: 'none', borderRadius: 6, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c4c4c2', flexShrink: 0 }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#e96c6c')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#c4c4c2')}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer legend */}
        <div style={{ padding: '10px 20px 14px', borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {ROLES.map(r => (
              <span key={r} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--color-text-muted)' }}>
                {ROLE_ICONS[r]}
                <strong style={{ color: 'var(--color-text-muted)' }}>{ROLE_LABELS[r]}</strong>
                — {r === 'viewer' ? t('share_legend_viewer') : r === 'editor' ? t('share_legend_editor') : t('share_legend_co_owner')}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
