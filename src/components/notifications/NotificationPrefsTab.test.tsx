// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { fireEvent, render, screen } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { readNotificationPrefs, writeNotificationPrefs } from '../../lib/notificationPrefs'
import { NotificationPrefsTab } from './NotificationPrefsTab'

afterEach(() => { localStorage.clear() })

it('uma caixa por categoria; desmarcar silencia o aviso e grava neste aparelho', async () => {
  writeNotificationPrefs({ muted: ['system'] })
  const { container } = render(<NotificationPrefsTab />)
  expect(screen.getByRole('group', { name: 'Aviso ao chegar' })).toBeTruthy()
  const finance = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Finanças' })
  expect(finance.checked).toBe(true)
  expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Sistema' }).checked).toBe(false)
  fireEvent.click(finance)
  expect(finance.checked).toBe(false)
  expect(readNotificationPrefs().muted).toEqual(['system', 'finance'])
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sistema' }))
  expect(readNotificationPrefs().muted).toEqual(['finance'])
  await expectNoAxeViolations(container)
})
