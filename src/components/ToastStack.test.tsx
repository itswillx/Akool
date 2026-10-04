// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../test/rtl'
import { ToastProvider, useToast } from '../contexts/ToastContext'
import { ToastStack } from './ToastStack'

afterEach(() => { vi.useRealTimers() })

it('NOTIF-001: região viva sempre presente; erro interrompe (alert); o botão de ação age e fecha o aviso', () => {
  const onDismiss = vi.fn()
  const onClick = vi.fn()
  const { rerender } = render(<ToastStack toasts={[]} onDismiss={onDismiss} />)
  const region = document.body.querySelector('[aria-live="polite"]')
  expect(region?.children).toHaveLength(0)
  rerender(
    <ToastStack
      onDismiss={onDismiss}
      toasts={[
        { id: '1', variant: 'error', message: 'Falhou', duration: 0, dedupeKey: 'a' },
        { id: '2', variant: 'info', message: 'Chegou uma notificação', duration: 0, dedupeKey: 'b', action: { label: 'Ver', onClick } },
      ]}
    />,
  )
  expect(screen.getByRole('alert').textContent).toContain('Falhou')
  expect(region?.textContent).toContain('Chegou uma notificação')
  fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
  expect(onClick).toHaveBeenCalledTimes(1)
  expect(onDismiss).toHaveBeenCalledWith('2')
})

let show: ReturnType<typeof useToast>['showToast']
const keep = (fn: typeof show) => { show = fn }
function Trigger() {
  keep(useToast().showToast)
  return null
}

it('o tempo do aviso para com o mouse ou o foco nele e volta ao sair', () => {
  vi.useFakeTimers()
  render(<ToastProvider><Trigger /></ToastProvider>)
  act(() => { show('info', 'Notificação nova', { action: { label: 'Ver', onClick: () => {} } }) })
  const toast = screen.getByText('Notificação nova').parentElement as HTMLElement
  fireEvent.mouseEnter(toast)
  act(() => { vi.advanceTimersByTime(20_000) })
  expect(screen.getByText('Notificação nova')).toBeTruthy()
  fireEvent.mouseLeave(toast)
  fireEvent.focus(screen.getByRole('button', { name: 'Ver' }))
  act(() => { vi.advanceTimersByTime(20_000) })
  expect(screen.getByText('Notificação nova')).toBeTruthy()
  fireEvent.blur(screen.getByRole('button', { name: 'Ver' }))
  act(() => { vi.advanceTimersByTime(8_000) })
  expect(screen.queryByText('Notificação nova')).toBeNull()
})
