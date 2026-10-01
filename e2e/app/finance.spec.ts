import { expect, test, T } from '../fixtures'

// QA-003: lançar uma despesa e apagá-la.

test('lançamento financeiro: criar e apagar', async ({ app: page, unique }) => {
  await page.getByRole('button', { name: T.sidebar_section_finance, exact: true }).first().click()
  await page.getByRole('tab', { name: T.finance_tab_transactions }).click()

  await page.getByRole('button', { name: T.finance_new_transaction }).first().click()
  await page.getByLabel(T.finance_tx_amount).fill('12.34')
  await page.getByLabel(T.finance_tx_description).fill(unique)
  await page.getByRole('button', { name: T.finance_save, exact: true }).click()

  const row = page.getByText(unique).first()
  await expect(row).toBeVisible()

  await row.click()
  await page.getByRole('button', { name: T.finance_delete, exact: true }).click()
  await page.getByRole('button', { name: T.finance_confirm_delete, exact: true }).click()
  await expect(page.getByText(unique)).toHaveCount(0)
})
