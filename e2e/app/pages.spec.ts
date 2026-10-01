import { confirmDelete, expect, test, T } from '../fixtures'

// QA-003: criar página (nota), renomear e apagar.

test('criar, renomear e apagar uma página', async ({ app: page, unique }) => {
  await page.getByRole('button', { name: T.sidebar_create_new }).click()
  await page.getByRole('button', { name: T.sidebar_new_note }).click()

  const heading = page.getByRole('heading', { level: 1 })
  await heading.getByRole('button').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(unique)
  await page.keyboard.press('Enter')
  await expect(heading).toHaveText(unique)

  const item = page.getByRole('treeitem', { name: unique })
  await expect(item).toBeVisible()

  await item.hover()
  await item.getByRole('button', { name: T.sidebar_delete }).click()
  await confirmDelete(page)
  await expect(item).toHaveCount(0)
})
