import { useEffect, useRef } from 'react'
import { localDateKey, msUntilNextLocalMidnight } from '../lib/localDate'

// REL-007: com a aba aberta na virada do dia, o app avisa em vez de deslogar
// (o login diário é pedido na próxima abertura, sem perder trabalho). Checa na
// meia-noite local e quando a aba volta a ficar visível: aba em segundo plano
// e computador suspenso atrasam o timer.
export function useDayRollover(active: boolean, onRollover: (day: string) => void) {
  const onRolloverRef = useRef(onRollover)
  useEffect(() => { onRolloverRef.current = onRollover }, [onRollover])

  useEffect(() => {
    if (!active) return
    let day = localDateKey()
    let timer: ReturnType<typeof setTimeout> | undefined

    const check = () => {
      const now = localDateKey()
      if (now === day) return
      day = now
      onRolloverRef.current(now)
    }
    // +1 s de folga: o timer pode disparar um pouco antes da meia-noite.
    const arm = () => {
      timer = setTimeout(() => { check(); arm() }, msUntilNextLocalMidnight() + 1000)
    }
    const onVisibility = () => { if (document.visibilityState === 'visible') check() }

    arm()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active])
}
