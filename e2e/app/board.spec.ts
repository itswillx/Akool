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

test('importar cards de Markdown (BacklogCard v1)', async ({ app: page, unique }) => {
  const id = `E2E-${Date.now().toString(36).toUpperCase()}`
  const markdown = `## Tópico: E2E

### CARD ${id} — ${unique} importado

| Campo | Valor |
| --- | --- |
| **ID** | ${id} |
| **Prioridade** | P2 |
| **Esforço** | S |
| **Labels** | e2e |

**Problema:** Card criado pelo teste E2E.

**Subtarefas Kanban:**

- [ ] Primeiro passo
`
  await openProjects(page)
  await createBoard(page, unique)
  try {
    await page.getByRole('button', { name: T.projects_import, exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(T.projects_import_paste_label).fill(markdown)
    await expect(dialog.getByText(T.projects_import_preview.replace('{count}', '1'))).toBeVisible()
    await dialog.getByRole('button', { name: T.projects_import_confirm, exact: true }).click()
    await expect(page.getByText(`${id} — ${unique} importado`).or(page.getByText(`${unique} importado`)).first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await page.keyboard.press('Escape')
    await deleteOpenBoard(page)
  }
})
