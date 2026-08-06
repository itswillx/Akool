import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { purchaseTotal, saleNetReceived } from '../../../lib/financeStoreCalc'
import type {
  FinanceAttachment,
  FinanceStoreCustomer,
  FinanceStoreProduct,
  FinanceStorePurchase,
  FinanceStoreSale,
  FinanceStoreSaleItem,
  FinanceStoreSaleStatus,
  FinanceSupplier,
} from '../../../types'

// Data layer of the store ("Loja") submodule, following the optimistic
// state-first shape of useFinanceProjects: mutate local state immediately,
// then persist via supabase.from().
//
// Reads are NOT filtered by user_id on purpose: RLS already narrows every
// table to rows the caller owns or shares through the finance workspace.
//
// Unlike obras (where children inherit the workspace of their project), the
// Loja is a single domain: every row is created with the `workspaceId` prop
// as passed by the panel at creation time.
//
// Cash-flow integration: a sale that reaches 'sold' can carry ONE income row
// in finance_transactions (sales.transaction_id); a purchase can carry one
// expense row. The link is owned by this side — finance_transactions has no
// store column, and its FK is ON DELETE SET NULL, so a transaction deleted by
// hand in the Transactions tab simply unlinks. Every write to
// finance_transactions dispatches TRANSACTIONS_CHANGED_EVENT so the
// FinancePanel reloads without an F5.

export const STORE_ATTACHMENT_BUCKET = 'store-files'
export const TRANSACTIONS_CHANGED_EVENT = 'finance_transactions_changed'

type NewProduct = Pick<FinanceStoreProduct,
  'kind' | 'name' | 'category' | 'condition' | 'serial_number' | 'notes' | 'target_price' | 'attachments'>
type NewPurchase = Pick<FinanceStorePurchase,
  'product_id' | 'supplier_id' | 'quantity' | 'unit_cost' | 'other_costs' | 'date' | 'account_id' | 'notes' | 'attachments' | 'status'>
type NewCustomer = Pick<FinanceStoreCustomer, 'name' | 'phone' | 'city' | 'channel' | 'notes'>
type NewSale = Pick<FinanceStoreSale,
  'customer_id' | 'channel' | 'shipping_method' | 'tracking_code' | 'expected_delivery_on'
  | 'shipping_charged' | 'shipping_cost' | 'fees' | 'account_id' | 'notes' | 'attachments'>
type NewSaleItem = Pick<FinanceStoreSaleItem,
  'sale_id' | 'product_id' | 'product_name' | 'quantity' | 'unit_price' | 'unit_cost_at_sale'>

function normalizeAttachments<T extends { attachments: FinanceAttachment[] }>(row: T): T {
  return { ...row, attachments: (row.attachments ?? []) as FinanceAttachment[] }
}

// Storage has no ON DELETE CASCADE: dropping a row would leave its objects
// orphaned in the bucket, so they are removed explicitly first.
async function removeAttachmentObjects(attachments: FinanceAttachment[]) {
  const paths = attachments.map(a => a.path).filter(Boolean)
  if (paths.length === 0) return
  await supabase.storage.from(STORE_ATTACHMENT_BUCKET).remove(paths)
}

// Local calendar date (never toISOString(), which shifts a day in UTC-3).
// Shared with the modals, so the string lives in exactly one place.
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function notifyTransactionsChanged() {
  window.dispatchEvent(new CustomEvent(TRANSACTIONS_CHANGED_EVENT))
}

export function useFinanceStore(userId: string | undefined, workspaceId: string | null) {
  const [products, setProducts] = useState<FinanceStoreProduct[]>([])
  const [purchases, setPurchases] = useState<FinanceStorePurchase[]>([])
  const [customers, setCustomers] = useState<FinanceStoreCustomer[]>([])
  const [sales, setSales] = useState<FinanceStoreSale[]>([])
  const [saleItems, setSaleItems] = useState<FinanceStoreSaleItem[]>([])
  // Suppliers are the same finance_suppliers rows the obras submodule manages:
  // "de quem comprei" is one address book across the whole finance module.
  const [suppliers, setSuppliers] = useState<FinanceSupplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([
      supabase.from('finance_store_products').select('*').order('created_at', { ascending: false }),
      supabase.from('finance_store_purchases').select('*').order('date', { ascending: false }),
      supabase.from('finance_store_customers').select('*').order('name', { ascending: true }),
      supabase.from('finance_store_sales').select('*').order('created_at', { ascending: false }),
      supabase.from('finance_store_sale_items').select('*').order('created_at', { ascending: true }),
      supabase.from('finance_suppliers').select('*').order('name', { ascending: true }),
    ]).then(([pr, pu, cu, sa, si, su]) => {
      if (cancelled) return
      const failed = [pr, pu, cu, sa, si, su].find(r => r.error)
      if (failed?.error) setError(failed.error.message)
      setProducts(((pr.data as FinanceStoreProduct[]) ?? []).map(normalizeAttachments))
      setPurchases(((pu.data as FinanceStorePurchase[]) ?? []).map(normalizeAttachments))
      setCustomers((cu.data as FinanceStoreCustomer[]) ?? [])
      setSales(((sa.data as FinanceStoreSale[]) ?? []).map(normalizeAttachments))
      setSaleItems((si.data as FinanceStoreSaleItem[]) ?? [])
      setSuppliers((su.data as FinanceSupplier[]) ?? [])
      setLoading(false)
    }).catch((e: Error) => {
      // A network failure must not leave the tab stuck on "Loading…".
      if (cancelled) return
      setError(e.message)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId])

  const touch = () => ({ updated_at: new Date().toISOString() })

  // ─── Linked finance_transactions ───────────────────────────────────────────

  // `categoryId` is optional but worth passing: a linked transaction with no
  // category still counts in the month's totals while being invisible to
  // totalsByCategory and to the budgets — so a sale inflated the month's income
  // and never showed up in "top categories".
  const insertLinkedTx = useCallback(async (
    type: 'income' | 'expense',
    amount: number,
    description: string,
    date: string,
    accountId: string,
    categoryId: string | null = null,
  ): Promise<string | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_transactions')
      .insert({
        user_id: userId,
        account_id: accountId,
        category_id: categoryId,
        type,
        amount,
        description,
        date,
        shared_with_user_id: null,
        workspace_id: workspaceId,
      })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    notifyTransactionsChanged()
    return (data as { id: string }).id
  }, [userId, workspaceId])

  const updateLinkedTx = useCallback(async (txId: string, patch: { amount?: number; date?: string; description?: string }) => {
    const { error: err } = await supabase.from('finance_transactions').update(patch).eq('id', txId)
    if (err) setError(err.message)
    else notifyTransactionsChanged()
  }, [])

  const deleteLinkedTx = useCallback(async (txId: string) => {
    const { error: err } = await supabase.from('finance_transactions').delete().eq('id', txId)
    if (err) setError(err.message)
    else notifyTransactionsChanged()
  }, [])

  // Re-derives the income amount of an already-transacted sale after any money
  // mutation (price, freight, fees, items added/removed). Callers pass the
  // NEXT state of the sale and its items, since React state is async.
  const syncSaleTx = useCallback(async (sale: FinanceStoreSale, items: FinanceStoreSaleItem[]) => {
    if (!sale.transaction_id) return
    await updateLinkedTx(sale.transaction_id, {
      amount: saleNetReceived(sale, items),
      ...(sale.sold_on ? { date: sale.sold_on } : {}),
    })
  }, [updateLinkedTx])

  // ─── Products ──────────────────────────────────────────────────────────────

  const createProduct = useCallback(async (form: NewProduct): Promise<FinanceStoreProduct | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_store_products')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = normalizeAttachments(data as FinanceStoreProduct)
    setProducts(prev => [row, ...prev])
    return row
  }, [userId, workspaceId])

  const updateProduct = useCallback(async (id: string, patch: Partial<NewProduct & Pick<FinanceStoreProduct, 'archived'>>) => {
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
    const { error: err } = await supabase.from('finance_store_products').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  // Purchases cascade in the database; sale items keep their snapshot with
  // product_id SET NULL, so sale history survives. Linked purchase expenses
  // are NOT removed — the money left the pocket either way.
  const deleteProduct = useCallback(async (id: string) => {
    const orphaned = [
      ...products.filter(p => p.id === id).flatMap(p => p.attachments),
      ...purchases.filter(p => p.product_id === id).flatMap(p => p.attachments),
    ]
    setProducts(prev => prev.filter(p => p.id !== id))
    setPurchases(prev => prev.filter(p => p.product_id !== id))
    setSaleItems(prev => prev.map(i => (i.product_id === id ? { ...i, product_id: null } : i)))
    await removeAttachmentObjects(orphaned)
    const { error: err } = await supabase.from('finance_store_products').delete().eq('id', id)
    if (err) setError(err.message)
  }, [products, purchases])

  // ─── Purchases ─────────────────────────────────────────────────────────────

  const createPurchase = useCallback(async (
    form: NewPurchase,
    opts?: { createTransaction?: boolean; description?: string; categoryId?: string | null },
  ): Promise<FinanceStorePurchase | null> => {
    if (!userId) return null
    let transactionId: string | null = null
    if (opts?.createTransaction && form.account_id) {
      const amount = form.quantity * form.unit_cost + form.other_costs
      transactionId = await insertLinkedTx('expense', amount, opts.description ?? '', form.date, form.account_id, opts.categoryId ?? null)
    }
    const { data, error: err } = await supabase
      .from('finance_store_purchases')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId, transaction_id: transactionId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = normalizeAttachments(data as FinanceStorePurchase)
    setPurchases(prev => [row, ...prev])
    return row
  }, [userId, workspaceId, insertLinkedTx])

  const updatePurchase = useCallback(async (id: string, patch: Partial<NewPurchase>) => {
    const target = purchases.find(p => p.id === id)
    if (!target) return
    const next = { ...target, ...patch }
    // Voltar para 'quoting' desfaz a compra: a despesa some do fluxo de caixa
    // e as unidades saem do estoque (por derivação). Espelha o 'reopen' da
    // venda — sem isto, uma cotação continuaria contando como dinheiro gasto.
    const undoing = patch.status === 'quoting' && target.status !== 'quoting' && !!target.transaction_id
    if (undoing) next.transaction_id = null
    setPurchases(prev => prev.map(p => (p.id === id ? next : p)))
    const { error: err } = await supabase
      .from('finance_store_purchases')
      .update({ ...patch, ...(undoing ? { transaction_id: null } : {}), ...touch() })
      .eq('id', id)
    if (err) { setError(err.message); return }
    if (undoing) {
      await deleteLinkedTx(target.transaction_id!)
      return
    }
    if (target.transaction_id) {
      await updateLinkedTx(target.transaction_id, {
        amount: next.quantity * next.unit_cost + next.other_costs,
        date: next.date,
      })
    }
  }, [purchases, updateLinkedTx, deleteLinkedTx])

  // Cria a despesa vinculada depois do fato — espelho de `generateSaleIncome`.
  // Usado quando a compra sai de 'quoting' e o usuário decide lançá-la no fluxo
  // de caixa naquele momento, em vez de na criação.
  const generatePurchaseExpense = useCallback(async (id: string, description: string, categoryId: string | null = null) => {
    const target = purchases.find(p => p.id === id)
    if (!target || target.transaction_id || !target.account_id) return
    if (target.status === 'quoting') return
    const txId = await insertLinkedTx(
      'expense',
      purchaseTotal(target),
      description,
      target.date,
      target.account_id,
      categoryId,
    )
    if (!txId) return
    setPurchases(prev => prev.map(p => (p.id === id ? { ...p, transaction_id: txId } : p)))
    const { error: err } = await supabase.from('finance_store_purchases').update({ transaction_id: txId, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [purchases, insertLinkedTx])

  const deletePurchase = useCallback(async (id: string) => {
    const target = purchases.find(p => p.id === id)
    setPurchases(prev => prev.filter(p => p.id !== id))
    if (target) await removeAttachmentObjects(target.attachments)
    const { error: err } = await supabase.from('finance_store_purchases').delete().eq('id', id)
    if (err) { setError(err.message); return }
    if (target?.transaction_id) await deleteLinkedTx(target.transaction_id)
  }, [purchases, deleteLinkedTx])

  // ─── Suppliers (shared with obras) ─────────────────────────────────────────

  const createSupplier = useCallback(async (name: string): Promise<FinanceSupplier | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_suppliers')
      .insert({ name, phone: '', website: '', notes: '', user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceSupplier
    setSuppliers(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }, [userId, workspaceId])

  // ─── Customers ─────────────────────────────────────────────────────────────

  const createCustomer = useCallback(async (form: NewCustomer): Promise<FinanceStoreCustomer | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_store_customers')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceStoreCustomer
    setCustomers(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }, [userId, workspaceId])

  const updateCustomer = useCallback(async (id: string, patch: Partial<NewCustomer>) => {
    setCustomers(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
    const { error: err } = await supabase.from('finance_store_customers').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [])

  // Sales keep their history: the FK is ON DELETE SET NULL.
  const deleteCustomer = useCallback(async (id: string) => {
    setCustomers(prev => prev.filter(c => c.id !== id))
    setSales(prev => prev.map(s => (s.customer_id === id ? { ...s, customer_id: null } : s)))
    const { error: err } = await supabase.from('finance_store_customers').delete().eq('id', id)
    if (err) setError(err.message)
  }, [])

  // ─── Sales ─────────────────────────────────────────────────────────────────

  const createSale = useCallback(async (form: NewSale): Promise<FinanceStoreSale | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_store_sales')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = normalizeAttachments(data as FinanceStoreSale)
    setSales(prev => [row, ...prev])
    return row
  }, [userId, workspaceId])

  const updateSale = useCallback(async (
    id: string,
    patch: Partial<NewSale & Pick<FinanceStoreSale, 'sold_on'>>,
  ) => {
    const target = sales.find(s => s.id === id)
    if (!target) return
    const next = { ...target, ...patch }
    setSales(prev => prev.map(s => (s.id === id ? next : s)))
    const { error: err } = await supabase.from('finance_store_sales').update({ ...patch, ...touch() }).eq('id', id)
    if (err) { setError(err.message); return }
    await syncSaleTx(next, saleItems.filter(i => i.sale_id === id))
  }, [sales, saleItems, syncSaleTx])

  // The state machine of the pipeline. Moving to 'sold' stamps sold_on (the
  // caller may pick a retroactive date) and can open the linked income; moving
  // to 'cancelled' OR back to 'negotiating' reverses it — the income is
  // deleted and the stock returns by derivation (financeStoreCalc.productStock).
  const setSaleStatus = useCallback(async (
    id: string,
    status: FinanceStoreSaleStatus,
    opts?: { createTransaction?: boolean; description?: string; date?: string; categoryId?: string | null },
  ) => {
    const target = sales.find(s => s.id === id)
    if (!target) return
    const items = saleItems.filter(i => i.sale_id === id)
    const patch: Partial<FinanceStoreSale> = { status }

    if (status === 'sold') patch.sold_on = opts?.date ?? target.sold_on ?? todayISO()
    if (status === 'delivered') patch.delivered_on = target.delivered_on ?? todayISO()
    // A sale that is not delivered has no delivered_on (covers stepping back);
    // reopening to negotiating clears every stamp.
    if (status === 'sold' || status === 'shipped') patch.delivered_on = null
    if (status === 'negotiating') {
      patch.sold_on = null
      patch.delivered_on = null
    }

    let next = { ...target, ...patch }

    const dropsTx = (status === 'cancelled' || status === 'negotiating') && target.transaction_id
    if (dropsTx && target.transaction_id) {
      await deleteLinkedTx(target.transaction_id)
      patch.transaction_id = null
      next = { ...next, transaction_id: null }
    }

    if (status === 'sold' && !target.transaction_id && opts?.createTransaction && target.account_id) {
      const txId = await insertLinkedTx(
        'income',
        saleNetReceived(next, items),
        opts.description ?? '',
        next.sold_on ?? todayISO(),
        target.account_id,
        opts.categoryId ?? null,
      )
      patch.transaction_id = txId
      next = { ...next, transaction_id: txId }
    }

    setSales(prev => prev.map(s => (s.id === id ? next : s)))
    const { error: err } = await supabase.from('finance_store_sales').update({ ...patch, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [sales, saleItems, insertLinkedTx, deleteLinkedTx])

  // Late income for a sale that was marked sold without one (no account at the
  // time, or the checkbox was off). Same single-transaction-per-sale rule.
  const generateSaleIncome = useCallback(async (id: string, description: string, categoryId: string | null = null) => {
    const target = sales.find(s => s.id === id)
    if (!target || target.transaction_id || !target.account_id) return
    if (target.status === 'negotiating' || target.status === 'cancelled') return
    const items = saleItems.filter(i => i.sale_id === id)
    const txId = await insertLinkedTx(
      'income',
      saleNetReceived(target, items),
      description,
      target.sold_on ?? todayISO(),
      target.account_id,
      categoryId,
    )
    if (!txId) return
    setSales(prev => prev.map(s => (s.id === id ? { ...s, transaction_id: txId } : s)))
    const { error: err } = await supabase.from('finance_store_sales').update({ transaction_id: txId, ...touch() }).eq('id', id)
    if (err) setError(err.message)
  }, [sales, saleItems, insertLinkedTx])

  const deleteSale = useCallback(async (id: string) => {
    const target = sales.find(s => s.id === id)
    setSales(prev => prev.filter(s => s.id !== id))
    setSaleItems(prev => prev.filter(i => i.sale_id !== id))
    if (target) await removeAttachmentObjects(target.attachments)
    const { error: err } = await supabase.from('finance_store_sales').delete().eq('id', id)
    if (err) { setError(err.message); return }
    if (target?.transaction_id) await deleteLinkedTx(target.transaction_id)
  }, [sales, deleteLinkedTx])

  // ─── Sale items ────────────────────────────────────────────────────────────

  // All saleItems mutations use FUNCTIONAL updaters and capture the resulting
  // array in a local for syncSaleTx: several awaited mutations can run inside
  // one render (multi-item sale), and a closure copy of `saleItems` would be
  // stale after the first one — items silently vanished from the local state.
  // The assignment inside the updater is idempotent, so StrictMode is fine.

  const addSaleItem = useCallback(async (form: NewSaleItem): Promise<FinanceStoreSaleItem | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_store_sale_items')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { setError(err?.message ?? null); return null }
    const row = data as FinanceStoreSaleItem
    let nextItems: FinanceStoreSaleItem[] = []
    setSaleItems(prev => { nextItems = [...prev, row]; return nextItems })
    const sale = sales.find(s => s.id === form.sale_id)
    if (sale) await syncSaleTx(sale, nextItems.filter(i => i.sale_id === form.sale_id))
    return row
  }, [userId, workspaceId, sales, syncSaleTx])

  // Batch insert for the create-sale flow: one write, one state update, one
  // transaction sync — instead of a sequential per-item loop.
  const addSaleItems = useCallback(async (forms: NewSaleItem[]): Promise<FinanceStoreSaleItem[]> => {
    if (!userId || forms.length === 0) return []
    const { data, error: err } = await supabase
      .from('finance_store_sale_items')
      .insert(forms.map(f => ({ ...f, user_id: userId, workspace_id: workspaceId })))
      .select()
    if (err || !data) { setError(err?.message ?? null); return [] }
    const rows = data as FinanceStoreSaleItem[]
    let nextItems: FinanceStoreSaleItem[] = []
    setSaleItems(prev => { nextItems = [...prev, ...rows]; return nextItems })
    const saleId = forms[0].sale_id
    const sale = sales.find(s => s.id === saleId)
    if (sale) await syncSaleTx(sale, nextItems.filter(i => i.sale_id === saleId))
    return rows
  }, [userId, workspaceId, sales, syncSaleTx])

  const updateSaleItem = useCallback(async (id: string, patch: Partial<NewSaleItem>) => {
    const target = saleItems.find(i => i.id === id)
    if (!target) return
    let nextItems: FinanceStoreSaleItem[] = []
    setSaleItems(prev => { nextItems = prev.map(i => (i.id === id ? { ...i, ...patch } : i)); return nextItems })
    const { error: err } = await supabase.from('finance_store_sale_items').update({ ...patch, ...touch() }).eq('id', id)
    if (err) { setError(err.message); return }
    const sale = sales.find(s => s.id === target.sale_id)
    if (sale) await syncSaleTx(sale, nextItems.filter(i => i.sale_id === target.sale_id))
  }, [saleItems, sales, syncSaleTx])

  const removeSaleItem = useCallback(async (id: string) => {
    const target = saleItems.find(i => i.id === id)
    if (!target) return
    let nextItems: FinanceStoreSaleItem[] = []
    setSaleItems(prev => { nextItems = prev.filter(i => i.id !== id); return nextItems })
    const { error: err } = await supabase.from('finance_store_sale_items').delete().eq('id', id)
    if (err) { setError(err.message); return }
    const sale = sales.find(s => s.id === target.sale_id)
    if (sale) await syncSaleTx(sale, nextItems.filter(i => i.sale_id === target.sale_id))
  }, [saleItems, sales, syncSaleTx])

  const clearError = useCallback(() => setError(null), [])

  return {
    products, purchases, customers, sales, saleItems, suppliers, loading, error, clearError,
    createProduct, updateProduct, deleteProduct,
    createPurchase, updatePurchase, deletePurchase, generatePurchaseExpense,
    createSupplier,
    createCustomer, updateCustomer, deleteCustomer,
    createSale, updateSale, setSaleStatus, generateSaleIncome, deleteSale,
    addSaleItem, addSaleItems, updateSaleItem, removeSaleItem,
  }
}

export type FinanceStoreStore = ReturnType<typeof useFinanceStore>
