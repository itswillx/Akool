import { useMemo, useState } from 'react'
import type { DocsGraph } from '../../lib/docsGraph'
import { listIsolated, rankByDegree } from '../../lib/docsGraph'
import { useLanguage } from '../../i18n/LanguageContext'
import { cardSurfaceStyle, sectionCaptionStyle, segBtnStyle, segTrackStyle, tabularNums } from '../../components/uiTokens'

// Ranking lateral, calculado sobre o grafo JÁ filtrado — acompanha os filtros.
// O modo "Isolados" é o acionável: página que ninguém linka, card sem vínculo.

type RankMode = 'connected' | 'people' | 'orphans'

export function DocsNetworkRanking({ graph, hideIsolated, onSelect }: {
  graph: DocsGraph
  hideIsolated: boolean
  onSelect: (nodeId: string) => void
}) {
  const { t } = useLanguage()
  const [mode, setMode] = useState<RankMode>('connected')

  const rows = useMemo(() => {
    if (mode === 'orphans') return listIsolated(graph, 8)
    return rankByDegree(graph, 8, mode === 'people' ? 'person' : undefined)
  }, [mode, graph])

  const maxDegree = Math.max(1, ...rows.map(r => r.degree))

  const emptyText = mode === 'orphans'
    ? (hideIsolated ? t('docs_network_orphans_hidden') : t('docs_network_no_orphans'))
    : t('docs_network_no_rank')

  return (
    <div style={{ ...cardSurfaceStyle, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ ...sectionCaptionStyle, padding: '0 4px' }}>{t('docs_network_ranking_title')}</h3>
      <div style={{ ...segTrackStyle, alignSelf: 'stretch' }}>
        <button style={segBtnStyle(mode === 'connected', { wide: true })} onClick={() => setMode('connected')}>{t('docs_network_rank_connected')}</button>
        <button style={segBtnStyle(mode === 'people', { wide: true })} onClick={() => setMode('people')}>{t('docs_network_rank_people')}</button>
        <button style={segBtnStyle(mode === 'orphans', { wide: true })} onClick={() => setMode('orphans')}>{t('docs_network_rank_orphans')}</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map(node => (
          <button key={node.id} onClick={() => onSelect(node.id)}
            style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%', padding: '7px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, width: '100%' }}>
              <span style={{ flexShrink: 0 }}>{node.icon}</span>
              <span style={{ color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {node.label || t('docs_network_untitled')}
              </span>
              <span style={{ color: 'var(--color-text-muted)', fontWeight: 700, flexShrink: 0, ...tabularNums }}>{node.degree}</span>
            </div>
            {mode !== 'orphans' && (
              <div style={{ width: '100%', height: 5, borderRadius: 999, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(4, (node.degree / maxDegree) * 100)}%`, height: '100%', borderRadius: 999, background: node.color }} />
              </div>
            )}
          </button>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: '14px 8px', fontSize: 12.5, color: 'var(--color-text-muted)' }}>{emptyText}</div>
        )}
      </div>
    </div>
  )
}
