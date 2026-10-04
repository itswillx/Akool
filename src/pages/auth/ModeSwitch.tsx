import { segBtnStyle, segTrackStyle } from '@/shared/ui/uiTokens'
import { AuthLink } from './AuthTopBar'
import type { AuthFormView, Translate } from './authView'

// Entrar / Criar conta: links reais (#entrar, #cadastro) com aria-current no
// ativo, numa trilha com borda que existe nos dois temas. Links, e não botões:
// o botão de enviar "Entrar" fica sendo o único botão com esse nome. O fundo
// da aba ativa é uma pílula só (.auth-mode-pill), que desliza de uma aba para
// a outra (authMotion.css); os links ficam transparentes por cima dela.
export function ModeSwitch({ view, t, onSwitch }: {
  view: 'signin' | 'signup'
  t: Translate
  onSwitch: (view: AuthFormView) => void
}) {
  const item = (target: 'signin' | 'signup', label: string) => {
    const active = view === target
    return (
      <AuthLink
        view={target}
        onNavigate={() => onSwitch(target)}
        aria-current={active ? 'page' : undefined}
        style={{ ...segBtnStyle(active, { wide: true }), background: 'transparent', boxShadow: 'none', textDecoration: 'none' }}
      >
        {label}
      </AuthLink>
    )
  }
  return (
    <nav aria-label={t('auth_mode_nav')} className="auth-mode" data-active={view} style={{ ...segTrackStyle, display: 'flex', width: '100%', boxSizing: 'border-box', marginBottom: 24 }}>
      <span className="auth-mode-pill" aria-hidden="true" />
      {item('signin', t('auth_signin_btn'))}
      {item('signup', t('auth_signup_btn'))}
    </nav>
  )
}
