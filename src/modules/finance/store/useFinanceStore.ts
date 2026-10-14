import { useCallback, useEffect, useState } from 'react'
import { emitAppEvent } from '../../../lib/appEvents'
import { supabase } from '../../../lib/supabase'
import { purchaseTotal } from '../../../lib/financeStoreCalc'
import { localDateKey } from '../../../lib/localDate'
import {
  addStoreSaleItems,
  createStoreSale,
  deleteStoreSale,
  generateStoreSaleIncome,
  removeStoreSaleItem,
  setStoreSaleStatus,
  storeErrorText,
  updateStoreSale,
  updateStoreSaleItem,
  type StoreSaleItemInput,
  type StoreSaleResult,
} from '../../../lib/data/financeStore'
import { useLanguage } from '../../../i18n/LanguageContext'
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

// Data layer of the store ("Loja") submodule.
//
// Reads are NOT filtered by user_id on purpose: RLS already narrows every
// table to rows the caller owns or shares through the finance workspace.
//
// API-028: as VENDAS vão pelas RPCs de src/lib/data/financeStore.ts, sem
// otimismo: cada chamada é uma transação no servidor (venda, itens e receita
// vinculada juntos), e o hook adota a venda, os itens e a receita que voltam.
// O servidor confere a máquina de estados, o estoque, o item único, as
// referências e o dinheiro; a recusa vira um texto traduzido em `error`
// (storeErrorText) e a ação devolve false, para a tela reverter. A receita
// nasce no workspace da venda (quando quem vende é membro), e não mais no do
// painel. updated_at é do servidor (gatilho) nas 5 tabelas: o touch() saiu.
//
// Produtos, compras e clientes continuam otimistas, gravando direto nas
// tabelas (o API-037 leva compras e produtos para o servidor). Cada linha
// nova usa o `workspaceId` do painel no momento da criação. A recusa do banco
// (o CHECK de dinheiro >= 0 do API-028 dá 23514) também vira texto traduzido:
// a compra recusada apaga a despesa que acabou de lançar (sem isso, ela
// ficava órfã em Finanças), e a edição recusada devolve a tela ao que era. A
// recusa da despesa vinculada também conta como falha, traduzida. A despesa
// precisa de valor > 0 (CHECK de finance_transactions): compra de total zero
// não lança despesa, e a compra lançada não vai a zero. A compra com a
// despesa numa transação só é do API-037.
//
// Cash-flow integration: a purchase can carry one expense row
// (purchases.transaction_id), written here. finance_transactions has no store
// column, and its FK is ON DELETE SET NULL, so a transaction deleted by hand
// in the Transactions tab simply unlinks. Every change to finance_transactions
// emits `finance_transactions_changed` (src/lib/appEvents.ts, ARCH-007) so the
// FinancePanel reloads without an F5.

export const STORE_ATTACHMENT_BUCKET = 'store-files'

type NewProduct = Pick<FinanceStoreProduct,
  'kind' | 'name' | 'category' | 'condition' | 'serial_number' | 'notes' | 'target_price' | 'attachments'>
type NewPurchase = Pick<FinanceStorePurchase,
  'product_id' | 'supplier_id' | 'quantity' | 'unit_cost' | 'other_costs' | 'date' | 'account_id' | 'notes' | 'attachments' | 'status'>
type NewCustomer = Pick<FinanceStoreCustomer, 'name' | 'phone' | 'city' | 'channel' | 'notes'>
export type NewSale = Pick<FinanceStoreSale,
  'customer_id' | 'channel' | 'shipping_method' | 'tracking_code' | 'expected_delivery_on'
  | 'shipping_charged' | 'shipping_cost' | 'fees' | 'account_id' | 'notes' | 'attachments'>
export type NewSaleItem = StoreSaleItemInput

function normalizeAttachments<T extends { attachments: FinanceAttachment[] }>(row: T): T {
  return { ...row, attachments: (row.attachments ?? []) }
}

// Storage has no ON DELETE CASCADE: dropping a row would leave its objects
// orphaned in the bucket, so they are removed explicitly.
async function removeAttachmentObjects(attachments: FinanceAttachment[]) {
  const paths = attachments.map(a => a.path).filter(Boolean)
  if (paths.length === 0) return
  await supabase.storage.from(STORE_ATTACHMENT_BUCKET).remove(paths)
}

// Local calendar date (never toISOString(), which shifts a day in UTC-3).
// Shared with the modals, so the string lives in exactly one place.
export function todayISO(): string {
  return localDateKey(new Date())
}

function notifyTransactionsChanged() {
  emitAppEvent('finance_transactions_changed')
}

export function useFinanceStore(userId: string | undefined, workspaceId: string | null) {
  const { t } = useLanguage()
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
      setProducts((pr.data ?? []).map(normalizeAttachments))
      setPurchases((pu.data ?? []).map(normalizeAttachments))
      setCustomers(cu.data ?? [])
      setSales((sa.data ?? []).map(normalizeAttachments))
      setSaleItems(si.data ?? [])
      setSuppliers(su.data ?? [])
      setLoading(false)
    }).catch((e: Error) => {
      // A network failure must not leave the tab stuck on "Loading…".
      if (cancelled) return
      setError(e.message)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [userId])

  // A recusa do servidor vira um texto no idioma da tela (vendas, compras e
  // produtos).
  const fail = useCallback((err: { code?: string; message?: string } | null): false => {
    if (err) setError(storeErrorText(err, t))
    return false
  }, [t])

  // A recusa da despesa vinculada. Em finance_transactions, o 23514 é o CHECK
  // amount > 0 (o tipo é sempre 'expense'), e não o de dinheiro negativo.
  const failTx = useCallback((err: { code?: string; message?: string } | null): false => {
    if (err?.code !== '23514') return fail(err)
    setError(t('finance_store_error_expense_not_positive'))
    return false
  }, [t, fail])

  // ─── Linked finance_transactions (compras) ─────────────────────────────────

  // `categoryId` is optional but worth passing: a linked transaction with no
  // category still counts in the month's totals while being invisible to
  // totalsByCategory and to the budgets.
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
    if (err || !data) { failTx(err); return null }
    notifyTransactionsChanged()
    return (data as { id: string }).id
  }, [userId, workspaceId, failTx])

  // Devolve false quando o banco recusa, com o motivo traduzido.
  const updateLinkedTx = useCallback(async (txId: string, patch: { amount?: number; date?: string; description?: string }): Promise<boolean> => {
    const { error: err } = await supabase.from('finance_transactions').update(patch).eq('id', txId)
    if (err) return failTx(err)
    notifyTransactionsChanged()
    return true
  }, [failTx])

  const deleteLinkedTx = useCallback(async (txId: string) => {
    const { error: err } = await supabase.from('finance_transactions').delete().eq('id', txId)
    if (err) failTx(err)
    else notifyTransactionsChanged()
  }, [failTx])

  // ─── Products ──────────────────────────────────────────────────────────────

  const createProduct = useCallback(async (form: NewProduct): Promise<FinanceStoreProduct | null> => {
    if (!userId) return null
    const { data, error: err } = await supabase
      .from('finance_store_products')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId })
      .select()
      .single()
    if (err || !data) { fail(err); return null }
    const row = normalizeAttachments(data)
    setProducts(prev => [row, ...prev])
    return row
  }, [userId, workspaceId, fail])

  // Devolve false quando o banco recusa, com a tela de volta ao que era.
  const updateProduct = useCallback(async (id: string, patch: Partial<NewProduct & Pick<FinanceStoreProduct, 'archived'>>): Promise<boolean> => {
    const before = products.find(p => p.id === id)
    setProducts(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
    const { error: err } = await supabase.from('finance_store_products').update(patch).eq('id', id)
    if (err) {
      if (before) setProducts(prev => prev.map(p => (p.id === id ? before : p)))
      return fail(err)
    }
    return true
  }, [products, fail])

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
    const amount = purchaseTotal(form)
    // Total zero não tem despesa (o banco recusaria): a compra grava sem ela.
    if (opts?.createTransaction && form.account_id && amount > 0) {
      transactionId = await insertLinkedTx('expense', amount, opts.description ?? '', form.date, form.account_id, opts.categoryId ?? null)
      // A despesa pedida foi recusada: a compra não grava sem ela, e o modal
      // fica aberto com o motivo.
      if (!transactionId) return null
    }
    const { data, error: err } = await supabase
      .from('finance_store_purchases')
      .insert({ ...form, user_id: userId, workspace_id: workspaceId, transaction_id: transactionId })
      .select()
      .single()
    if (err || !data) {
      // A despesa já foi lançada: sem a compra, ela ficaria órfã em Finanças.
      if (transactionId) await deleteLinkedTx(transactionId)
      fail(err)
      return null
    }
    const row = normalizeAttachments(data)
    setPurchases(prev => [row, ...prev])
    return row
  }, [userId, workspaceId, insertLinkedTx, deleteLinkedTx, fail])

  // Devolve false quando o banco recusa: a tela volta ao que era, e a despesa
  // vinculada só muda depois da compra gravada. A despesa recusada também
  // devolve false: a compra fica gravada, e salvar de novo regrava a despesa.
  const updatePurchase = useCallback(async (id: string, patch: Partial<NewPurchase>): Promise<boolean> => {
    const target = purchases.find(p => p.id === id)
    if (!target) return false
    const next = { ...target, ...patch }
    // Voltar para 'quoting' desfaz a compra: a despesa some do fluxo de caixa
    // e as unidades saem do estoque (por derivação). Espelha o 'reopen' da
    // venda — sem isto, uma cotação continuaria contando como dinheiro gasto.
    const undoing = patch.status === 'quoting' && target.status !== 'quoting' && !!target.transaction_id
    if (undoing) next.transaction_id = null
    // A despesa vinculada não vai a zero (o banco a recusaria depois da compra
    // gravada, e as duas divergiriam): recusa antes, sem tocar em nada. Só a
    // edição que leva o total a zero: a compra antiga já com total zero e
    // despesa (gravada antes desta trava) ainda muda de fase, notas e data.
    const total = purchaseTotal(next)
    if (target.transaction_id && !undoing && total <= 0 && total !== purchaseTotal(target)) {
      setError(t('finance_store_error_expense_not_positive'))
      return false
    }
    setPurchases(prev => prev.map(p => (p.id === id ? next : p)))
    const { error: err } = await supabase
      .from('finance_store_purchases')
      .update({ ...patch, ...(undoing ? { transaction_id: null } : {}) })
      .eq('id', id)
    if (err) {
      setPurchases(prev => prev.map(p => (p.id === id ? target : p)))
      return fail(err)
    }
    if (undoing) {
      await deleteLinkedTx(target.transaction_id!)
      return true
    }
    if (target.transaction_id) {
      return updateLinkedTx(target.transaction_id, total > 0 ? { amount: total, date: next.date } : { date: next.date })
    }
    return true
  }, [purchases, t, updateLinkedTx, deleteLinkedTx, fail])

  // 'quoting' → 'purchased' (o ExpenseConfirmModal do kanban), com a despesa
  // vinculada opcional, numa ação só: a despesa nasce do alvo, e a compra grava
  // o status e o vínculo num update. Não depende do estado depois do update
  // (a closure do clique ainda vê a compra em 'quoting'). Recusada a compra,
  // a despesa recém-lançada é apagada; recusada a despesa, nada é gravado.
  const markPurchased = useCallback(async (
    id: string,
    opts: { createExpense?: boolean; description?: string; categoryId?: string | null } = {},
  ): Promise<boolean> => {
    const target = purchases.find(p => p.id === id)
    if (!target) return false
    let txId: string | null = null
    const amount = purchaseTotal(target)
    if (opts.createExpense && target.account_id && !target.transaction_id && amount > 0) {
      txId = await insertLinkedTx('expense', amount, opts.description ?? '', target.date, target.account_id, opts.categoryId ?? null)
      if (!txId) return false
    }
    const patch = { status: 'purchased' as const, ...(txId ? { transaction_id: txId } : {}) }
    setPurchases(prev => prev.map(p => (p.id === id ? { ...p, ...patch } : p)))
    const { error: err } = await supabase.from('finance_store_purchases').update(patch).eq('id', id)
    if (err) {
      setPurchases(prev => prev.map(p => (p.id === id ? target : p)))
      if (txId) await deleteLinkedTx(txId)
      return fail(err)
    }
    return true
  }, [purchases, insertLinkedTx, deleteLinkedTx, fail])

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
    const row = data
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
    const row = data
    setCustomers(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }, [userId, workspaceId])

  const updateCustomer = useCallback(async (id: string, patch: Partial<NewCustomer>) => {
    setCustomers(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)))
    const { error: err } = await supabase.from('finance_store_customers').update(patch).eq('id', id)
    if (err) setError(err.message)
  }, [])

  // Sales keep their history: the FK is ON DELETE SET NULL.
  const deleteCustomer = useCallback(async (id: string) => {
    setCustomers(prev => prev.filter(c => c.id !== id))
    setSales(prev => prev.map(s => (s.customer_id === id ? { ...s, customer_id: null } : s)))
    const { error: err } = await supabase.from('finance_store_customers').delete().eq('id', id)
    if (err) setError(err.message)
  }, [])

  // ─── Sales (RPCs do API-028) ───────────────────────────────────────────────

  // A resposta é a verdade do servidor: a venda, os itens dela (quando vêm) e
  // o aviso de que a receita mudou.
  const adopt = useCallback((res: StoreSaleResult) => {
    const { sale, items } = res
    if (sale) {
      setSales(prev => (prev.some(s => s.id === sale.id) ? prev.map(s => (s.id === sale.id ? sale : s)) : [sale, ...prev]))
      if (items) setSaleItems(prev => [...prev.filter(i => i.sale_id !== sale.id), ...items])
    }
    if (res.transactionChanged) notifyTransactionsChanged()
  }, [])

  // Venda nova com os itens numa chamada: não sobra venda vazia quando um item
  // passa do estoque.
  const createSale = useCallback(async (form: NewSale, items: NewSaleItem[]): Promise<FinanceStoreSale | null> => {
    if (!userId) return null
    const { data, error: err } = await createStoreSale({ ...form, workspace_id: workspaceId }, items)
    if (err || !data?.sale) { fail(err); return null }
    adopt(data)
    return data.sale
  }, [userId, workspaceId, adopt, fail])

  const updateSale = useCallback(async (
    id: string,
    patch: Partial<NewSale & Pick<FinanceStoreSale, 'sold_on'>>,
  ): Promise<boolean> => {
    const { data, error: err } = await updateStoreSale(id, patch)
    if (err || !data) return fail(err)
    adopt(data)
    return true
  }, [adopt, fail])

  // The state machine of the pipeline, now on the server: moving to 'sold'
  // stamps sold_on (the caller may pick a retroactive date) and can open the
  // linked income; moving to 'cancelled' OR back to 'negotiating' deletes it,
  // all in one transaction. Devolve false quando o servidor recusa.
  const setSaleStatus = useCallback(async (
    id: string,
    status: FinanceStoreSaleStatus,
    opts?: { createTransaction?: boolean; description?: string; date?: string; categoryId?: string | null },
  ): Promise<boolean> => {
    const { data, error: err } = await setStoreSaleStatus(id, status, {
      createIncome: opts?.createTransaction,
      soldOn: opts?.date,
      categoryId: opts?.categoryId,
      description: opts?.description,
    })
    if (err || !data) return fail(err)
    adopt(data)
    return true
  }, [adopt, fail])

  // Late income for a sale that was marked sold without one. Idempotente no
  // servidor: um duplo clique não cria duas receitas.
  const generateSaleIncome = useCallback(async (id: string, description: string, categoryId: string | null = null): Promise<boolean> => {
    const { data, error: err } = await generateStoreSaleIncome(id, categoryId, description)
    if (err || !data) return fail(err)
    adopt(data)
    return true
  }, [adopt, fail])

  // O banco primeiro (receita, venda e itens), o Storage depois: um anexo
  // órfão no bucket é menos grave que uma venda sem os anexos.
  const deleteSale = useCallback(async (id: string): Promise<boolean> => {
    const { data, error: err } = await deleteStoreSale(id)
    if (err || !data) return fail(err)
    setSales(prev => prev.filter(s => s.id !== id))
    setSaleItems(prev => prev.filter(i => i.sale_id !== id))
    if (data.transactionDeleted) notifyTransactionsChanged()
    await removeAttachmentObjects(data.attachments)
    return true
  }, [fail])

  // ─── Sale items ────────────────────────────────────────────────────────────

  // Nome e custo médio são snapshots do servidor; a receita da venda acompanha
  // o líquido na mesma transação.
  const addSaleItems = useCallback(async (saleId: string, items: NewSaleItem[]): Promise<boolean> => {
    if (items.length === 0) return true
    const { data, error: err } = await addStoreSaleItems(saleId, items)
    if (err || !data) return fail(err)
    adopt(data)
    return true
  }, [adopt, fail])

  const updateSaleItem = useCallback(async (id: string, patch: { quantity?: number; unit_price?: number }): Promise<boolean> => {
    const { data, error: err } = await updateStoreSaleItem(id, patch)
    if (err || !data) return fail(err)
    adopt(data)
    return true
  }, [adopt, fail])

  const removeSaleItem = useCallback(async (id: string): Promise<boolean> => {
    const { data, error: err } = await removeStoreSaleItem(id)
    if (err || !data) return fail(err)
    adopt(data)
    return true
  }, [adopt, fail])

  const clearError = useCallback(() => setError(null), [])

  return {
    products, purchases, customers, sales, saleItems, suppliers, loading, error, clearError,
    createProduct, updateProduct, deleteProduct,
    createPurchase, updatePurchase, markPurchased, deletePurchase,
    createSupplier,
    createCustomer, updateCustomer, deleteCustomer,
    createSale, updateSale, setSaleStatus, generateSaleIncome, deleteSale,
    addSaleItems, updateSaleItem, removeSaleItem,
  }
}

export type FinanceStoreStore = ReturnType<typeof useFinanceStore>
