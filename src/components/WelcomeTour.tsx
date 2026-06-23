import { useState } from 'react'
import { X } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { helpContent } from '../i18n/helpContent'
import { HelpGlyph } from './helpIcons'

export default function WelcomeTour({ onClose }: { onClose: () => void }) {
  const { lang } = useLanguage()
  const c = helpContent[lang]
  const steps = c.tour
  const [index, setIndex] = useState(0)

  const step = steps[index]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  const next = () => {
    if (isLast) onClose()
    else setIndex((i) => i + 1)
  }
  const back = () => setIndex((i) => Math.max(0, i - 1))

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
        backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, borderRadius: 20, overflow: 'hidden',
          backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
          boxShadow: '0 24px 60px -20px rgba(0,0,0,0.45)',
        }}
      >
        {/* Header banner */}
        <div style={{
          position: 'relative', padding: '32px 28px 28px', textAlign: 'center',
          background: `linear-gradient(160deg, ${step.color}22, ${step.color}08)`,
        }}>
          <button
            onClick={onClose}
            aria-label={c.tourSkip}
            style={{
              position: 'absolute', top: 12, right: 12, width: 30, height: 30,
              borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)',
            }}
          >
            <X size={18} />
          </button>

          <div style={{
            margin: '0 auto 16px', width: 64, height: 64, borderRadius: 18,
            backgroundColor: `${step.color}1f`, color: step.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <HelpGlyph name={step.icon} size={30} />
          </div>

          <div style={{
            display: 'inline-block', marginBottom: 10, padding: '3px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
            color: step.color, backgroundColor: `${step.color}1a`,
          }}>
            {c.tourBadge}
          </div>

          <h2 style={{ margin: '0 0 8px', fontSize: 21, fontWeight: 700, color: 'var(--color-text)' }}>
            {step.title}
          </h2>
          <p style={{ margin: '0 auto', maxWidth: 360, fontSize: 14, lineHeight: 1.55, color: 'var(--color-text-muted)' }}>
            {step.description}
          </p>
        </div>

        {/* Footer controls */}
        <div style={{ padding: '18px 24px 22px' }}>
          {/* Progress dots */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginBottom: 18 }}>
            {steps.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === index ? 22 : 7, height: 7, borderRadius: 999,
                  backgroundColor: i === index ? step.color : 'var(--color-border)',
                  transition: 'all 0.25s',
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <button
              onClick={onClose}
              style={{
                padding: '9px 14px', borderRadius: 10, border: 'none', background: 'transparent',
                fontSize: 13, fontWeight: 500, color: 'var(--color-text-muted)', cursor: 'pointer',
              }}
            >
              {c.tourSkip}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {index + 1} {c.tourStepOf} {steps.length}
              </span>
              {!isFirst && (
                <button
                  onClick={back}
                  style={{
                    padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
                    border: '1px solid var(--color-border)', background: 'var(--color-surface)',
                    fontSize: 13, fontWeight: 600, color: 'var(--color-text)',
                  }}
                >
                  {c.tourBack}
                </button>
              )}
              <button
                onClick={next}
                style={{
                  padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                  backgroundColor: 'var(--color-primary)', color: 'var(--color-btn-primary-text)',
                  fontSize: 13, fontWeight: 600,
                }}
              >
                {isLast ? c.tourFinish : c.tourNext}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
