import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { assertNotProduction, stagingEnv } from '../env'
import { expect, test, T } from '../fixtures'

// API-009: Configurações → API no staging, com o usuário de teste (não admin,
// sem MFA). Cria com preset, confere na cards-api que a edição de escopos vale
// sem trocar o segredo, revoga, limpa os inativos e exclui um token ativo:
// excluído ou revogado, a cards-api responde 401. O segredo nunca é impresso.

const env = stagingEnv()

// O segredo passa pela tela e pela rede. No CI o repositório é público e o
// relatório sobe como artefato quando falha: lá, nada de trace nem captura.
test.use({ trace: process.env.CI ? 'off' : 'retain-on-failure', screenshot: 'off', video: 'off' })

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
  // A faixa do token novo é o grupo nomeado pela instrução; a lista também tem
  // <code> com o prefixo (akool_pat_xxxx…), então nada de procurar no diálogo todo.
  const banner = dialog.getByRole('group', { name: T.settings_api_new_token })
  const code = banner.locator('code')
  await expect(code).toBeVisible()
  const secret = (await code.textContent())?.trim() ?? ''
  // Sem toMatch: a mensagem de falha imprimiria o segredo.
  expect(/^akool_pat_[0-9a-f]{64}$/.test(secret), 'segredo no formato akool_pat_ + 64 hex').toBe(true)
  await banner.getByRole('button', { name: T.settings_api_dismiss }).click()
  await expect(banner).toHaveCount(0)
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

/** Rótulo com {n} (ex.: "Confirmar: excluir {n}") como regex de qualquer número. */
const countLabel = (template: string) =>
  new RegExp(`^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{n\\}', '\\d+')}$`)

/** Botão de dois passos: o primeiro clique arma e troca o nome; o segundo, no nome novo, confirma. */
async function confirmTwice(scope: Locator, label: string, confirmLabel: string | RegExp) {
  await scope.getByRole('button', { name: label, exact: true }).click()
  await scope.getByRole('button', { name: confirmLabel, exact: typeof confirmLabel === 'string' }).click()
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
    await confirmTwice(rowA, T.settings_api_revoke, T.settings_api_revoke_confirm)
    await expect(rowA.getByText(T.settings_api_status_revoked, { exact: true })).toBeVisible()
    expect(await cardsApi(request, secretA, 'queue.list')).toBe(401)
    await confirmTwice(dialog, T.settings_api_purge, countLabel(T.settings_api_purge_confirm))
    await expect(dialog.getByText(nameA)).toHaveCount(0)

    // B: somente leitura; excluído ainda ativo, para na hora.
    const secretB = await createToken(dialog, nameB, T.api_preset_read_only)
    expect(await cardsApi(request, secretB, 'boards')).toBe(200)
    const rowB = rowOf(dialog, nameB)
    await rowB.getByRole('button', { name: T.settings_api_delete, exact: true }).click()
    await expect(dialog.getByText(T.settings_api_delete_active_warning)).toBeVisible()
    await rowB.getByRole('button', { name: T.settings_api_delete_confirm, exact: true }).click()
    await expect(dialog.getByText(nameB)).toHaveCount(0)
    expect(await cardsApi(request, secretB, 'boards')).toBe(401)
  } finally {
    // Sobrou token deste teste (falha no meio)? Exclui pela tela. O Excluir pode
    // ter ficado armado ("Confirmar exclusão") se a falha veio entre os dois cliques.
    for (const name of [nameA, nameB]) {
      const leftover = rowOf(dialog, name)
      if (!(await leftover.count())) continue
      const armed = leftover.getByRole('button', { name: T.settings_api_delete_confirm, exact: true })
      if (!(await armed.count())) await leftover.getByRole('button', { name: T.settings_api_delete, exact: true }).click()
      await armed.click()
    }
  }
})
