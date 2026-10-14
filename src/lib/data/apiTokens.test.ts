import { beforeEach, describe, expect, it, vi } from 'vitest'
import migration from '../../../supabase/migrations/20261005100000_api001_token_scopes.sql?raw'

// API-009: as chamadas da tela de tokens. Listagem sem user_id nem token_hash,
// criação sempre com escopos explícitos, limpeza só dos inativos e a
// classificação de erro conferida contra as mensagens da própria migration.

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as unknown[][] }))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const query = {
        select: (columns: string) => { db.calls.push(['select', table, columns]); return query },
        order: (column: string, opts: unknown) => {
          db.calls.push(['order', column, opts])
          return Promise.resolve(db.queue.shift() ?? { data: [], error: null })
        },
      }
      return query
    },
    rpc: (name: string, args?: unknown) => {
      db.calls.push(['rpc', name, args])
      return Promise.resolve(db.queue.shift() ?? { data: null, error: null })
    },
  },
}))

const {
  API_TOKEN_COLUMNS, apiTokenStatus, classifyApiTokenError, createApiToken, deleteApiToken, listApiTokens,
  purgeInactiveApiTokens, revokeAllApiTokens, revokeApiToken, updateApiTokenScopes,
} = await import('./apiTokens')

const NOW = Date.parse('2026-10-05T12:00:00Z')
const token = (id: string, over: { revoked_at?: string | null; expires_at?: string } = {}) => ({
  id, name: id, prefix: 'akool_pat_abcd', scopes: {}, created_at: '2026-10-01T00:00:00Z',
  last_used_at: null, last_client: null, expires_at: '2026-11-01T00:00:00Z', revoked_at: null, ...over,
})

beforeEach(() => {
  db.queue = []
  db.calls = []
})

describe('listagem', () => {
  it('pede só as colunas da tela, sem user_id nem token_hash, mais novos primeiro', async () => {
    db.queue.push({ data: [token('t1')], error: null })
    const { data } = await listApiTokens()
    expect(data).toHaveLength(1)
    expect(db.calls).toEqual([
      ['select', 'api_tokens', API_TOKEN_COLUMNS],
      ['order', 'created_at', { ascending: false }],
    ])
    expect(API_TOKEN_COLUMNS).not.toMatch(/user_id|token_hash/)
    expect(API_TOKEN_COLUMNS).toMatch(/scopes/)
    expect(API_TOKEN_COLUMNS).toMatch(/last_client/)
  })

  it('status: revogado vence expirado; vence no instante da validade', () => {
    expect(apiTokenStatus(token('a'), NOW)).toBe('active')
    expect(apiTokenStatus(token('b', { expires_at: '2026-10-05T12:00:00Z' }), NOW)).toBe('expired')
    expect(apiTokenStatus(token('c', { revoked_at: '2026-10-02T00:00:00Z', expires_at: '2026-10-03T00:00:00Z' }), NOW)).toBe('revoked')
  })
})

describe('RPCs', () => {
  it('cria sempre com escopos explícitos; nome em branco vira "Token"', async () => {
    const created = { id: 't1', token: 'akool_pat_x', prefix: 'akool_pat_x', expires_at: '2026-11-04T00:00:00Z', scopes: { 'projetos.cards': 'read' } }
    db.queue.push({ data: created, error: null })
    expect(await createApiToken({ name: '  Claude no Mac  ', expiresInDays: 30, scopes: { 'projetos.cards': 'read' } }))
      .toEqual({ data: created, error: null })
    await createApiToken({ name: '   ', expiresInDays: 7, scopes: { 'financas.contas': 'read' } })
    expect(db.calls).toEqual([
      ['rpc', 'create_api_token', { p_name: 'Claude no Mac', p_expires_in_days: 30, p_scopes: { 'projetos.cards': 'read' } }],
      ['rpc', 'create_api_token', { p_name: 'Token', p_expires_in_days: 7, p_scopes: { 'financas.contas': 'read' } }],
    ])
  })

  it('com erro, a criação não devolve dado', async () => {
    db.queue.push({ data: { token: 'nunca' }, error: { code: 'P0001', message: 'Limite de 20 tokens ativos.' } })
    expect((await createApiToken({ name: 'x', expiresInDays: 7, scopes: { 'projetos.cards': 'read' } })).data).toBeNull()
  })

  it('editar, revogar, revogar todos e excluir mandam os argumentos certos', async () => {
    await updateApiTokenScopes('t1', { 'projetos.validacao': 'write' })
    await revokeApiToken('t2')
    await revokeAllApiTokens()
    await deleteApiToken('t3')
    expect(db.calls).toEqual([
      ['rpc', 'update_api_token_scopes', { p_id: 't1', p_scopes: { 'projetos.validacao': 'write' } }],
      ['rpc', 'revoke_api_token', { p_id: 't2' }],
      ['rpc', 'revoke_all_my_api_tokens', undefined],
      ['rpc', 'delete_api_token', { p_id: 't3' }],
    ])
  })
})

describe('purgeInactiveApiTokens', () => {
  const list = [
    token('ativo'),
    token('revogado', { revoked_at: '2026-10-02T00:00:00Z' }),
    token('expirado', { expires_at: '2026-10-01T00:00:00Z' }),
    token('outro-revogado', { revoked_at: '2026-10-03T00:00:00Z' }),
  ]

  it('exclui só os revogados e expirados, um por vez; "não encontrado" conta como excluído', async () => {
    db.queue.push({ data: null, error: null }, { data: null, error: { code: 'P0002', message: 'Token não encontrado' } }, { data: null, error: null })
    expect(await purgeInactiveApiTokens(list, NOW)).toEqual({ deleted: 3, error: null })
    expect(db.calls.map(c => (c[2] as { p_id: string }).p_id)).toEqual(['revogado', 'expirado', 'outro-revogado'])
  })

  it('para no primeiro erro de outro tipo e diz quantos já saíram', async () => {
    const failure = { code: '', message: 'TypeError: Failed to fetch' }
    db.queue.push({ data: null, error: null }, { data: null, error: failure })
    expect(await purgeInactiveApiTokens(list, NOW)).toEqual({ deleted: 1, error: failure })
    expect(db.calls).toHaveLength(2)
  })
})

describe('classifyApiTokenError', () => {
  // A mensagem de cada raise da migration, com % trocado por um exemplo.
  const raised = (needle: string) => {
    const line = migration.split('\n').find(l => l.includes('raise exception') && l.includes(needle))
    const match = line?.match(/raise exception '(.+)'(?:,[^']*)? using errcode = '([^']+)'/)
    if (!match) throw new Error(`raise com "${needle}" não encontrado na migration`)
    return { message: match[1].replaceAll('%', 'Administração › Usuários'), code: match[2] }
  }

  it.each([
    ['segundo fator', 'mfa'],
    ['só para administradores', 'admin_only'],
    ['Limite de 20 tokens', 'limit'],
    ['Token não encontrado, revogado ou expirado', 'not_found'],
    ["Token não encontrado' using", 'not_found'],
    ['not authenticated', 'session'],
    ['pelo app', 'session'],
    ['vale no máximo 30 dias', 'invalid'],
    ['vale no máximo 90 dias', 'invalid'],
    ['Escolha ao menos uma permissão para o token', 'invalid'],
    ['Subseção inexistente', 'invalid'],
  ] as const)('"%s" → %s', (needle, kind) => {
    expect(classifyApiTokenError(raised(needle))).toBe(kind)
  })

  it('JWT vencido é sessão; rede, RLS e erro sem código são "outro"', () => {
    expect(classifyApiTokenError({ code: 'PGRST303', message: 'JWT expired' })).toBe('session')
    expect(classifyApiTokenError({ code: '', message: 'TypeError: Failed to fetch' })).toBe('other')
    expect(classifyApiTokenError({ code: '42501', message: 'permission denied for function x' })).toBe('other')
    expect(classifyApiTokenError({ code: 'P0001', message: 'outra regra' })).toBe('other')
    expect(classifyApiTokenError({})).toBe('other')
  })
})
