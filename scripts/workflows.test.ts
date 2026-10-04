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

// DEV-008: dependências vigiadas toda semana, e o CI barra vulnerabilidade alta
// em produção sem exceção válida.
describe('dependabot.yml e audit no CI', () => {
  const dependabot = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8')
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

  it('vigia npm e GitHub Actions toda semana, agrupando minor e patch', () => {
    expect(dependabot).toMatch(/package-ecosystem: npm[\s\S]*interval: weekly/)
    expect(dependabot).toMatch(/package-ecosystem: github-actions[\s\S]*interval: weekly/)
    expect(dependabot).toMatch(/groups:\s*\n\s*minor-e-patch:\s*\n\s*update-types: \[minor, patch\]/)
  })

  it('o CI roda o gate de audit depois de instalar', () => {
    const install = ci.indexOf('run: npm ci')
    const audit = ci.indexOf('run: npm run audit:ci')
    expect(install).toBeGreaterThan(0)
    expect(audit).toBeGreaterThan(install)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['audit:ci']).toBe('node scripts/audit-gate.mjs')
  })

  it('toda exceção do audit tem GHSA, motivo e validade', () => {
    const list = JSON.parse(readFileSync(join(ROOT, 'scripts/audit-allowlist.json'), 'utf8')) as { id: string; motivo: string; ate: string }[]
    for (const e of list) {
      expect(e.id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/)
      expect(e.motivo.length).toBeGreaterThan(10)
      expect(e.ate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  // O Excalidraw 0.18.1 fixa o sass 1.51.0, que puxa o chokidar 3 e o braces
  // (GHSA-vfj7-8cjw-p6xm, sem versão corrigida). O override troca pelo sass
  // 1.79.4 (chokidar 4, sem braces); o dist do Excalidraw nem importa o sass.
  it('o override do sass sai quando o Excalidraw trocar o sass 1.51.0', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { overrides: Record<string, unknown> }
    const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { dependencies?: Record<string, string> }> }
    expect(pkg.overrides.sass).toBe('1.79.4')
    const excalidrawSass = lock.packages['node_modules/@excalidraw/excalidraw']?.dependencies?.sass
    expect(excalidrawSass, 'o Excalidraw trocou o sass: tire o override "sass" do package.json e este teste').toBe('1.51.0')
  })
})

// DEV-009: o link do preview vem de uma variável do repositório, nunca de um
// domínio fixo no workflow, e o job só precisa comentar no PR.
describe('preview-link.yml', () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/preview-link.yml'), 'utf8')

  it('roda quando o PR abre, com a permissão mínima', () => {
    expect(wf).toMatch(/pull_request:\s*\n\s*types: \[opened, reopened\]/)
    expect(wf).toMatch(/permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: write/)
    expect(wf).not.toMatch(/secrets\./)
  })

  it('usa a variável PREVIEW_URL_TEMPLATE e pula sem ela', () => {
    expect(wf).toContain('vars.PREVIEW_URL_TEMPLATE')
    expect(wf).toContain('exit 0')
    expect(wf).not.toMatch(/https?:\/\/[a-z0-9.-]+\.(com|br|app)\b/)
  })
})
