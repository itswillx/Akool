// API-008: tipos do registro de ações (docs/api-arquitetura.md §4). Uma ação
// descreve o que faz (id, textos, schemas, permissões, anotações e exemplos) e
// como faz (run). O MCP, o REST e o OpenAPI saem desta mesma definição.

import type { ScopeLevel } from './catalog.ts'
import type { ScopeRequirement } from './errors.ts'
import type { JsonSchema } from './schema.ts'
import type { ScopeMap } from './scopes.ts'

/** O que a ação faz com os dados; as invariantes de anotação dependem disto. */
export type ActionKind = 'read' | 'create' | 'update' | 'delete'

/** `allOf`: todas; `anyOf`: qualquer uma basta; `anyOf: []` sem `allOf`: sempre permitida. */
export interface ActionRequires {
  allOf?: readonly ScopeRequirement[]
  anyOf?: readonly ScopeRequirement[]
}

/** As anotações do MCP. `openWorldHint` é sempre false: a ação só mexe no Akool. */
export interface ActionAnnotations {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: false
}

/** Quem chama: o dono do token e os escopos efetivos (resolve_api_token_v2). */
export interface Principal {
  user_id: string
  token_id: string
  name: string
  prefix: string
  expires_at: string
  scopes: ScopeMap
}

/** A transação do executor (API-010): consultas como o dono do token. */
export interface ActionTx {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
}

/** Storage como o dono do token (API-018 completa). */
export interface ActionStorage {
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>
}

export type Surface = 'rest' | 'mcp' | 'cards-api'

export interface RequestInfo {
  surface: Surface
  /** Cliente declarado (User-Agent ou clientInfo do MCP), para a auditoria. */
  client: string | null
  /** Faixa do IP (nunca o IP inteiro), para limites e auditoria. */
  ip_bucket: string | null
}

/** Ganchos de auditoria, limites e idempotência: vazios até o API-014. */
export interface ActionHooks {
  audit?: (entry: { action: string; outcome: string }) => void
  limit?: (action: string) => Promise<void>
  idempotency?: (key: string) => Promise<unknown>
}

export interface ActionCtx {
  tx: ActionTx
  principal: Principal
  can: (sub: string, level: ScopeLevel) => boolean
  storage: ActionStorage
  /** Fuso da pessoa (X-Akool-Timezone), padrão America/Sao_Paulo. */
  tz: string
  now: Date
  request: RequestInfo
  hooks: ActionHooks
  /** O registro inteiro (o executor passa o REGISTRY); meta.acoes.listar lista daqui. */
  actions: readonly ActionDef[]
}

/** Exemplos que o teste valida contra os schemas e que o OpenAPI e o MCP mostram. */
export interface ActionExamples {
  input: readonly unknown[]
  output: readonly unknown[]
}

export interface ActionDef<I = unknown, O = unknown> {
  /** `secao.subsecao.acao`, só [a-z_]. O nome MCP é o id com `_` no lugar do ponto. */
  id: string
  title: string
  /** Até 300 caracteres, dizendo o que a ação faz; nada de instrução à IA. */
  description: string
  kind: ActionKind
  requires: ActionRequires
  input: JsonSchema
  output: JsonSchema
  annotations: ActionAnnotations
  idempotent: boolean
  /** Tabelas que a ação lê ou escreve (auditoria e revisão de segurança). */
  tables: readonly string[]
  maxResultChars?: number
  deprecated?: boolean
  examples: ActionExamples
  // Método (não propriedade): o registro guarda ActionDef<unknown, unknown>.
  run(ctx: ActionCtx, input: I): Promise<O>
}
