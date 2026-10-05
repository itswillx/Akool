import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { MAX_ACTIVE_TOKENS } from '../../supabase/functions/_api/catalog'
import { primaryBtnStyle } from '@/shared/ui/uiTokens'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { apiTokenStatus } from '../lib/data/apiTokens'
import { CreateTokenForm, type CreateTokenInput } from './apiTokens/CreateTokenForm'
import type { ScopeMap } from './apiTokens/scopeModel'
import { NewTokenBanner, ProblemBanner } from './apiTokens/tokenBanners'
import { TokenList } from './apiTokens/TokenList'
import { bannerStyle, hintStyle } from './apiTokens/tokenStyles'
import { useApiTokens } from './apiTokens/useApiTokens'

// API-009: Configurações → API. Tokens pessoais para qualquer IA, com
// permissão por seção e subseção (catálogo em supabase/functions/_api). O
// banco guarda só o hash: o token aparece uma única vez, na criação. Dados em
// src/lib/data/apiTokens.ts; peças em src/components/apiTokens/.

export default function ApiTokensSection({ onOpenSecurity }: {
  /** Leva à aba Segurança (o erro de segundo fator aponta para lá). */
  onOpenSecurity?: () => void
}) {
  const { t } = useLanguage()
  const { isAdmin } = useAuth()
  const api = useApiTokens()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const active = api.tokens.filter(token => apiTokenStatus(token, api.now) === 'active').length
  const atLimit = active >= MAX_ACTIVE_TOKENS
  // Só token ativo se edita: revogado ou expirado depois de abrir, o painel fecha.
  const editing = api.tokens.some(token => token.id === editingId && apiTokenStatus(token, api.now) === 'active') ? editingId : null

  // Botão que some com o foco (Cancelar, Revogar, Excluir…) não pode jogar o
  // teclado para o topo do modal: terminada a ação, o foco vai para um lugar fixo.
  const newButton = useRef<HTMLButtonElement>(null)
  const listTitle = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<'new' | 'list' | null>(null)
  useEffect(() => {
    if (!pendingFocus.current || api.busy) return
    const target = pendingFocus.current
    pendingFocus.current = null
    if (document.activeElement && document.activeElement !== document.body) return
    ;(target === 'list' ? listTitle.current ?? newButton.current : newButton.current ?? listTitle.current)?.focus()
  })
  const after = (action: () => Promise<boolean>) => {
    pendingFocus.current = 'list'
    void action()
  }

  const create = async (input: CreateTokenInput) => {
    const ok = await api.create(input)
    if (ok) setCreating(false)
    return ok
  }
  const saveScopes = async (id: string, scopes: ScopeMap) => {
    const ok = await api.updateScopes(id, scopes)
    if (ok) setEditingId(null)
    return ok
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('settings_api_intro')}</p>

      {api.created && (
        <NewTokenBanner
          key={api.created.id}
          token={api.created.token}
          onDismiss={() => {
            pendingFocus.current = 'new'
            api.dismissCreated()
          }}
        />
      )}
      {api.notice && <p role="status" style={{ ...bannerStyle('success'), margin: 0 }}>{t(api.notice.key, { n: api.notice.n ?? 0 })}</p>}
      {api.problem && !creating && <ProblemBanner problem={api.problem} onOpenSecurity={onOpenSecurity} />}

      {creating ? (
        <>
          <CreateTokenForm
            isAdmin={isAdmin}
            busy={api.busy}
            onCreate={create}
            onCancel={() => {
              pendingFocus.current = 'new'
              setCreating(false)
            }}
          />
          {api.problem && <ProblemBanner problem={api.problem} onOpenSecurity={onOpenSecurity} />}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <button
            ref={newButton}
            type="button"
            disabled={atLimit || api.loading}
            onClick={() => {
              setEditingId(null)
              setCreating(true)
            }}
            style={{ ...primaryBtnStyle, ...(atLimit || api.loading ? { background: 'var(--color-btn-disabled)', color: 'var(--color-btn-disabled-text)', cursor: 'not-allowed' } : null) }}
          >
            <Plus size={14} aria-hidden />
            {t('settings_api_new')}
          </button>
        </div>
      )}

      {api.loading ? (
        <p style={{ ...hintStyle, fontSize: 13 }}>{t('settings_api_loading')}</p>
      ) : (
        <TokenList
          titleRef={listTitle}
          tokens={api.tokens}
          now={api.now}
          isAdmin={isAdmin}
          busy={api.busy}
          editingId={editing}
          actions={{
            onEdit: id => {
              setCreating(false)
              setEditingId(id)
            },
            onSaveScopes: saveScopes,
            onRevoke: id => after(() => api.revoke(id)),
            onDelete: id => after(() => api.remove(id)),
            onRevokeAll: () => after(api.revokeAll),
            onPurge: () => after(api.purge),
          }}
        />
      )}
    </div>
  )
}
