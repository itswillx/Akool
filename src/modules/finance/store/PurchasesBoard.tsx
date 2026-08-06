import { useMemo, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { formatBRL } from '../../../lib/money'
import { purchaseTotal } from '../../../lib/financeStoreCalc'
import { stepIndexOf, type StepDef } from '../../../lib/boardStepper'
import { BoardStepper, KanbanBoard, type BoardColumnDef, type BoardSortOption } from '../../../components/board'
import type { FinanceCategory, FinanceStorePurchase, FinanceStorePurchaseStatus } from '../../../types'
import { Modal, ghostBtnStyle, inputStyle, labelStyle, primaryBtnStyle, tabularNums } from '../ui'
import { PURCHASE_STATUSES, PURCHASE_STATUS_KEY, badgeStyle, purchaseStatusColor } from './storeUi'
import type { FinanceStoreStore } from './useFinanceStore'

// Funil de compra: quoting -> purchased -> received.
//
// Só 'quoting' é intenção. Sair de 'quoting' significa que o dinheiro saiu, e é
// aí que o modal abaixo oferece lançar a despesa no fluxo de caixa. Voltar para
// 'quoting' desfaz isso (`updatePurchase` apaga a transação vinculada), do
// mesmo jeito que reabrir uma venda apaga a receita.

function ExpenseConfirmModal({ store, purchase, categories, onClose, onResolved }: {
  store: FinanceStoreStore
  purchase: FinanceStorePurchase
  categories: FinanceCategory[]
  onClose: () => void
  onResolved: (confirmed: boolean) => void
}) {
  const { t } = useLanguage()
  const [createTx, setCreateTx] = useState(!!purchase.account_id)
  const [categoryId, setCategoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const product = store.products.find(p => p.id === purchase.product_id)
  const total = purchaseTotal(purchase)

  const dismiss = () => { onResolved(false); onClose() }

  const confirm = async () => {
    setBusy(true)
    try {
      await store.updatePurchase(purchase.id, { status: 'purchased' })
      if (createTx && purchase.account_id && !purchase.transaction_id) {
        await store.generatePurchaseExpense(
          purchase.id,
          t('finance_store_tx_purchase_desc', { name: product?.name ?? '' }),
          categoryId || null,
        )
      }
      onResolved(true)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('finance_store_purchase_confirm_title')} onClose={dismiss}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13.5, color: 'var(--color-text)', ...tabularNums }}>
          {t('finance_store_purchase_confirm', { value: formatBRL(total) })}
        </div>
        {!purchase.transaction_id && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={createTx} disabled={!purchase.account_id}
              onChange={e => setCreateTx(e.target.checked)} />
            {t('finance_store_create_expense')}
          </label>
        )}
        {createTx && !purchase.transaction_id && (
          <div>
            <label style={labelStyle}>{t('finance_store_tx_category')}</label>
            <select style={inputStyle} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">{t('finance_import_no_category')}</option>
              {categories.filter(c => c.type === 'expense').map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </div>
        )}
        {!purchase.account_id && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_store_no_account_hint')}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...primaryBtnStyle, flex: 1, justifyContent: 'center', opacity: busy ? 0.7 : 1 }}
            onClick={confirm} disabled={busy}>{t('finance_store_purchase_confirm_title')}</button>
          <button style={ghostBtnStyle} onClick={dismiss}>{t('finance_cancel')}</button>
        </div>
      </div>
    </Modal>
  )
}

export function PurchasesBoard({ store, categories, onEdit }: {
  store: FinanceStoreStore
  categories: FinanceCategory[]
  onEdit: (purchase: FinanceStorePurchase) => void
}) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()
  const [confirming, setConfirming] = useState<{
    purchase: FinanceStorePurchase
    resolve: (ok: boolean) => void
  } | null>(null)

  const columns: BoardColumnDef[] = useMemo(
    () => PURCHASE_STATUSES.map(s => ({ id: s, label: t(PURCHASE_STATUS_KEY[s]), color: purchaseStatusColor(s) })),
    [t],
  )

  const steps: StepDef[] = useMemo(
    () => PURCHASE_STATUSES.map(s => ({ id: s, label: t(PURCHASE_STATUS_KEY[s]) })),
    [t],
  )

  const sortOptions: BoardSortOption<FinanceStorePurchase>[] = useMemo(() => [
    { id: 'recent', label: t('board_sort_recent'), compare: (a, b) => b.date.localeCompare(a.date) },
    { id: 'value', label: t('board_sort_value'), compare: (a, b) => purchaseTotal(b) - purchaseTotal(a) },
  ], [t])

  const requestStatus = (purchase: FinanceStorePurchase, to: FinanceStorePurchaseStatus): Promise<boolean> => {
    // Entrar em 'purchased' vindo de 'quoting' é o único passo que pode criar
    // dinheiro no fluxo de caixa — os outros são só mudança de prateleira.
    if (to === 'purchased' && purchase.status === 'quoting') {
      return new Promise<boolean>(resolve => setConfirming({ purchase, resolve }))
    }
    return store.updatePurchase(purchase.id, { status: to }).then(() => true)
  }

  return (
    <>
      <KanbanBoard
        storageKey="finance_board_purchases"
        columns={columns}
        items={store.purchases}
        isMobile={isMobile}
        getId={p => p.id}
        getColumnId={p => p.status}
        getAmount={purchaseTotal}
        getSearchText={p => {
          const product = store.products.find(x => x.id === p.product_id)
          const supplier = p.supplier_id ? store.suppliers.find(s => s.id === p.supplier_id) : null
          return `${product?.name ?? ''} ${supplier?.name ?? ''} ${p.notes}`
        }}
        sortOptions={sortOptions}
        onCardClick={onEdit}
        onMove={(purchase, to) => requestStatus(purchase, to as FinanceStorePurchaseStatus)}
        renderCard={purchase => {
          const product = store.products.find(x => x.id === purchase.product_id)
          const supplier = purchase.supplier_id ? store.suppliers.find(s => s.id === purchase.supplier_id) : null
          return (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {product?.name ?? t('finance_store_purchase')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {purchase.quantity}× · {supplier?.name ?? t('finance_store_no_supplier')}
                    {` · ${purchase.date.slice(8, 10)}/${purchase.date.slice(5, 7)}`}
                  </div>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', flexShrink: 0, ...tabularNums }}>
                  {formatBRL(purchaseTotal(purchase))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                {purchase.transaction_id && (
                  <span style={badgeStyle('var(--color-text-muted)')}>{t('finance_store_linked_tx')}</span>
                )}
              </div>
              <BoardStepper steps={steps} currentIndex={stepIndexOf(steps, purchase.status)} compact />
            </>
          )
        }}
      />

      {confirming && (
        <ExpenseConfirmModal
          store={store}
          purchase={confirming.purchase}
          categories={categories}
          onResolved={confirming.resolve}
          onClose={() => setConfirming(null)}
        />
      )}
    </>
  )
}
