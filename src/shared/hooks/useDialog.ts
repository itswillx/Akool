import { useEffect, useId, useRef, useState, type RefObject } from 'react'

// UX-003: comportamento comum dos modais — papel de diálogo, Tab preso, Esc,
// foco devolvido a quem abriu e scroll do fundo travado. Sem portal: o painel
// continua onde está no DOM (animações e menus portalizados seguem iguais).
//
// Modais podem se aninhar (uma confirmação dentro de um formulário): uma pilha
// de módulo garante que só o diálogo do topo responde a Tab e Esc, e a trava
// de scroll só é solta quando o último fecha.

interface OpenDialog { id: symbol; panel: HTMLElement | null }
const stack: OpenDialog[] = []
let scrollLocks = 0
let savedOverflow = ''

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter(el => !el.closest('[aria-hidden="true"], [inert]'))
}

function lockScroll() {
  if (scrollLocks++ === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}

function unlockScroll() {
  if (--scrollLocks === 0) document.body.style.overflow = savedOverflow
}

export interface UseDialogOptions {
  /** Para modais sempre montados que abrem/fecham por prop. Default: true. */
  open?: boolean
  onClose: () => void
  /** false em modais de formulário: Esc não descarta o que foi digitado. */
  closeOnEsc: boolean
  /** Onde o foco começa se nada dentro do modal tiver `autoFocus`. Default: o painel. */
  initialFocusRef?: RefObject<HTMLElement | null>
  role?: 'dialog' | 'alertdialog'
  /** Nome acessível quando não há título visível (senão use `titleId` no título). */
  label?: string
}

export function useDialog({ open = true, onClose, closeOnEsc, initialFocusRef, role = 'dialog', label }: UseDialogOptions) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  const closeOnEscRef = useRef(closeOnEsc)
  useEffect(() => {
    onCloseRef.current = onClose
    closeOnEscRef.current = closeOnEsc
  })

  // Quem tinha o foco antes de abrir. Capturado no render da abertura: no
  // efeito já seria tarde, porque o autoFocus de um input do modal roda antes.
  const [returnTo, setReturnTo] = useState<Element | null>(() => (open ? document.activeElement : null))
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    setReturnTo(open ? document.activeElement : null)
  }

  useEffect(() => {
    if (!open) return
    const id = Symbol('dialog')
    const panel = panelRef.current
    // Efeitos de filhos rodam antes: se um modal interno montou junto, o de
    // fora entra ABAIXO dele na pilha, não no topo.
    const inner = stack.findIndex(d => !!panel && !!d.panel && panel.contains(d.panel))
    if (inner === -1) stack.push({ id, panel })
    else stack.splice(inner, 0, { id, panel })
    lockScroll()

    if (panel && !panel.contains(document.activeElement)) {
      (initialFocusRef?.current ?? panel).focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (stack[stack.length - 1]?.id !== id) return
      if (e.key === 'Escape') {
        if (!closeOnEscRef.current) return
        e.preventDefault()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = focusableIn(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!panel.contains(active)) {
        // O foco escapou (clique no fundo): o Tab volta para dentro.
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stack.splice(stack.findIndex(d => d.id === id), 1)
      unlockScroll()
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus()
    }
  }, [open, returnTo, initialFocusRef])

  return {
    titleId,
    dialogProps: {
      ref: panelRef,
      role,
      'aria-modal': true as const,
      'aria-labelledby': label ? undefined : titleId,
      'aria-label': label,
      tabIndex: -1,
    },
  }
}
