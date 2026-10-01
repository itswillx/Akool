import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { copyToClipboard } from '../lib/clipboard'
import { useLanguage } from '../i18n/LanguageContext'

// Tokens pessoais para a edge function cards-api (fila de desenvolvimento da IA).
// O banco guarda só o hash: o texto do token aparece uma única vez, na criação.

interface ApiToken {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string
  revoked_at: string | null
}

type TokenStatus = 'active' | 'revoked' | 'expired'

function tokenStatus(token: ApiToken, now: number): TokenStatus {
  if (token.revoked_at) return 'revoked'
  if (new Date(token.expires_at).getTime() <= now) return 'expired'
  return 'active'
}

const STATUS_COLOR: Record<TokenStatus, string> = { active: '#22c55e', revoked: '#ef4444', expired: '#94a3b8' }

export default function ApiTokensSection() {
  const { t } = useLanguage()
  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const fetchTokens = useCallback(() => supabase
    .from('api_tokens')
    .select('id, name, prefix, created_at, last_used_at, expires_at, revoked_at')
    .order('created_at', { ascending: false }), [])

  const applyTokens = useCallback(({ data, error: err }: Awaited<ReturnType<typeof fetchTokens>>) => {
    if (err) {
      setError(t('settings_api_error').replace('{message}', err.message))
      return
    }
    setTokens(data ?? [])
  }, [t])

  const load = useCallback(async () => { applyTokens(await fetchTokens()) }, [fetchTokens, applyTokens])

  useEffect(() => {
    let cancelled = false
    void fetchTokens().then(result => { if (!cancelled) applyTokens(result) })
    return () => { cancelled = true }
  }, [fetchTokens, applyTokens])

  const create = async () => {
    setCreating(true)
    setError(null)
    setCopied(false)
    const { data, error: err } = await supabase.rpc('create_api_token', { p_name: name.trim() || 'Token', p_expires_in_days: 90 })
    setCreating(false)
    if (err) {
      setError(t('settings_api_error').replace('{message}', err.message))
      return
    }
    setNewToken((data as { token: string }).token)
    setName('')
    await load()
  }

  const revoke = async (id: string) => {
    setConfirmId(null)
    const { error: err } = await supabase.rpc('revoke_api_token', { p_id: id })
    if (err) {
      setError(t('settings_api_error').replace('{message}', err.message))
      return
    }
    await load()
  }

  const copy = async () => {
    if (newToken && await copyToClipboard(newToken)) setCopied(true)
  }

  const fmt = (iso: string) => new Date(iso).toLocaleDateString()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('settings_api_intro')}</p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('settings_api_name_placeholder')}
          maxLength={80}
          style={{ flex: 1, minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--color-border)', borderRadius: 8, fontSize: 14, color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' }}
        />
        <button
          type="button"
          onClick={() => { void create() }}
          disabled={creating}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', fontSize: 13, fontWeight: 600, cursor: creating ? 'wait' : 'pointer', whiteSpace: 'nowrap' }}
        >
          <KeyRound size={14} />
          {creating ? t('settings_api_generating') : t('settings_api_generate')}
        </button>
      </div>

      {newToken && (
        <div style={{ padding: 12, borderRadius: 8, border: '1px solid #f59e0b66', backgroundColor: '#f59e0b14', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--color-text)', lineHeight: 1.45 }}>{t('settings_api_new_token')}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: 12, padding: '6px 8px', borderRadius: 6, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
              {newToken}
            </code>
            <button
              type="button"
              onClick={() => { void copy() }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: copied ? '#22c55e' : 'var(--color-text)', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? t('settings_api_copied') : t('settings_api_copy')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ padding: '8px 12px', borderRadius: 8, backgroundColor: '#ef444418', color: '#ef4444', fontSize: 12.5 }}>{error}</div>
      )}

      {tokens.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('settings_api_empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tokens.map(token => {
            const status = tokenStatus(token, now)
            return (
              <li key={token.id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: STATUS_COLOR[status], backgroundColor: `${STATUS_COLOR[status]}1f`, padding: '1px 7px', borderRadius: 999, flexShrink: 0 }}>
                      {t(`settings_api_status_${status}`)}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                    <code>{token.prefix}…</code>
                    {' · '}
                    {token.last_used_at ? t('settings_api_last_used').replace('{date}', fmt(token.last_used_at)) : t('settings_api_never_used')}
                    {status === 'active' && <>{' · '}{t('settings_api_expires').replace('{date}', fmt(token.expires_at))}</>}
                  </span>
                </div>
                {status === 'active' && (
                  <button
                    type="button"
                    onClick={() => (confirmId === token.id ? void revoke(token.id) : setConfirmId(token.id))}
                    onBlur={() => setConfirmId(id => (id === token.id ? null : id))}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ef444466', background: confirmId === token.id ? '#ef4444' : 'transparent', color: confirmId === token.id ? '#fff' : '#ef4444', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                  >
                    {confirmId === token.id ? t('settings_api_revoke_confirm') : t('settings_api_revoke')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
