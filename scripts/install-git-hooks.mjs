#!/usr/bin/env node
// SEC-001: ativa os hooks versionados em .githooks/ (pre-commit com gitleaks).
// Roda no `npm install` / `npm ci` (script "prepare"). Só age quando a raiz do
// repositório git é este projeto; fora de um repositório (deploy, download em
// zip) ou sem git instalado, não faz nada e nunca falha a instalação.

import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'))

try {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (realpathSync(top) === ROOT) {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: ROOT, stdio: 'ignore' })
  }
} catch {
  // Sem git ou fora de um repositório: nada a fazer.
}
