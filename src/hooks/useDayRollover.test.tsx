// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDayRollover } from './useDayRollover'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function Probe({ active, onRollover }: { active: boolean; onRollover: (day: string) => void }) {
  useDayRollover(active, onRollover)
  return null
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 8, 26, 23, 59, 0) })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useDayRollover', () => {
  it('avisa uma vez na meia-noite local e rearma para o dia seguinte', () => {
    const onRollover = vi.fn()
    act(() => root.render(<Probe active onRollover={onRollover} />))

    act(() => { vi.advanceTimersByTime(59_000) })
    expect(onRollover).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(onRollover).toHaveBeenCalledTimes(1)
    expect(onRollover).toHaveBeenCalledWith('2026-09-27')

    act(() => { vi.advanceTimersByTime(3_600_000) })
    expect(onRollover).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(24 * 3_600_000) })
    expect(onRollover).toHaveBeenCalledTimes(2)
    expect(onRollover).toHaveBeenLastCalledWith('2026-09-28')
  })

  it('aba que volta a ficar visível num dia novo também avisa', () => {
    const onRollover = vi.fn()
    act(() => root.render(<Probe active onRollover={onRollover} />))
    // Timer atrasado (aba em segundo plano, computador suspenso): só o relógio andou.
    vi.setSystemTime(new Date(2026, 8, 27, 8, 0, 0))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(onRollover).toHaveBeenCalledWith('2026-09-27')
  })

  it('inativo (sem sessão) não arma nada', () => {
    const onRollover = vi.fn()
    act(() => root.render(<Probe active={false} onRollover={onRollover} />))
    act(() => { vi.advanceTimersByTime(2 * 24 * 3_600_000) })
    expect(onRollover).not.toHaveBeenCalled()
  })
})
