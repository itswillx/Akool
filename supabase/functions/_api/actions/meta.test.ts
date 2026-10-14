import { describe, expect, it } from 'vitest'
import { validate } from '../schema.ts'
import type { ActionCtx, ActionDef } from '../types.ts'
import { META_ACTIONS, metaAcoesListar, metaTokenObter } from './meta.ts'

// API-008: as ações sempre permitidas, sobre um ctx falso. A saída de cada uma
// passa no próprio outputSchema.

const principal = {
  user_id: '2bbe49df-2070-441a-adf6-63116598ed72',
  token_id: '0f6a3c1e-8d2b-4f5a-9c7e-1b2d3e4f5a6b',
  name: 'Claude Code no Mac',
  prefix: 'akool_pat_ab12',
  expires_at: '2026-12-31T12:00:00Z',
  scopes: { 'projetos.cards': 'read' as const },
}

const action = (id: string, sub?: string): ActionDef => ({
  ...metaTokenObter,
  id,
  title: id,
  requires: sub ? { allOf: [{ sub, level: 'read' }] } : { anyOf: [] },
})

const ctxWith = (actions: readonly ActionDef[]): ActionCtx => ({
  tx: { query: () => Promise.resolve([]) },
  principal,
  can: (sub, level) => sub === 'projetos.cards' && level === 'read',
  storage: { createSignedUrl: () => Promise.resolve('') },
  tz: 'America/Sao_Paulo',
  now: new Date('2026-10-07T12:00:00Z'),
  request: { surface: 'rest', client: null, ip_bucket: null },
  hooks: {},
  actions,
})

describe('meta.token.obter', () => {
  it('devolve o principal sem nada a mais, no formato do outputSchema', async () => {
    const out = await metaTokenObter.run(ctxWith([]), {})
    expect(out).toEqual(principal)
    expect(validate(metaTokenObter.output, out)).toEqual({ ok: true })
  })
})

describe('meta.acoes.listar', () => {
  const registry = [action('financas.contas.listar', 'financas.contas'), action('meta.token.obter'), action('projetos.cards.listar', 'projetos.cards')]

  it('lista só o que o token pode chamar, na ordem do registro', async () => {
    const out = await metaAcoesListar.run(ctxWith(registry), {})
    expect(out.items.map(i => i.id)).toEqual(['meta.token.obter', 'projetos.cards.listar'])
    expect(out.next_cursor).toBeNull()
    expect(validate(metaAcoesListar.output, out)).toEqual({ ok: true })
  })

  it('filtra pela seção (primeiro segmento do id)', async () => {
    expect((await metaAcoesListar.run(ctxWith(registry), { secao: 'projetos' })).items.map(i => i.id)).toEqual(['projetos.cards.listar'])
    expect((await metaAcoesListar.run(ctxWith(registry), { secao: 'financas' })).items).toEqual([])
  })

  it('o filtro aceita as seções do catálogo e os namespaces compostos', () => {
    expect(metaAcoesListar.input.properties?.secao.enum).toEqual(
      expect.arrayContaining(['admin', 'compartilhamento', 'documentos', 'estudos', 'financas', 'meta', 'painel', 'perfil', 'projetos']),
    )
  })

  it('as duas ações meta são sempre permitidas', () => {
    expect(META_ACTIONS.map(a => a.requires)).toEqual([{ anyOf: [] }, { anyOf: [] }])
  })
})
