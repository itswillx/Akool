import type { Page } from '@playwright/test'
import { createBoard, deleteOpenBoard, expect, openProjects, test, T } from '../fixtures'

// QA-003: mover card entre colunas e importar cards de Markdown, cada um num
// quadro próprio que o teste apaga no fim.

test('criar card e movê-lo para outra coluna', async ({ app: page, unique }) => {
  await openProjects(page)
  await createBoard(page, unique)
  try {
    const todo = page.getByRole('group', { name: 'A Fazer' })
    const doing = page.getByRole('group', { name: 'Fazendo' })
    await todo.getByRole('button', { name: T.projects_add_card }).first().click()
    await page.getByPlaceholder(T.projects_card_title_placeholder).fill(`${unique} card`)
    await page.getByRole('button', { name: T.projects_save, exact: true }).click()
    const card = todo.getByText(`${unique} card`)
    await expect(card).toBeVisible()

    // MouseSensor do dnd-kit: precisa de movimento (>6px) em passos.
    const from = await card.boundingBox()
    const to = await doing.boundingBox()
    if (!from || !to) throw new Error('card ou coluna fora da tela')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 20 })
    await page.mouse.up()

    await expect(doing.getByText(`${unique} card`)).toBeVisible()
    // Depois de recarregar, continua lá (a ordem foi gravada).
    await page.reload()
    await openProjects(page)
    await page.getByRole('button', { name: unique }).first().click()
    await expect(page.getByRole('group', { name: 'Fazendo' }).getByText(`${unique} card`)).toBeVisible()
  } finally {
    await deleteOpenBoard(page)
  }
})

// API-033: o aceite contra o banco real (com o gatilho do API-013): 2 cards,
// Contexto de 3 linhas e Depende de. O dependente vem antes no arquivo, então
// a gravação por níveis tem de inserir a dependência numa instrução anterior.
// Os IDs casam [A-Z]{2,5}-\d{3} (o parser ignora outro formato); o quadro é
// novo a cada teste, então um ID fixo não colide.
test('importar cards de Markdown (BacklogCard v1)', async ({ app: page, unique }) => {
  const base = 'ETE-001'
  const dependent = 'ETE-002'
  const baseTitle = `${base} — ${unique} base`
  const dependentTitle = `${dependent} — ${unique} depende`
  const context = ['Linha 1 do contexto.', 'Linha 2 do contexto.', 'Linha 3 do contexto.']
  const markdown = `## Tópico: E2E

### CARD ${dependentTitle}

| Campo | Valor |
| --- | --- |
| **ID** | ${dependent} |
| **Prioridade** | P2 |
| **Esforço** | S |
| **Labels** | e2e |
| **Depende de** | ${base} |

**Problema:** Card criado pelo teste E2E.

**Contexto:**
${context.map(line => `- ${line}`).join('\n')}

**Subtarefas Kanban:**

- [ ] Primeiro passo

### CARD ${baseTitle}

| Campo | Valor |
| --- | --- |
| **ID** | ${base} |
| **Prioridade** | P2 |
| **Esforço** | S |

**Problema:** A dependência do outro card.

**Subtarefas Kanban:**

- [ ] Primeiro passo
`
  await openProjects(page)
  await createBoard(page, unique)
  try {
    await page.getByRole('button', { name: T.projects_import, exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(T.projects_import_paste_label).fill(markdown)
    await expect(dialog.getByText(T.projects_import_preview.replace('{count}', '2'))).toBeVisible()
    // A dependência está no arquivo: a prévia não tem aviso.
    await expect(dialog.getByText(T.projects_import_warnings)).toBeHidden()
    await dialog.getByRole('button', { name: T.projects_import_confirm, exact: true }).click()
    await expect(page.getByText(dependentTitle).first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(baseTitle).first()).toBeVisible()
    // Sem aviso nem card pulado, o modal fecha sozinho.
    await expect(dialog).toBeHidden()

    // O card dependente: o Contexto inteiro na descrição e a dependência gravada.
    await page.getByText(dependentTitle).first().click()
    const card = page.getByRole('dialog')
    for (const line of context) await expect(card.getByText(line)).toBeVisible()
    await card.getByRole('button', { name: T.projects_section_organization }).click()
    const chip = card.locator('span').filter({ hasText: baseTitle }).filter({ has: page.getByRole('button', { name: T.common_remove }) })
    await expect(chip.first()).toBeVisible()
    await closeCardModal(page)
  } finally {
    await page.keyboard.press('Escape')
    await deleteOpenBoard(page)
  }
})

/** Cria um card na coluna, com rótulos opcionais, e fecha o modal salvando. */
async function addCard(page: Page, column: string, title: string, labels: string[] = []) {
  await page.getByRole('group', { name: column }).getByRole('button', { name: T.projects_add_card }).first().click()
  await page.getByPlaceholder(T.projects_card_title_placeholder).fill(title)
  if (labels.length) {
    await page.getByRole('button', { name: T.projects_section_organization }).click()
    const input = page.getByPlaceholder(T.projects_labels_placeholder)
    for (const label of labels) await input.fill(label).then(() => input.press('Enter'))
  }
  await page.getByRole('button', { name: T.projects_save, exact: true }).click()
  await expect(page.getByRole('group', { name: column }).getByText(title)).toBeVisible()
}

const cardPatch = (page: Page) =>
  page.waitForResponse(r => r.url().includes('/rest/v1/project_cards') && r.request().method() === 'PATCH')

/** O modal do card não fecha com Esc (UX-003) e o estado dele volta depois do
 *  reload (sessionStorage): fecha pelo Cancelar e espera sumir. */
async function closeCardModal(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: T.projects_cancel, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

/** Na limpeza: fecha o modal que tenha ficado aberto, porque o fundo dele
 *  bloqueia o "Excluir" do quadro (e o modal tem um "Excluir" próprio). */
async function closeOpenDialog(page: Page) {
  // Limpeza: só tenta. Uma falha aqui não pode esconder o erro do teste.
  try {
    const cancel = page.getByRole('dialog').getByRole('button', { name: T.projects_cancel, exact: true }).first()
    if (await cancel.isVisible()) await closeCardModal(page)
  } catch { /* o deleteOpenBoard em seguida mostra o que sobrou */ }
}

// API-013: o rótulo não diferencia caixa no filtro (nem no servidor).
test('filtro de rótulo sem diferença de caixa', async ({ app: page, unique }) => {
  await openProjects(page)
  await createBoard(page, unique)
  try {
    await addCard(page, 'A Fazer', `${unique} A`, ['Segurança'])
    await addCard(page, 'A Fazer', `${unique} B`, ['segurança'])
    await addCard(page, 'A Fazer', `${unique} C`)

    // Um chip só para as duas grafias; filtrar por ele mostra os dois cards.
    const chips = page.getByRole('button', { name: /^segurança$/i })
    await expect(chips).toHaveCount(1)
    await chips.click()
    await expect(page.getByText(`${unique} A`)).toBeVisible()
    await expect(page.getByText(`${unique} B`)).toBeVisible()
    await expect(page.getByText(`${unique} C`)).toBeHidden()
    await chips.click()
  } finally {
    await closeOpenDialog(page)
    await deleteOpenBoard(page)
  }
})

// API-013: duas abas editam o mesmo campo do mesmo card. A segunda a gravar
// não passa por cima calada: o aviso pergunta, e "Manter a minha" grava.
test('conflito de edição em duas abas', async ({ app: page, unique }) => {
  await openProjects(page)
  await createBoard(page, unique)
  const other = await page.context().newPage()
  try {
    await addCard(page, 'A Fazer', `${unique} X`)

    // Aba 2 abre o card antes de a aba 1 gravar.
    await other.goto('/')
    await openProjects(other)
    await other.getByRole('button', { name: unique }).first().click()
    await other.getByRole('group', { name: 'A Fazer' }).getByText(`${unique} X`).click()
    const otherTitle = other.getByPlaceholder(T.projects_card_title_placeholder)
    await expect(otherTitle).toHaveValue(`${unique} X`)

    // Aba 1 grava um título novo.
    await page.getByRole('group', { name: 'A Fazer' }).getByText(`${unique} X`).click()
    const saved = cardPatch(page)
    await page.getByPlaceholder(T.projects_card_title_placeholder).fill(`${unique} aba 1`)
    expect((await saved).ok()).toBe(true)

    // Aba 2 grava o mesmo campo: o servidor não acha a versão, e o aviso aparece.
    await otherTitle.fill(`${unique} aba 2`)
    const banner = other.getByRole('alert').filter({ hasText: T.projects_conflict_title })
    await expect(banner).toBeVisible()
    const kept = cardPatch(other)
    await banner.getByRole('button', { name: T.projects_conflict_keep }).click()
    expect((await kept).ok()).toBe(true)
    await expect(banner).toBeHidden()

    // A aba 1, recarregada, vê a escolha da aba 2. Fecha o modal antes: aberto,
    // ele voltaria depois do reload e o fundo bloquearia os cliques.
    await closeCardModal(page)
    await page.reload()
    await openProjects(page)
    await page.getByRole('button', { name: unique }).first().click()
    await expect(page.getByRole('group', { name: 'A Fazer' }).getByText(`${unique} aba 2`)).toBeVisible()
  } finally {
    await other.close()
    await closeOpenDialog(page)
    await deleteOpenBoard(page)
  }
})
