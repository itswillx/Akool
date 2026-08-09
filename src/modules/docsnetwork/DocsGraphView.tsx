import type { DocsEdge, DocsGraph, DocsNode, DocsNodeKind } from '../../lib/docsGraph'
import type { LayoutNode } from '../../lib/forceLayout'
import { GraphCanvas } from '../../components/graph/GraphCanvas'
import { useLanguage } from '../../i18n/LanguageContext'

// Adaptador do canvas genérico para o domínio de Documentos. Sem formatValue:
// o `value` aqui é o grau, que já está implícito no tamanho do nó — imprimir
// "3" sob cada bolha seria ruído.

export function docsKindLabelKey(kind: DocsNodeKind) {
  return `docs_network_kind_${kind}` as const
}

export function DocsGraphView({ graph, layout, selectedId, onSelect, height, isMobile }: {
  graph: DocsGraph
  layout: LayoutNode[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** '100%' deixa o grafo esticar até a altura do pai (desktop). */
  height: number | '100%'
  isMobile: boolean
}) {
  const { t } = useLanguage()
  return (
    <GraphCanvas<DocsNode, DocsEdge>
      graph={graph}
      layout={layout}
      selectedId={selectedId}
      onSelect={onSelect}
      height={height}
      isMobile={isMobile}
      formatValue={null}
      labels={{
        empty: t('docs_network_empty'),
        zoomIn: t('docs_network_zoom_in'),
        zoomOut: t('docs_network_zoom_out'),
        zoomReset: t('docs_network_zoom_reset'),
        fullscreen: t('docs_network_fullscreen'),
        exitFullscreen: t('docs_network_exit_fullscreen'),
      }}
      kindLabel={kind => t(docsKindLabelKey(kind))}
    />
  )
}
