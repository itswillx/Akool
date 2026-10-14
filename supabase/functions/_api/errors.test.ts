import { describe, expect, it } from 'vitest'
import {
  apiError, ERROR_STATUS, fromPgError, GENERIC_MESSAGE, insufficientScope, isAppMessage, sqlstateToCode, validationFailed,
  type ErrorCode,
} from './errors.ts'

describe('tabela de códigos', () => {
  it('todo código tem status e mensagem genérica', () => {
    const codes = Object.keys(ERROR_STATUS) as ErrorCode[]
    expect(codes).toHaveLength(14)
    for (const code of codes) expect(GENERIC_MESSAGE[code]).toBeTruthy()
  })

  it.each([
    ['42501', 'forbidden', 403],
    ['P0002', 'not_found', 404],
    ['22023', 'validation_failed', 422],
    ['22P02', 'validation_failed', 422],
    ['23514', 'validation_failed', 422],
    ['23503', 'validation_failed', 422],
    ['23502', 'validation_failed', 422],
    ['22001', 'validation_failed', 422],
    ['22003', 'validation_failed', 422],
    ['P0001', 'conflict', 409],
    ['23505', 'conflict', 409],
    ['40001', 'unavailable', 503],
    ['40P01', 'unavailable', 503],
    ['55P03', 'unavailable', 503],
    ['57014', 'timeout', 504],
    ['XX000', 'internal', 500],
    [undefined, 'internal', 500],
  ] as const)('SQLSTATE %s → %s (%i)', (state, code, status) => {
    expect(sqlstateToCode(state)).toBe(code)
    expect(fromPgError({ code: state, message: 'x' }).status).toBe(status)
  })

  it('nome de propriedade herdada não vira código', () => {
    expect(sqlstateToCode('toString')).toBe('internal')
  })
})

describe('fromPgError', () => {
  it('RAISE do app (P0001) passa a mensagem', () => {
    const res = fromPgError({ code: 'P0001', message: 'Limite de 20 tokens ativos.' })
    expect(res.body).toEqual({ error: { code: 'conflict', message: 'Limite de 20 tokens ativos.' } })
  })

  it("outro código só passa a mensagem com hint = 'akool'", () => {
    expect(fromPgError({ code: '22023', message: 'Validade deve ser de 7, 30, 90 ou 365 dias', hint: 'akool' }).body.error.message)
      .toBe('Validade deve ser de 7, 30, 90 ou 365 dias')
    expect(fromPgError({ code: '42501', message: 'new row violates row-level security policy for table "pages"' }).body.error)
      .toEqual({ code: 'forbidden', message: GENERIC_MESSAGE.forbidden })
    expect(isAppMessage({ code: '42501', hint: 'akool' })).toBe(true)
    expect(isAppMessage({ code: '42501', hint: 'outro' })).toBe(false)
  })

  it('detail, details e hint nunca vão no corpo', () => {
    const res = fromPgError({ code: '23505', message: 'dup', detail: 'Key (email)=(ana@x.com) already exists.', details: 'x', hint: 'y' })
    expect(JSON.stringify(res.body)).not.toMatch(/ana@x\.com|already exists|"y"/)
  })

  it('500 é reportado e não vaza o texto do banco', () => {
    const res = fromPgError({ code: '42P01', message: 'relation "x" does not exist' })
    expect(res).toMatchObject({ status: 500, report: true, body: { error: { code: 'internal', message: 'Erro interno.' } } })
  })

  it('503 e 504 sugerem quando tentar de novo', () => {
    expect(fromPgError({ code: '40P01' })).toMatchObject({ headers: { 'Retry-After': '1' }, body: { error: { retry_after: 1 } } })
    expect(fromPgError({ code: '57014' })).toMatchObject({ headers: { 'Retry-After': '2' }, body: { error: { retry_after: 2 } } })
  })

  it('limite de taxa pelo postgres.js (PGRST com JSON) e pelo PostgREST', () => {
    const raw = {
      code: 'PGRST',
      message: JSON.stringify({ code: 'rate_limited', message: 'Muitas tentativas.', hint: 'retry_after_seconds=42' }),
      detail: JSON.stringify({ status: 429 }),
    }
    expect(fromPgError(raw)).toMatchObject({ status: 429, headers: { 'Retry-After': '42' }, body: { error: { code: 'rate_limited', retry_after: 42 } } })
    expect(fromPgError({ code: 'rate_limited', hint: 'retry_after_seconds=7' }).body.error.retry_after).toBe(7)
    expect(fromPgError({ code: 'rate_limited' }).body.error.retry_after).toBe(1)
    expect(fromPgError({ code: 'PGRST', message: 'não é JSON' }).status).toBe(500)
  })
})

describe('apiError', () => {
  it('401 manda o desafio Bearer', () => {
    expect(apiError('unauthenticated').headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="akool"' })
    expect(apiError('token_invalid').headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="akool", error="invalid_token"' })
  })

  it('campos opcionais só aparecem quando existem', () => {
    expect(apiError('not_found').body).toEqual({ error: { code: 'not_found', message: 'Não encontrado.' } })
    expect(apiError('version_conflict', { details: { current_updated_at: 'v2' } }).body.error.details).toEqual({ current_updated_at: 'v2' })
  })

  it('validation_failed leva os problemas em JSON Pointer', () => {
    const res = validationFailed([{ path: '/amount_cents', keyword: 'type', message: 'Tipo inválido: esperado inteiro' }])
    expect(res).toMatchObject({ status: 422, body: { error: { code: 'validation_failed', details: [{ path: '/amount_cents' }] } } })
  })
})

describe('insufficientScope', () => {
  it('diz a permissão que falta, em português, e lista o que exige', () => {
    const res = insufficientScope([{ sub: 'projetos.validacao', level: 'write' }])
    expect(res.status).toBe(403)
    expect(res.body.error).toEqual({
      code: 'insufficient_scope',
      message: 'Este token não tem a permissão Projetos › Validação (aprovar/reprovar): Escrever. Libere editando o token ou gerando outro em Configurações → API.',
      required: ['projetos.validacao:write'],
    })
  })

  it('com qualquer uma bastando, junta com "ou"', () => {
    const res = insufficientScope([{ sub: 'documentos.paginas', level: 'read' }, { sub: 'projetos.cards', level: 'read' }], 'any')
    expect(res.body.error.message).toContain('Documentos › Páginas: Ler ou Projetos › Cards: Ler')
    expect(res.body.error.required).toEqual(['documentos.paginas:read', 'projetos.cards:read'])
  })
})
