import { execSync } from 'node:child_process'
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

// REL-007 e UX-011 (auditoria da validação): a data "de hoje" vem do relógio
// local (localDateKey), nunca da data UTC (que vira amanhã às 21h em
// Brasília); e toda data formatada leva o locale do perfil (localeOf(lang)),
// nunca o do navegador. Os dois resíduos voltaram depois dos cards; esta trava
// impede o terceiro.
describe('datas: relógio local e locale do perfil (REL-007, UX-011)', () => {
  const files = execSync('git ls-files src', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(f => /\.(ts|tsx)$/.test(f) && !/\.(test|bench)\.|\/test\//.test(f) && f !== 'src/lib/localDate.ts')

  const offenders = (re: RegExp) => files.flatMap(f => {
    const text = readFileSync(join(ROOT, f), 'utf8')
    return text.split('\n').flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}`] : []))
  })

  it('nenhuma data UTC como "hoje" fora do localDate.ts', () => {
    expect(offenders(/toISOString\(\)\.(slice\(0, 10\)|split\('T'\)\[0\])/)).toEqual([])
  })

  it('nenhuma data formatada sem locale', () => {
    expect(offenders(/toLocale(Date|Time)?String\(\)/)).toEqual([])
  })
})

// QA-006: toda chave de localStorage/sessionStorage vem de src/lib/localKeys.ts.
// Chave escrita como string no meio do código não entra no inventário, não é
// migrada e o logout não sabe dela.
describe('chaves de storage só no inventário (QA-006)', () => {
  const files = execSync('git ls-files src', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter(f => /\.(ts|tsx)$/.test(f) && !/\.(test|bench)\.|\/test\//.test(f) && f !== 'src/lib/localKeys.ts')
  const lines = (re: RegExp) => files.flatMap(f => readFileSync(join(ROOT, f), 'utf8').split('\n')
    .flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}`] : [])))

  it('nenhuma chave literal em getItem/setItem/removeItem', () => {
    expect(lines(/(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(\s*['"`]/)).toEqual([])
  })

  it('nenhum nome antigo (excalinotion_*, akool_*) fora do inventário', () => {
    // Os prefixos projects_/finance_ coincidem com chaves de tradução, então
    // ficam cobertos só pela regra de cima (chamadas de storage).
    expect(lines(/['"`](excalinotion_|akool_(workspace_mode|onboarding_seen|recovery_pending))/)).toEqual([])
  })
})

// DEV-011: o dev server fica em localhost; expor na rede é opt-in (dev:lan).
describe('dev server (DEV-011)', () => {
  it('vite.config.ts não liga host: true; dev:lan existe com --host', () => {
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')
    expect(vite).not.toMatch(/host:\s*true/)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['dev:lan']).toBe('vite --host')
    expect(pkg.scripts.dev).toBe('vite')
  })
})

// DEV-012: docs e configs apontando para o que existe.
describe('docs e configs em dia (DEV-012)', () => {
  it('toda migration citada no README de migrations existe', () => {
    const readme = readFileSync(join(ROOT, 'supabase/migrations/README.md'), 'utf8')
    const cited = [...new Set(readme.match(/2026\d{10}_[a-z0-9_]+\.sql/g) ?? [])]
    expect(cited.length).toBeGreaterThan(3)
    expect(cited.filter(f => !existsSync(join(ROOT, 'supabase/migrations', f)))).toEqual([])
  })

  it('.gitignore sem barra invertida', () => {
    const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')
    expect(lines.filter(l => l.includes('\\'))).toEqual([])
  })

  it('toda variável que as functions leem está documentada ou é injetada pelo Supabase', () => {
    const injected = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
    const example = readFileSync(join(ROOT, 'supabase/functions/.env.example'), 'utf8')
    const deploy = readFileSync(join(ROOT, 'docs/deploy-coolify.md'), 'utf8')
    const files = execSync('git ls-files supabase/functions', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(f => f.endsWith('.ts') && !f.includes('.test.'))
    const read = new Set(files.flatMap(f => [...readFileSync(join(ROOT, f), 'utf8').matchAll(/Deno\.env\.get\(["']([A-Z_]+)["']\)/g)].map(m => m[1])))
    expect(read.size).toBeGreaterThan(2)
    const missing = [...read].filter(v => !injected.has(v) && !(example.includes(`${v}=`) && deploy.includes(v)))
    expect(missing).toEqual([])
  })

  it('o README tem a seção Portas com 5173 e 4173', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(readme).toMatch(/### Portas[\s\S]*\| 5173 \|[\s\S]*\| 4173 \|/)
  })
})
