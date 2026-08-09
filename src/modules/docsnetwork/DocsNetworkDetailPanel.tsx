import { useMemo } from 'react'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { Page } from '../../types'
import type { DocsGraph, DocsGraphSource, DocsNode } from '../../lib/docsGraph'
import { neighborKindCounts, pageAncestors, pageNodeId } from '../../lib/docsGraph'
import { neighborsOf } from '../../lib/graph'
import { daysUntil } from '../../lib/financeCalc'
import { useLanguage } from '../../i18n/LanguageContext'
import { badgeStyle, cardSurfaceStyle, ghostBtnStyle, primaryBtnStyle, sectionCaptionStyle, tabularNums, FIN_NEG, FIN_POS } from '../../components/uiTokens'
import { docsKindLabelKey } from './DocsGraphView'

// Detalhe do nó selecionado. Desktop: ocupa a coluna direita no lugar do
// ranking. Mobile: vai dentro do Drawer — por isso o componente não sabe onde
// está montado, só recebe onBack opcional.

export function DocsNetworkDetailPanel({ node, graph, source, onSelect, onBack, onOpen }: {
  node: DocsNode
  graph: DocsGraph
  source: DocsGraphSource
  onSelect: (nodeId: string) => void
  onBack?: () => void
  onOpen: (node: DocsNode) => void
}) {
  const { t, lang } = useLanguage()

  const neighbors = useMemo(() => neighborsOf(graph, node.id), [graph, node.id])
  const counts = useMemo(() => neighborKindCounts(graph, node.id), [graph, node.id])

  const page = node.kind === 'page' ? source.pages.find(p => p.id === node.refId) : undefined
  const board = node.kind === 'board' ? source.boards.find(b => b.id === node.refId) : undefined
  const card = node.kind === 'card' ? source.cards.find(c => c.id === node.refId) : undefined
  const note = node.kind === 'note' ? source.notes.find(n => n.id === node.refId) : undefined
  const person = node.kind === 'person' ? source.profiles.get(node.refId) : undefined

  const ancestors = page ? pageAncestors(source.pages, page.id) : []
  const cardBoard = card ? source.boards.find(b => b.id === card.board_id) : undefined
  const cardColumn = card ? source.columns.find(c => c.id === card.column_id) : undefined
  const dueDays = card?.due_date ? daysUntil(card.due_date) : null
  const checklistDone = card ? card.checklist.filter(i => i.completed).length : 0
  const boardCards = board ? source.cards.filter(c => c.board_id === board.id) : []
  const boardDone = boardCards.filter(c => c.completed).length

  const fmtDate = (iso: string) => new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso)
    .toLocaleDateString(lang, { day: '2-digit', month: 'short', year: 'numeric' })

  const openLabel = node.kind === 'page' ? t('docs_network_open_page')
    : node.kind === 'card' ? t('docs_network_open_card')
    : node.kind === 'board' ? t('docs_network_open_board')
    : node.kind === 'note' ? t('docs_network_open_notes')
    : null

  const stat = (label: string, value: React.ReactNode) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', ...tabularNums, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )

  return (
    <div style={{ ...cardSurfaceStyle, padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {onBack && (
        <button onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', border: 'none', background: 'transparent', color: 'var(--color-text-subtle)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          <ArrowLeft size={13} /> {t('docs_network_back_to_ranking')}
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 19,
          background: `color-mix(in srgb, ${node.color} 18%, var(--color-surface))`, border: `1px solid ${node.color}`,
        }}>
          {node.icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.label || t('docs_network_untitled')}
          </div>
          <span style={{ ...badgeStyle(node.color), marginTop: 2 }}>{t(docsKindLabelKey(node.kind))}</span>
        </div>
      </div>

      {openLabel && (
        <button onClick={() => onOpen(node)} style={{ ...primaryBtnStyle, alignSelf: 'flex-start' }}>
          <ExternalLink size={14} />{openLabel}
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {stat(t('docs_network_stats_links'), node.degree)}
        {page && stat(t('docs_network_stats_subpages'), counts.page)}
        {page && stat(t('docs_network_stats_cards'), counts.card)}
        {page && stat(t('docs_network_stats_notes'), counts.note)}
        {page && stat(t('docs_network_stats_people'), counts.person)}
        {page && stat(t('docs_network_stats_favorite'), page.is_favorite ? t('docs_network_yes') : t('docs_network_no'))}
        {card && cardBoard && stat(t('docs_network_stats_board'), `${cardBoard.icon} ${cardBoard.name}`)}
        {card && cardColumn && stat(t('docs_network_stats_column'), cardColumn.name)}
        {card && stat(t('docs_network_stats_priority'), t(`projects_priority_${card.priority}` as const))}
        {card && stat(t('docs_network_stats_status'), card.completed ? t('docs_network_status_done') : t('docs_network_status_open'))}
        {card?.due_date && stat(
          t('docs_network_stats_due'),
          dueDays != null && dueDays < 0 && !card.completed
            ? <span style={{ color: FIN_NEG }}>{t('docs_network_overdue')}</span>
            : fmtDate(card.due_date),
        )}
        {board && stat(t('docs_network_stats_cards'), boardCards.length)}
        {board && stat(t('docs_network_status_done'), `${boardDone}/${boardCards.length}`)}
        {board && stat(t('docs_network_stats_people'), counts.person)}
        {note && stat(t('docs_network_stats_updated'), fmtDate(note.updated_at))}
        {person && stat(t('docs_network_stats_cards'), counts.card)}
        {person && stat(t('docs_network_stats_subpages'), counts.page)}
      </div>

      {person && (
        <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{person.email}</div>
      )}

      {card && card.checklist.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h4 style={sectionCaptionStyle}>{t('docs_network_checklist')} {checklistDone}/{card.checklist.length}</h4>
          <div style={{ width: '100%', height: 6, borderRadius: 999, background: 'var(--color-bg-secondary)', overflow: 'hidden' }}>
            <div style={{ width: `${(checklistDone / card.checklist.length) * 100}%`, height: '100%', borderRadius: 999, background: FIN_POS }} />
          </div>
        </div>
      )}

      {ancestors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h4 style={sectionCaptionStyle}>{t('docs_network_path')}</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
            {ancestors.map((a: Page, i) => (
              <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>/</span>}
                <button onClick={() => onSelect(pageNodeId(a.id))}
                  style={{ ...ghostBtnStyle, padding: '3px 8px', fontSize: 12, borderRadius: 6 }}>
                  {a.icon} {a.title || t('docs_network_untitled')}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {note && note.content.trim() && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h4 style={sectionCaptionStyle}>{t('docs_network_preview')}</h4>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-subtle)', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
            {note.content}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h4 style={sectionCaptionStyle}>{t('docs_network_connections')}</h4>
        {neighbors.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('docs_network_no_connections')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {neighbors.map(({ node: other, edge }) => (
              <button key={other.id} onClick={() => onSelect(other.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '6px 8px', border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 12.5 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: other.color, flexShrink: 0 }} />
                <span style={{ flexShrink: 0 }}>{other.icon}</span>
                <span style={{ color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                  {other.label || t('docs_network_untitled')}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 11, flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {t(`docs_network_edge_${edge.kind.replace(/-/g, '_')}` as 'docs_network_edge_parent_page')}
                  {edge.kinds.length > 1 && ` ${t('docs_network_edge_more', { n: edge.kinds.length - 1 })}`}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
