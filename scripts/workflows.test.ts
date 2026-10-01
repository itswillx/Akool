import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — script .mjs sem tipos
import { PRODUCTION_REF } from './staging-reset.mjs'

// DEV-005: o workflow de deploy lista exatamente as functions do repo e só
// conhece os dois projetos (produção e staging).

const ROOT = join(__dirname, '..')
const deploy = readFileSync(join(ROOT, '.github/workflows/deploy-functions.yml'), 'utf8')

describe('deploy-functions.yml', () => {
  it('oferece exatamente as functions de supabase/functions/', () => {
    const block = deploy.slice(deploy.indexOf('function:'), deploy.indexOf('target:'))
    const options = [...block.matchAll(/^ {10}- ([a-z0-9-]+)$/gm)].map(m => m[1]).sort()
    const dir = join(ROOT, 'supabase/functions')
    const repo = readdirSync(dir).filter(n => !n.startsWith('_') && existsSync(join(dir, n, 'index.ts'))).sort()
    expect(options).toEqual(repo)
  })

  it('produção só pelo Environment e com o ref certo; o resto vai para o staging', () => {
    expect(deploy).toContain('environment: ${{ inputs.target }}')
    expect(deploy).toContain(`REF=${PRODUCTION_REF}; else REF=ixqpkmxmgftchgwbrogw`)
    expect(deploy).toMatch(/supabase@\d+\.\d+\.\d+ functions deploy/)
  })
})
