import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// SEC-001: guarda contra credenciais nos testes do TestSprite. Os scripts
// TC0*.py são gerados com os valores literais do login, então uma nova geração
// traria de volta a senha do admin. O gitleaks não pega esse caso (senha só de
// dígitos tem entropia baixa); a regra aqui é estrutural e a mensagem aponta
// arquivo e linha, nunca o valor encontrado:
//   - fill() dos campos do login só com LOGIN_USER / LOGIN_PASSWORD (do
//     ambiente) ou um valor fictício (e-mail de domínio reservado, senha da
//     lista FAKE_PASSWORDS);
//   - nenhum e-mail fora dos domínios reservados (RFC 2606);
//   - em JSON, test_credentials e chaves de senha/token só com placeholder {{…}}.
// testsprite_tests/tmp/ fica de fora: é a config local do TestSprite (gitignored).

const ROOT = join(__dirname, '..')
const DIR = join(ROOT, 'testsprite_tests')

const LOGIN_FIELDS: Record<string, { name: string; envVar: string }> = {
  'you@example.com': { name: 'e-mail', envVar: 'LOGIN_USER' },
  '••••••••': { name: 'senha', envVar: 'LOGIN_PASSWORD' },
}
const FAKE_PASSWORDS = new Set(['invalid-password', 'wrong-password', ''])
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g
const PLACEHOLDER = /^\{\{[A-Z0-9_]+\}\}$/
const SECRET_KEY = /^(password|senha|secret|token|api_?key)$/i

export function isReservedDomain(domain: string): boolean {
  const d = domain.toLowerCase()
  return /(^|\.)example\.(com|net|org)$/.test(d) || /\.(test|example|invalid|localhost)$/.test(d)
}

function checkPython(text: string): { line: number; problem: string }[] {
  const found: { line: number; problem: string }[] = []
  let field: { name: string; envVar: string } | null = null
  text.split('\n').forEach((raw, i) => {
    const line = i + 1
    const locator = raw.match(/get_by_placeholder\('([^']*)'/)
    if (locator) {
      field = LOGIN_FIELDS[locator[1]] ?? null
      return
    }
    if (/\.get_by_\w+\(|page\.locator\(/.test(raw)) field = null
    const fill = raw.match(/\.fill\((.*)\)\s*$/)
    if (!fill || !field) return
    const arg = fill[1].trim()
    const literal = arg.match(/^(["'])(.*)\1$/)
    if (arg !== field.envVar) {
      const fake = literal && (field.envVar === 'LOGIN_USER'
        ? [...literal[2].matchAll(EMAIL)].every(m => isReservedDomain(m[1])) && literal[2].includes('@')
        : FAKE_PASSWORDS.has(literal[2]))
      if (!fake) found.push({ line, problem: `${field.name} literal no login (use ${field.envVar} do ambiente)` })
    }
    field = null
  })
  return found
}

function checkJson(text: string): { line: number; problem: string }[] {
  const found: { line: number; problem: string }[] = []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return [{ line: 1, problem: 'JSON inválido' }]
  }
  const lines = text.split('\n')
  // Linha da chave: a 1ª ocorrência a partir da linha da chave-mãe (0-based).
  const lineOf = (key: string, from: number) => {
    const i = lines.findIndex((l, n) => n >= from && l.includes(`"${key}"`))
    return i < 0 ? from : i
  }
  const visit = (node: unknown, path: string, inCredentials: boolean, from: number) => {
    if (Array.isArray(node)) return node.forEach((v, i) => visit(v, `${path}[${i}]`, inCredentials, from))
    if (!node || typeof node !== 'object') return
    let cursor = from
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key
      const at = (cursor = lineOf(key, cursor))
      const creds = inCredentials || key === 'test_credentials'
      if (typeof value === 'string' && (creds || SECRET_KEY.test(key)) && !PLACEHOLDER.test(value)) {
        found.push({ line: at + 1, problem: `${here} precisa ser placeholder {{…}}` })
      }
      visit(value, here, creds, at)
    }
  }
  visit(data, '', false, 0)
  return found
}

/** Problemas de credencial num arquivo de testsprite_tests (sem nunca repetir o valor). */
export function findCredentialProblems(file: string, text: string): string[] {
  const found = file.endsWith('.py') ? checkPython(text) : file.endsWith('.json') ? checkJson(text) : []
  text.split('\n').forEach((raw, i) => {
    for (const m of raw.matchAll(EMAIL)) {
      if (!isReservedDomain(m[1])) found.push({ line: i + 1, problem: `e-mail real (***@${m[1]}); use variável de ambiente` })
    }
  })
  return found.sort((a, b) => a.line - b.line).map(f => `${file}:${f.line} ${f.problem}`)
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'tmp' || name === '__pycache__' ? [] : files(p)
    return [p]
  })
}

describe('findCredentialProblems', () => {
  const login = (user: string, pass: string) => [
    "elem = page.get_by_placeholder('you@example.com', exact=True)",
    'await elem.wait_for(state="visible", timeout=10000)',
    `await elem.fill(${user})`,
    "elem = page.get_by_placeholder('••••••••', exact=True)",
    'await elem.wait_for(state="visible", timeout=10000)',
    `await elem.fill(${pass})`,
  ].join('\n')

  it('aceita o login pelas variáveis de ambiente', () => {
    expect(findCredentialProblems('TC.py', login('LOGIN_USER', 'LOGIN_PASSWORD'))).toEqual([])
  })

  it('aceita valores fictícios (teste de login inválido)', () => {
    expect(findCredentialProblems('TC.py', login('"invalid@example.com"', '"invalid-password"'))).toEqual([])
  })

  it('aponta senha e e-mail literais sem repetir o valor', () => {
    const problems = findCredentialProblems('TC.py', login('"pessoa@dominio.com"', '"000000000"'))
    expect(problems).toEqual([
      'TC.py:3 e-mail literal no login (use LOGIN_USER do ambiente)',
      'TC.py:3 e-mail real (***@dominio.com); use variável de ambiente',
      'TC.py:6 senha literal no login (use LOGIN_PASSWORD do ambiente)',
    ])
    expect(problems.join('\n')).not.toMatch(/pessoa|000000000/)
  })

  it('aponta e-mail real em comentário e aceita domínio reservado', () => {
    const text = '# -> Fill the Email field with pessoa@dominio.com\n# use you@example.com ou a@b.test'
    expect(findCredentialProblems('TC.py', text)).toEqual(['TC.py:1 e-mail real (***@dominio.com); use variável de ambiente'])
  })

  it('exige placeholder em test_credentials e em chaves de senha', () => {
    const bad = JSON.stringify({ code_summary: { test_credentials: { email: 'x@example.com', password: '000000000' } } }, null, 2)
    expect(findCredentialProblems('prd.json', bad)).toEqual([
      'prd.json:4 code_summary.test_credentials.email precisa ser placeholder {{…}}',
      'prd.json:5 code_summary.test_credentials.password precisa ser placeholder {{…}}',
    ])
    const good = JSON.stringify({ code_summary: { test_credentials: { email: '{{LOGIN_USER}}', password: '{{LOGIN_PASSWORD}}' } } })
    expect(findCredentialProblems('prd.json', good)).toEqual([])
  })
})

describe('testsprite_tests', () => {
  it('não tem credenciais nem e-mails reais', () => {
    const problems = files(DIR).flatMap(p => findCredentialProblems(relative(ROOT, p), readFileSync(p, 'utf8')))
    expect(problems).toEqual([])
  })
})
