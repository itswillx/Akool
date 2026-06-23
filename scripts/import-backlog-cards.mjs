/**
 * CLI entry — loads TypeScript parser via tsx when run as:
 *   npm run import:cards -- arquivo.md --board-id=<uuid> [--dry-run]
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tsScript = join(__dirname, 'import-backlog-cards.ts')
const args = process.argv.slice(2)

const result = spawnSync('npx', ['tsx', tsScript, ...args], {
  stdio: 'inherit',
  shell: true,
  cwd: join(__dirname, '..'),
})

process.exit(result.status ?? 1)
