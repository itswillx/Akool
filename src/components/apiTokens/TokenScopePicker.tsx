import { useId, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import type { SectionKey } from '../../../supabase/functions/_api/catalog'
import { PRESET_CHOICES, PRESETS, presetOf, type PresetChoice } from './presets'
import {
  fitsLimits, levelAllowed, levelLabelKey, levelsFor, PICKER_LEVELS, scopeWarnings, sectionBulkLevel, sectionLabelKey,
  sectionMaxLevel, setLevel, setSectionLevel, subsectionLabelKey, subsectionsOf, viewLabelKey, viewStatuses, visibleSections,
  type PickerLevel, type PickerLimits, type ScopeMap,
} from './scopeModel'
import { levelRank } from '../../../supabase/functions/_api/scopes'
import { SegmentedRadio } from './SegmentedRadio'
import { bannerStyle, fieldLabelStyle, hintStyle } from './tokenStyles'

// API-009: escolha das permissões de um token, na criação e na edição.
// Presets como ponto de partida; cada seção tem um nível em lote (limitado ao
// máximo de cada subseção) e abre para o nível de cada subseção. Administração
// só aparece para admin. O banco confere tudo de novo.

const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } as const

export function TokenScopePicker({ value, onChange, isAdmin, limits, emptyHint }: {
  value: ScopeMap
  onChange: (next: ScopeMap) => void
  isAdmin: boolean
  limits: PickerLimits
  /** Texto quando nada está escolhido (a edição explica que desligar é revogar). */
  emptyHint?: string
}) {
  const { t } = useLanguage()
  const id = useId()
  const [open, setOpen] = useState<ReadonlySet<SectionKey>>(() => new Set())
  // "Personalizado" escolhido à mão, com as permissões ainda iguais a um preset.
  const [customPicked, setCustomPicked] = useState(false)
  const preset = customPicked ? 'custom' : presetOf(value)
  const warnings = scopeWarnings(value)

  const pick = (choice: PresetChoice) => {
    setCustomPicked(choice === 'custom')
    if (choice !== 'custom') onChange({ ...PRESETS[choice] })
  }
  const change = (next: ScopeMap) => {
    setCustomPicked(false)
    onChange(next)
  }
  const toggle = (section: SectionKey) => setOpen(prev => {
    const next = new Set(prev)
    if (!next.delete(section)) next.add(section)
    return next
  })

  return (
    <div role="group" aria-labelledby={`${id}-title`} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span id={`${id}-title`} style={{ ...fieldLabelStyle, marginBottom: 0 }}>{t('api_picker_label')}</span>
      <p id={`${id}-hint`} style={hintStyle}>{t('api_picker_hint')}</p>

      <span id={`${id}-presets`} style={{ ...hintStyle, fontWeight: 600 }}>{t('api_preset_label')}</span>
      <SegmentedRadio
        variant="cards"
        labelledBy={`${id}-presets`}
        value={preset}
        onChange={pick}
        options={PRESET_CHOICES.map(choice => ({
          value: choice,
          label: t(`api_preset_${choice}`),
          description: t(`api_preset_${choice}_desc`),
          disabled: choice !== 'custom' && !fitsLimits(PRESETS[choice], limits),
        }))}
      />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {visibleSections(isAdmin).map(section => {
          const name = t(sectionLabelKey(section))
          const isOpen = open.has(section)
          const bulk = sectionBulkLevel(value, section)
          const max = sectionMaxLevel(section)
          const adminBlocked = section === 'admin' && !limits.admin
          const bulkOptions = PICKER_LEVELS.filter(level => level === 'none' || levelRank(level) <= levelRank(max)).map(level => ({
            value: level,
            label: t(levelLabelKey(level)),
            disabled: level !== 'none' && (adminBlocked || levelRank(level) > levelRank(limits.maxLevel)),
          }))
          return (
            <div key={section} style={{ borderTop: '1px solid var(--color-border)', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={rowStyle}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? `${id}-${section}` : undefined}
                  onClick={() => toggle(section)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: '4px 0', cursor: 'pointer', color: 'var(--color-text)', fontSize: 13.5, fontWeight: 600 }}
                >
                  {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  {name}
                </button>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  {bulk === 'mixed' && <span id={`${id}-${section}-mixed`} style={hintStyle}>{t('api_picker_mixed')}</span>}
                  <SegmentedRadio
                    label={t('api_picker_section_all', { section: name })}
                    describedBy={bulk === 'mixed' ? `${id}-${section}-mixed` : undefined}
                    value={bulk === 'mixed' ? null : bulk}
                    onChange={(level: PickerLevel) => change(setSectionLevel(value, section, level, limits))}
                    options={bulkOptions}
                  />
                </div>
              </div>
              {isOpen && (
                <div id={`${id}-${section}`} role="group" aria-label={t('api_picker_subsections', { section: name })} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 20 }}>
                  {subsectionsOf(section).map(sub => (
                    <div key={sub.key} style={rowStyle}>
                      <span id={`${id}-${sub.key}`} style={{ fontSize: 13, color: 'var(--color-text)' }}>{t(subsectionLabelKey(sub.key))}</span>
                      <SegmentedRadio
                        labelledBy={`${id}-${sub.key}`}
                        value={value[sub.key] ?? 'none'}
                        onChange={(level: PickerLevel) => change(setLevel(value, sub.key, level))}
                        options={levelsFor(sub).map(level => ({ value: level, label: t(levelLabelKey(level)), disabled: !levelAllowed(sub, level, limits) }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {Object.keys(value).length === 0 && <p style={hintStyle}>{emptyHint ?? t('api_picker_empty')}</p>}

      <div aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {warnings.map(warning => (
          <p key={warning} style={{ ...bannerStyle('warning'), margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={14} aria-hidden style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-warning)' }} />
            {t(`api_warn_${warning}`)}
          </p>
        ))}
      </div>

      <details style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--color-text)' }}>{t('api_picker_views_title')}</summary>
        <p style={{ ...hintStyle, margin: '6px 0' }}>{t('api_picker_views_hint')}</p>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {viewStatuses(value).map(({ view, granted, total }) => (
            <li key={view.key}>
              <strong style={{ color: 'var(--color-text)' }}>{t(viewLabelKey(view.key))}</strong>
              {': '}
              {total === 0
                ? t('api_picker_view_always')
                : `${t('api_picker_view_count', { granted, total })} (${view.anyOf.map(key => t(subsectionLabelKey(key))).join(', ')})`}
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
