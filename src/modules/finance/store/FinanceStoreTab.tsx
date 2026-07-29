import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { FinanceAccount, FinanceStoreCustomer, FinanceStoreProduct, FinanceStorePurchase, FinanceStoreSale } from '../../../types'
import { segBtnStyle, segTrackStyle } from '../ui'
import type { TranslationKey } from '../../../i18n/translations'
import { CustomerModal } from './CustomerModal'
import { CustomersView } from './CustomersView'
import { InventoryView } from './InventoryView'
import { ProductModal } from './ProductModal'
import { PurchaseModal } from './PurchaseModal'
import { SaleModal } from './SaleModal'
import { SalesView } from './SalesView'
import { StoreOverview } from './StoreOverview'
import { useFinanceStore } from './useFinanceStore'

type Section = 'overview' | 'inventory' | 'sales' | 'customers'

const SECTIONS: { id: Section; key: TranslationKey }[] = [
  { id: 'overview', key: 'finance_store_nav_overview' },
  { id: 'inventory', key: 'finance_store_nav_inventory' },
  { id: 'sales', key: 'finance_store_nav_sales' },
  { id: 'customers', key: 'finance_store_nav_customers' },
]

// Which section is open survives a reload, like the finance tab itself.
const SECTION_KEY = 'finance_store_section'

function isSection(value: unknown): value is Section {
  return typeof value === 'string' && SECTIONS.some(s => s.id === value)
}

// Entry point of the store ("Loja") submodule: resale inventory, sale pipeline
// and customers. Rendered as a tab of FinancePanel, inside its mobile context
// provider — the shared Modal depends on it. `month` ('YYYY-MM') comes from
// the panel's header arrows and drives the overview cards.
export default function FinanceStoreTab({ workspaceId, accounts, month }: {
  workspaceId: string | null
  accounts: FinanceAccount[]
  month: string
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const store = useFinanceStore(user?.id, workspaceId)
  const [section, setSection] = useState<Section>(() => {
    const saved = localStorage.getItem(SECTION_KEY)
    return isSection(saved) ? saved : 'overview'
  })
  useEffect(() => { localStorage.setItem(SECTION_KEY, section) }, [section])

  const [productModal, setProductModal] = useState<{ open: boolean; product?: FinanceStoreProduct }>({ open: false })
  const [purchaseModal, setPurchaseModal] = useState<{ product: FinanceStoreProduct; purchase?: FinanceStorePurchase } | null>(null)
  const [saleModal, setSaleModal] = useState<{ open: boolean; sale?: FinanceStoreSale }>({ open: false })
  const [customerModal, setCustomerModal] = useState<{ open: boolean; customer?: FinanceStoreCustomer }>({ open: false })

  if (store.loading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {store.error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: 'var(--color-error)', fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>{store.error}</span>
          <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', padding: 2, flexShrink: 0 }}
            title={t('finance_store_close')} onClick={store.clearError}>
            <X size={14} />
          </button>
        </div>
      )}

      <div style={{ ...segTrackStyle, alignSelf: 'flex-start', flexWrap: 'wrap' }}>
        {SECTIONS.map(s => (
          <button key={s.id} style={segBtnStyle(section === s.id)} onClick={() => setSection(s.id)}>{t(s.key)}</button>
        ))}
      </div>

      {section === 'overview' && (
        <StoreOverview store={store} month={month}
          onNewProduct={() => { setSection('inventory'); setProductModal({ open: true }) }} />
      )}
      {section === 'inventory' && (
        <InventoryView store={store}
          onNew={() => setProductModal({ open: true })}
          onEdit={product => setProductModal({ open: true, product })}
          onRestock={product => setPurchaseModal({ product })} />
      )}
      {section === 'sales' && (
        <SalesView store={store}
          onNew={() => setSaleModal({ open: true })}
          onEdit={sale => setSaleModal({ open: true, sale })} />
      )}
      {section === 'customers' && (
        <CustomersView store={store}
          onNew={() => setCustomerModal({ open: true })}
          onEdit={customer => setCustomerModal({ open: true, customer })} />
      )}

      {productModal.open && (
        <ProductModal store={store} product={productModal.product} accounts={accounts}
          onClose={() => setProductModal({ open: false })}
          // Swap modals rather than stacking: the tab closes the product form
          // and opens the purchase form for the clicked (or a new) purchase.
          onEditPurchase={productModal.product
            ? purchase => { const product = productModal.product!; setProductModal({ open: false }); setPurchaseModal({ product, purchase }) }
            : undefined}
          onAddPurchase={productModal.product
            ? () => { const product = productModal.product!; setProductModal({ open: false }); setPurchaseModal({ product }) }
            : undefined} />
      )}
      {purchaseModal && (
        <PurchaseModal store={store} product={purchaseModal.product} purchase={purchaseModal.purchase}
          accounts={accounts} onClose={() => setPurchaseModal(null)} />
      )}
      {saleModal.open && (
        <SaleModal store={store} sale={saleModal.sale} accounts={accounts}
          onClose={() => setSaleModal({ open: false })} />
      )}
      {customerModal.open && (
        <CustomerModal store={store} customer={customerModal.customer}
          onClose={() => setCustomerModal({ open: false })} />
      )}
    </div>
  )
}
