import { supabase } from '../supabase'
import { deviceToday } from './financeRecurring'
import type { TranslationKey } from '../../i18n/translations'
import type { Json } from '../../types/database'
import type {
  FinanceAttachment,
  FinanceStoreChannel,
  FinanceStoreSale,
  FinanceStoreSaleItem,
  FinanceStoreSaleStatus,
  FinanceTransaction,
} from '../../types'

// API-028: as vendas da Loja no servidor (migration api028_store_sales_server).
// Venda, itens e a receita vinculada mudam por 8 RPCs SECURITY INVOKER, cada
// uma numa transação: o navegador não grava mais a receita em passos soltos.
// O banco confere a máquina de estados, o estoque (global), o item único, as
// referências e o dinheiro. Quem chama lê `{ data, error }`, como nas outras
// funções de src/lib/data; `data` nulo (o smoke e clientes falsos) vira vazio.
// Datas em branco ('' do input) viram null antes da RPC: '' dava 22007 sem
// hint, que a API trata como erro interno.

/** Campos da venda que a tela grava (o servidor completa o resto). */
export interface StoreSaleFields {
  customer_id: string | null
  channel: FinanceStoreChannel
  shipping_method: string
  tracking_code: string
  expected_delivery_on: string | null
  shipping_charged: number
  shipping_cost: number
  fees: number
  account_id: string | null
  notes: string
  attachments: FinanceAttachment[]
}

/** Item como a RPC aceita: nome e custo médio são snapshots do servidor. */
export interface StoreSaleItemInput {
  product_id: string
  quantity: number
  /** Centavos; sem ele, o target_price do produto. */
  unit_price?: number
}

export interface StoreSaleResult {
  sale: FinanceStoreSale | null
  /** Todos os itens da venda que quem chama enxerga; null quando a RPC não devolve itens. */
  items: FinanceStoreSaleItem[] | null
  /** A receita vinculada depois da chamada (null: sem receita ou apagada). */
  transaction: FinanceTransaction | null
  /** A receita foi criada, alterada ou apagada: Transações precisa recarregar. */
  transactionChanged: boolean
}

export interface StoreSaleDeleted {
  saleId: string | null
  transactionDeleted: boolean
  /** Os anexos da venda apagada, para remover do Storage depois do banco. */
  attachments: FinanceAttachment[]
}

function isRow(value: unknown): value is { id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string'
}

function field(data: unknown, key: string): unknown {
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>)[key] : undefined
}

function saleRow(value: unknown): FinanceStoreSale | null {
  if (!isRow(value)) return null
  const sale = value as FinanceStoreSale
  return { ...sale, attachments: Array.isArray(sale.attachments) ? sale.attachments : [] }
}

function attachmentsOf(value: unknown): FinanceAttachment[] {
  return Array.isArray(value) ? (value.filter(a => typeof (a as { path?: unknown })?.path === 'string') as FinanceAttachment[]) : []
}

/** O retorno de store_sale_create, set_status, update, items_* e generate_income. */
export function parseSaleResult(data: unknown): StoreSaleResult {
  const items = field(data, 'items')
  return {
    sale: saleRow(field(data, 'sale')),
    items: Array.isArray(items) ? (items.filter(isRow) as FinanceStoreSaleItem[]) : null,
    transaction: isRow(field(data, 'transaction')) ? (field(data, 'transaction') as FinanceTransaction) : null,
    transactionChanged: field(data, 'transaction_changed') === true || field(data, 'created') === true,
  }
}

/** O retorno de store_sale_delete. */
export function parseSaleDeleted(data: unknown): StoreSaleDeleted {
  const saleId = field(data, 'sale_id')
  return {
    saleId: typeof saleId === 'string' ? saleId : null,
    transactionDeleted: field(data, 'transaction_deleted') === true,
    attachments: attachmentsOf(field(data, 'attachments')),
  }
}

/** '' (o input de data vazio) vira null; o resto passa como veio. */
function dateOrNull(value: string | null | undefined): string | null {
  return value ? value : null
}

function withDates<T extends { expected_delivery_on?: string | null; sold_on?: string | null }>(fields: T): T {
  const out = { ...fields }
  if ('expected_delivery_on' in out) out.expected_delivery_on = dateOrNull(out.expected_delivery_on)
  if ('sold_on' in out) out.sold_on = dateOrNull(out.sold_on)
  return out
}

// Os tipos do app não têm índice de string, e o Json gerado exige um: a forma
// é conferida aqui e no servidor (chave desconhecida dá 22023).
const asJson = (value: unknown) => value as Json

function itemsInput(items: readonly StoreSaleItemInput[]) {
  return items.map(i => (i.unit_price === undefined
    ? { product_id: i.product_id, quantity: i.quantity }
    : { product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price }))
}

/** Venda nova em negociação com os itens, numa transação só. */
export async function createStoreSale(fields: StoreSaleFields & { workspace_id: string | null }, items: readonly StoreSaleItemInput[]) {
  const { data, error } = await supabase.rpc('store_sale_create', {
    p_sale: asJson({ ...withDates(fields), items: itemsInput(items) }),
  })
  return { data: error ? null : parseSaleResult(data), error }
}

export interface StoreSaleStatusOptions {
  /** Lança a receita junto (só em sold, shipped ou delivered). */
  createIncome?: boolean
  /** Data da venda ao virar sold; '' vira o dia de hoje no servidor. */
  soldOn?: string | null
  categoryId?: string | null
  description?: string
  /**
   * O dia do aparelho (deviceToday), que carimba sold_on e delivered_on: a
   * tela trabalha no fuso dele. O servidor aceita até 1 dia do hoje de São
   * Paulo; com o relógio errado, recusa (finance_store_error_clock).
   */
  today?: string
}

/** Muda o status (os 10 pares do pipeline) com a receita na mesma transação. */
export async function setStoreSaleStatus(saleId: string, status: FinanceStoreSaleStatus, opts: StoreSaleStatusOptions = {}) {
  const args: {
    p_sale: string
    p_status: string
    p_create_income?: boolean
    p_sold_on?: string
    p_category?: string
    p_description?: string
    p_today?: string
  } = { p_sale: saleId, p_status: status }
  if (opts.createIncome) args.p_create_income = true
  const soldOn = dateOrNull(opts.soldOn)
  if (soldOn) args.p_sold_on = soldOn
  if (opts.categoryId) args.p_category = opts.categoryId
  if (opts.description) args.p_description = opts.description
  args.p_today = opts.today ?? deviceToday()
  const { data, error } = await supabase.rpc('store_sale_set_status', args)
  return { data: error ? null : parseSaleResult(data), error }
}

/** Muda os campos da venda (só as chaves presentes) e ressincroniza a receita. */
export async function updateStoreSale(saleId: string, patch: Partial<StoreSaleFields> & { sold_on?: string | null }) {
  const { data, error } = await supabase.rpc('store_sale_update', { p_sale: saleId, p_patch: asJson(withDates(patch)) })
  return { data: error ? null : parseSaleResult(data), error }
}

/** Põe itens numa venda (tudo ou nada) sem mexer na versão da venda. */
export async function addStoreSaleItems(saleId: string, items: readonly StoreSaleItemInput[]) {
  const { data, error } = await supabase.rpc('store_sale_items_add', { p_sale: saleId, p_items: asJson(itemsInput(items)) })
  return { data: error ? null : parseSaleResult(data), error }
}

/** Muda quantidade e/ou preço de um item; produto, nome e custo não mudam. */
export async function updateStoreSaleItem(itemId: string, patch: { quantity?: number; unit_price?: number }) {
  const { data, error } = await supabase.rpc('store_sale_items_update', { p_item: itemId, p_patch: asJson(patch) })
  return { data: error ? null : parseSaleResult(data), error }
}

export async function removeStoreSaleItem(itemId: string) {
  const { data, error } = await supabase.rpc('store_sale_items_remove', { p_item: itemId })
  return { data: error ? null : parseSaleResult(data), error }
}

/** Receita depois do fato; já vinculada devolve a existente (idempotente). */
export async function generateStoreSaleIncome(saleId: string, categoryId: string | null, description: string) {
  const args: { p_sale: string; p_category?: string; p_description?: string } = { p_sale: saleId }
  if (categoryId) args.p_category = categoryId
  if (description) args.p_description = description
  const { data, error } = await supabase.rpc('store_sale_generate_income', args)
  return { data: error ? null : parseSaleResult(data), error }
}

/** Apaga a receita e a venda; os anexos voltam para quem chama apagar do Storage. */
export async function deleteStoreSale(saleId: string) {
  const { data, error } = await supabase.rpc('store_sale_delete', { p_sale: saleId })
  return { data: error ? null : parseSaleDeleted(data), error }
}

// ─── Erros ───────────────────────────────────────────────────────────────────

export interface StoreErrorMessage {
  key: TranslationKey
  vars?: Record<string, string>
}

type StoreError = { code?: string | null; message?: string | null } | null | undefined

/**
 * A chave de tradução de um erro das RPCs e dos gatilhos da Loja, pelo
 * SQLSTATE e pela mensagem (em pt-BR no servidor). O prefixo "items/N: " dos
 * lotes sai antes. Desconhecido: null (quem mostra usa a mensagem crua).
 */
export function storeErrorKey(error: StoreError): StoreErrorMessage | null {
  if (!error) return null
  const code = error.code ?? ''
  const message = (error.message ?? '').replace(/^items\/\d+: /, '')
  if (code === 'PGRST202' || code === '42883') return { key: 'finance_store_error_outdated' }
  if (code === '23514') return { key: 'finance_store_error_negative' }
  if (code === 'P0002') return { key: 'finance_store_error_not_found' }
  if (code === '42501') {
    return message.startsWith('A receita vinculada é de outra pessoa')
      ? { key: 'finance_store_error_income_foreign' }
      : { key: 'finance_store_error_denied' }
  }
  if (code === 'P0001') {
    const reopen = /^Estoque insuficiente para reabrir: (.+) tem (\d+) disponível\(is\), a venda pede (\d+)$/.exec(message)
    if (reopen) return { key: 'finance_store_error_reopen_stock', vars: { name: reopen[1], available: reopen[2], needed: reopen[3] } }
    const stock = /^Estoque insuficiente: (.+) tem (\d+) disponível\(is\)$/.exec(message)
    if (stock) return { key: 'finance_store_error_stock', vars: { name: stock[1], available: stock[2] } }
    if (message.startsWith('Mudança de status não permitida')) return { key: 'finance_store_error_transition' }
    if (message.startsWith('Remova a receita vinculada')) return { key: 'finance_store_error_remove_income' }
    if (message.startsWith('A venda já tem receita') || message.startsWith('Esta transação já está vinculada')) {
      return { key: 'finance_store_error_has_income' }
    }
    if (message.startsWith('Só venda vendida')) return { key: 'finance_store_error_not_sold' }
    return null
  }
  if (code === '22023') {
    if (message.includes('líquido da venda')) return { key: 'finance_store_error_net' }
    if (message.startsWith('Data de hoje')) return { key: 'finance_store_error_clock' }
    // Antes da data da venda: "A data de entrega (…) é anterior à data da venda (…)".
    if (message.startsWith('A data de entrega') || message.startsWith('Só venda entregue tem data de entrega')) {
      return { key: 'finance_store_error_delivered_on' }
    }
    if (message.includes('data da venda')) return { key: 'finance_store_error_sold_on' }
    if (message.startsWith('Item único')) return { key: 'finance_store_error_unique' }
    if (message.startsWith('Produto arquivado')) return { key: 'finance_store_error_archived' }
    if (message.includes('precisa de uma conta')) return { key: 'finance_store_error_account' }
    if (message.startsWith('A categoria da receita')) return { key: 'finance_store_error_category' }
    return { key: 'finance_store_error_invalid' }
  }
  if (code === '22007' || code === '22008' || code === '22P02') return { key: 'finance_store_error_invalid' }
  return null
}

/** O texto do erro no idioma da tela, ou a mensagem crua quando não há chave. */
export function storeErrorText(error: StoreError, t: (key: TranslationKey, vars?: Record<string, string>) => string): string | null {
  if (!error) return null
  const known = storeErrorKey(error)
  return known ? t(known.key, known.vars) : (error.message ?? null)
}
