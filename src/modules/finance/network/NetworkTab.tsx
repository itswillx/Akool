import { useMemo, useState } from 'react'
import type { FinanceAccount, FinanceCategory, FinanceGoal, FinanceGoalContribution, FinanceTransaction } from '../../../types'
import {
  DEFAULT_GRAPH_FILTERS, applySearch, applyValueFilter, buildFinanceGraph,
  filterTransactions, graphValueBounds, lastNMonths, type GraphFilters,
} from '../../../lib/financeGraph'
import { radiusFor, runForceLayout } from '../../../lib/forceLayout'
import { useLanguage } from '../../../i18n/LanguageContext'
import { Drawer, useFinanceMobile } from '../ui'
import { cardSurfaceStyle } from '../ui/tokens'
import { NetworkFilters } from './NetworkFilters'
import { NetworkGraph } from './NetworkGraph'
import { NetworkRanking } from './NetworkRanking'
import { NetworkDetailPanel } from './NetworkDetailPanel'

// Aba "Rede": grafo interativo de contas ↔ categorias ↔ metas. Orquestra o
// pipeline puro de src/lib/financeGraph (janela → grafo → bounds → faixa →
// busca) e o layout de força determinístico de src/lib/forceLayout.
//
// v1 usa só os dados pessoais que o useFinanceData já carrega. Dados da Loja
// (produtos/clientes/vendas) ficam de fora de propósito: o useFinanceStore é
// instanciado uma única vez pela aba Projetos — ver financeGraph.ts.

function currentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function NetworkTab({ accounts, categories, transactions, goals, contributions }: {
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  transactions: FinanceTransaction[]
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
}) {
  const { t } = useLanguage()
  const isMobile = useFinanceMobile()
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_GRAPH_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [baseYM] = useState(currentYM)

  const months = useMemo(() => lastNMonths(baseYM, filters.months), [baseYM, filters.months])

  const filteredTxs = useMemo(
    () => filterTransactions(transactions, filters, baseYM),
    [transactions, filters.months, filters.accountId, filters.txType, baseYM],
  )

  const fullGraph = useMemo(
    () => buildFinanceGraph({ accounts, categories, goals, contributions, transactions: filteredTxs }, filters),
    [accounts, categories, goals, contributions, filteredTxs, filters.txType, filters.accountId],
  )

  // Bounds do slider vêm do grafo ANTES do filtro de faixa — senão o slider
  // encolheria o próprio trilho a cada arrasto.
  const bounds = useMemo(() => graphValueBounds(fullGraph), [fullGraph])

  const graph = useMemo(
    () => applySearch(applyValueFilter(fullGraph, filters.minValue, filters.maxValue), filters.search),
    [fullGraph, filters.minValue, filters.maxValue, filters.search],
  )

  // Relayout só quando o conjunto de nós/arestas muda de verdade (a chave é a
  // lista de ids) — hover/seleção nunca reposicionam nada.
  const layoutKey = useMemo(
    () => graph.nodes.map(n => `${n.id}:${Math.round(radiusFor(n.value, bounds.max))}`).join(',') + '#' + graph.edges.map(e => e.id).join(','),
    [graph, bounds.max],
  )
  const layout = useMemo(
    () => runForceLayout(
      graph.nodes.map(n => ({ id: n.id, r: radiusFor(n.value, bounds.max) })),
      graph.edges.map(e => ({ source: e.source, target: e.target, weight: e.weight })),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey],
  )

  const selectedNode = selectedId ? graph.nodes.find(n => n.id === selectedId) ?? null : null

  const detail = selectedNode && (
    // key por nó: navegar para um vizinho remonta o painel e zera estado
    // local (ex.: "Ver todas" da lista de transações).
    <NetworkDetailPanel
      key={selectedNode.id}
      node={selectedNode}
      graph={graph}
      transactions={filteredTxs}
      allTransactions={transactions}
      contributions={contributions}
      accounts={accounts}
      goals={goals}
      months={months}
      onSelect={setSelectedId}
      onBack={isMobile ? undefined : () => setSelectedId(null)}
    />
  )

  const ranking = (
    <NetworkRanking
      categories={categories}
      transactions={filteredTxs}
      goals={goals}
      contributions={contributions}
      onSelect={setSelectedId}
    />
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <NetworkFilters filters={filters} onChange={setFilters} accounts={accounts} bounds={bounds} />

      {isMobile ? (
        <>
          <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
            <NetworkGraph graph={graph} layout={layout} selectedId={selectedId} onSelect={setSelectedId} height={380} />
          </div>
          {ranking}
          {selectedNode && (
            <Drawer title={`${selectedNode.icon} ${selectedNode.label}`} onClose={() => setSelectedId(null)}>
              {detail}
            </Drawer>
          )}
        </>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 14, alignItems: 'start' }}>
          <div style={{ ...cardSurfaceStyle, overflow: 'hidden' }}>
            <NetworkGraph graph={graph} layout={layout} selectedId={selectedId} onSelect={setSelectedId} height={560} />
          </div>
          {/* Sem seleção a coluna mostra o ranking; com seleção, o detalhe —
              mantém as três zonas do layout sem abrir uma quarta. */}
          {selectedNode ? detail : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {ranking}
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '0 4px' }}>
                {t('finance_network_detail_hint')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
