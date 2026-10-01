// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedCallback, useDebouncedValue } from './useDebounce'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useDebouncedValue (PERF-013)', () => {
  it('só entrega o valor depois da pausa, e o último vence', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), { initialProps: { v: 'a' } })
    rerender({ v: 'ab' })
    act(() => { vi.advanceTimersByTime(200) })
    rerender({ v: 'abc' })
    act(() => { vi.advanceTimersByTime(299) })
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe('abc')
  })
})

describe('useDebouncedCallback (PERF-013)', () => {
  it('dispara uma vez só, com os argumentos da última chamada', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))
    result.current('a')
    result.current('ab')
    result.current('abc')
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('abc')
  })

  it('usa a versão mais recente da função sem trocar a referência', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result, rerender } = renderHook(({ fn }) => useDebouncedCallback(fn, 300), { initialProps: { fn: first } })
    const before = result.current
    rerender({ fn: second })
    expect(result.current).toBe(before)
    result.current('x')
    vi.advanceTimersByTime(300)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('x')
  })

  it('cancel() descarta a chamada pendente', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(fn, 300))
    result.current('a')
    result.current.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })

  it('desmontar cancela (a busca não roda depois que o modal fecha)', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(fn, 300))
    result.current('a')
    unmount()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()
  })
})
