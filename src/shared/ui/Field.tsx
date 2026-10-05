import { useId, type CSSProperties, type ReactNode } from 'react'

// UX-007: liga o label ao campo (htmlFor/id) e a dica ou o erro ao campo
// (aria-describedby, aria-invalid). Sem isso, o leitor de tela anunciava só
// "caixa de texto" e o gerenciador de senhas adivinhava o campo pelo
// placeholder. O campo vem como render prop e não há elemento em volta, então
// o visual de cada formulário continua igual.

export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

export function Field({ label, labelStyle, hint, error, children }: {
  label: ReactNode
  labelStyle?: CSSProperties
  /** Texto de apoio abaixo do campo, ligado a ele por aria-describedby. */
  hint?: ReactNode
  /** Erro deste campo: anunciado (role="alert") e marcado com aria-invalid. */
  error?: string | null
  children: (control: FieldControlProps) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <>
      <label htmlFor={id} style={labelStyle}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {hint && <div id={hintId}>{hint}</div>}
      {error && (
        <p id={errorId} role="alert" style={{ color: 'var(--color-error-text)', fontSize: 12.5, margin: '6px 0 0' }}>
          {error}
        </p>
      )}
    </>
  )
}

// UX-008: título de um grupo que não é um campo só (cores, tipo, compartilhar,
// uma lista). Um label ali não rotulava nada; aqui o grupo recebe o título
// como nome (role="group" + aria-labelledby).
export function FieldGroup({ label, labelStyle, style, children }: {
  label: ReactNode
  labelStyle?: CSSProperties
  style?: CSSProperties
  children: ReactNode
}) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} style={style}>
      <span id={id} style={{ display: 'block', ...labelStyle }}>{label}</span>
      {children}
    </div>
  )
}
