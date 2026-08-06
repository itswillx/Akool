import { useCallback, useMemo, useRef, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { formatBRL } from '../../../lib/money'
import { saleNetReceived, saleProfit } from '../../../lib/financeStoreCalc'
import { stepIndexOf, type StepDef } from '../../../lib/boardStepper'
import { BoardStepper, KanbanBoard, type BoardColumnDef, type BoardSortOption } from '../../../components/board'
import type { FinanceCategory, FinanceStoreSale, FinanceStoreSaleStatus } from '../../../types'
import { FIN_NEG, FIN_POS, tabularNums } from '../ui'
import { CHANNEL_KEY, SALE_STATUSES, SALE_STATUS_KEY, SALE_STEPS, badgeStyle, saleStatusColor } from './storeUi'
import { StatusConfirmModal } from './StatusConfirmModal'
import { canTransition, confirmActionFor, type ConfirmAction } from './saleTransitions'
import type { FinanceStoreStore } from './useFinanceStore'

// Kanban do pipeline de venda: uma coluna por status, cards arrastáveis.
//
// O drop NÃO grava direto. Ele chama `requestStatus`, que decide entre aplicar
// na hora ou abrir o StatusConfirmModal — as mesmas regras da lista, vindas de
// `saleTransitions.ts`. Enquanto o modal está aberto o card fica na coluna de
// destino (preview otimista do board) e volta sozinho se o usuário desistir.

export function SalesBoard({ store, categories, onEdit }: {
  store: FinanceStoreStore
  categories: FinanceCategory[]
  onEdit: (sale: FinanceStoreSale) => void
}) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [confirming, setConfirming] = useState<{ sale: FinanceStoreSale; action: ConfirmAction } | null>(null)
  // A promessa do onMove fica pendurada até o modal resolver; o board usa o
  // retorno para manter ou reverter o preview.
  const resolveRef = useRef<((ok: boolean) => void) | null>(null)

  const columns: BoardColumnDef[] = useMemo(
    () => SALE_STATUSES.map(s => ({ id: s, label: t(SALE_STATUS_KEY[s]), color: saleStatusColor(s) })),
    [t],
  )

  const steps: StepDef[] = useMemo(
    () => SALE_STEPS.map(s => ({ id: s, label: t(SALE_STATUS_KEY[s]) })),
    [t],
  )

  const saleItems = store.saleItems
  const itemsOf = useCallback(
    (sale: FinanceStoreSale) => saleItems.filter(i => i.sale_id === sale.id),
    [saleItems],
  )

  const sortOptions: BoardSortOption<FinanceStoreSale>[] = useMemo(() => [
    { id: 'recent', label: t('board_sort_recent'), compare: (a, b) => b.updated_at.localeCompare(a.updated_at) },
    { id: 'value', label: t('board_sort_value'), compare: (a, b) => saleNetReceived(b, itemsOf(b)) - saleNetReceived(a, itemsOf(a)) },
  ], [t, itemsOf])

  const requestStatus = (sale: FinanceStoreSale, to: FinanceStoreSaleStatus): Promise<boolean> => {
    const action = confirmActionFor(sale.status, to, !!sale.transaction_id)
    if (!action) {
      // Sem efeito colateral em finance_transactions: aplica direto.
      return store.setSaleStatus(sale.id, to).then(() => true)
    }
    setConfirming({ sale, action })
    return new Promise<boolean>(resolve => { resolveRef.current = resolve })
  }

  const finishConfirm = (confirmed: boolean) => {
    resolveRef.current?.(confirmed)
    resolveRef.current = null
  }

  return (
    <>
      <KanbanBoard
        storageKey="finance_board_sales"
        columns={columns}
        items={store.sales}
        isMobile={isMobile}
        // Cancelada é ruído no dia a dia, mas o chip do olho a revela — nada
        // some sem o usuário poder trazer de volta.
        defaultHiddenColumns={['cancelled']}
        getId={s => s.id}
        getColumnId={s => s.status}
        getAmount={s => saleNetReceived(s, itemsOf(s))}
        getSearchText={s => {
          const customer = s.customer_id ? store.customers.find(c => c.id === s.customer_id) : null
          return `${itemsOf(s).map(i => i.product_name).join(' ')} ${customer?.name ?? ''} ${s.tracking_code}`
        }}
        sortOptions={sortOptions}
        onCardClick={onEdit}
        canMove={(sale, to) => canTransition(sale.status, to as FinanceStoreSaleStatus)}
        onMove={(sale, to) => requestStatus(sale, to as FinanceStoreSaleStatus)}
        renderCard={sale => {
          const items = itemsOf(sale)
          const customer = sale.customer_id ? store.customers.find(c => c.id === sale.customer_id) : null
          const profit = saleProfit(sale, items)
          const summary = items.map(i => `${i.quantity}× ${i.product_name}`).join(', ')
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {summary || t('finance_store_sale')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {customer?.name ?? t('finance_store_no_customer')}
                    {sale.sold_on ? ` · ${sale.sold_on.slice(8, 10)}/${sale.sold_on.slice(5, 7)}` : ''}
                  </div>
                </div>
                {/* Projeção enquanto negocia, fato depois de vendida, ruído
                    depois de cancelada. */}
                {sale.status !== 'cancelled' && (
                  <div style={{ textAlign: 'right', flexShrink: 0, ...tabularNums }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: sale.status === 'negotiating' ? 'var(--color-text-muted)' : profit >= 0 ? FIN_POS : FIN_NEG }}>
                      {formatBRL(profit)}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)' }}>
                      {sale.status === 'negotiating' ? t('finance_store_profit_projected') : t('finance_store_profit')}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                <span style={badgeStyle('var(--color-text-muted)')}>{t(CHANNEL_KEY[sale.channel])}</span>
                {sale.tracking_code && <span style={badgeStyle('var(--color-text-muted)')}>{sale.tracking_code}</span>}
                {sale.expected_delivery_on && sale.status !== 'delivered' && sale.status !== 'cancelled' && (
                  <span style={badgeStyle('var(--color-text-muted)')}>
                    {t('finance_store_eta_short', { date: `${sale.expected_delivery_on.slice(8, 10)}/${sale.expected_delivery_on.slice(5, 7)}` })}
                  </span>
                )}
              </div>
              <BoardStepper steps={steps} currentIndex={stepIndexOf(steps, sale.status)} compact />
            </>
          )
        }}
      />

      {confirming && (
        <StatusConfirmModal
          store={store}
          sale={confirming.sale}
          action={confirming.action}
          categories={categories}
          onResolved={finishConfirm}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  )
}
