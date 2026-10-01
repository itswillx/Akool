import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FETCH_PAGE_SIZE } from '../src/lib/fetchAllRows'

// SEC-008: o que nunca pode ir para o repositório tem de continuar no
// .gitignore — segredos (.env), estado do Supabase CLI (project ref, org, host
// do pooler), exports com dados reais e a config local do TestSprite. A
// varredura de segredos fica com o gitleaks; aqui só se trava a regressão de
// alguém tirar uma dessas linhas.

const ROOT = join(__dirname, '..')

export const PRIVATE_PATHS = ['.env', '.env.local', 'supabase/.temp/', 'supabase/backups/', 'testsprite_tests/tmp/']

/** Linhas efetivas do .gitignore (sem comentário nem espaço). */
export function gitignoreEntries(text: string): Set<string> {
  return new Set(text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')))
}

describe('.gitignore', () => {
  it('cobre segredos, estado do CLI e dados reais', () => {
    const entries = gitignoreEntries(readFileSync(join(ROOT, '.gitignore'), 'utf8'))
    expect(PRIVATE_PATHS.filter(p => !entries.has(p))).toEqual([])
  })

  it('ignora comentários e linhas vazias', () => {
    expect([...gitignoreEntries('# x\n\n  supabase/.temp/  \n.env\n')]).toEqual(['supabase/.temp/', '.env'])
  })
})

// REL-005: o Caddyfile de produção (Coolify) vem do [staticAssets] do
// nixpacks.toml. Sem estas regras, chunk velho volta a receber o index.html com
// 200 e somem cache e headers de segurança. A sintaxe fica com o
// `caddy validate` (docs/deploy-coolify.md, seção 6); aqui só se trava a
// regressão de alguém tirar uma regra.
describe('nixpacks.toml (Caddyfile de produção)', () => {
  const toml = readFileSync(join(ROOT, 'nixpacks.toml'), 'utf8')
  const caddyfile = /^Caddyfile = '''\n([\s\S]*?)'''/m.exec(toml)?.[1] ?? ''

  it('substitui o Caddyfile padrão do Nixpacks', () => {
    expect(toml).toMatch(/^\[staticAssets\]$/m)
    expect(caddyfile).toContain('root * ../app/{$NIXPACKS_SPA_OUTPUT_DIR}')
  })

  it('asset que não existe não cai no index.html', () => {
    expect(caddyfile).toMatch(/handle \/assets\/\* \{\s*file_server\s*\}/)
    expect(caddyfile).toMatch(/handle \{[\s\S]*try_files \{path\} \/index\.html/)
  })

  it('cache de 1 ano só em asset que existe; o resto revalida', () => {
    expect(caddyfile).toMatch(/@asset_exists \{\s*path \/assets\/\*\s*file\s*\}/)
    expect(caddyfile).toContain('header @asset_exists Cache-Control "public, max-age=31536000, immutable"')
    expect(caddyfile).toContain('header Cache-Control "no-cache"')
  })

  it('manda os headers de segurança', () => {
    const headers = ['X-Frame-Options "DENY"', 'X-Content-Type-Options "nosniff"', 'Referrer-Policy "', 'Permissions-Policy "']
    expect(headers.filter(h => !caddyfile.includes(h))).toEqual([])
  })

  // SEC-009: HSTS e CSP. A CSP está em Report-Only até as telas logadas serem
  // conferidas; o script-src nunca pode abrir para inline nem eval.
  it('manda HSTS e uma CSP sem script inline nem eval', () => {
    expect(caddyfile).toMatch(/Strict-Transport-Security "max-age=\d{8,}"/)
    const csp = /Content-Security-Policy(?:-Report-Only)? "([^"]+)"/.exec(caddyfile)?.[1] ?? ''
    const directives = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
    expect(directives['script-src']).toEqual(["'self'"])
    expect(directives['object-src']).toEqual(["'none'"])
    expect(directives['frame-ancestors']).toEqual(["'none'"])
    expect(directives['default-src']).toEqual(["'self'"])
  })

  it('fontes do Excalidraw: cache longo e sem cair no index.html', () => {
    expect(caddyfile).toMatch(/@excalidraw_asset_exists \{\s*path \/excalidraw-assets\/\*\s*file\s*\}/)
    expect(caddyfile).toContain('header @excalidraw_asset_exists Cache-Control "public, max-age=31536000, immutable"')
    expect(caddyfile).toMatch(/handle \/excalidraw-assets\/\* \{\s*file_server\s*\}/)
  })
})

// DEV-004: o Coolify instala com `npm ci`, que só funciona com o lock em
// sincronia e com as bindings nativas de Linux dentro dele (um lock gerado
// por npm antigo no macOS podia deixá-las de fora).
describe('build reprodutível (npm ci)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
  const toml = readFileSync(join(ROOT, 'nixpacks.toml'), 'utf8')

  it('package.json e package-lock.json em sincronia', () => {
    const root = lock.packages['']
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      expect(root[field] ?? {}, field).toEqual(pkg[field] ?? {})
    }
  })

  it('o lock traz as bindings nativas de Linux x64 e arm64', () => {
    const missing = ['@rolldown/binding', 'lightningcss', '@tailwindcss/oxide']
      .flatMap(base => ['linux-x64-gnu', 'linux-arm64-gnu'].map(target => `node_modules/${base}-${target}`))
      .filter(path => !lock.packages[path])
    expect(missing).toEqual([])
  })

  it('o Nixpacks instala com npm ci e com engine-strict ligado', () => {
    expect(toml).toMatch(/cmds = \["npm ci\b/)
    expect(readFileSync(join(ROOT, '.npmrc'), 'utf8')).toMatch(/^engine-strict=true$/m)
  })

  it('o Node do Nixpacks cabe no engines do package.json', () => {
    const major = toml.match(/NIXPACKS_NODE_VERSION = "(\d+)"/)?.[1]
    expect(major).toBeTruthy()
    expect(pkg.engines?.node ?? '').toMatch(new RegExp(`\\^${major}\\.`))
  })
})

// DEV-007: o README não pode apodrecer em silêncio — todo \`npm run X\` citado
// existe no package.json, e todo link relativo aponta para um arquivo real.
describe('README', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>

  it('só cita scripts que existem no package.json', () => {
    const cited = [...readme.matchAll(/npm run ([\w:-]+)/g)].map(m => m[1])
    expect(cited.length).toBeGreaterThan(0)
    expect(cited.filter(name => !(name in scripts))).toEqual([])
  })

  it('links relativos apontam para arquivos que existem', () => {
    const links = [...readme.matchAll(/\]\((?:<([^>]+)>|([^)\s]+))\)/g)]
      .map(m => (m[1] ?? m[2]).split('#')[0])
      .filter(link => link && !/^[a-z]+:/i.test(link))
    expect(links.length).toBeGreaterThan(0)
    expect(links.filter(link => !existsSync(join(ROOT, decodeURIComponent(link))))).toEqual([])
  })
})

// SEC-009: script inline obrigaria 'unsafe-inline' no script-src da CSP.
describe('index.html', () => {
  it('não tem script inline', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) || body.trim())
    expect(inline.map(([tag]) => tag)).toEqual([])
  })
})

describe('leituras paginadas (REL-003)', () => {
  it('a página do fetchAllRows não passa do max_rows do PostgREST', () => {
    const toml = readFileSync(join(ROOT, 'supabase/config.toml'), 'utf8')
    const maxRows = Number(/^\s*max_rows\s*=\s*(\d+)/m.exec(toml)?.[1])
    expect(maxRows).toBeGreaterThanOrEqual(FETCH_PAGE_SIZE)
  })
})

// UX-014: o index.html referencia o manifest, os ícones e a fonte local; cada
// arquivo referenciado tem de existir em public/, senão o deploy serve o
// index.html no lugar (fallback do SPA) e o navegador engole o erro.
describe('index.html (UX-014)', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')

  it('declara description, theme-color (claro e escuro), manifest e apple-touch-icon', () => {
    expect(html).toMatch(/<meta name="description" content="[^"]{20,}"/)
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: light\)"/)
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-f]{6}" media="\(prefers-color-scheme: dark\)"/)
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
    expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png"')
    expect(html).not.toContain('fonts.googleapis.com')
  })

  it('todo arquivo de public/ referenciado no index.html e no manifest existe', () => {
    const manifest = readFileSync(join(ROOT, 'public/manifest.webmanifest'), 'utf8')
    const refs = [...(html + manifest).matchAll(/(?:href|src)=?"?:?\s*"?(\/[\w./-]+\.(?:svg|png|webmanifest|woff2))"/g)].map(m => m[1])
    expect(refs.length).toBeGreaterThanOrEqual(6)
    expect(refs.filter(r => !existsSync(join(ROOT, 'public', r)))).toEqual([])
  })

  it('o favicon fica branco em aba escura', () => {
    const svg = readFileSync(join(ROOT, 'public/favicon.svg'), 'utf8')
    expect(svg).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*path\s*\{\s*fill:\s*#fff/)
  })
})
