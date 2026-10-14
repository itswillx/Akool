import { describe, expect, it } from 'vitest'
import { compileSchema, jsonPointer, matchesFormat, MAX_ISSUES, schemaProblems, validate, type JsonSchema } from './schema.ts'

const issuesOf = (schema: JsonSchema, value: unknown) => {
  const result = validate(schema, value)
  return result.ok ? [] : result.issues
}

describe('jsonPointer', () => {
  it('escapa ~ e / (RFC 6901)', () => {
    expect(jsonPointer([])).toBe('')
    expect(jsonPointer(['a', 0, 'b'])).toBe('/a/0/b')
    expect(jsonPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d')
  })
})

describe('schemaProblems', () => {
  it('aceita o subconjunto, inclusive as palavras só de documentação', () => {
    expect(schemaProblems({
      type: 'object',
      title: 'Card', description: 'Um card', deprecated: false, examples: [{ title: 'x' }],
      properties: { title: { type: 'string', maxLength: 200, pattern: '^\\S', default: 'x' }, tags: { type: 'array', items: { type: 'string' }, maxItems: 5 } },
      required: ['title'],
      additionalProperties: false,
    })).toEqual([])
  })

  it.each([
    [{ allOf: [] }, 'palavra-chave fora do subconjunto: allOf'],
    [{ type: 'decimal' }, 'type inválido'],
    [{ type: ['string', 'string'] }, 'type inválido'],
    [{ additionalProperties: true }, 'additionalProperties só aceita false'],
    [{ required: ['a'] }, 'required cita campo sem properties: a'],
    [{ enum: [] }, 'enum deve ser uma lista não vazia de valores simples'],
    [{ enum: [{}] }, 'enum deve ser uma lista não vazia de valores simples'],
    [{ const: [1] }, 'const deve ser um valor simples'],
    [{ minimum: '1' }, 'minimum deve ser um número'],
    [{ maxLength: -1 }, 'maxLength deve ser um inteiro >= 0'],
    [{ minItems: 3, maxItems: 1 }, 'minItems maior que maxItems'],
    [{ pattern: '(', maxLength: 5 }, 'pattern não compila'],
    [{ pattern: '^a' }, 'pattern exige maxLength'],
    [{ format: 'ipv4' }, 'format fora do subconjunto: ipv4'],
    [{ oneOf: [] }, 'oneOf deve ser uma lista não vazia'],
    [{ deprecated: 'sim' }, 'deprecated deve ser booleano'],
  ])('recusa %j', (schema, problem) => {
    expect(schemaProblems(schema).join('\n')).toContain(problem)
  })

  it('aponta onde está o problema nos schemas aninhados', () => {
    expect(schemaProblems({ properties: { 'a/b': { type: 'x' } }, items: { not: {} } })).toEqual([
      '/properties/a~1b: type inválido',
      '/items: palavra-chave fora do subconjunto: not',
    ])
    expect(schemaProblems(null)).toEqual(['(raiz): o schema deve ser um objeto'])
  })

  it('compileSchema lança com schema fora do subconjunto e reaproveita o validador', () => {
    expect(() => compileSchema({ anyOf: [] } as unknown as JsonSchema)).toThrow(/anyOf/)
    const schema: JsonSchema = { type: 'string' }
    expect(compileSchema(schema)).toBe(compileSchema(schema))
  })
})

describe('validate: tipos', () => {
  it.each([
    [{ type: 'string' }, 'a', true],
    [{ type: 'string' }, 1, false],
    [{ type: 'integer' }, 3, true],
    [{ type: 'integer' }, 3.5, false],
    [{ type: 'integer' }, 2 ** 60, false],
    [{ type: 'number' }, 3.5, true],
    [{ type: 'number' }, 3, true],
    [{ type: 'number' }, Number.NaN, false],
    [{ type: 'number' }, Infinity, false],
    [{ type: 'boolean' }, false, true],
    [{ type: 'null' }, null, true],
    [{ type: 'object' }, [], false],
    [{ type: 'object' }, null, false],
    [{ type: 'array' }, [], true],
    [{ type: ['string', 'null'] }, null, true],
  ] as const)('%j com %j → %s', (schema, value, ok) => {
    expect(validate(schema as JsonSchema, value).ok).toBe(ok)
  })

  it('a mensagem de tipo diz o esperado em português', () => {
    expect(issuesOf({ type: ['integer', 'null'] }, 'x')).toEqual([{ path: '', keyword: 'type', message: 'Tipo inválido: esperado inteiro ou nulo' }])
  })
})

describe('validate: palavras-chave', () => {
  it('const e enum', () => {
    expect(issuesOf({ const: 'read' }, 'write')[0]).toMatchObject({ keyword: 'const', message: 'Deve ser "read"' })
    expect(issuesOf({ enum: ['read', 'write'] }, 'delete')[0]).toMatchObject({ keyword: 'enum' })
    expect(validate({ enum: [1, null] }, null).ok).toBe(true)
  })

  it('mínimo e máximo', () => {
    expect(issuesOf({ type: 'integer', minimum: 1, maximum: 100 }, 0)[0]).toMatchObject({ keyword: 'minimum', message: 'Deve ser no mínimo 1' })
    expect(issuesOf({ type: 'integer', minimum: 1, maximum: 100 }, 101)[0]).toMatchObject({ keyword: 'maximum' })
    expect(validate({ type: 'integer', minimum: 1, maximum: 100 }, 100).ok).toBe(true)
  })

  it('tamanho do texto conta caracteres, não unidades UTF-16', () => {
    expect(validate({ type: 'string', maxLength: 2 }, '😀😀').ok).toBe(true)
    expect(issuesOf({ type: 'string', maxLength: 2 }, 'abc')[0]).toMatchObject({ keyword: 'maxLength' })
    expect(issuesOf({ type: 'string', minLength: 1 }, '')[0]).toMatchObject({ keyword: 'minLength', message: 'Deve ter no mínimo 1 caractere(s)' })
  })

  it('conta pontos de código nas fronteiras, inclusive surrogate solto, e para no teto', () => {
    const lone = '\ud83d'
    expect(validate({ type: 'string', maxLength: 3 }, `ab${lone}`).ok).toBe(true)
    expect(validate({ type: 'string', maxLength: 2 }, `ab${lone}`).ok).toBe(false)
    expect(validate({ type: 'string', minLength: 3, maxLength: 3 }, '😀a😀').ok).toBe(true)
    expect(validate({ type: 'string', minLength: 4 }, '😀a😀').ok).toBe(false)
    expect(validate({ type: 'string', minLength: 2 }, '😀😀').ok).toBe(true)
    expect(issuesOf({ type: 'string', maxLength: 5 }, '😀'.repeat(6)).map(i => i.keyword)).toEqual(['maxLength'])
    // Texto enorme num campo curto: recusado sem percorrer tudo.
    expect(issuesOf({ type: 'string', maxLength: 10 }, 'x'.repeat(2_000_000)).map(i => i.keyword)).toEqual(['maxLength'])
  })

  it('pattern não roda sobre texto acima do maxLength', () => {
    const schema: JsonSchema = { type: 'string', pattern: '^[a-z]+$', maxLength: 5 }
    expect(validate(schema, 'abc').ok).toBe(true)
    expect(issuesOf(schema, 'ab1')[0]).toMatchObject({ keyword: 'pattern', message: 'Formato inválido' })
    expect(issuesOf(schema, 'abcdefg').map(i => i.keyword)).toEqual(['maxLength'])
  })

  it('listas: tamanho e itens, com o índice no caminho', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 }
    expect(issuesOf(schema, [])[0]).toMatchObject({ keyword: 'minItems' })
    expect(issuesOf(schema, ['a', 'b', 'c'])[0]).toMatchObject({ keyword: 'maxItems' })
    expect(issuesOf(schema, ['a', 2])).toEqual([{ path: '/1', keyword: 'type', message: 'Tipo inválido: esperado texto' }])
  })

  it('objetos: obrigatórios, campos extras e caminhos aninhados', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' }, budget: { type: 'object', properties: { amount_cents: { type: 'integer' } }, additionalProperties: false } },
      required: ['name'],
      additionalProperties: false,
    }
    expect(issuesOf(schema, { budget: { amount_cents: 12.5, extra: 1 }, other: true })).toEqual([
      { path: '/name', keyword: 'required', message: 'Campo obrigatório' },
      { path: '/budget/amount_cents', keyword: 'type', message: 'Tipo inválido: esperado inteiro' },
      { path: '/budget/extra', keyword: 'additionalProperties', message: 'Campo não permitido' },
      { path: '/other', keyword: 'additionalProperties', message: 'Campo não permitido' },
    ])
    expect(validate(schema, { name: 'x' }).ok).toBe(true)
  })

  it('sem additionalProperties, campo extra passa; herança do protótipo não conta como campo', () => {
    expect(validate({ type: 'object', properties: { a: { type: 'string' } } }, { b: 1 }).ok).toBe(true)
    expect(issuesOf({ type: 'object', properties: { toString: { type: 'string' as const } }, required: ['toString'] }, {})[0]).toMatchObject({ keyword: 'required' })
  })

  it('para no teto de problemas', () => {
    const issues = issuesOf({ type: 'array', items: { type: 'string' } }, Array.from({ length: 50 }, (_, i) => i))
    expect(issues).toHaveLength(MAX_ISSUES)
  })
})

describe('validate: formatos', () => {
  it.each([
    ['date', '2026-02-28', true],
    ['date', '2026-02-30', false],
    ['date', '2024-02-29', true],
    ['date', '2026-2-1', false],
    ['month', '2026-10', true],
    ['month', '2026-13', false],
    ['date-time', '2026-10-05T12:30:00Z', true],
    ['date-time', '2026-10-05T12:30:00.123456-03:00', true],
    ['date-time', '2026-10-05T12:30:00', false],
    ['date-time', '2026-10-05T24:00:00Z', false],
    ['date-time', '2026-02-30T12:00:00Z', false],
    ['uuid', '2bbe49df-2070-441a-adf6-63116598ed72', true],
    ['uuid', '2bbe49df20704', false],
    ['email', 'ana@exemplo.com.br', true],
    ['email', 'ana@', false],
    ['email', `${'a'.repeat(250)}@x.co`, false],
  ] as const)('%s %j → %s', (format, value, ok) => {
    expect(matchesFormat(value, format)).toBe(ok)
  })

  it('a mensagem diz o formato esperado', () => {
    expect(issuesOf({ type: 'string', format: 'date' }, '05/10/2026')[0]).toMatchObject({ keyword: 'format', message: 'Formato inválido: esperado data AAAA-MM-DD' })
  })
})

describe('validate: oneOf', () => {
  const byKind: JsonSchema = {
    oneOf: [
      { type: 'object', properties: { kind: { const: 'page' }, page_id: { type: 'string', format: 'uuid' } }, required: ['kind', 'page_id'], additionalProperties: false },
      { type: 'object', properties: { kind: { const: 'card' }, card_id: { type: 'string', format: 'uuid' } }, required: ['kind', 'card_id'], additionalProperties: false },
    ],
  }

  it('passa com exatamente uma opção', () => {
    expect(validate(byKind, { kind: 'page', page_id: '2bbe49df-2070-441a-adf6-63116598ed72' }).ok).toBe(true)
  })

  it('com discriminador, explica a opção escolhida', () => {
    expect(issuesOf(byKind, { kind: 'card', card_id: 'x' })).toEqual([
      { path: '/card_id', keyword: 'format', message: 'Formato inválido: esperado UUID' },
    ])
  })

  it('sem opção que sirva ou com mais de uma, diz isso', () => {
    expect(issuesOf(byKind, { kind: 'outro' })[0]).toMatchObject({ keyword: 'oneOf', message: 'Não corresponde a nenhuma das opções' })
    expect(issuesOf({ oneOf: [{ type: 'integer' }, { type: 'number' }] }, 3)[0]).toMatchObject({ keyword: 'oneOf', message: 'Corresponde a mais de uma opção' })
    expect(issuesOf({ oneOf: [{ type: 'string' }, { type: 'boolean' }] }, 3)[0]).toMatchObject({ keyword: 'oneOf' })
  })
})
