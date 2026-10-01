// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { emitAppEvent, onAppEvent } from './appEvents'

describe('appEvents (ARCH-007)', () => {
  it('o listener recebe o evento emitido e o unsubscribe para de receber', () => {
    const handler = vi.fn()
    const off = onAppEvent('finance_transactions_changed', handler)
    emitAppEvent('finance_transactions_changed')
    expect(handler).toHaveBeenCalledTimes(1)
    off()
    emitAppEvent('finance_transactions_changed')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('cada listener só recebe o seu evento', () => {
    const handler = vi.fn()
    const off = onAppEvent('finance_transactions_changed', handler)
    window.dispatchEvent(new CustomEvent('outro_evento'))
    expect(handler).not.toHaveBeenCalled()
    off()
  })
})
