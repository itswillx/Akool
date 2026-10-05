import { ChevronDown } from 'lucide-react'
import type { LandingContent } from '../../i18n/landingContent'
import { H2, sectionInner } from './landingStyles'

// Perguntas frequentes: <details>/<summary> nativos (teclado e leitor de tela
// de graça, sem estado). O `name` comum faz o grupo abrir um de cada vez onde
// o navegador suporta; a abertura animada e a seta girando ficam no
// landing.css (só com movimento liberado).
export function LandingFaq({ c, isMobile }: { c: LandingContent; isMobile: boolean }) {
  return (
    <section aria-labelledby="landing-faq-title" className="landing-faq landing-reveal" style={sectionInner(isMobile)}>
      <h2 id="landing-faq-title" style={H2}>{c.faq.title}</h2>
      <div style={{ display: 'grid', gap: 10, marginTop: 20, maxWidth: 820 }}>
        {c.faq.items.map(item => (
          <details key={item.q} name="landing-faq" className="landing-faq-item">
            <summary className="landing-faq-q">
              {item.q}
              <ChevronDown size={18} aria-hidden="true" className="landing-faq-chevron" />
            </summary>
            <p className="landing-faq-a">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
