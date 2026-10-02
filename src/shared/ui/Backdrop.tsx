import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

// QA-004: a camada de fundo dos modais, folhas e gavetas num lugar só. Antes,
// cada shell de modal montava o seu `position: fixed; inset: 0` à mão (21
// cópias). O painel vem como `children` e para a propagação do clique por
// conta própria; `onClick` aqui é o "clicar fora fecha" (quando permitido).

const ALIGN: Record<'center' | 'bottom' | 'right', CSSProperties> = {
  center: { alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'column', justifyContent: 'flex-end' },
  right: { justifyContent: 'flex-end' },
}

export function Backdrop({ align = 'center', zIndex = 1000, color = 'rgba(0,0,0,0.5)', padding, className, onClick, children }: {
  /** Onde o painel se encosta: centro (diálogo), base (folha no celular) ou direita (gaveta). */
  align?: 'center' | 'bottom' | 'right'
  zIndex?: number
  color?: string
  padding?: number
  className?: string
  onClick?: MouseEventHandler<HTMLDivElement>
  children: ReactNode
}) {
  return (
    <div
      role="presentation"
      className={className}
      onClick={onClick}
      style={{ position: 'fixed', inset: 0, zIndex, display: 'flex', backgroundColor: color, padding, ...ALIGN[align] }}
    >
      {children}
    </div>
  )
}
