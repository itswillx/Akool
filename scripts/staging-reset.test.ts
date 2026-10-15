import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos; a lógica pura é o que importa aqui.
import { PRODUCTION_REF, assertStagingRef, functionBundle, migrationFiles, pendingMigrations, relativeImports, verifyJwtFor } from './staging-reset.mjs'

// DEV-002: o script que monta o staging a partir do repo. O que mais importa:
// nunca apontar para a produção.

const ROOT = join(__dirname, '..')

describe('staging-reset: trava da produção', () => {
  it('recusa o ref da produção', () => {
    expect(() => assertStagingRef(PRODUCTION_REF)).toThrow(/PRODUÇÃO/)
  })

  it('recusa ref vazio ou fora do formato', () => {
    expect(() => assertStagingRef(undefined)).toThrow(/não definido/)
    expect(() => assertStagingRef('https://x.supabase.co')).toThrow(/inválido/)
  })

  it('aceita o ref do staging', () => {
    expect(assertStagingRef('ixqpkmxmgftchgwbrogw')).toBe('ixqpkmxmgftchgwbrogw')
  })
})

describe('staging-reset: migrations', () => {
  const files = migrationFiles(['README.md', '20260509000001_b.sql', '20260509000000_a.sql', '20260601000000_c.sql'])

  it('ordena pela versão e separa o nome', () => {
    expect(files).toEqual([
      { file: '20260509000000_a.sql', version: '20260509000000', name: 'a' },
      { file: '20260509000001_b.sql', version: '20260509000001', name: 'b' },
      { file: '20260601000000_c.sql', version: '20260601000000', name: 'c' },
    ])
  })

  it('pula o que já está no ledger (pelo nome) e retoma de um arquivo', () => {
    expect(pendingMigrations(files, ['a'], undefined).map((m: { name: string }) => m.name)).toEqual(['b', 'c'])
    expect(pendingMigrations(files, [], '20260509000001_b.sql').map((m: { name: string }) => m.name)).toEqual(['b', 'c'])
    expect(() => pendingMigrations(files, [], 'nao_existe.sql')).toThrow(/--from/)
  })

  it('a baseline é a primeira migration do repo', () => {
    const real = migrationFiles(readdirSync(join(ROOT, 'supabase/migrations')))
    expect(real[0].name).toBe('baseline_remote_schema')
  })
})

describe('staging-reset: functions', () => {
  const toml = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8')

  it('verify_jwt vem do config.toml (padrão true)', () => {
    expect(verifyJwtFor('site-backup', toml)).toBe(false)
    expect(verifyJwtFor('admin-ops', toml)).toBe(true)
    // Seção sem `verify_jwt` não herda o valor da seção seguinte, seja ela de
    // function ou não (o config.toml real só tem uma seção de function, no
    // fim). Sem o terminador da regex, a e c leriam o `false` de baixo.
    const toml2 = '[functions.a]\n\n[functions.b]\nverify_jwt = false\n\n[functions.c]\n\n[analytics]\nverify_jwt = false\n'
    expect(['a', 'b', 'c'].map(slug => verifyJwtFor(slug, toml2))).toEqual([true, false, true])
  })

  it('acha os imports relativos', () => {
    expect(relativeImports(`import { a } from "./rules.ts";\nimport x from '../_shared/cors.ts'\nimport "jsr:@supabase/x"`))
      .toEqual(['./rules.ts', '../_shared/cors.ts'])
  })

  it('empacota o entrypoint com os arquivos locais e de _shared', () => {
    const bundle = functionBundle('admin-ops', (rel: string) => readFileSync(join(ROOT, 'supabase/functions', rel), 'utf8'))
    // _shared/sentry.ts importa _shared/scrub.ts: vem junto; _shared/aal.ts é do SEC-004.
    expect([...bundle.keys()].sort()).toEqual(['_shared/aal.ts', '_shared/cors.ts', '_shared/scrub.ts', '_shared/sentry.ts', 'admin-ops/index.ts', 'admin-ops/rules.ts'])
  })
})
