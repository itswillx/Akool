import { CircleCheck, Clock, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

// Faixa de aviso das telas de entrada (login diário, link expirado, erro do
// servidor, e-mail reenviado): fundo e borda por color-mix do token, texto no
// --color-text (4,5:1 nos dois temas) e ícone lucide em vez de emoji.
const TONE = {
  info: { token: 'var(--color-warning)', Icon: Clock },
  warning: { token: 'var(--color-warning)', Icon: TriangleAlert },
  error: { token: 'var(--color-error)', Icon: TriangleAlert },
  success: { token: 'var(--color-success)', Icon: CircleCheck },
} as const

export function FormNotice({ tone, role, children }: {
  tone: keyof typeof TONE
  /** `alert` para erro (anunciado na hora); `status` para o resto. */
  role: 'alert' | 'status'
  children: ReactNode
}) {
  const { token, Icon } = TONE[tone]
  return (
    <div
      role={role}
      className="auth-notice"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 8, fontSize: 13, lineHeight: 1.45,
        color: 'var(--color-text)',
        backgroundColor: `color-mix(in srgb, ${token} 16%, var(--color-bg))`,
        border: `1px solid color-mix(in srgb, ${token} 45%, transparent)`,
      }}
    >
      <Icon size={15} aria-hidden="true" style={{ color: token, flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}
