import type React from 'react'

// UX-002: elementos clicáveis que não podem virar <button> (têm botões dentro,
// ou o estilo depende de ser um bloco) ganham papel de botão e teclado.

export interface ActivateOptions {
  /** Nome acessível quando o texto visível não basta (ex.: "Editar título"). */
  label?: string
}

export interface ActivateProps {
  role: 'button'
  tabIndex: 0
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
  'aria-label'?: string
}

/** true para Enter/Espaço vindos do próprio elemento (não de um input ou botão dentro dele). */
export function isActivationKey(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.target !== e.currentTarget) return false
  return e.key === 'Enter' || e.key === ' '
}

/**
 * Props para um `div`/`li` clicável se comportar como botão: foco por Tab e
 * Enter/Espaço acionam `onActivate`. O `onClick` continua com o chamador.
 */
export function activateProps(onActivate: () => void, opts: ActivateOptions = {}): ActivateProps {
  const props: ActivateProps = {
    role: 'button',
    tabIndex: 0,
    onKeyDown: e => {
      if (!isActivationKey(e)) return
      // Espaço rolaria a página; Enter num form submeteria.
      e.preventDefault()
      onActivate()
    },
  }
  if (opts.label) props['aria-label'] = opts.label
  return props
}
