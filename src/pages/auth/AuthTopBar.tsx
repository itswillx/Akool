import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { AkoolBrand } from '@/shared/ui/AkoolBrand'
import { ghostBtnStyle, primaryBtnStyle, segBtnStyle, segTrackStyle } from '@/shared/ui/uiTokens'
import type { Lang } from '../../i18n/translations'
import { hrefForView, isPlainClick, LANG_SHORT } from './authView'
import type { AuthView, Translate } from './authView'

// Barra do topo da página pública e da tela de login, com a receita da barra
// do app logado (App.tsx): ~57 px, borda embaixo, controles de 32 px à direita.

/** Link que troca a view sem recarregar; o href real serve ao clique do meio e a links externos. */
export function AuthLink({ view, onNavigate, style, children, 'aria-label': ariaLabel, 'aria-current': ariaCurrent }: {
  view: AuthView
  onNavigate: (view: AuthView) => void
  style?: CSSProperties
  children: ReactNode
  'aria-label'?: string
  /** `page` no link da view ativa (abas Entrar / Criar conta). */
  'aria-current'?: 'page'
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(e)) return
    e.preventDefault()
    onNavigate(view)
  }
  return (
    <a href={hrefForView(view)} onClick={onClick} aria-label={ariaLabel} aria-current={ariaCurrent} style={{ textDecoration: 'none', ...style }}>
      {children}
    </a>
  )
}

const LANGS: Lang[] = ['pt-BR', 'en']

export function LangSwitch({ lang, t, isMobile, onChange }: {
  lang: Lang
  t: Translate
  isMobile: boolean
  onChange: (lang: Lang) => void
}) {
  const name = (l: Lang) => (l === 'en' ? t('settings_lang_en') : t('settings_lang_pt'))
  if (isMobile) {
    // Celular: um botão só, com o código do outro idioma (a barra tem quatro
    // controles em 320 px). O nome acessível começa pelo texto visível (WCAG 2.5.3).
    const other: Lang = lang === 'en' ? 'pt-BR' : 'en'
    return (
      <button
        type="button"
        aria-label={`${LANG_SHORT[other]} · ${name(other)}`}
        onClick={() => onChange(other)}
        style={{ ...ghostBtnStyle, padding: '6px 9px', fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)' }}
      >
        {LANG_SHORT[other]}
      </button>
    )
  }
  return (
    <div role="group" aria-label={t('settings_language')} style={segTrackStyle}>
      {LANGS.map(l => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => onChange(l)} style={segBtnStyle(lang === l)}>
          {name(l)}
        </button>
      ))}
    </div>
  )
}

export function AuthTopBar({ view, lang, t, isMobile, onNavigate, onChangeLang, action }: {
  view: AuthView
  lang: Lang
  t: Translate
  isMobile: boolean
  onNavigate: (view: AuthView) => void
  onChangeLang: (lang: Lang) => void
  /** Substitui o link da direita ("Sair" no MFA, "Cancelar" na redefinição de senha). */
  action?: ReactNode
}) {
  const cta = (base: CSSProperties): CSSProperties => ({
    ...base,
    ...(isMobile ? { fontSize: 12.5, padding: '6px 9px' } : { fontSize: 13.5, padding: '8px 14px' }),
  })
  return (
    // auth-topbar: fundo translúcido com desfoque ao rolar e nome na View Transition (authMotion.css).
    <header
      className="auth-topbar"
      style={{
        position: 'sticky', top: 0, zIndex: 10, flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: isMobile ? '10px 12px' : '10px 24px',
        borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
      }}
    >
      <AuthLink view="landing" onNavigate={onNavigate} aria-label="Akool" style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--color-text)' }}>
        <AkoolBrand size="sm" compact={isMobile} />
      </AuthLink>
      <nav style={{ marginLeft: 'auto', minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <LangSwitch lang={lang} t={t} isMobile={isMobile} onChange={onChangeLang} />
        {action ? action : view === 'landing' ? (
          <>
            <AuthLink view="signin" onNavigate={onNavigate} style={cta(ghostBtnStyle)}>{t('auth_signin_btn')}</AuthLink>
            <AuthLink view="signup" onNavigate={onNavigate} style={cta(primaryBtnStyle)}>{t('auth_signup_btn')}</AuthLink>
          </>
        ) : (
          <AuthLink view="landing" onNavigate={onNavigate} style={cta(ghostBtnStyle)}>{t('landing_back_home')}</AuthLink>
        )}
      </nav>
    </header>
  )
}
