// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../../test/rtl'
import { getT } from '../../i18n/translations'
import { ConfirmationPanel } from './ConfirmationPanel'

const t = getT('pt-BR')
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

it('foca o título, ecoa o e-mail, trava o reenvio por 60 s e depois reenvia', async () => {
  const onResend = vi.fn().mockResolvedValue({ error: null })
  render(<ConfirmationPanel kind="signup" email="nova@example.com" t={t} onResend={onResend} onBack={vi.fn()} />)
  const title = screen.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })
  expect(document.activeElement).toBe(title)
  expect(screen.getByRole('status').textContent).toContain('nova@example.com')

  const waiting = screen.getByRole('button', { name: 'Reenviar em 60s' })
  expect(waiting.getAttribute('aria-disabled')).toBe('true')
  fireEvent.click(waiting)
  expect(onResend).not.toHaveBeenCalled()

  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  const ready = screen.getByRole('button', { name: 'Reenviar e-mail' })
  expect(ready.getAttribute('aria-disabled')).toBe('false')
  fireEvent.click(ready)
  await flush()
  expect(onResend).toHaveBeenCalledTimes(1)
  expect(screen.getByText('E-mail reenviado.')).toBeTruthy()
  // Nova espera de 60 s depois do reenvio.
  expect(screen.getByRole('button', { name: 'Reenviar em 60s' })).toBeTruthy()
})

it('erro no reenvio vira aviso traduzido; "Voltar ao login" chama onBack', async () => {
  const onResend = vi.fn().mockResolvedValue({ error: { code: 'over_email_send_rate_limit', message: 'rate limit' } })
  const onBack = vi.fn()
  render(<ConfirmationPanel kind="reset" email="pessoa@example.com" t={t} onResend={onResend} onBack={onBack} />)
  expect(screen.getByRole('heading', { level: 1, name: 'Link enviado' })).toBeTruthy()
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar e-mail' }))
  await flush()
  expect(screen.getByRole('alert').textContent).toBe('Muitas tentativas. Aguarde um pouco e tente de novo.')
  fireEvent.click(screen.getByRole('link', { name: 'Voltar ao login' }))
  expect(onBack).toHaveBeenCalledTimes(1)
})
