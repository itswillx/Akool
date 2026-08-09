import type { FinanceGraph, GraphEdge, GraphNode } from '../../../lib/financeGraph'
import type { LayoutNode } from '../../../lib/forceLayout'
import { formatBRL } from '../../../lib/money'
import { GraphCanvas } from '../../../components/graph/GraphCanvas'
import { useLanguage } from '../../../i18n/LanguageContext'
import { useFinanceMobile } from '../ui'
import { FIN_NEG, FIN_POS } from '../ui/tokens'

// Adaptador do canvas genérico (src/components/graph) para o domínio de
// finanças: dinheiro em reais nos rótulos, verde/vermelho nas arestas por tipo
// de transação e as strings de UI vindas das chaves finance_network_*.

export function NetworkGraph({ graph, layout, selectedId, onSelect, height }: {
  graph: FinanceGraph
  layout: LayoutNode[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  height: number
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()

  return (
    <GraphCanvas<GraphNode, GraphEdge>
      graph={graph}
      layout={layout}
      selectedId={selectedId}
      onSelect={onSelect}
      height={height}
      isMobile={isMobile}
      formatValue={formatBRL}
      labels={{
        empty: t('finance_network_empty'),
        zoomIn: t('finance_network_zoom_in'),
        zoomOut: t('finance_network_zoom_out'),
        zoomReset: t('finance_network_zoom_reset'),
        fullscreen: t('finance_network_fullscreen'),
        exitFullscreen: t('finance_network_exit_fullscreen'),
      }}
      kindLabel={kind =>
        kind === 'account' ? t('finance_network_kind_account')
        : kind === 'category' ? t('finance_network_kind_category')
        : t('finance_network_kind_goal')}
      edgeColor={(edge, nodeById) =>
        edge.kind === 'income' ? FIN_POS
        : edge.kind === 'expense' ? FIN_NEG
        : nodeById.get(edge.target)?.color ?? 'var(--color-border)'}
    />
  )
}
