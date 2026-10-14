import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getT } from '../../i18n/translations'
import { ptBR } from '../../i18n/translations.pt-BR'

// API-028: as 8 RPCs das vendas da Loja. Os parâmetros que o banco espera
// (datas '' viram null, itens só com product_id, quantity e unit_price), o
// retorno lido de forma tolerante (data nulo, como o smoke, vira vazio), o
// erro repassado sem dado parcial e a tradução das recusas (storeErrorKey).

type Res = { data: unknown; error: { message: string; code?: string } | null }
const db = vi.hoisted(() => ({ queue: [] as Res[], calls: [] as unknown[][] }))

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      db.calls.push([name, args])
      return Promise.resolve(db.queue.shift() ?? { data: null, error: null })
    },
  },
}))

const {
  addStoreSaleItems, createStoreSale, deleteStoreSale, generateStoreSaleIncome, parseSaleDeleted, parseSaleResult,
  removeStoreSaleItem, setStoreSaleStatus, storeErrorKey, storeErrorText, updateStoreSale, updateStoreSaleItem,
} = await import('./financeStore')
const { deviceToday } = await import('./financeRecurring')

const sale = { id: 's1', status: 'sold', attachments: null, sold_on: '2026-10-10' }
const item = { id: 'i1', sale_id: 's1', product_id: 'p1', quantity: 1, unit_price: 3000 }
const tx = { id: 't1', type: 'income', amount: 3000 }

const fields = {
  customer_id: null, channel: 'olx' as const, shipping_method: '', tracking_code: '', expected_delivery_on: '',
  shipping_charged: 0, shipping_cost: 0, fees: 500, account_id: 'acc', notes: '', attachments: [],
}

beforeEach(() => {
  db.queue = []
  db.calls = []
})

afterEach(() => { vi.useRealTimers() })

describe('parseSaleResult', () => {
  it('venda (anexos nulos viram []), itens, receita e o aviso de receita mudada', () => {
    expect(parseSaleResult({ sale, items: [item, { x: 1 }], transaction: tx, transaction_changed: true })).toEqual({
      sale: { ...sale, attachments: [] }, items: [item], transaction: tx, transactionChanged: true,
    })
  })

  it('created (generate_income) também conta como receita mudada; sem itens, items é null', () => {
    expect(parseSaleResult({ sale, transaction: tx, created: true })).toMatchObject({ items: null, transactionChanged: true })
    expect(parseSaleResult({ sale, transaction: tx, created: false }).transactionChanged).toBe(false)
  })

  it('data nulo ou fora da forma vira vazio', () => {
    expect(parseSaleResult(null)).toEqual({ sale: null, items: null, transaction: null, transactionChanged: false })
    expect(parseSaleResult({ sale: 'x', items: 'y', transaction: 1 })).toEqual({ sale: null, items: null, transaction: null, transactionChanged: false })
  })
})

describe('parseSaleDeleted', () => {
  it('id, receita apagada e só os anexos com caminho', () => {
    expect(parseSaleDeleted({ sale_id: 's1', transaction_deleted: true, attachments: [{ path: 'u/a.png' }, { id: 'sem-caminho' }] }))
      .toEqual({ saleId: 's1', transactionDeleted: true, attachments: [{ path: 'u/a.png' }] })
  })

  it('data nulo: nada para apagar', () => {
    expect(parseSaleDeleted(null)).toEqual({ saleId: null, transactionDeleted: false, attachments: [] })
  })
})

describe('createStoreSale', () => {
  it('manda a venda e os itens numa chamada, com a data em branco como null e o preço só quando veio', async () => {
    db.queue = [{ data: { sale, items: [item] }, error: null }]
    const { data, error } = await createStoreSale({ ...fields, workspace_id: 'ws1' }, [
      { product_id: 'p1', quantity: 1, unit_price: 3000 },
      { product_id: 'p2', quantity: 2 },
    ])
    expect(error).toBeNull()
    expect(db.calls).toEqual([['store_sale_create', {
      p_sale: { ...fields, expected_delivery_on: null, workspace_id: 'ws1',
        items: [{ product_id: 'p1', quantity: 1, unit_price: 3000 }, { product_id: 'p2', quantity: 2 }] },
    }]])
    expect(data?.sale?.id).toBe('s1')
    expect(data?.items).toEqual([item])
  })

  it('erro: sem dado', async () => {
    db.queue = [{ data: null, error: { code: 'P0001', message: 'items/0: Estoque insuficiente: GPU tem 0 disponível(is)' } }]
    expect(await createStoreSale({ ...fields, workspace_id: null }, [{ product_id: 'p1', quantity: 1 }]))
      .toEqual({ data: null, error: { code: 'P0001', message: 'items/0: Estoque insuficiente: GPU tem 0 disponível(is)' } })
  })
})

describe('setStoreSaleStatus', () => {
  it('só os parâmetros usados; data em branco não vai', async () => {
    await setStoreSaleStatus('s1', 'shipped', { today: '2026-10-12' })
    await setStoreSaleStatus('s1', 'sold', { createIncome: true, soldOn: '', categoryId: 'c1', description: 'Venda: GPU', today: '2026-10-12' })
    await setStoreSaleStatus('s1', 'sold', { soldOn: '2026-10-11', createIncome: false, categoryId: null, today: '2026-10-12' })
    expect(db.calls).toEqual([
      ['store_sale_set_status', { p_sale: 's1', p_status: 'shipped', p_today: '2026-10-12' }],
      ['store_sale_set_status', { p_sale: 's1', p_status: 'sold', p_create_income: true, p_category: 'c1', p_description: 'Venda: GPU', p_today: '2026-10-12' }],
      ['store_sale_set_status', { p_sale: 's1', p_status: 'sold', p_sold_on: '2026-10-11', p_today: '2026-10-12' }],
    ])
  })

  it('sem today, manda o dia do aparelho (deviceToday)', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 12, 23, 30))
    await setStoreSaleStatus('s1', 'cancelled')
    expect(db.calls[0][1]).toEqual({ p_sale: 's1', p_status: 'cancelled', p_today: '2026-10-12' })
    expect(deviceToday()).toBe('2026-10-12')
  })

  it('lê a venda, a receita e o aviso', async () => {
    db.queue = [{ data: { sale, transaction: tx, transaction_changed: true }, error: null }]
    const { data } = await setStoreSaleStatus('s1', 'sold', { today: '2026-10-12' })
    expect(data).toMatchObject({ sale: { id: 's1' }, transaction: { id: 't1' }, transactionChanged: true })
  })
})

describe('updateStoreSale', () => {
  it('só as chaves do patch; datas em branco viram null', async () => {
    await updateStoreSale('s1', { fees: 100, sold_on: '', expected_delivery_on: '' })
    await updateStoreSale('s1', { notes: 'x' })
    expect(db.calls).toEqual([
      ['store_sale_update', { p_sale: 's1', p_patch: { fees: 100, sold_on: null, expected_delivery_on: null } }],
      ['store_sale_update', { p_sale: 's1', p_patch: { notes: 'x' } }],
    ])
  })
})

describe('itens', () => {
  it('add, update e remove chamam as RPCs com os ids e devolvem os itens da venda', async () => {
    db.queue = [{ data: { sale, items: [item], transaction: null, transaction_changed: false }, error: null }]
    const added = await addStoreSaleItems('s1', [{ product_id: 'p1', quantity: 1 }])
    await updateStoreSaleItem('i1', { unit_price: 4000 })
    await removeStoreSaleItem('i1')
    expect(db.calls).toEqual([
      ['store_sale_items_add', { p_sale: 's1', p_items: [{ product_id: 'p1', quantity: 1 }] }],
      ['store_sale_items_update', { p_item: 'i1', p_patch: { unit_price: 4000 } }],
      ['store_sale_items_remove', { p_item: 'i1' }],
    ])
    expect(added.data?.items).toEqual([item])
  })

  it('erro: sem dado', async () => {
    db.queue = [{ data: null, error: { code: '22023', message: 'x' } }, { data: null, error: { code: 'P0002', message: 'y' } }]
    expect((await updateStoreSaleItem('i1', { quantity: 2 })).data).toBeNull()
    expect((await removeStoreSaleItem('i1')).data).toBeNull()
  })
})

describe('generateStoreSaleIncome e deleteStoreSale', () => {
  it('categoria e descrição só quando vieram', async () => {
    db.queue = [{ data: { sale, transaction: tx, created: true }, error: null }]
    const { data } = await generateStoreSaleIncome('s1', 'c1', 'Venda: GPU')
    await generateStoreSaleIncome('s1', null, '')
    expect(db.calls).toEqual([
      ['store_sale_generate_income', { p_sale: 's1', p_category: 'c1', p_description: 'Venda: GPU' }],
      ['store_sale_generate_income', { p_sale: 's1' }],
    ])
    expect(data?.transactionChanged).toBe(true)
  })

  it('delete devolve os anexos; erro sem dado', async () => {
    db.queue = [
      { data: { sale_id: 's1', transaction_deleted: true, attachments: [{ path: 'u/a.png' }] }, error: null },
      { data: null, error: { code: '42501', message: 'A receita vinculada é de outra pessoa: só ela pode apagar' } },
    ]
    expect((await deleteStoreSale('s1')).data).toEqual({ saleId: 's1', transactionDeleted: true, attachments: [{ path: 'u/a.png' }] })
    expect((await deleteStoreSale('s2')).data).toBeNull()
    expect(db.calls).toEqual([['store_sale_delete', { p_sale: 's1' }], ['store_sale_delete', { p_sale: 's2' }]])
  })
})

describe('storeErrorKey', () => {
  const cases: [string, string, unknown][] = [
    ['P0001', 'items/1: Estoque insuficiente: GPU tem 0 disponível(is)', { key: 'finance_store_error_stock', vars: { name: 'GPU', available: '0' } }],
    ['P0001', 'Estoque insuficiente para reabrir: SSD tem 1 disponível(is), a venda pede 50',
      { key: 'finance_store_error_reopen_stock', vars: { name: 'SSD', available: '1', needed: '50' } }],
    ['P0001', 'Mudança de status não permitida: negotiating → delivered', { key: 'finance_store_error_transition' }],
    ['P0001', 'Remova a receita vinculada antes de reabrir ou cancelar a venda', { key: 'finance_store_error_remove_income' }],
    ['P0001', 'A venda já tem receita vinculada: remova a atual antes', { key: 'finance_store_error_has_income' }],
    ['P0001', 'Esta transação já está vinculada a outra venda ou compra', { key: 'finance_store_error_has_income' }],
    ['P0001', 'Só venda vendida, enviada ou entregue gera receita', { key: 'finance_store_error_not_sold' }],
    ['P0001', 'outra coisa', null],
    ['22023', 'O líquido da venda ficaria zero ou negativo com a receita lançada: remova a receita antes', { key: 'finance_store_error_net' }],
    ['22023', 'O líquido da venda é zero ou negativo: não há receita para lançar', { key: 'finance_store_error_net' }],
    ['22023', 'A data da venda (2026-10-14) passa de amanhã em São Paulo (2026-10-13)', { key: 'finance_store_error_sold_on' }],
    ['22023', 'Venda vendida, enviada ou entregue precisa da data da venda', { key: 'finance_store_error_sold_on' }],
    // A data de entrega (#12 da revisão): a 1ª menciona a data da venda e não é dela.
    ['22023', 'A data de entrega (2026-10-12) é anterior à data da venda (2026-10-13)', { key: 'finance_store_error_delivered_on' }],
    ['22023', 'A data de entrega (3000-01-01) passa de amanhã em São Paulo (2026-10-14)', { key: 'finance_store_error_delivered_on' }],
    ['22023', 'Só venda entregue tem data de entrega', { key: 'finance_store_error_delivered_on' }],
    ['22023', 'Data de hoje (2026-10-20) a mais de 1 dia do hoje de São Paulo (2026-10-12): mande o dia do aparelho ou nada', { key: 'finance_store_error_clock' }],
    ['22023', 'items/0: Item único vende 1 unidade: GPU', { key: 'finance_store_error_unique' }],
    ['22023', 'Produto arquivado não entra em venda: Fonte', { key: 'finance_store_error_archived' }],
    ['22023', 'A venda precisa de uma conta para lançar a receita', { key: 'finance_store_error_account' }],
    ['22023', 'Venda com receita lançada precisa de uma conta: escolha outra ou remova a receita', { key: 'finance_store_error_account' }],
    ['22023', 'A categoria da receita tem de ser de receita (income)', { key: 'finance_store_error_category' }],
    ['22023', 'fees é um valor em centavos, inteiro, de 0 a 1000000000000', { key: 'finance_store_error_invalid' }],
    ['22007', 'invalid input syntax for type date: ""', { key: 'finance_store_error_invalid' }],
    ['23514', 'new row for relation "finance_store_sales" violates check constraint "finance_store_sales_money_nonneg"', { key: 'finance_store_error_negative' }],
    ['P0002', 'Venda não encontrada', { key: 'finance_store_error_not_found' }],
    ['42501', 'A receita vinculada é de outra pessoa: só ela pode apagar', { key: 'finance_store_error_income_foreign' }],
    ['42501', 'A receita vinculada é de outra pessoa: peça a quem a lançou para apagá-la em Transações e tente de novo', { key: 'finance_store_error_income_foreign' }],
    ['42501', 'A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la (ou apagá-la em Transações)', { key: 'finance_store_error_income_foreign' }],
    ['42501', 'new row violates row-level security policy', { key: 'finance_store_error_denied' }],
    ['PGRST202', 'Could not find the function public.store_sale_create', { key: 'finance_store_error_outdated' }],
    ['42883', 'function public.store_sale_update(uuid, jsonb) does not exist', { key: 'finance_store_error_outdated' }],
    ['08006', 'Failed to fetch', null],
  ]

  it.each(cases)('%s "%s"', (code, message, expected) => {
    expect(storeErrorKey({ code, message })).toEqual(expected)
  })

  it('sem erro: null; toda chave existe no dicionário', () => {
    expect(storeErrorKey(null)).toBeNull()
    for (const [code, message, expected] of cases) {
      const key = (expected as { key?: string } | null)?.key
      if (key) expect(key in ptBR, `${code} ${message}`).toBe(true)
    }
  })
})

describe('storeErrorText', () => {
  it('traduz com as variáveis, e cai na mensagem crua quando não conhece', () => {
    const t = getT('pt-BR')
    expect(storeErrorText({ code: 'P0001', message: 'items/0: Estoque insuficiente: GPU tem 0 disponível(is)' }, t))
      .toBe('Estoque insuficiente: GPU tem 0 disponível(is).')
    expect(storeErrorText({ code: '08006', message: 'Failed to fetch' }, t)).toBe('Failed to fetch')
    expect(storeErrorText(null, t)).toBeNull()
  })
})
