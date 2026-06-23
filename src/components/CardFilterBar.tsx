import { useState } from 'react'
import { Filter, Search, ChevronDown, ChevronUp, X } from 'lucide-react'
import type { ProjectColumn, ProjectCardPriority } from '../types'
import type { DueDatePreset, ProjectCardFilters, CompletionFilter } from '../lib/projectCardFilters'
import { countActiveFilters, defaultCardFilters } from '../lib/projectCardFilters'
import { useLanguage } from '../i18n/LanguageContext'

interface Member {
  id: string
  email: string
  display_name: string | null
}

const PRIORITIES: ProjectCardPriority[] = ['urgent', 'high', 'medium', 'low']
const DUE_PRESETS: DueDatePreset[] = ['all', 'overdue', 'today', 'this_week', 'no_date', 'has_date']
const COMPLETION_OPTIONS: CompletionFilter[] = ['all', 'open', 'done']

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid var(--color-border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--color-text)',
  backgroundColor: 'var(--color-bg)',
  cursor: 'pointer',
  minWidth: 0,
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  backgroundColor: active ? 'var(--color-bg-tertiary)' : 'var(--color-bg)',
  color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
  fontSize: 12,
  fontWeight: active ? 600 : 400,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

const LABELS_COLLAPSE_THRESHOLD = 6

export default function CardFilterBar({
  filters,
  onChange,
  columns,
  members,
  availableLabels,
  isMobile = false,
}: {
  filters: ProjectCardFilters
  onChange: (filters: ProjectCardFilters) => void
  columns: ProjectColumn[]
  members: Member[]
  availableLabels: string[]
  isMobile?: boolean
}) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(!isMobile)
  const manyLabels = availableLabels.length > LABELS_COLLAPSE_THRESHOLD
  const [labelsExpanded, setLabelsExpanded] = useState(!manyLabels)
  const activeCount = countActiveFilters(filters)

  const togglePriority = (p: ProjectCardPriority) => {
    const next = filters.priorities.includes(p)
      ? filters.priorities.filter(x => x !== p)
      : [...filters.priorities, p]
    onChange({ ...filters, priorities: next })
  }

  const toggleLabel = (label: string) => {
    const next = filters.labels.includes(label)
      ? filters.labels.filter(x => x !== label)
      : [...filters.labels, label]
    onChange({ ...filters, labels: next })
  }

  const pLabel = (p: ProjectCardPriority) => t(`projects_priority_${p}` as 'projects_priority_low')
  const dueLabel = (preset: DueDatePreset) =>
    preset === 'all' ? t('projects_filter_all') : t(`projects_filter_due_${preset}` as 'projects_filter_due_overdue')

  const labelsSection = availableLabels.length > 0 && (
    <div style={{ width: isMobile ? '100%' : undefined, flex: isMobile ? '1 1 100%' : undefined }}>
      {manyLabels ? (
        <>
          <button
            type="button"
            onClick={() => setLabelsExpanded(o => !o)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: isMobile ? '100%' : 'auto',
              padding: '4px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-muted)',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            <span>{t('projects_labels')}:</span>
            {filters.labels.length > 0 && (
              <span style={{ fontSize: 10, fontWeight: 600, color: '#6366f1', backgroundColor: '#6366f11f', padding: '1px 6px', borderRadius: 999 }}>
                {t('projects_filter_labels_selected').replace('{count}', String(filters.labels.length))}
              </span>
            )}
            <span style={{ color: 'var(--color-text)', fontWeight: 500 }}>
              {labelsExpanded
                ? t('projects_filter_labels_hide')
                : t('projects_filter_labels_show').replace('{count}', String(availableLabels.length))}
            </span>
            <span style={{ marginLeft: isMobile ? 'auto' : undefined, color: 'var(--color-text-muted)' }}>
              {labelsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </span>
          </button>
          {labelsExpanded && (
            <div style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
              alignItems: 'center',
              marginTop: 6,
              maxHeight: isMobile ? 120 : undefined,
              overflowY: isMobile ? 'auto' : undefined,
              WebkitOverflowScrolling: isMobile ? 'touch' as React.CSSProperties['WebkitOverflowScrolling'] : undefined,
            }}>
              {availableLabels.map(label => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleLabel(label)}
                  style={chipStyle(filters.labels.includes(label))}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {!labelsExpanded && filters.labels.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {filters.labels.map(label => (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleLabel(label)}
                  style={chipStyle(true)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginRight: 2 }}>{t('projects_labels')}:</span>
          {availableLabels.map(label => (
            <button
              key={label}
              type="button"
              onClick={() => toggleLabel(label)}
              style={chipStyle(filters.labels.includes(label))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  const controls = (
    <>
      <div style={{ position: 'relative', flex: isMobile ? '1 1 100%' : '1 1 180px', minWidth: 140, maxWidth: isMobile ? undefined : 280 }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
        <input
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
          placeholder={t('projects_filter_search')}
          style={{
            width: '100%',
            padding: '6px 10px 6px 28px',
            border: '1px solid var(--color-border)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--color-text)',
            backgroundColor: 'var(--color-bg)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <select
        value={filters.duePreset}
        onChange={e => onChange({ ...filters, duePreset: e.target.value as DueDatePreset })}
        style={{ ...selectStyle, flex: '0 1 auto' }}
      >
        {DUE_PRESETS.map(p => (
          <option key={p} value={p}>{t('projects_due_date')}: {dueLabel(p)}</option>
        ))}
      </select>

      <select
        value={filters.assigneeId}
        onChange={e => onChange({ ...filters, assigneeId: e.target.value as ProjectCardFilters['assigneeId'] })}
        style={{ ...selectStyle, flex: '0 1 auto', maxWidth: 180 }}
      >
        <option value="">{t('projects_assignee')}: {t('projects_filter_all')}</option>
        <option value="unassigned">{t('projects_filter_unassigned')}</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.display_name || m.email}</option>
        ))}
      </select>

      <select
        value={filters.columnId}
        onChange={e => onChange({ ...filters, columnId: e.target.value })}
        style={{ ...selectStyle, flex: '0 1 auto', maxWidth: 160 }}
      >
        <option value="">{t('projects_table_column')}: {t('projects_filter_all')}</option>
        {columns.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {COMPLETION_OPTIONS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => onChange({ ...filters, completion: c })}
            style={chipStyle(filters.completion === c)}
          >
            {t(`projects_completion_${c}` as 'projects_completion_all')}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', width: isMobile ? '100%' : undefined }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginRight: 2 }}>{t('projects_priority')}:</span>
        {PRIORITIES.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => togglePriority(p)}
            style={chipStyle(filters.priorities.includes(p))}
          >
            {pLabel(p)}
          </button>
        ))}
      </div>

      {labelsSection}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={() => onChange(defaultCardFilters())}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={12} />
          {t('projects_filter_clear')}
        </button>
      )}
    </>
  )

  return (
    <div style={{
      padding: isMobile ? '8px 14px' : '10px 16px',
      borderBottom: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-bg)',
      flexShrink: 0,
    }}>
      {isMobile ? (
        <>
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '6px 0',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--color-text)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Filter size={14} color="var(--color-icon)" />
            {t('projects_filter_title')}
            {activeCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', backgroundColor: '#6366f11f', padding: '1px 7px', borderRadius: 999 }}>
                {t('projects_filter_active').replace('{count}', String(activeCount))}
              </span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>
          {expanded && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingTop: 8 }}>
              {controls}
            </div>
          )}
        </>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Filter size={14} color="var(--color-icon)" style={{ flexShrink: 0 }} />
          {activeCount > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: '#6366f1', backgroundColor: '#6366f11f', padding: '2px 8px', borderRadius: 999, flexShrink: 0 }}>
              {t('projects_filter_active').replace('{count}', String(activeCount))}
            </span>
          )}
          {controls}
        </div>
      )}
    </div>
  )
}
