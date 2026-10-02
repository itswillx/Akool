import { useEffect, useState } from 'react'

// PERF-013: debounce num lugar só. As buscas de compartilhar (página, quadro,
// meta, workspace) tinham cada uma o seu setTimeout com ref e cleanup próprios
// — e uma delas não cancelava ao desmontar. Os debounces de salvamento (nota,
// desenho, card) ficam com os seus helpers, que têm flush e estado de "salvando".

/** O valor só muda depois de `ms` sem novas mudanças. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export interface DebouncedCallback<A extends unknown[]> {
  (...args: A): void
  /** Descarta a chamada pendente, se houver. */
  cancel: () => void
}

/** Controlador fora do React: guarda o timer e a versão atual da função. */
function createDebouncer<A extends unknown[]>(initialFn: (...args: A) => unknown, initialMs: number) {
  let fn = initialFn
  let ms = initialMs
  let timer: ReturnType<typeof setTimeout> | null = null
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }
  const call: DebouncedCallback<A> = Object.assign((...args: A) => {
    cancel()
    timer = setTimeout(() => {
      timer = null
      void fn(...args)
    }, ms)
  }, { cancel })
  const configure = (nextFn: (...args: A) => unknown, nextMs: number) => {
    fn = nextFn
    ms = nextMs
  }
  return { call, cancel, configure }
}

/**
 * Chama `fn` `ms` depois da última chamada, com os argumentos dela. Usa sempre a
 * versão mais recente de `fn` (sem precisar de deps) e cancela ao desmontar. A
 * função devolvida é estável entre renders.
 */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => unknown, ms: number): DebouncedCallback<A> {
  const [debouncer] = useState(() => createDebouncer(fn, ms))
  useEffect(() => { debouncer.configure(fn, ms) })
  useEffect(() => () => debouncer.cancel(), [debouncer])
  return debouncer.call
}
