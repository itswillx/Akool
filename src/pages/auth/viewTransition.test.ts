// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { runAuthTransition } from './viewTransition'

// O happy-dom não tem document.startViewTransition: aqui ele é um dublê que
// chama o update na hora e devolve promessas controladas pelo teste.

interface Stub {
  start: ReturnType<typeof vi.fn>
  finish: () => void
}

function stubViewTransitions({ skip = false } = {}): Stub {
  let finish = () => {}
  const start = vi.fn((update: () => void) => {
    update()
    const finished = new Promise<void>(resolve => { finish = resolve })
    const ready = skip ? Promise.reject(new DOMException('pulada', 'AbortError')) : Promise.resolve()
    return { ready, finished, updateCallbackDone: Promise.resolve(), skipTransition: () => {} }
  })
  Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true, writable: true })
  return { start, finish: () => finish() }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition')
  delete document.documentElement.dataset.authVt
  vi.restoreAllMocks()
})

describe('runAuthTransition', () => {
  it('sem a API, roda o update na hora e não marca o <html>', () => {
    const update = vi.fn()
    runAuthTransition('page', update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.authVt).toBeUndefined()
  })

  it('com movimento reduzido, nem inicia a transição', () => {
    const { start } = stubViewTransitions()
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    const update = vi.fn()
    runAuthTransition('card', update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(start).not.toHaveBeenCalled()
  })

  it('com a API, marca o tipo no <html> durante a transição e limpa no fim', async () => {
    const { start, finish } = stubViewTransitions()
    const update = vi.fn()
    runAuthTransition('card', update)
    expect(start).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.authVt).toBe('card')
    finish()
    await flush()
    expect(document.documentElement.dataset.authVt).toBeUndefined()
  })

  it('transição pulada não vira erro no console, e a seguinte mantém o próprio tipo', async () => {
    const first = stubViewTransitions({ skip: true })
    runAuthTransition('card', () => {})
    const finishFirst = first.finish
    const second = stubViewTransitions()
    runAuthTransition('page', () => {})
    // A primeira termina depois: não pode apagar a marca da segunda.
    finishFirst()
    await flush()
    expect(document.documentElement.dataset.authVt).toBe('page')
    second.finish()
    await flush()
    expect(document.documentElement.dataset.authVt).toBeUndefined()
  })
})

describe('runAuthTransition: flushSync', () => {
  it('o DOM novo já está pronto quando o callback da transição volta (o navegador fotografa nesse momento)', async () => {
    // Fora do act, como no navegador: sem o flushSync, o React só renderizaria depois.
    const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previous = g.IS_REACT_ACT_ENVIRONMENT
    let setLabel: (value: string) => void = () => {}
    function Probe() {
      const [label, set] = useState('antes')
      setLabel = set
      return createElement('p', null, label)
    }
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(Probe)) })
    g.IS_REACT_ACT_ENVIRONMENT = false
    let seen = ''
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      writable: true,
      value: (update: () => void) => {
        update()
        seen = host.textContent ?? ''
        return { ready: Promise.resolve(), finished: Promise.resolve(), updateCallbackDone: Promise.resolve(), skipTransition: () => {} }
      },
    })
    try {
      runAuthTransition('page', () => setLabel('depois'))
      expect(seen).toBe('depois')
    } finally {
      g.IS_REACT_ACT_ENVIRONMENT = previous
      root.unmount()
      host.remove()
    }
  })
})
