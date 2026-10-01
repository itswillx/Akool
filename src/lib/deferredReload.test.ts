import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeferredReload } from './deferredReload'

describe('createDeferredReload (REL-010)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function setup() {
    let blocked = false
    const reload = vi.fn()
    const deferred = createDeferredReload({ delayMs: 400, reload, isBlocked: () => blocked })
    return { deferred, reload, block: (value: boolean) => { blocked = value } }
  }

  it('a burst of events becomes a single reload', async () => {
    const { deferred, reload } = setup()
    deferred.trigger()
    deferred.trigger()
    await vi.advanceTimersByTimeAsync(300)
    deferred.trigger()
    await vi.advanceTimersByTimeAsync(400)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waits while a card is being dragged, then reloads on release', async () => {
    const { deferred, reload, block } = setup()
    block(true)
    deferred.trigger()
    await vi.advanceTimersByTimeAsync(1000)
    expect(reload).not.toHaveBeenCalled()

    block(false)
    deferred.release()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('release without a waiting reload does nothing', () => {
    const { deferred, reload } = setup()
    deferred.release()
    expect(reload).not.toHaveBeenCalled()
  })

  it('cancel forgets the scheduled and the waiting reload', async () => {
    const { deferred, reload, block } = setup()
    deferred.trigger()
    deferred.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    block(true)
    deferred.trigger()
    await vi.advanceTimersByTimeAsync(1000)
    deferred.cancel()
    block(false)
    deferred.release()
    expect(reload).not.toHaveBeenCalled()
  })
})
