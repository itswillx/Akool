import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// DEV-002/QA-003: o E2E roda contra o STAGING, nunca contra a produção. O
// ambiente é o mesmo que o `vite --mode staging` enxerga: .env.local e, por
// cima, .env.staging.local; variáveis já definidas (CI) vencem os arquivos.

export const PRODUCTION_REF = 'nhfftophadasiezrzlsv'
const ROOT = fileURLToPath(new URL('..', import.meta.url))

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export function stagingEnv(root = ROOT, processEnv: NodeJS.ProcessEnv = process.env): Record<string, string | undefined> {
  const read = (file: string) => (existsSync(root + file) ? parseEnvFile(readFileSync(root + file, 'utf8')) : {})
  const fromFiles = { ...read('.env.local'), ...read('.env.staging.local') }
  const env: Record<string, string | undefined> = { ...fromFiles }
  for (const [key, value] of Object.entries(processEnv)) if (value) env[key] = value
  return env
}

/** Recusa rodar sem URL do Supabase ou com a URL da produção. */
export function assertNotProduction(url: string | undefined): string {
  if (!url) throw new Error('VITE_SUPABASE_URL do staging não definido (.env.staging.local).')
  if (url.includes(PRODUCTION_REF)) throw new Error('E2E apontando para a PRODUÇÃO: recusado. Use o staging (.env.staging.local).')
  return url
}
