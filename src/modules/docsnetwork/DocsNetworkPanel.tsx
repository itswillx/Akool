import { useMemo, useState } from 'react'
import type { Page } from '../../types'
import {
  DEFAULT_DOCS_FILTERS, MAX_DOCS_NODES, buildDocsGraph,
  type DocsGraphFilters, type DocsNode,
} from '../../lib/docsGraph'
import { applySearch, applyValueFilter, capGraph, dropIsolated, graphValueBounds } from '../../lib/graph'
import { radiusFor, runForceLayout } from '../../lib/forceLayout'
import { setDocsSelection } from '../../lib/docsNavigation'
import { useLanguage } from '../../i18n/LanguageContext'
import { Drawer } from '../../components/Drawer'
import { cardSurfaceStyle } from '../../components/uiTokens'
import { useDocsGraphData } from './useDocsGraphData'
import { DocsGraphView } from './DocsGraphView'
import { DocsNetworkFilters } from './DocsNetworkFilters'
import { DocsNetworkRanking } from './DocsNetworkRanking'
import { DocsNetworkDetailPanel } from './DocsNetworkDetailPanel'

// Seção "Rede" de Documentos. Espelha o pipeline da aba Rede do financeiro:
// construir → medir → filtrar → buscar → limitar → posicionar, tudo em memos
// encadeados, com o layout de força recalculado apenas quando o conjunto de
// nós/arestas muda de fato.

export default function DocsNetworkPanel({ isMobile, pages, onOpenPage }: {
  isMobile: boolean
  /** Lista achatada — o DocumentsPanel já achata a árvore do PagesContext. */
  pages: Page[]
  onOpenPage: (page: Page) => void
}) {
  const { t } = useLanguage()
  const { source, loading, error, reload } = useDocsGraphData(pages)
  const [filters, setFilters] = useState<DocsGraphFilters>(DEFAULT_DOCS_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Tipos e quadro entram no build (e não depois): esconder pessoas tem que
  // encolher as páginas às quais elas estavam ligadas, senão o raio mente.
  const fullGraph = useMemo(
    () => buildDocsGraph(source, { kinds: filters.kinds, boardId: filters.boardId }),
    [source, filters.kinds, filters.boardId],
  )

  // Bounds do slider vêm do grafo ANTES do filtro de faixa.
  const bounds = useMemo(() => graphValueBounds(fullGraph), [fullGraph])

  const graph = useMemo(() => {
    let g = applyValueFilter(fullGraph, filters.minDegree, filters.maxDegree)
    if (filters.hideIsolated) g = dropIsolated(g)
    g = applySearch(g, filters.search)
    return capGraph(g, MAX_DOCS_NODES)
  }, [fullGraph, filters.minDegree, filters.maxDegree, filters.hideIsolated, filters.search])

  const capped = graph.nodes.length < fullGraph.nodes.length && graph.nodes.length === MAX_DOCS_NODES

  const layoutKey = useMemo(
    () => graph.nodes.map(n => `${n.id}:${Math.round(radiusFor(n.value, bounds.max))}`).join(',') + '#' + graph.edges.map(e => e.id).join(','),
    [graph, bounds.max],
  )
  // O tamanho do canvas e a contagem de iterações escalam com o número de nós
  // dentro do próprio runForceLayout; o canvas enquadra o resultado sozinho.
  const layout = useMemo(
    () => runForceLayout(
      graph.nodes.map(n => ({ id: n.id, r: radiusFor(n.value, bounds.max) })),
      graph.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight })),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  )

  const selectedNode = selectedId ? graph.nodes.find(n => n.id === selectedId) ?? null : null

  // Abrir um item: página usa o handler do painel (que sabe distinguir árvore
  // própria de página compartilhada); card/quadro gravam as chaves que o
  // ProjectsPanel lê no mount — mesmo protocolo do QuickNotes e do Dashboard.
  const openNode = (node: DocsNode) => {
    if (node.kind === 'page') {
      const page = source.pages.find(p => p.id === node.refId)
      if (page) onOpenPage(page)
      return
    }
    if (node.kind === 'card') {
      const card = source.cards.find(c => c.id === node.refId)
      if (!card) return
      localStorage.setItem('projects_active_board', card.board_id)
      localStorage.setItem('projects_open_card', card.id)
      setDocsSelection({ kind: 'projects' })
      return
    }
    if (node.kind === 'board') {
      localStorage.setItem('projects_active_board', node.refId)
      setDocsSelection({ kind: 'projects' })
      return
    }
    if (node.kind === 'note') setDocsSelection({ kind: 'quick-notes' })
  }

  if (loading) {
    return <div style={{ padding: 24, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('docs_network_loading')}</div>
  }
  if (error) {
    return (
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{t('docs_network_error')}</span>
        <button onClick={reload} style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {t('docs_network_reload')}
        </button>
      </div>
    )
  }

  const detail = selectedNode && (
    // key por nó: navegar para um vizinho remonta o painel e zera scroll/estado.
    <DocsNetworkDetailPanel
      key={selectedNode.id}
      node={selectedNode}
      graph={graph}
      source={source}
      onSelect={setSelectedId}
      onOpen={openNode}
      onBack={isMobile ? undefined : () => setSelectedId(null)}
    />
  )

  const ranking = (
    <DocsNetworkRanking graph={graph} hideIsolated={filters.hideIsolated} onSelect={setSelectedId} />
  )

  // No desktop o card do grafo estica: `height: '100%'` sobre um pai em flex:1
  // — o grafo ganha toda a altura que sobra em vez de um valor fixo.
  const graphCard = (height: number | '100%') => (
    <div style={{ ...cardSurfaceStyle, overflow: 'hidden', height: height === '100%' ? '100%' : undefined }}>
      <DocsGraphView
        graph={graph}
        layout={layout}
        selectedId={selectedId}
        onSelect={setSelectedId}
        height={height}
        isMobile={isMobile}
      />
    </div>
  )

  const header = (
    <>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{t('docs_network_title')}</h2>
        <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--color-text-muted)' }}>{t('docs_network_subtitle')}</p>
      </div>

      <DocsNetworkFilters
        filters={filters}
        onChange={setFilters}
        boards={source.boards}
        bounds={bounds}
        onReload={reload}
      />

      {capped && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 2px' }}>
          {t('docs_network_capped', { n: MAX_DOCS_NODES })}
        </div>
      )}
    </>
  )

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {header}
        {graphCard(380)}
        {ranking}
        {selectedNode && (
          <Drawer title={`${selectedNode.icon} ${selectedNode.label || t('docs_network_untitled')}`} onClose={() => setSelectedId(null)}>
            {detail}
          </Drawer>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, height: '100%', minHeight: 0 }}>
      {header}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 14, flex: 1, minHeight: 320 }}>
        {graphCard('100%')}
        {/* A coluna lateral rola por conta própria: um detalhe longo não pode
            empurrar o grafo para fora da tela. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflowY: 'auto' }}>
          {selectedNode ? detail : (
            <>
              {ranking}
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>
                {t('docs_network_detail_hint')}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
