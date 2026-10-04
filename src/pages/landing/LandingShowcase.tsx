import { useEffect, useRef, useState } from 'react'
import type { AnimationEvent } from 'react'
import { Check, Pause, Play } from 'lucide-react'
import { tabPanelProps } from '@/lib/tabs'
import { Tabs } from '@/shared/ui/Tabs'
import { ghostBtnStyle, segBtnStyle, segTrackStyle } from '@/shared/ui/uiTokens'
import type { LandingContent, LandingShowcaseId } from '../../i18n/landingContent'
import type { Lang } from '../../i18n/translations'
import { AppPreview } from '../auth/AppPreview'
import type { AppPreviewVariant } from '../auth/AppPreview'
import type { Translate } from '../auth/authView'
import { H2, SUBTITLE, sectionInner } from './landingStyles'

// "Por dentro dos módulos": abas (padrão WAI-ARIA do Tabs) com a prévia do
// módulo e o que ele faz. A troca automática é guiada pela barra de progresso
// da aba ativa (landing.css): quando a animação de 6 s termina, passa para a
// próxima. Para no hover e com o foco dentro (CSS), no botão Pausar (WCAG
// 2.2.2), quando a pessoa escolhe uma aba ou mexe na prévia, e fora da tela
// (IntersectionObserver: o painel muda de altura e empurraria o que está
// abaixo). Com movimento reduzido a barra não anima, então nada troca sozinho,
// e o botão some. A prévia é uma demonstração: a barra lateral dela troca a
// aba (o Dashboard mostra a visão geral sem trocar a aba).

const ID_BASE = 'landing-showcase'
const PROGRESS_ANIMATION = 'landing-showcase-progress'

export function LandingShowcase({ c, lang, t, isMobile }: {
  c: LandingContent
  lang: Lang
  t: Translate
  isMobile: boolean
}) {
  const items = c.showcase.items
  const ids = items.map(item => item.id)
  const [selected, setSelected] = useState<LandingShowcaseId>(ids[0])
  const [playing, setPlaying] = useState(true)
  const [overview, setOverview] = useState(false)
  const [inView, setInView] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = items.find(item => item.id === selected) ?? items[0]

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 })
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  // Só o fim da própria barra conta (o animationend de dentro da aba também sobe até aqui).
  const advance = (e: AnimationEvent<HTMLSpanElement>) => {
    if (e.animationName !== PROGRESS_ANIMATION || !playing) return
    setOverview(false)
    setSelected(ids[(ids.indexOf(selected) + 1) % ids.length])
  }
  const pause = () => setPlaying(false)
  const choose = (id: LandingShowcaseId) => {
    setOverview(false)
    setSelected(id)
    pause()
  }
  const changeVariant = (variant: AppPreviewVariant) => {
    if (variant === 'overview') {
      setOverview(true)
      pause()
    } else {
      choose(variant)
    }
  }

  return (
    <section aria-labelledby="landing-showcase-title" className="landing-reveal" style={sectionInner(isMobile)}>
      <h2 id="landing-showcase-title" style={H2}>{c.showcase.title}</h2>
      <p style={SUBTITLE}>{c.showcase.subtitle}</p>
      <div ref={rootRef} className="landing-showcase" data-playing={playing} data-inview={inView}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
          <Tabs
            idBase={ID_BASE}
            items={ids}
            selected={selected}
            onSelect={choose}
            label={c.showcase.tabsLabel}
            style={{ ...segTrackStyle, maxWidth: '100%', overflowX: 'auto', boxSizing: 'border-box' }}
            renderTab={(id, props, isSelected) => (
              <button key={id} type="button" {...props} className="landing-tab" style={segBtnStyle(isSelected, { wide: !isMobile })}>
                {items.find(item => item.id === id)?.label}
                {isSelected && <span className="landing-tab-progress" aria-hidden="true" onAnimationEnd={advance} />}
              </button>
            )}
          />
          <button
            type="button"
            className="landing-showcase-toggle"
            onClick={() => setPlaying(p => !p)}
            // display fica na classe: com movimento reduzido o CSS esconde o botão.
            style={{ ...ghostBtnStyle, display: undefined, fontSize: 12.5, padding: '6px 10px' }}
          >
            {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
            {playing ? c.showcase.pause : c.showcase.resume}
          </button>
        </div>
        <div {...tabPanelProps(ID_BASE, selected)} className="landing-showcase-panel">
          {/* key: o texto remonta na troca e entra com fade; a prévia fica (guarda o que a pessoa fez). */}
          <div key={selected} className="landing-showcase-text">
            <p style={{ margin: 0, fontSize: 17, fontWeight: 600, lineHeight: 1.4, color: 'var(--color-text)' }}>{current.lead}</p>
            <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 12 }}>
              {current.points.map(point => (
                <li key={point} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14, lineHeight: 1.55, color: 'var(--color-text-subtle)' }}>
                  <Check size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3, color: 'var(--color-accent)' }} />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className="landing-showcase-preview">
            <AppPreview
              lang={lang}
              t={t}
              variant={overview ? 'overview' : selected}
              interactive
              onVariantChange={changeVariant}
              onInteract={pause}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
