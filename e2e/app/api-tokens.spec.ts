import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { assertNotProduction, stagingEnv } from '../env'
import { expect, test, T } from '../fixtures'

// API-009: Configurações → API no staging, com o usuário de teste (não admin,
// sem MFA). Cria com preset, confere na cards-api que a edição de escopos vale
// sem trocar o segredo, revoga, limpa os inativos e exclui um token ativo:
// excluído ou revogado, a cards-api responde 401. O segredo nunca é impresso.

const env = stagingEnv()

async function openApiTab(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: T.account_menu }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: T.settings_tab_api }).click()
  await expect(dialog.getByRole('button', { name: T.settings_api_new })).toBeVisible()
  return dialog
}

/** Cria um token pela tela e devolve o segredo (mostrado uma vez). */
async function createToken(dialog: Locator, name: string, preset: string): Promise<string> {
  await dialog.getByRole('button', { name: T.settings_api_new }).click()
  await dialog.getByLabel(T.settings_api_name_label).fill(name)
  await expect(dialog.getByRole('button', { name: T.api_scope_section_admin, exact: true })).toHaveCount(0)
  await dialog.getByRole('radiogroup', { name: T.api_preset_label }).getByRole('radio', { name: preset }).click()
  await dialog.getByRole('radiogroup', { name: T.settings_api_expiry_label }).getByRole('radio', { name: T.settings_api_expiry_days.replace('{n}', '7') }).click()
  await dialog.getByRole('button', { name: T.settings_api_generate }).click()
  const code = dialog.locator('code', { hasText: 'akool_pat_' }).first()
  await expect(code).toBeVisible()
  const secret = (await code.textContent())?.trim() ?? ''
  expect(secret).toMatch(/^akool_pat_[0-9a-f]{64}$/)
  await dialog.getByRole('button', { name: T.settings_api_dismiss }).click()
  await expect(dialog.locator('code', { hasText: 'akool_pat_' })).toHaveCount(0)
  return secret
}

/** Status HTTP da cards-api do staging para uma ação com este token. */
async function cardsApi(request: APIRequestContext, token: string, action: string): Promise<number> {
  const url = assertNotProduction(env.VITE_SUPABASE_URL)
  const res = await request.post(`${url.replace(/\/$/, '')}/functions/v1/cards-api`, {
    headers: { Authorization: `Bearer ${token}`, ...(env.VITE_SUPABASE_ANON_KEY ? { apikey: env.VITE_SUPABASE_ANON_KEY } : {}) },
    data: { action },
  })
  return res.status()
}

const rowOf = (dialog: Locator, name: string) => dialog.getByRole('listitem').filter({ hasText: name }).first()

/** Botão de dois passos: o segundo clique confirma. */
async function confirmTwice(button: Locator) {
  await button.click()
  await button.click()
}

test('criar com preset, editar escopos, revogar, limpar e excluir; token sem acesso recebe 401', async ({ app: page, unique, request }) => {
  const dialog = await openApiTab(page)
  const nameA = `${unique} A`
  const nameB = `${unique} B`
  try {
    // A: preset do /fila. Quadros: Ler deixa listar os quadros.
    const secretA = await createToken(dialog, nameA, T.api_preset_claude_fila)
    const rowA = rowOf(dialog, nameA)
    await expect(rowA.getByText(T.settings_api_status_active, { exact: true })).toBeVisible()
    expect(await cardsApi(request, secretA, 'boards')).toBe(200)

    // Editar: tirar Quadros. O segredo é o mesmo, e a ação passa a dar 403.
    await rowA.getByRole('button', { name: T.settings_api_edit }).click()
    const panel = dialog.getByRole('region', { name: T.settings_api_edit_title.replace('{name}', nameA) })
    await panel.getByRole('button', { name: T.api_scope_section_projetos, exact: true }).click()
    await panel.getByRole('radiogroup', { name: T.api_scope_projetos_quadros }).getByRole('radio', { name: T.api_scope_level_none }).click()
    await panel.getByRole('button', { name: T.settings_api_save_scopes }).click()
    await expect(dialog.getByText(T.settings_api_saved)).toBeVisible()
    expect(await cardsApi(request, secretA, 'boards')).toBe(403)
    // Fila continua liberada: a cards-api confere o escopo antes dos campos, e o
    // 400 é só a falta do quadro no corpo (sem permissão seria 403).
    expect(await cardsApi(request, secretA, 'queue.list')).toBe(400)

    // Revogar: 401. Depois "Limpar revogados e expirados" tira a linha.
    await confirmTwice(rowA.getByRole('button', { name: T.settings_api_revoke, exact: true }))
    await expect(rowA.getByText(T.settings_api_status_revoked, { exact: true })).toBeVisible()
    expect(await cardsApi(request, secretA, 'queue.list')).toBe(401)
    await confirmTwice(dialog.getByRole('button', { name: T.settings_api_purge }))
    await expect(dialog.getByText(nameA)).toHaveCount(0)

    // B: somente leitura; excluído ainda ativo, para na hora.
    const secretB = await createToken(dialog, nameB, T.api_preset_read_only)
    expect(await cardsApi(request, secretB, 'boards')).toBe(200)
    const deleteB = rowOf(dialog, nameB).getByRole('button', { name: T.settings_api_delete, exact: true })
    await deleteB.click()
    await expect(dialog.getByText(T.settings_api_delete_active_warning)).toBeVisible()
    await deleteB.click()
    await expect(dialog.getByText(nameB)).toHaveCount(0)
    expect(await cardsApi(request, secretB, 'boards')).toBe(401)
  } finally {
    // Sobrou token deste teste (falha no meio)? Exclui pela tela.
    for (const name of [nameA, nameB]) {
      const leftover = rowOf(dialog, name)
      if (await leftover.count()) await confirmTwice(leftover.getByRole('button', { name: T.settings_api_delete, exact: true }))
    }
  }
})
