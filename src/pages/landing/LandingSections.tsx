import { useEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { Database, FileDown, Languages, MonitorSmartphone, Moon, ShieldCheck, Smartphone, Users, WifiOff } from 'lucide-react'
import { HelpGlyph } from '../../components/helpIcons'
import { landingContent } from '../../i18n/landingContent'
import type { LandingContent, LandingHighlightIcon } from '../../i18n/landingContent'
import type { Lang } from '../../i18n/translations'
import { cardSurfaceStyle, ghostBtnStyle, primaryBtnStyle } from '@/shared/ui/uiTokens'
import { AkoolBrand } from '@/shared/ui/AkoolBrand'
import { AppPreview } from '../auth/AppPreview'
import type { AppPreviewVariant } from '../auth/AppPreview'
import { AuthLink } from '../auth/AuthTopBar'
import type { AuthView, Translate } from '../auth/authView'
import { LandingFaq } from './LandingFaq'
import { LandingShowcase } from './LandingShowcase'
import { BODY, H2, H3, SUBTITLE, sectionInner } from './landingStyles'
import './landing.css'

// As seções da página pública (abaixo da barra do topo). Chunk à parte, carregado
// pelo AuthPage com import(): só quem chega deslogado baixa isto. O texto vem
// de landingContent.ts; os rótulos curtos (Entrar, Criar conta) das traduções.
// O movimento (entrada do hero, seções surgindo ao rolar, hover dos cartões)
// fica em landing.css.

const CURRENT_YEAR = new Date().getFullYear()

const HIGHLIGHT_ICONS: Record<LandingHighlightIcon, ComponentType<{ size?: number }>> = {
  users: Users,
  fileDown: FileDown,
  languages: Languages,
  moon: Moon,
  shield: ShieldCheck,
  database: Database,
  wifiOff: WifiOff,
  smartphone: Smartphone,
}

const FACT_ICONS = [ShieldCheck, Languages, MonitorSmartphone] as const

interface SectionProps {
  c: LandingContent
  lang: Lang
  t: Translate
  isMobile: boolean
  onNavigate: (view: AuthView) => void
}

const CTA_SIZE = { fontSize: 14, padding: '11px 18px' } as const

function Ctas({ t, onNavigate }: Pick<SectionProps, 't' | 'onNavigate'>) {
  return (
    <>
      <AuthLink view="signup" onNavigate={onNavigate} style={{ ...primaryBtnStyle, ...CTA_SIZE }}>{t('auth_signup_btn')}</AuthLink>
      <AuthLink view="signin" onNavigate={onNavigate} style={{ ...ghostBtnStyle, ...CTA_SIZE, color: 'var(--color-text)' }}>{t('auth_signin_btn')}</AuthLink>
    </>
  )
}

function Hero({ c, lang, t, isMobile, onNavigate, focusHeading }: SectionProps & { focusHeading: boolean }) {
  // A prévia do hero é uma pequena demonstração: a barra lateral troca o módulo.
  const [module, setModule] = useState<AppPreviewVariant>('overview')
  // Voltando do login antes de o chunk da landing chegar, o AuthShell focou o
  // contêiner (o h1 ainda não existia): o título é focado aqui, ao montar.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focusHeading) titleRef.current?.focus({ preventScroll: true })
  }, [focusHeading])
  return (
    <section aria-labelledby="landing-hero-title" className="landing-hero-band">
      <div className="landing-hero" style={{ maxWidth: 1100, margin: '0 auto', padding: isMobile ? '36px 16px 32px' : '64px 24px 56px', boxSizing: 'border-box' }}>
        <div>
          <p className="landing-eyebrow">{c.hero.eyebrow}</p>
          {/* Sem atraso no h1 (é o maior conteúdo da tela); o resto entra em sequência. */}
          <h1 ref={titleRef} id="landing-hero-title" tabIndex={-1} style={{ margin: '14px 0 0', fontSize: isMobile ? 28 : 36, fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--color-text)', maxWidth: 720 }}>
            {c.hero.title}
          </h1>
          <p className="landing-enter" data-step="1" style={{ margin: '14px 0 0', fontSize: 16, lineHeight: 1.6, color: 'var(--color-text-muted)', maxWidth: 600 }}>{c.hero.subtitle}</p>
          <div className="landing-enter" data-step="2" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 24 }}>
            <Ctas t={t} onNavigate={onNavigate} />
          </div>
          <ul className="landing-enter landing-facts" data-step="3">
            {c.hero.facts.map((fact, i) => {
              const Icon = FACT_ICONS[i]
              return (
                <li key={fact}>
                  <Icon size={15} aria-hidden="true" />
                  {fact}
                </li>
              )
            })}
          </ul>
          <p className="landing-enter" data-step="3" style={{ margin: '14px 0 0', fontSize: 13, lineHeight: 1.5, color: 'var(--color-text-muted)' }}>{c.hero.inviteNote}</p>
        </div>
        <div className="landing-enter landing-hero-preview" data-step="4">
          <AppPreview lang={lang} t={t} variant={module} interactive onVariantChange={setModule} />
        </div>
      </div>
    </section>
  )
}

function Modules({ c, isMobile }: SectionProps) {
  return (
    <section aria-labelledby="landing-modules-title" style={sectionInner(isMobile)}>
      <h2 id="landing-modules-title" style={H2}>{c.modules.title}</h2>
      <p style={SUBTITLE}>{c.modules.subtitle}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {c.modules.items.map(m => (
          <article key={m.id} className="landing-card landing-reveal" style={{ ...cardSurfaceStyle, padding: '16px 18px' }}>
            {/* Tile da Ajuda (HelpPanel): tinta da cor da categoria, certa nos dois temas. */}
            <div style={{ width: 40, height: 40, borderRadius: 11, backgroundColor: `${m.color}1a`, color: m.color, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <HelpGlyph name={m.icon} size={20} />
            </div>
            <h3 style={H3}>{m.title}</h3>
            <p style={BODY}>{m.description}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function HowItWorks({ c, isMobile }: SectionProps) {
  return (
    <section aria-labelledby="landing-steps-title" style={{ backgroundColor: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
      <div style={sectionInner(isMobile)}>
        <h2 id="landing-steps-title" style={H2}>{c.steps.title}</h2>
        <ol className="landing-steps" style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
          {c.steps.items.map((s, i) => (
            <li key={s.title} className="landing-reveal" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {/* Fundo opaco: a linha que liga os passos (landing.css) passa por trás do número. */}
              <span aria-hidden="true" className="landing-step-number" style={{ width: 32, height: 32, borderRadius: 999, flexShrink: 0, backgroundColor: 'color-mix(in srgb, var(--color-accent) 14%, var(--color-bg-secondary))', color: 'var(--color-accent)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {i + 1}
              </span>
              <div>
                <h3 style={H3}>{s.title}</h3>
                <p style={BODY}>{s.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Highlights({ c, t, isMobile }: SectionProps) {
  return (
    <section aria-labelledby="landing-highlights-title" style={sectionInner(isMobile)}>
      <h2 id="landing-highlights-title" style={H2}>{t('auth_marketing_highlights_title')}</h2>
      <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {c.highlights.items.map(h => {
          const Icon = HIGHLIGHT_ICONS[h.icon]
          return (
            <li key={h.title} className="landing-reveal" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, backgroundColor: 'var(--color-hover)', color: 'var(--color-text-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon size={16} />
              </span>
              <div>
                <h3 style={{ ...H3, fontSize: 14 }}>{h.title}</h3>
                <p style={{ ...BODY, margin: '3px 0 0', fontSize: 13 }}>{h.description}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function CtaBand({ c, t, isMobile, onNavigate }: SectionProps) {
  return (
    <section aria-labelledby="landing-cta-title" className="landing-reveal" style={sectionInner(isMobile)}>
      <div className="landing-cta" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 20, padding: isMobile ? '24px 20px' : '36px 40px', borderRadius: 16, border: '1px solid var(--color-border)' }}>
        <div>
          <h2 id="landing-cta-title" style={{ ...H2, fontSize: isMobile ? 21 : 24 }}>{c.cta.title}</h2>
          <p style={{ ...BODY, fontSize: 15 }}>{c.cta.text}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Ctas t={t} onNavigate={onNavigate} />
        </div>
      </div>
    </section>
  )
}

function Footer({ c, t, isMobile, onNavigate, langSwitch }: SectionProps & { langSwitch: ReactNode }) {
  // --color-text sublinhado: o azul de --color-primary dá 3,7:1 no fundo claro.
  const link = { fontSize: 13, color: 'var(--color-text)', textDecoration: 'underline' } as const
  return (
    <footer style={{ borderTop: '1px solid var(--color-border)', padding: isMobile ? '24px 16px' : '28px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AkoolBrand size="sm" />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{c.footer.tagline}</p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)' }}>© {CURRENT_YEAR} Akool</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <AuthLink view="signin" onNavigate={onNavigate} style={link}>{t('auth_signin_btn')}</AuthLink>
          <AuthLink view="signup" onNavigate={onNavigate} style={link}>{t('auth_signup_btn')}</AuthLink>
          {langSwitch}
        </div>
      </div>
    </footer>
  )
}

export default function LandingSections({ lang, t, isMobile, onNavigate, langSwitch, focusHeading = false }: {
  lang: Lang
  t: Translate
  isMobile: boolean
  onNavigate: (view: AuthView) => void
  langSwitch: ReactNode
  /** Focar o h1 ao montar (a landing não é a primeira tela da visita). */
  focusHeading?: boolean
}) {
  const c = landingContent[lang]
  const props = { c, lang, t, isMobile, onNavigate }
  return (
    <>
      <main style={{ flex: 1 }}>
        <Hero {...props} focusHeading={focusHeading} />
        <Modules {...props} />
        <LandingShowcase c={c} lang={lang} t={t} isMobile={isMobile} />
        <HowItWorks {...props} />
        <Highlights {...props} />
        <LandingFaq c={c} isMobile={isMobile} />
        <CtaBand {...props} />
      </main>
      <Footer {...props} langSwitch={langSwitch} />
    </>
  )
}
