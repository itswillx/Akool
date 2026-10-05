import { useCallback, useEffect, useState } from 'react'
import type { PostgrestError } from '@supabase/supabase-js'
import type { TranslationKey } from '../../i18n/translations'
import {
  classifyApiTokenError, createApiToken, deleteApiToken, listApiTokens, purgeInactiveApiTokens, revokeAllApiTokens,
  revokeApiToken, updateApiTokenScopes, type ApiTokenRow, type CreatedApiToken,
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

export function useApiTokens() {
  const [tokens, setTokens] = useState<ApiTokenRow[]>([])
  // A aba monta com `loading` true; o efeito só aplica a resposta.
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [problem, setProblem] = useState<ApiTokenProblem | null>(null)
  const [notice, setNotice] = useState<ApiTokenNotice | null>(null)

  const applyList = useCallback(({ data, error }: Result<ApiTokenRow[]>) => {
    if (error) setProblem(toProblem(error))
    else {
      setTokens(data ?? [])
      setNow(Date.now())
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

  const create = (input: CreateTokenInput) => run(() => createApiToken(input), data => {
    setCreated(data)
  })
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
    setCreated(current => (current?.id === id ? null : current))
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
