// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent } from '../../../test/rtl'
import type { FinanceStoreProduct, FinanceStorePurchase, FinanceStoreSale, FinanceStoreSaleItem } from '../../../types'
import type { FinanceStoreStore } from './useFinanceStore'

// API-028: a tela das vendas com as recusas do servidor. O "Criar receita"
// desliga com líquido <= 0; o modal de status resolve com o resultado real (o
// kanban reverte o card); a venda nova vai com os itens numa chamada; com a
// receita lançada, o último item só sai depois de entrar outro; a venda
// consumida exige a data; e a lista (o caminho do celular) mostra o motivo na
// própria linha.

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }),
}))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => true }))
// O campo de anexos da venda editada lê quem está logado.
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

const { StatusConfirmModal } = await import('./StatusConfirmModal')
const { SaleModal } = await import('./SaleModal')
const { SalesView } = await import('./SalesView')

// O teto da data da venda com fuso e hora fixos (#14 da revisão): em Noronha
// (UTC-2), às 00:30 de 13/10, São Paulo ainda está em 12/10 (23:30). O teto
// certo é o amanhã de São Paulo, 13/10; o amanhã do aparelho (14/10) o gatilho
// recusaria. Com o literal, o teste não depende do fuso nem da hora do processo.
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
function atNoronhaAfterMidnight() {
  vi.stubEnv('TZ', 'America/Noronha')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T02:30:00Z'))
  // Pré-condição: o fuso fixado vale (o pool do vitest é forks e o Node relê o
  // TZ); sem ela o caso rodaria no fuso do processo.
  expect(new Date().getTimezoneOffset()).toBe(120)
}

const sale = (over: Partial<FinanceStoreSale> = {}): FinanceStoreSale => ({
  id: 's1', user_id: 'u1', workspace_id: null, customer_id: null, status: 'negotiating', channel: 'olx',
  sold_on: null, shipping_method: '', tracking_code: '', expected_delivery_on: null, delivered_on: null,
  shipping_charged: 0, shipping_cost: 0, fees: 0, account_id: 'acc', transaction_id: null,
  notes: '', attachments: [], created_at: '', updated_at: '', ...over,
})
const item = (over: Partial<FinanceStoreSaleItem> = {}): FinanceStoreSaleItem => ({
  id: 'i1', user_id: 'u1', workspace_id: null, sale_id: 's1', product_id: 'p1', product_name: 'GPU',
  quantity: 1, unit_price: 30_000, unit_cost_at_sale: 20_000, created_at: '', updated_at: '', ...over,
})
const product: FinanceStoreProduct = {
  id: 'p1', user_id: 'u1', workspace_id: null, kind: 'stock', name: 'SSD', category: '', condition: 'new',
  serial_number: '', notes: '', target_price: 40_000, archived: false, attachments: [], created_at: '', updated_at: '',
}
const purchase: FinanceStorePurchase = {
  id: 'pu1', user_id: 'u1', workspace_id: null, product_id: 'p1', supplier_id: null, status: 'received',
  quantity: 5, unit_cost: 20_000, other_costs: 0, date: '2026-09-01', account_id: null, transaction_id: null,
  notes: '', attachments: [], created_at: '', updated_at: '',
}

function fakeStore(over: Partial<FinanceStoreStore> = {}): FinanceStoreStore {
  return {
    products: [product], purchases: [purchase], customers: [], sales: [], saleItems: [], suppliers: [],
    loading: false, error: null, clearError: vi.fn(),
    setSaleStatus: vi.fn(() => Promise.resolve(true)),
    generateSaleIncome: vi.fn(() => Promise.resolve(true)),
    createSale: vi.fn(() => Promise.resolve(sale())),
    updateSale: vi.fn(() => Promise.resolve(true)),
    deleteSale: vi.fn(() => Promise.resolve(true)),
    addSaleItems: vi.fn(() => Promise.resolve(true)),
    updateSaleItem: vi.fn(() => Promise.resolve(true)),
    removeSaleItem: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as unknown as FinanceStoreStore
}

describe('StatusConfirmModal', () => {
  it('líquido <= 0: "Criar receita" desligado, com a dica, e a venda segue sem receita', async () => {
    const store = fakeStore({ saleItems: [item({ unit_price: 0 })] })
    render(<StatusConfirmModal store={store} sale={sale({ fees: 500 })} action="sold" categories={[]} onClose={() => {}} />)
    const box = screen.getByRole('checkbox')
    expect((box as HTMLInputElement).disabled).toBe(true)
    expect((box as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText('finance_store_net_not_positive_hint')).toBeTruthy()
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'finance_store_mark_sold' }).at(-1)!)
    expect(store.setSaleStatus).toHaveBeenCalledWith('s1', 'sold', expect.objectContaining({ createTransaction: false }))
  })

  it('a data da venda vai até amanhã (o menor entre o do aparelho e o de São Paulo)', () => {
    atNoronhaAfterMidnight()
    render(<StatusConfirmModal store={fakeStore({ saleItems: [item()] })} sale={sale()} action="sold" categories={[]} onClose={() => {}} />)
    const date = document.querySelector<HTMLInputElement>('input[type="date"]')!
    expect(date.max).toBe('2026-10-13')
    expect(date.required).toBe(true)
  })

  it('resolve com o resultado real: recusado pelo servidor, onResolved(false) e o kanban reverte', async () => {
    const onResolved = vi.fn()
    const onClose = vi.fn()
    const store = fakeStore({ saleItems: [item()], setSaleStatus: vi.fn(() => Promise.resolve(false)) })
    render(<StatusConfirmModal store={store} sale={sale()} action="sold" categories={[]} onClose={onClose} onResolved={onResolved} />)
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true)
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'finance_store_mark_sold' }).at(-1)!)
    expect(store.setSaleStatus).toHaveBeenCalledWith('s1', 'sold', expect.objectContaining({ createTransaction: true }))
    expect(onResolved).toHaveBeenCalledWith(false)
    expect(onClose).toHaveBeenCalled()
  })

  it('receita depois do fato sem líquido: o botão fica desligado', () => {
    render(<StatusConfirmModal store={fakeStore({ saleItems: [item({ unit_price: 0 })] })} sale={sale({ status: 'sold', sold_on: '2026-09-10' })}
      action="income" categories={[]} onClose={() => {}} />)
    const button = screen.getAllByRole('button', { name: 'finance_store_generate_income' }).at(-1) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('cancelar e reabrir mandam o status; aplicado, onResolved(true)', async () => {
    const onResolved = vi.fn()
    const store = fakeStore()
    const { unmount } = render(<StatusConfirmModal store={store} sale={sale({ status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx' })}
      action="cancelled" categories={[]} onClose={() => {}} onResolved={onResolved} />)
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'finance_store_cancel_sale' }).at(-1)!)
    expect(store.setSaleStatus).toHaveBeenCalledWith('s1', 'cancelled')
    expect(onResolved).toHaveBeenCalledWith(true)
    unmount()
    render(<StatusConfirmModal store={store} sale={sale({ status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx' })}
      action="reopen" categories={[]} onClose={() => {}} />)
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'finance_store_revert_status' }).at(-1)!)
    expect(store.setSaleStatus).toHaveBeenLastCalledWith('s1', 'negotiating')
  })
})

describe('SaleModal', () => {
  it('venda nova: venda e itens numa chamada, só produto, quantidade e preço', async () => {
    const store = fakeStore()
    const onClose = vi.fn()
    render(<SaleModal store={store} accounts={[]} onClose={onClose} />)
    fireEvent.change(screen.getAllByRole('combobox').find(s => s.querySelector('option[value="p1"]'))!, { target: { value: 'p1' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'common_add_item' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_save' }))
    expect(store.createSale).toHaveBeenCalledTimes(1)
    expect(vi.mocked(store.createSale).mock.calls[0][1]).toEqual([{ product_id: 'p1', quantity: 1, unit_price: 40_000 }])
    expect(store.addSaleItems).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('recusa ao criar: o motivo aparece no modal e ele não fecha', async () => {
    const store = fakeStore({ createSale: vi.fn(() => Promise.resolve(null)), error: 'Estoque insuficiente: SSD tem 0 disponível(is).' })
    const onClose = vi.fn()
    render(<SaleModal store={store} accounts={[]} onClose={onClose} />)
    fireEvent.change(screen.getAllByRole('combobox').find(s => s.querySelector('option[value="p1"]'))!, { target: { value: 'p1' } })
    await userEvent.setup().click(screen.getByRole('button', { name: 'common_add_item' }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_save' }))
    expect(screen.getByRole('alert').textContent).toBe('Estoque insuficiente: SSD tem 0 disponível(is).')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('com a receita lançada, o único item não sai (o líquido zeraria); com outro, sai', async () => {
    const withIncome = sale({ status: 'sold', sold_on: '2026-09-10', transaction_id: 'tx' })
    const store = fakeStore({ sales: [withIncome], saleItems: [item()] })
    const { unmount } = render(<SaleModal store={store} sale={withIncome} accounts={[]} onClose={() => {}} />)
    const blocked = screen.getByRole<HTMLButtonElement>('button', { name: 'finance_store_remove_needs_add' })
    expect(blocked.disabled).toBe(true)
    unmount()
    const two = fakeStore({ sales: [withIncome], saleItems: [item(), item({ id: 'i2', unit_price: 10_000 })] })
    render(<SaleModal store={two} sale={withIncome} accounts={[]} onClose={() => {}} />)
    const removable = screen.getAllByRole('button', { name: 'finance_delete' })[0] as HTMLButtonElement
    expect(removable.disabled).toBe(false)
    await userEvent.setup().click(removable)
    expect(two.removeSaleItem).toHaveBeenCalledWith('i1')
  })

  it('venda consumida sem data: salvar desligado, com a dica; a data vai até amanhã', () => {
    atNoronhaAfterMidnight()
    const consumed = sale({ status: 'shipped', sold_on: null })
    render(<SaleModal store={fakeStore({ sales: [consumed], saleItems: [item()] })} sale={consumed} accounts={[]} onClose={() => {}} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'finance_save' }).disabled).toBe(true)
    expect(screen.getByText('finance_store_sold_on_required')).toBeTruthy()
    const dates = [...document.querySelectorAll<HTMLInputElement>('input[type="date"]')]
    expect(dates.some(d => d.max === '2026-10-13' && d.required)).toBe(true)
  })

  it('editar: salva a data da venda consumida e fecha; recusado, fica aberto', async () => {
    const consumed = sale({ status: 'sold', sold_on: '2026-09-10' })
    const store = fakeStore({ sales: [consumed], saleItems: [item()] })
    const onClose = vi.fn()
    const { unmount } = render(<SaleModal store={store} sale={consumed} accounts={[]} onClose={onClose} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_save' }))
    expect(store.updateSale).toHaveBeenCalledWith('s1', expect.objectContaining({ sold_on: '2026-09-10' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    const refused = fakeStore({ sales: [consumed], saleItems: [item()], updateSale: vi.fn(() => Promise.resolve(false)), error: 'motivo' })
    const onClose2 = vi.fn()
    render(<SaleModal store={refused} sale={consumed} accounts={[]} onClose={onClose2} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_save' }))
    expect(onClose2).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('motivo')
  })
})

describe('SalesView no celular (lista)', () => {
  it('transição recusada: limpa o aviso antigo e mostra o motivo na linha da venda', async () => {
    const shipped = sale({ status: 'sold', sold_on: '2026-09-10' })
    const store = fakeStore({ sales: [shipped], saleItems: [item()], setSaleStatus: vi.fn(() => Promise.resolve(false)), error: 'motivo da recusa' })
    render(<SalesView store={store} categories={[]} onNew={() => {}} onEdit={() => {}} />)
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_store_mark_shipped' }))
    expect(store.clearError).toHaveBeenCalled()
    expect(store.setSaleStatus).toHaveBeenCalledWith('s1', 'shipped')
    expect(screen.getByRole('alert').textContent).toBe('motivo da recusa')
  })

  it('transição aplicada: sem aviso na linha', async () => {
    const store = fakeStore({ sales: [sale({ status: 'sold', sold_on: '2026-09-10' })], saleItems: [item()], error: 'antigo' })
    render(<SalesView store={store} categories={[]} onNew={() => {}} onEdit={() => {}} />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_store_mark_shipped' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
