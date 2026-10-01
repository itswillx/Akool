/**
 * CLI entry — roda scripts/cards.ts via tsx:
 *   npm run cards -- <comando> [opções]
 *
 * Sem shell de propósito: notas como --note="precisa de deploy" chegam inteiras.
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const result = spawnSync(
  process.execPath,
  [join(root, 'node_modules/tsx/dist/cli.mjs'), join(__dirname, 'cards.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: root },
)

process.exit(result.status ?? 1)
