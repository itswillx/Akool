// ARCH-008: cores dos selos e estilos de formulário das Configurações e do
// painel de admin, num arquivo sem componentes (o Fast Refresh pede isso).
// Os pares de cor são os tons claros de antes, num lugar só; onde há token
// (--color-success/error/warning/primary) as telas usam o token.

export const SOFT = {
  green: { bg: '#dcfce7', text: '#15803d' },
  yellow: { bg: '#fef9c3', text: '#854d0e' },
  red: { bg: '#fee2e2', text: '#dc2626' },
  indigo: { bg: '#e0e7ff', text: '#4338ca' },
  gray: { bg: '#f3f4f6', text: '#6b7280' },
  amber: { bg: '#fef3c7', text: '#d97706' },
  blue: { bg: '#dbeafe', text: '#2563eb' },
  /** Botões e faixas de alerta/sucesso. */
  redBox: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  greenBox: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
} as const

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1.5px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 14,
  color: 'var(--color-text)',
  boxSizing: 'border-box',
  transition: 'border-color 0.15s',
  backgroundColor: 'var(--color-surface)',
}

export const submitBtnStyle = (disabled: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  backgroundColor: disabled ? 'var(--color-btn-disabled)' : 'var(--color-btn-primary)',
  color: disabled ? 'var(--color-btn-disabled-text)' : 'var(--color-btn-primary-text)',
  padding: '10px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  border: 'none',
  cursor: disabled ? 'not-allowed' : 'pointer',
  transition: 'background-color 0.15s',
})

/**
 * As Configurações têm um tamanho só, em qualquer aba (antes a casca crescia
 * nas abas de admin e encolhia nas da conta). Por isso a função não recebe a
 * aba: só se a pessoa é admin (usuários, backup e auditoria pedem a casca
 * larga) e se a tela é de celular.
 */
export function settingsShellSize(isAdmin: boolean, isMobile: boolean): React.CSSProperties {
  if (isMobile) return { maxWidth: '100%', height: 'calc(100dvh - 24px)' }
  return { maxWidth: isAdmin ? 980 : 640, height: 'min(760px, calc(100dvh - 48px))' }
}

/** Largura máxima dos formulários das abas da conta dentro da casca. */
export const SETTINGS_FORM_MAX_WIDTH = 600
