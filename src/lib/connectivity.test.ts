// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOnline, onReconnect, subscribeOnline, useOnlineStatus } from './connectivity'

// REL-012: o estado da conexão vem do navegador (navigator.onLine e os eventos
// online/offline); `onReconnect` só dispara na volta.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const setOnline = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true })
const fire = (name: 'online' | 'offline') => window.dispatchEvent(new Event(name))

afterEach(() => { setOnline(true) })

describe('isOnline / subscribeOnline', () => {
  it('espelha navigator.onLine', () => {
    setOnline(true)
    expect(isOnline()).toBe(true)
    setOnline(false)
    expect(isOnline()).toBe(false)
  })

  it('avisa nos dois eventos e para de avisar ao cancelar', () => {
    const listener = vi.fn()
    const stop = subscribeOnline(listener)
    fire('offline')
    fire('online')
    expect(listener).toHaveBeenCalledTimes(2)
    stop()
    fire('offline')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('onReconnect', () => {
  it('só dispara na transição offline → online', () => {
    setOnline(true)
    const back = vi.fn()
    const stop = onReconnect(back)
    fire('online') // já estava online: nada
    expect(back).not.toHaveBeenCalled()
    setOnline(false); fire('offline')
    expect(back).not.toHaveBeenCalled()
    setOnline(true); fire('online')
    expect(back).toHaveBeenCalledTimes(1)
    stop()
    setOnline(false); fire('offline'); setOnline(true); fire('online')
    expect(back).toHaveBeenCalledTimes(1)
  })
})

describe('useOnlineStatus', () => {
  it('re-renderiza quando a conexão cai e volta', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    function Probe() { return createElement('output', null, String(useOnlineStatus())) }
    await act(async () => { root.render(createElement(Probe)) })
    expect(container.textContent).toBe('true')
    await act(async () => { setOnline(false); fire('offline') })
    expect(container.textContent).toBe('false')
    await act(async () => { setOnline(true); fire('online') })
    expect(container.textContent).toBe('true')
    await act(async () => { root.unmount() })
    container.remove()
  })
})
