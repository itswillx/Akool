// API-008: as duas ações sempre permitidas (namespace composto `meta`, sem
// nível próprio): o que é este token e o que ele pode chamar. Puras sobre o
// ctx: o executor (API-010) só passa o principal, o `can` e o registro.

import { isAllowed } from '../access.ts'
import { COMPOSITE_VIEWS, SECTIONS } from '../catalog.ts'
import type { JsonSchema } from '../schema.ts'
import type { ActionDef, ActionKind, ActionRequires } from '../types.ts'

const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

// Primeiro segmento de qualquer id: as seções e os namespaces compostos.
const SECTION_FILTER = [...new Set([...SECTIONS.map(s => s.key), ...COMPOSITE_VIEWS.map(v => v.key.split('.')[0])])].sort()

const UUID: JsonSchema = { type: 'string', format: 'uuid' }
const REQUIREMENT: JsonSchema = {
  type: 'object',
  properties: { sub: { type: 'string', maxLength: 60 }, level: { enum: ['read', 'write', 'delete'] } },
  required: ['sub', 'level'],
  additionalProperties: false,
}

export interface TokenInfo {
  user_id: string
  token_id: string
  name: string
  prefix: string
  expires_at: string
  scopes: Readonly<Record<string, string | undefined>>
}

export const metaTokenObter: ActionDef<Record<string, never>, TokenInfo> = {
  id: 'meta.token.obter',
  title: 'Sobre este token',
  description: 'Mostra o dono, o nome, o prefixo, a validade e as permissões efetivas do token usado na chamada.',
  kind: 'read',
  requires: { anyOf: [] },
  input: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    type: 'object',
    properties: {
      user_id: UUID,
      token_id: UUID,
      name: { type: 'string', maxLength: 80 },
      prefix: { type: 'string', maxLength: 14 },
      expires_at: { type: 'string', format: 'date-time' },
      scopes: { type: 'object', description: 'secao.subsecao → read, write ou delete' },
    },
    required: ['user_id', 'token_id', 'name', 'prefix', 'expires_at', 'scopes'],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
  idempotent: true,
  tables: [],
  examples: {
    input: [{}],
    output: [{
      user_id: '2bbe49df-2070-441a-adf6-63116598ed72',
      token_id: '0f6a3c1e-8d2b-4f5a-9c7e-1b2d3e4f5a6b',
      name: 'Claude Code no Mac',
      prefix: 'akool_pat_ab12',
      expires_at: '2026-12-31T12:00:00Z',
      scopes: { 'projetos.cards': 'read', 'projetos.fila': 'write' },
    }],
  },
  run(ctx) {
    const { user_id, token_id, name, prefix, expires_at, scopes } = ctx.principal
    return Promise.resolve({ user_id, token_id, name, prefix, expires_at, scopes })
  },
}

export interface ActionSummary {
  id: string
  title: string
  description: string
  kind: ActionKind
  requires: ActionRequires
}

export const metaAcoesListar: ActionDef<{ secao?: string }, { items: ActionSummary[]; next_cursor: null }> = {
  id: 'meta.acoes.listar',
  title: 'Ações disponíveis',
  description: 'Lista, em ordem, as ações que este token pode chamar, com o que cada uma exige. Filtra por seção com `secao`.',
  kind: 'read',
  requires: { anyOf: [] },
  input: {
    type: 'object',
    properties: { secao: { enum: SECTION_FILTER, description: 'Primeiro segmento do id (ex.: projetos).' } },
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', maxLength: 60 },
            title: { type: 'string', maxLength: 120 },
            description: { type: 'string', maxLength: 300 },
            kind: { enum: ['read', 'create', 'update', 'delete'] },
            requires: {
              type: 'object',
              properties: { allOf: { type: 'array', items: REQUIREMENT }, anyOf: { type: 'array', items: REQUIREMENT } },
              additionalProperties: false,
            },
          },
          required: ['id', 'title', 'description', 'kind', 'requires'],
          additionalProperties: false,
        },
      },
      next_cursor: { type: 'null' },
    },
    required: ['items', 'next_cursor'],
    additionalProperties: false,
  },
  annotations: READ_ANNOTATIONS,
  idempotent: true,
  tables: [],
  examples: {
    input: [{}, { secao: 'meta' }],
    output: [{
      items: [{
        id: 'meta.token.obter',
        title: 'Sobre este token',
        description: 'Mostra o dono, o nome, o prefixo, a validade e as permissões efetivas do token usado na chamada.',
        kind: 'read',
        requires: { anyOf: [] },
      }],
      next_cursor: null,
    }],
  },
  run(ctx, input) {
    const prefix = input.secao ? `${input.secao}.` : ''
    const items = ctx.actions
      .filter(action => action.id.startsWith(prefix) && isAllowed(action.requires, ctx.can))
      .map(({ id, title, description, kind, requires }) => ({ id, title, description, kind, requires }))
    return Promise.resolve({ items, next_cursor: null })
  },
}

export const META_ACTIONS: readonly ActionDef[] = [metaTokenObter, metaAcoesListar]
