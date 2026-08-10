import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ToastStack } from '../components/ToastStack'

export type ToastVariant = 'error' | 'warning' | 'success'

export interface ToastOptions {
  /** ms before auto-dismiss; 0 = sticky (user must dismiss manually). Defaults per variant. */
  duration?: number
  /** Toasts sharing a dedupeKey collapse into one while the first is still showing. Defaults to `${variant}:${message}`. */
  dedupeKey?: string
}

export interface ToastItem {
  id: string
  variant: ToastVariant
  message: string
  duration: number
  dedupeKey: string
}

interface ToastContextType {
  toasts: ToastItem[]
  showToast: (variant: ToastVariant, message: string, options?: ToastOptions) => string
  dismissToast: (id: string) => void
}

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  error: 6000,
  warning: 5000,
  success: 3500,
}

// How many toasts render concurrently ("fila" — queue). Extras wait FIFO and
// appear as slots free, so a burst of failures (e.g. repeated autosave
// retries) can't cover the screen.
const MAX_VISIBLE = 3

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
    setQueue(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((variant: ToastVariant, message: string, options: ToastOptions = {}) => {
    const dedupeKey = options.dedupeKey ?? `${variant}:${message}`
    const duration = options.duration ?? DEFAULT_DURATIONS[variant]
    const id = crypto.randomUUID()
    let resultId: string = id
    setQueue(prev => {
      const dupe = prev.find(t => t.dedupeKey === dedupeKey)
      if (dupe) { resultId = dupe.id; return prev }
      return [...prev, { id, variant, message, duration, dedupeKey }]
    })
    return resultId
  }, [])

  // Only toasts inside the visible window get a live timer, so queued-but-not-
  // shown-yet toasts can't expire before they're ever displayed.
  const visible = useMemo(() => queue.slice(0, MAX_VISIBLE), [queue])
  const visibleKey = visible.map(t => t.id).join(',')

  useEffect(() => {
    for (const t of visible) {
      if (t.duration > 0 && !timers.current.has(t.id)) {
        timers.current.set(t.id, setTimeout(() => dismissToast(t.id), t.duration))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visible/dismissToast intentionally excluded, visibleKey is the derived dep
  }, [visibleKey])

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

  const value = useMemo<ToastContextType>(() => ({ toasts: visible, showToast, dismissToast }), [visible, showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={visible} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
