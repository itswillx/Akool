import { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { ToastStack } from '../components/ToastStack'

// `info`: avisos neutros (NOTIF-001: notificação nova chegando).
export type ToastVariant = 'error' | 'warning' | 'success' | 'info'

/** Um botão no aviso (ex.: "Ver" na notificação nova); clicar também fecha o aviso. */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** ms before auto-dismiss; 0 = sticky (user must dismiss manually). Defaults per variant. */
  duration?: number
  /** Toasts sharing a dedupeKey collapse into one while the first is still showing. Defaults to `${variant}:${message}`. */
  dedupeKey?: string
  action?: ToastAction
}

export interface ToastItem {
  id: string
  variant: ToastVariant
  message: string
  duration: number
  dedupeKey: string
  action?: ToastAction
}

// PERF-001: o contexto público só carrega as ações, que são estáveis. A fila
// fica dentro do provider e vai direto para o ToastStack — antes, cada toast
// exibido/fechado re-renderizava todo consumidor de useToast (inclusive o
// PagesContext, que envolve a árvore inteira), e todos só usam showToast.
interface ToastContextType {
  showToast: (variant: ToastVariant, message: string, options?: ToastOptions) => string
  dismissToast: (id: string) => void
}

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  error: 6000,
  warning: 5000,
  success: 3500,
  info: 7000,
}

// How many toasts render concurrently ("fila" — queue). Extras wait FIFO and
// appear as slots free, so a burst of failures (e.g. repeated autosave
// retries) can't cover the screen.
const MAX_VISIBLE = 3

const ToastContext = createContext<ToastContextType | undefined>(undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  // NOTIF-001: o tempo para enquanto o mouse ou o foco estão no aviso (dá para
  // chegar ao botão de ação); `deadlines` guarda quando cada um venceria e
  // `paused`, quanto faltava ao pausar.
  const deadlines = useRef<Map<string, number>>(new Map())
  const paused = useRef<Map<string, number>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
    deadlines.current.delete(id)
    paused.current.delete(id)
    setQueue(prev => prev.filter(t => t.id !== id))
  }, [])

  const arm = useCallback((id: string, ms: number) => {
    timers.current.set(id, setTimeout(() => dismissToast(id), ms))
    deadlines.current.set(id, Date.now() + ms)
  }, [dismissToast])

  const pauseToast = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (!timer) return
    clearTimeout(timer)
    timers.current.delete(id)
    paused.current.set(id, Math.max(0, (deadlines.current.get(id) ?? 0) - Date.now()))
  }, [])

  // Ao retomar, pelo menos 1,5 s para a pessoa ver que o aviso continua ali.
  const resumeToast = useCallback((id: string) => {
    const remaining = paused.current.get(id)
    if (remaining === undefined) return
    paused.current.delete(id)
    arm(id, Math.max(1500, remaining))
  }, [arm])

  const showToast = useCallback((variant: ToastVariant, message: string, options: ToastOptions = {}) => {
    const dedupeKey = options.dedupeKey ?? `${variant}:${message}`
    const duration = options.duration ?? DEFAULT_DURATIONS[variant]
    const id = crypto.randomUUID()
    let resultId: string = id
    setQueue(prev => {
      const dupe = prev.find(t => t.dedupeKey === dedupeKey)
      if (dupe) { resultId = dupe.id; return prev }
      return [...prev, { id, variant, message, duration, dedupeKey, action: options.action }]
    })
    return resultId
  }, [])

  // Only toasts inside the visible window get a live timer, so queued-but-not-
  // shown-yet toasts can't expire before they're ever displayed.
  const visible = useMemo(() => queue.slice(0, MAX_VISIBLE), [queue])
  const visibleKey = visible.map(t => t.id).join(',')

  useEffect(() => {
    for (const t of visible) {
      if (t.duration > 0 && !timers.current.has(t.id) && !paused.current.has(t.id)) arm(t.id, t.duration)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visible/arm intentionally excluded, visibleKey is the derived dep
  }, [visibleKey])

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

  const value = useMemo<ToastContextType>(() => ({ showToast, dismissToast }), [showToast, dismissToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={visible} onDismiss={dismissToast} onPause={pauseToast} onResume={resumeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
