import { Check } from 'lucide-react'
import { isTerminalStep, stepStates, type StepDef } from '../../lib/boardStepper'

// Trilha horizontal de bolinhas conectadas dentro do card: mostra de relance em
// que etapa o card está. Puramente apresentacional — os rótulos chegam
// traduzidos e o índice atual é derivado pelo chamador (`stepIndexOf`).

const DOT = 9
const CURRENT_DOT = 13

export function BoardStepper({ steps, currentIndex, accent = '#6366f1', compact = false }: {
  steps: StepDef[]
  /** Índice na trilha; -1 = fora dela (cancelado), tudo apagado. */
  currentIndex: number
  /** Cor da bolinha atual. Default: o indigo usado como "atual" no resto do app. */
  accent?: string
  compact?: boolean
}) {
  if (steps.length === 0) return null

  const states = stepStates(steps, currentIndex)
  const terminal = isTerminalStep(steps, currentIndex)
  const size = compact ? DOT - 1 : DOT
  const currentSize = compact ? CURRENT_DOT - 1 : CURRENT_DOT

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', width: '100%' }}
      // O stepper é decorativo; o estado textual já está no badge de status ao
      // lado, então o leitor de tela não precisa ler as bolinhas de novo.
      aria-hidden
    >
      {steps.map((step, i) => {
        const state = states[i]
        const isCurrent = state === 'current'
        const done = state === 'completed'
        // A etapa final concluída vira ✓ em vez de bolinha: "entregue" é um
        // fim, não mais um "você está aqui".
        const showCheck = isCurrent && terminal
        const dotSize = isCurrent ? currentSize : size
        const color = done ? 'var(--color-done)'
          : isCurrent ? (showCheck ? 'var(--color-done)' : (step.color ?? accent))
          : 'var(--color-border)'
        return (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center', flex: i === steps.length - 1 ? '0 0 auto' : 1, minWidth: 0 }} title={step.label}>
            <span
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: '50%',
                flexShrink: 0,
                backgroundColor: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                // Halo só na etapa atual — mesmo tratamento do roadmap de Estudos.
                boxShadow: isCurrent ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : 'none',
                opacity: state === 'skipped' ? 0.45 : 1,
              }}
            >
              {showCheck && <Check size={compact ? 7 : 8} strokeWidth={4} />}
            </span>
            {i < steps.length - 1 && (
              <span
                style={{
                  flex: 1,
                  height: 2,
                  minWidth: 8,
                  borderRadius: 2,
                  // O conector fica verde só quando a etapa ANTES dele já passou.
                  backgroundColor: done ? 'var(--color-done)' : 'var(--color-border)',
                  opacity: state === 'skipped' ? 0.45 : 1,
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
