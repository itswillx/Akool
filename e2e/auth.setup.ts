import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test as setup } from '@playwright/test'
import { stagingEnv } from './env'
import { ptBR as T } from '../src/i18n/translations.pt-BR'

// Login uma vez e guarda a sessão para os testes de e2e/app/. Sem o usuário de
// teste (E2E_USER/E2E_PASSWORD), grava uma sessão vazia e os testes logados
// pulam sozinhos.

const STATE = 'e2e/.auth/user.json'
const env = stagingEnv()

setup('login do usuário de teste', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true })
  if (!env.E2E_USER || !env.E2E_PASSWORD) {
    writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }))
    setup.skip(true, 'Sem E2E_USER/E2E_PASSWORD: testes logados pulados.')
    return
  }
  // A raiz é a página pública; o formulário fica em #entrar.
  await page.goto('/#entrar')
  await page.getByLabel(T.auth_email).fill(env.E2E_USER)
  await page.getByLabel(T.auth_password, { exact: true }).fill(env.E2E_PASSWORD)
  await page.locator('form button[type="submit"]').click()
  await expect(page.getByRole('button', { name: T.sidebar_create_new })).toBeVisible({ timeout: 30_000 })

  // Tour de boas-vindas: marcado como visto (a chave é por usuário).
  await page.evaluate(() => {
    const sessionKey = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k))
    const userId = sessionKey ? (JSON.parse(localStorage.getItem(sessionKey) ?? '{}') as { user?: { id?: string } }).user?.id : undefined
    // QA-006: a chave é a de src/lib/localKeys.ts (localKey.onboardingSeen).
    if (userId) localStorage.setItem(`akool:onboarding.seen:${userId}`, '1')
  })
  await page.context().storageState({ path: STATE })
})
