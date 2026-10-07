import { useEffect, useId, useRef } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { CardField } from '../../../lib/data/projects'
import { GhostBtn, PrimaryBtn } from '../ui'
import { CARD_FIELD_LABELS } from './cardDraft'

// API-013: a gravação parou porque outra pessoa mudou os mesmos campos do card
// enquanto esta edição estava aberta. Nada é gravado até a pessoa escolher:
// carregar a versão salva (descarta o que ela mudou nesses campos) ou manter a
// dela (grava por cima, levando o que a outra pessoa mudou nos outros campos).
export function CardConflictBanner({ fields, onLoadSaved, onKeepMine }: {
  fields: CardField[]
  onLoadSaved: () => void
  onKeepMine: () => void
}) {
  const { t } = useLanguage()
  const titleId = useId()
  const titleRef = useRef<HTMLElement>(null)

  // O aviso aparece no meio da edição: o foco vai para ele, senão quem usa
  // teclado ou leitor de tela segue digitando sem saber que nada é gravado.
  useEffect(() => { titleRef.current?.focus() }, [])

  return (
    <section role="alert" aria-labelledby={titleId}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--color-warning) 45%, transparent)',
        backgroundColor: 'color-mix(in srgb, var(--color-warning) 12%, var(--color-bg))',
      }}>
      <strong id={titleId} ref={titleRef} tabIndex={-1} style={{ fontSize: 13, color: 'var(--color-text)' }}>
        {t('projects_conflict_title')}
      </strong>
      {fields.length > 0 && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          {t('projects_conflict_fields').replace('{fields}', fields.map(f => t(CARD_FIELD_LABELS[f])).join(', '))}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <GhostBtn onClick={onLoadSaved}>{t('projects_conflict_load')}</GhostBtn>
        <PrimaryBtn onClick={onKeepMine}>{t('projects_conflict_keep')}</PrimaryBtn>
      </div>
    </section>
  )
}
