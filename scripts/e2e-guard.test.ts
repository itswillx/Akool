import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_REF, assertNotProduction, parseEnvFile, stagingEnv } from '../e2e/env'

// DEV-002/QA-003: o E2E nunca roda contra a produção.

describe('e2e/env', () => {
  it('recusa a URL da produção e a ausência de URL', () => {
    expect(() => assertNotProduction(`https://${PRODUCTION_REF}.supabase.co`)).toThrow(/PRODUÇÃO/)
    expect(() => assertNotProduction(undefined)).toThrow(/não definido/)
    expect(assertNotProduction('https://ixqpkmxmgftchgwbrogw.supabase.co')).toContain('ixqpkmxmgftchgwbrogw')
  })

  it('lê como o vite --mode staging: .env.staging.local vence .env.local, e o ambiente vence os dois', () => {
    const dir = mkdtempSync(join(tmpdir(), 'akool-e2e-'))
    writeFileSync(join(dir, '.env.local'), `VITE_SUPABASE_URL=https://${PRODUCTION_REF}.supabase.co\nE2E_USER=do-local\n`)
    writeFileSync(join(dir, '.env.staging.local'), '# staging\nVITE_SUPABASE_URL="https://ixqpkmxmgftchgwbrogw.supabase.co"\n')
    const env = stagingEnv(dir + '/', { E2E_USER: 'do-ci' })
    expect(env.VITE_SUPABASE_URL).toBe('https://ixqpkmxmgftchgwbrogw.supabase.co')
    expect(env.E2E_USER).toBe('do-ci')
  })

  it('parseEnvFile ignora comentários e tira aspas', () => {
    expect(parseEnvFile("# x\nA=1\nB='dois'\n  C = três \n")).toEqual({ A: '1', B: 'dois', C: 'três' })
  })
})
