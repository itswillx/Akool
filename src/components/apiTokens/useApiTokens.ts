import { useCallback, useEffect, useRef, useState } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import type { TranslationKey } from '../../i18n/translations'
import {
  apiTokenStatus, classifyApiTokenError, createApiToken, deleteApiToken, listApiTokens, purgeInactiveApiTokens,
  revokeAllApiTokens, revokeApiToken, updateApiTokenScopes, type ApiTokenRow, type CreatedApiToken,
} from '../../lib/data/apiTokens'
import type { CreateTokenInput } from './CreateTokenForm'
import type { ScopeMap } from './scopeModel'
import type { ApiTokenProblem } from './tokenBanners'

// API-009: estado da aba API (lista, token recém-criado, erro e aviso) e as
// ações. Uma ação por vez: enquanto `busy`, os botões ficam desligados. Toda
// ação relê a lista no fim, com ou sem erro de "não encontrado" (outra aba).

export interface ApiTokenNotice {
  key: TranslationKey
  n?: number
}

type Result<T> = { data: T | null; error: PostgrestError | null }

const toProblem = (error: { code?: string | null; message?: string | null }): ApiTokenProblem =>
  ({ kind: classifyApiTokenError(error), message: error.message ?? '' })

// Token criado com a aba já fechada (trocou de aba ou fechou as Configurações
// durante o "Gerando…"): o segredo aparece na próxima leitura da lista. Só se
// o token estiver nela e ativo, e o RLS só lista os da própria pessoa.
let orphanCreated: CreatedApiToken | null = null

/** O segredo fica na tela só enquanto o token dele está ativo na lista. */
function keepIfActive(token: CreatedApiToken | null, rows: readonly ApiTokenRow[], now: number): CreatedApiToken | null {
  return token && rows.some(row => row.id === token.id && apiTokenStatus(row, now) === 'active') ? token : null
}

export function useApiTokens() {
  const [tokens, setTokens] = useState<ApiTokenRow[]>([])
  // A aba monta com `loading` true; o efeito só aplica a resposta.
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [problem, setProblem] = useState<ApiTokenProblem | null>(null)
  const [notice, setNotice] = useState<ApiTokenNotice | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const applyList = useCallback(({ data, error }: Result<ApiTokenRow[]>) => {
    if (error) setProblem(toProblem(error))
    else {
      const rows = data ?? []
      const at = Date.now()
      // Só a aba montada pega o órfão, e só quando a linha dele já está na lista
      // (a leitura pode chegar antes do commit da criação).
      const orphan = mounted.current ? orphanCreated : null
      if (orphan && rows.some(row => row.id === orphan.id)) orphanCreated = null
      setTokens(rows)
      setNow(at)
      setCreated(current => keepIfActive(current ?? orphan, rows, at))
    }
    setLoading(false)
  }, [])
  const reload = async () => applyList(await listApiTokens())

  useEffect(() => {
    let cancelled = false
    void listApiTokens().then(result => { if (!cancelled) applyList(result) })
    return () => { cancelled = true }
  }, [applyList])

  /** Roda uma ação; true quando deu certo. */
  const run = async <T>(action: () => PromiseLike<Result<T>>, onSuccess: (data: T | null) => void): Promise<boolean> => {
    setBusy(true)
    setProblem(null)
    setNotice(null)
    const { data, error } = await action()
    if (error) setProblem(toProblem(error))
    else onSuccess(data)
    await reload()
    setBusy(false)
    return !error
  }

  // A faixa do token anterior fica até o próximo sair (se a criação falhar, o
  // segredo dele não se perde); o key da faixa zera o "Copiado" e o foco.
  const create = (input: CreateTokenInput) => {
    return run(() => createApiToken(input), data => {
      if (mounted.current) setCreated(data)
      else orphanCreated = data
    })
  }
  const updateScopes = (id: string, scopes: ScopeMap) => run(() => updateApiTokenScopes(id, scopes), () => {
    setNotice({ key: 'settings_api_saved' })
  })
  const revoke = (id: string) => run(() => revokeApiToken(id), () => {
    setNotice({ key: 'settings_api_revoked_notice' })
  })
  const revokeAll = () => run(() => revokeAllApiTokens(), n => {
    setNotice({ key: 'settings_api_revoked_all_notice', n: n ?? 0 })
  })
  const remove = (id: string) => run(() => deleteApiToken(id), () => {
    setNotice({ key: 'settings_api_deleted_notice' })
  })
  const purge = () => run(async () => {
    const { deleted, error } = await purgeInactiveApiTokens(tokens, Date.now())
    // Parou no meio: diz quantos já saíram, além do erro.
    if (error && deleted > 0) setNotice({ key: 'settings_api_purged_notice', n: deleted })
    return { data: deleted, error }
  }, deleted => {
    setNotice({ key: 'settings_api_purged_notice', n: deleted ?? 0 })
  })

  return {
    tokens, loading, busy, now, created, problem, notice,
    create, updateScopes, revoke, revokeAll, remove, purge,
    dismissCreated: () => setCreated(null),
  }
}
