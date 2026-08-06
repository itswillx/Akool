import { useCallback, useMemo } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { formatBRL } from '../../../lib/money'
import { itemExpectedCost, stageTotals } from '../../../lib/financeProjectCalc'
import { stepIndexOf, type StepDef } from '../../../lib/boardStepper'
import { BoardStepper, KanbanBoard, type BoardColumnDef, type BoardSortOption } from '../../../components/board'
import type { FinanceProject, FinanceProjectItem } from '../../../types'
import { tabularNums } from '../ui'
import { ITEM_STATUS_KEY, badgeStyle, budgetBarColor, formatQuantity, itemStatusColor } from './projectsUi'
import type { FinanceProjectsStore } from './useFinanceProjects'

// Kanban das etapas de uma obra. As colunas são as etapas cadastradas; os cards
// são os ITENS da lista de compras.
//
// Card é item, não gasto: o item é o que anda entre etapas ("o piso saiu do
// Acabamento e foi para a Área externa"). Um gasto tem data e conta — arrastá-lo
// entre etapas sugeriria que o dinheiro está sendo movido, o que não acontece.

/** Coluna sintética dos itens sem etapa. */
const NO_STAGE = ''

export function StagesBoard({ project, store, onItemClick }: {
  project: FinanceProject
  store: FinanceProjectsStore
  onItemClick?: (item: FinanceProjectItem) => void
}) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()

  const stages = useMemo(
    () => store.stages.filter(s => s.project_id === project.id).sort((a, b) => a.sort_order - b.sort_order),
    [store.stages, project.id],
  )
  const items = useMemo(
    () => store.items.filter(i => i.project_id === project.id),
    [store.items, project.id],
  )
  const expenses = useMemo(
    () => store.expenses.filter(e => e.project_id === project.id),
    [store.expenses, project.id],
  )

  // "Sem etapa" existe porque a FK é ON DELETE SET NULL: apagar uma etapa
  // devolve seus itens para o limbo. Sem essa coluna eles sumiriam do board.
  const columns: BoardColumnDef[] = useMemo(() => [
    ...stages.map(s => ({
      id: s.id,
      label: `${s.icon} ${s.name}`,
      color: s.color,
      limit: s.budget_amount > 0 ? s.budget_amount : null,
    })),
    { id: NO_STAGE, label: t('finance_proj_board_no_stage'), color: 'var(--color-text-muted)' },
  ], [stages, t])

  const steps: StepDef[] = useMemo(
    () => stages.map(s => ({ id: s.id, label: s.name, color: s.color })),
    [stages],
  )

  const quotes = store.quotes
  const expectedCost = useCallback(
    (item: FinanceProjectItem) => itemExpectedCost(item, quotes),
    [quotes],
  )

  const sortOptions: BoardSortOption<FinanceProjectItem>[] = useMemo(() => [
    { id: 'recent', label: t('board_sort_recent'), compare: (a, b) => b.updated_at.localeCompare(a.updated_at) },
    { id: 'value', label: t('board_sort_value'), compare: (a, b) => expectedCost(b) - expectedCost(a) },
    { id: 'name', label: t('board_sort_name'), compare: (a, b) => a.name.localeCompare(b.name) },
  ], [t, expectedCost])

  return (
    <KanbanBoard
      storageKey={`finance_board_stages:${project.id}`}
      columns={columns}
      items={items}
      isMobile={isMobile}
      getId={i => i.id}
      getColumnId={i => i.stage_id ?? NO_STAGE}
      getAmount={expectedCost}
      getSearchText={i => `${i.name} ${i.unit} ${i.notes}`}
      sortOptions={sortOptions}
      onCardClick={onItemClick}
      // Sem confirmação: mudar um item de etapa não move dinheiro nenhum, e o
      // hook já é otimista. `stage_id` volta a null na coluna "Sem etapa".
      onMove={(item, to) => store.updateItem(item.id, { stage_id: to === NO_STAGE ? null : to })}
      renderColumnHeaderExtra={col => {
        if (col.id === NO_STAGE) return null
        const stage = stages.find(s => s.id === col.id)
        if (!stage) return null
        // Reusa stageTotals em vez de recalcular: o "gasto" vem dos GASTOS, e a
        // soma nativa da coluna é o "a comprar" dos itens — são números
        // diferentes, e recalcular aqui os faria divergir da aba Etapas.
        const totals = stageTotals(stage, items, expenses, store.quotes)
        return (
          <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-text-muted)', ...tabularNums }}>
            {totals.limit > 0
              ? t('finance_proj_spent_of', { spent: formatBRL(totals.spent), limit: formatBRL(totals.limit) })
              : t('finance_proj_spent_no_limit', { spent: formatBRL(totals.spent) })}
            {totals.limit > 0 && (
              <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: 'var(--color-border)', overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, totals.pct)}%`, height: '100%', background: budgetBarColor(totals.pct, totals.over) }} />
              </div>
            )}
          </div>
        )
      }}
      renderCard={item => (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {formatQuantity(item.quantity)}{item.unit ? ` ${item.unit}` : ''}
              </div>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0, ...tabularNums }}>
              {formatBRL(expectedCost(item))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={badgeStyle(itemStatusColor(item.status))}>{t(ITEM_STATUS_KEY[item.status])}</span>
          </div>
          {steps.length > 1 && (
            <BoardStepper steps={steps} currentIndex={stepIndexOf(steps, item.stage_id ?? '')} compact />
          )}
        </>
      )}
    />
  )
}
