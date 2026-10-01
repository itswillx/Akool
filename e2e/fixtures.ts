import { test as base, expect, type Page } from '@playwright/test'
import { stagingEnv } from './env'
import { ptBR as T } from '../src/i18n/translations.pt-BR'

// Base dos testes logados: pula sem usuário de teste, abre o app já logado e
// dá um nome único a tudo o que o teste cria (para achar e apagar depois).

const env = stagingEnv()
export { expect, T }

export const test = base.extend<{ app: Page; unique: string }>({
  app: async ({ page }, use) => {
    base.skip(!env.E2E_USER || !env.E2E_PASSWORD, 'Sem E2E_USER/E2E_PASSWORD.')
    await page.goto('/')
    await expect(page.getByRole('button', { name: T.sidebar_create_new })).toBeVisible({ timeout: 30_000 })
    await use(page)
  },
  // eslint-disable-next-line no-empty-pattern
  unique: async ({}, use, info) => {
    await use(`E2E ${info.title.slice(0, 20)} ${Date.now().toString(36)}`)
  },
})

/** Confirma o modal de exclusão (ConfirmDeleteModal). */
export async function confirmDelete(page: Page) {
  await page.getByRole('alertdialog').getByRole('button', { name: T.confirm_delete_confirm }).click()
}

// ── Projetos ────────────────────────────────────────────────────────────────

export async function openProjects(page: Page) {
  await page.getByRole('button', { name: T.sidebar_section_projects, exact: true }).first().click()
  await expect(page.getByRole('button', { name: T.projects_new_board })).toBeVisible()
}

/** Cria um quadro (vem com as colunas A Fazer / Fazendo / Concluído). */
export async function createBoard(page: Page, name: string) {
  await page.getByRole('button', { name: T.projects_new_board }).click()
  await page.getByPlaceholder(T.projects_board_name_placeholder).fill(name)
  await page.getByRole('button', { name: T.projects_create, exact: true }).click()
  await expect(page.getByRole('group', { name: 'A Fazer' })).toBeVisible()
}

/** Apaga o quadro aberto (e os cards dele). */
export async function deleteOpenBoard(page: Page) {
  await page.getByRole('button', { name: T.projects_delete, exact: true }).first().click()
  await confirmDelete(page)
}
