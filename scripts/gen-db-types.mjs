#!/usr/bin/env node
// ARCH-004: regenera src/types/database.ts a partir do schema public do banco.
//
//   npm run gen:types                regrava o arquivo
//   npm run gen:types -- --check     só compara; sai com erro se estiver desatualizado (CI)
//
// Usa o Supabase CLI (baixado pelo npx na primeira vez). Precisa estar logado
// (`npx supabase login`) ou ter SUPABASE_ACCESS_TOKEN no ambiente. O
// src/types/db.ts ajusta jsonb e CHECKs por cima; se uma coluna ajustada sumir
// do banco, o build acusa lá.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const TYPES_FILE = join(ROOT, 'src', 'types', 'database.ts')
export const PROJECT_ID = 'nhfftophadasiezrzlsv'

export const HEADER = `// GERADO — não editar à mão (ARCH-004).
// Tipos do schema public do Supabase (projeto ${PROJECT_ID}). Depois de
// aplicar uma migration, regenere com \`npm run gen:types\` (Supabase CLI
// logado: \`npx supabase login\`). Os ajustes de jsonb e CHECK ficam em
// src/types/db.ts; scripts/database-types.test.ts falha se uma tabela das
// migrations não estiver aqui.

`

export function withHeader(types) {
  return HEADER + types.trimEnd() + '\n'
}

function generate() {
  return execFileSync('npx', ['--yes', 'supabase', 'gen', 'types', 'typescript', '--project-id', PROJECT_ID, '--schema', 'public'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 16 * 1024 * 1024,
  })
}

function main() {
  const next = withHeader(generate())
  if (process.argv.includes('--check')) {
    if (readFileSync(TYPES_FILE, 'utf8') !== next) {
      console.error('src/types/database.ts está desatualizado: rode `npm run gen:types` e faça commit.')
      process.exit(1)
    }
    console.log('src/types/database.ts em dia com o banco.')
    return
  }
  writeFileSync(TYPES_FILE, next)
  console.log('src/types/database.ts regravado.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
