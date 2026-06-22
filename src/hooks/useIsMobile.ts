import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  )

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const onChange = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile('matches' in e ? e.matches : false)
    onChange(mql)
    mql.addEventListener('change', onChange as (e: MediaQueryListEvent) => void)
    return () => mql.removeEventListener('change', onChange as (e: MediaQueryListEvent) => void)
  }, [breakpoint])

  return isMobile
}
