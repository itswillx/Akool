import { expect, test } from '@playwright/test'
import { PRODUCTION_REF, stagingEnv } from '../env'
import { ptBR as T } from '../../src/i18n/translations.pt-BR'

// QA-003: o que dá para conferir sem login.

const stagingRef = new URL(stagingEnv().VITE_SUPABASE_URL ?? 'http://x').hostname.split('.')[0]

test('a tela de login abre sem erros no console', async ({ page }) => {
  const errors: string[] = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: T.auth_welcome })).toBeVisible()
  expect(errors).toEqual([])
})

test('o app servido aponta para o staging, nunca para a produção', async ({ page }) => {
  const scripts: string[] = []
  page.on('response', async r => {
    if (r.request().resourceType() === 'script' && r.ok()) scripts.push(await r.text())
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: T.auth_welcome })).toBeVisible()
  const bundle = scripts.join('\n')
  expect(bundle).toContain(stagingRef)
  expect(bundle).not.toContain(PRODUCTION_REF)
})

test('credenciais inválidas mostram o erro', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel(T.auth_email).fill('invalid@example.com')
  await page.getByLabel(T.auth_password, { exact: true }).fill('wrong-password')
  await page.locator('form button[type="submit"]').click()
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
})
