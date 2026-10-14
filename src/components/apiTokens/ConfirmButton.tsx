import { useId, useState } from 'react'
import { dangerBtnStyle } from './tokenStyles'

// API-009: ação destrutiva em dois passos, no padrão do Revogar de antes. O
// primeiro clique arma (o texto vira "Confirmar…"), o segundo executa e sair
// do botão desarma. Armado, o aviso aparece ao lado, ligado ao botão.

export function ConfirmButton({ label, confirmLabel, warning, describedBy, disabled, onConfirm }: {
  label: string
  confirmLabel: string
  /** Ids do que o botão afeta (ex.: nome e prefixo do token da linha). */
  describedBy?: string
  /** Mostrado (e anunciado) enquanto o botão está armado. */
  warning?: string
  disabled?: boolean
  onConfirm: () => void
}) {
  const id = useId()
  const [armed, setArmed] = useState(false)
  const showWarning = armed && !!warning

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        aria-describedby={[describedBy, showWarning ? id : null].filter(Boolean).join(' ') || undefined}
        onClick={() => {
          if (!armed) {
            setArmed(true)
            return
          }
          setArmed(false)
          onConfirm()
        }}
        onBlur={() => setArmed(false)}
        style={dangerBtnStyle(armed)}
      >
        {armed ? confirmLabel : label}
      </button>
      {showWarning && (
        <span id={id} role="status" style={{ flexBasis: '100%', fontSize: 12, color: 'var(--color-error-text)', lineHeight: 1.4 }}>
          {warning}
        </span>
      )}
    </>
  )
}
