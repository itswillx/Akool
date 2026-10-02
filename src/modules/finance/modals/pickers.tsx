// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FieldGroup } from '@/shared/ui/Field'
import { UserAvatar } from '@/shared/ui/UserAvatar'
import { useAuth } from '../../../contexts/AuthContext'
import { useToast } from '../../../contexts/ToastContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { sanitizeIlikeTerm } from '../../../lib/profileSearch'
import { isRateLimited } from '../../../lib/rateLimit'
import { supabase } from '../../../lib/supabase'
import {
inputStyle, labelStyle
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'
import { useDebouncedCallback } from '@/shared/hooks/useDebounce'

// ─── Transaction Modal ────────────────────────────────────────────────────────

// ─── User Picker (reusable for goal/tx/budget sharing) ────────────────────────────

export function UserPicker({ label, value, onChange, knownPartners }: {
  label: string
  value: string
  onChange: (id: string) => void
  knownPartners: PartnerProfile[]
}) {
  const { t } = useLanguage()
  const { showToast } = useToast()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PartnerProfile[]>([])
  const [searching, setSearching] = useState(false)
  const selected = knownPartners.find(p => p.id === value) ?? (value ? { id: value, email: value, display_name: null } : null)

  const displayName = (p: PartnerProfile) => p.display_name || p.email

  // SEC-012: antes isto disparava uma RPC POR TECLA. Com o limite de 40
  // buscas/min por usuário, digitar um e-mail longo estourava o próprio limite.
  // 300 ms é o mesmo debounce já usado em SharePageModal e ProjectsPanel.
  // PERF-013: debounce compartilhado (cancela ao desmontar).
  const runSearch = useDebouncedCallback(async (s: string) => {
    const { data, error } = await supabase.rpc('search_users_for_share', { p_term: s })
    setSearching(false)
    if (isRateLimited(error)) {
      showToast('warning', t('search_rate_limited'), { dedupeKey: 'user-search-rate-limited' })
      return
    }
    setResults(data ?? [])
  }, 300)
  const doSearch = useCallback((q: string) => {
    const s = sanitizeIlikeTerm(q)
    if (s.length < 3) { runSearch.cancel(); setResults([]); setSearching(false); return }
    setSearching(true)
    runSearch(s)
  }, [runSearch])

  return (
    <FieldGroup label={label} labelStyle={labelStyle}>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 6, backgroundColor: 'var(--color-bg)' }}>
          <UserAvatar name={displayName(selected)} seed={selected.email} emoji={selected.avatar_emoji} color={selected.avatar_color} url={selected.avatar_url} size={28} />
          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)' }}>{displayName(selected)}</span>
          <button aria-label={t('common_clear')} type="button" onClick={() => onChange('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', borderRadius: 4, padding: 2 }}><X size={14} /></button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          {knownPartners.length > 0 && !query && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {knownPartners.map(p => (
                <button type="button" key={p.id} onClick={() => onChange(p.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', cursor: 'pointer', fontSize: 12, color: 'var(--color-text)' }}>
                  <UserAvatar name={displayName(p)} seed={p.email} emoji={p.avatar_emoji} color={p.avatar_color} url={p.avatar_url} size={18} />
                  {displayName(p)}
                </button>
              ))}
            </div>
          )}
          <input style={inputStyle} type="text" value={query} onChange={e => { setQuery(e.target.value); doSearch(e.target.value) }} placeholder={t('finance_share_search_placeholder')} />
          <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--color-text-muted)' }}>{t('share_search_hint')}</p>
          {searching && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_searching')}</p>}
          {results.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden', marginTop: 2 }}>
              {results.map(p => (
                <button type="button" key={p.id} onClick={() => { onChange(p.id); setQuery(''); setResults([]) }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
                  <UserAvatar name={displayName(p)} seed={p.email} emoji={p.avatar_emoji} color={p.avatar_color} url={p.avatar_url} size={28} />
                  <div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>{displayName(p)}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{p.email}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
          {query.length >= 2 && !searching && results.length === 0 && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_no_results')}</p>
          )}
        </div>
      )}
    </FieldGroup>
  )
}

// ─── Invite autocomplete (workspace) ──────────────────────────────────────────
// Lets the workspace owner invite by email OR nick (display_name). As they type,
// matching users are suggested; selecting one fills the email behind the scenes.
// A raw email that matches no profile can still be typed and sent.

export function InviteAutocomplete({ value, onChange, onSubmit, sending, excludeIds }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  sending: boolean
  excludeIds: string[]
}) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const { showToast } = useToast()
  const [results, setResults] = useState<PartnerProfile[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)

  // SEC-012: mesmo motivo do UserPicker acima — era uma RPC por tecla.
  const runSearch = useDebouncedCallback(async (term: string) => {
    const { data, error } = await supabase.rpc('search_users_for_share', { p_term: term })
    setSearching(false)
    if (isRateLimited(error)) {
      showToast('warning', t('search_rate_limited'), { dedupeKey: 'user-search-rate-limited' })
      return
    }
    const filtered = (data ?? []).filter(p => p.id !== user?.id && !excludeIds.includes(p.id))
    setResults(filtered.slice(0, 6))
  }, 300)
  const doSearch = useCallback((q: string) => {
    const term = sanitizeIlikeTerm(q)
    if (term.length < 3) { runSearch.cancel(); setResults([]); setSearching(false); return }
    setSearching(true)
    runSearch(term)
  }, [runSearch])

  const handleChange = (v: string) => {
    onChange(v)
    setOpen(true)
    doSearch(v)
  }

  const pick = (p: PartnerProfile) => {
    onChange(p.email)
    setResults([])
    setOpen(false)
  }

  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...inputStyle, flex: 1 }} type="text" value={value}
          onChange={e => handleChange(e.target.value)}
          onFocus={() => { if (value.trim().length >= 2) setOpen(true) }}
          onBlur={() => { setTimeout(() => setOpen(false), 150) }}
          placeholder={t('finance_workspace_invite_placeholder')}
          onKeyDown={e => { if (e.key === 'Enter') { setOpen(false); onSubmit() } }} />
        <button onClick={onSubmit} disabled={sending || !value.trim()}
          style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: sending || !value.trim() ? 'not-allowed' : 'pointer', opacity: sending || !value.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
          {t('finance_workspace_invite_send')}
        </button>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'var(--color-text-muted)' }}>{t('share_search_hint')}</p>
      {open && value.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', overflow: 'hidden', marginTop: 2 }}>
          {searching && <p style={{ margin: 0, padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_searching')}</p>}
          {!searching && results.map(p => (
            <button type="button" key={p.id} onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--color-hover)')}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}>
              <UserAvatar name={p.display_name || p.email} seed={p.email} emoji={p.avatar_emoji} color={p.avatar_color} url={p.avatar_url} size={28} />
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.display_name || p.email}</p>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.email}</p>
              </div>
            </button>
          ))}
          {!searching && results.length === 0 && (
            <p style={{ margin: 0, padding: '10px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_share_no_results')}</p>
          )}
        </div>
      )}
    </div>
  )
}
