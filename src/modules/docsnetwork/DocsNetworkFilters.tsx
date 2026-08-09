import { EyeOff, RefreshCw, Search } from 'lucide-react'
import type { ProjectBoard } from '../../types'
import type { DocsGraphFilters, DocsNodeKind } from '../../lib/docsGraph'
import { useLanguage } from '../../i18n/LanguageContext'
import { DualRange } from '../../components/DualRange'
import { cardSurfaceStyle, ghostBtnStyle, inputStyle } from '../../components/uiTokens'
import { docsKindLabelKey } from './DocsGraphView'

// Barra de filtros da Rede. Os tipos de nó são chips de múltipla escolha (não
// um segmented control, que é escolha única) — o usuário costuma querer "tudo
// menos pessoas", não um tipo por vez.

const KIND_ICONS: Record<DocsNodeKind, string> = {
  page: '📄', board: '📋', card: '🔸', note: '🗒️', person: '👤',
}
const KINDS: DocsNodeKind[] = ['page', 'board', 'card', 'note', 'person']

export function DocsNetworkFilters({ filters, onChange, boards, bounds, onReload }: {
  filters: DocsGraphFilters
  onChange: (next: DocsGraphFilters) => void
  boards: ProjectBoard[]
  bounds: { min: number; max: number }
  onReload: () => void
}) {
  const { t } = useLanguage()

  const chip = (kind: DocsNodeKind) => {
    const on = filters.kinds[kind]
    return (
      <button
        key={kind}
        onClick={() => onChange({ ...filters, kinds: { ...filters.kinds, [kind]: !on } })}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999,
          border: '1px solid', borderColor: on ? 'var(--color-border-active)' : 'var(--color-border)',
          background: on ? 'var(--color-active)' : 'transparent',
          color: on ? 'var(--color-text)' : 'var(--color-text-muted)',
          fontSize: 12.5, fontWeight: on ? 600 : 500, cursor: 'pointer', whiteSpace: 'nowrap',
          transition: 'background 0.12s, color 0.12s',
        }}
      >
        <span style={{ opacity: on ? 1 : 0.55 }}>{KIND_ICONS[kind]}</span>
        {t(docsKindLabelKey(kind))}
      </button>
    )
  }

  return (
    <div style={{ ...cardSurfaceStyle, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
      <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160, maxWidth: 280 }}>
        <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
        <input
          style={{ ...inputStyle, paddingLeft: 30 }}
          placeholder={t('docs_network_search_placeholder')}
          value={filters.search}
          onChange={e => onChange({ ...filters, search: e.target.value })}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{KINDS.map(chip)}</div>

      {boards.length > 0 && (
        <select
          style={{ ...inputStyle, width: 'auto', minWidth: 130, cursor: 'pointer' }}
          value={filters.boardId ?? ''}
          onChange={e => onChange({ ...filters, boardId: e.target.value || null })}
        >
          <option value="">{t('docs_network_all_boards')}</option>
          {boards.map(b => (
            <option key={b.id} value={b.id}>{b.icon} {b.name}</option>
          ))}
        </select>
      )}

      <DualRange
        label={t('docs_network_degree_range')}
        bounds={bounds}
        min={filters.minDegree}
        max={filters.maxDegree}
        onChange={(minDegree, maxDegree) => onChange({ ...filters, minDegree, maxDegree })}
        format={v => String(v)}
      />

      <button
        onClick={() => onChange({ ...filters, hideIsolated: !filters.hideIsolated })}
        title={t('docs_network_hide_isolated')}
        style={{
          ...ghostBtnStyle,
          background: filters.hideIsolated ? 'var(--color-active)' : 'var(--color-surface)',
          color: filters.hideIsolated ? 'var(--color-text)' : 'var(--color-text-subtle)',
        }}
      >
        <EyeOff size={14} />{t('docs_network_hide_isolated')}
      </button>

      <button onClick={onReload} title={t('docs_network_reload')} style={{ ...ghostBtnStyle, padding: 8, lineHeight: 0 }}>
        <RefreshCw size={14} />
      </button>
    </div>
  )
}
