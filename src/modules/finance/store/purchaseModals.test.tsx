// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent } from '../../../test/rtl'
import type { FinanceAccount, FinanceStoreProduct, FinanceStorePurchase, FinanceSupplier } from '../../../types'
import type { FinanceStoreStore } from './useFinanceStore'

// #13 da revisão do API-028: compras e produtos continuam gravados direto
// pelo app até o API-037, e o CHECK de dinheiro >= 0 recusa o valor negativo
// (23514), que o min="0" do input não barra. O Salvar desliga com valor
// negativo, e o modal só fecha quando a gravação deu certo; recusado, mostra
// o motivo. O produto novo cuja compra inicial foi recusada não é criado de
// novo ao salvar outra vez, e o fornecedor novo também não: a 2ª tentativa vai
// com o id do fornecedor criado na 1ª.
//
// #11 da 2ª revisão: a despesa precisa de valor > 0 (CHECK de
// finance_transactions). Com o total zero, 'Gerar despesa' desliga e desmarca,
// com a dica, e salvar não pede a despesa.

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }),
}))
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

const { PurchaseModal } = await import('./PurchaseModal')
const { ProductModal } = await import('./ProductModal')

const product = (over: Partial<FinanceStoreProduct> = {}): FinanceStoreProduct => ({
  id: 'p1', user_id: 'u1', workspace_id: null, kind: 'stock', name: 'SSD', category: '', condition: 'new',
  serial_number: '', notes: '', target_price: 40_000, archived: false, attachments: [], created_at: '', updated_at: '', ...over,
})
const purchase = (over: Partial<FinanceStorePurchase> = {}): FinanceStorePurchase => ({
  id: 'pu1', user_id: 'u1', workspace_id: null, product_id: 'p1', supplier_id: null, status: 'received',
  quantity: 2, unit_cost: 10_000, other_costs: 0, date: '2026-09-01', account_id: null, transaction_id: null,
  notes: '', attachments: [], created_at: '', updated_at: '', ...over,
})

const supplier = (id: string): FinanceSupplier => ({
  id, user_id: 'u1', workspace_id: null, name: 'Loja X', phone: '', website: '', notes: '', created_at: '', updated_at: '',
})

function fakeStore(over: Partial<FinanceStoreStore> = {}): FinanceStoreStore {
  return {
    products: [product()], purchases: [purchase()], customers: [], sales: [], saleItems: [], suppliers: [],
    loading: false, error: null, clearError: vi.fn(),
    createPurchase: vi.fn(() => Promise.resolve(purchase({ id: 'novo' }))),
    updatePurchase: vi.fn(() => Promise.resolve(true)),
    createProduct: vi.fn(() => Promise.resolve(product({ id: 'criado' }))),
    updateProduct: vi.fn(() => Promise.resolve(true)),
    createSupplier: vi.fn(() => Promise.resolve(null)),
    ...over,
  } as unknown as FinanceStoreStore
}

const numberInputs = () => [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')]
const accounts = [{ id: 'acc', name: 'Conta', icon: '' }] as FinanceAccount[]
const expenseBox = () => screen.getByRole<HTMLInputElement>('checkbox', { name: 'finance_store_create_expense' })
const zeroHint = () => screen.queryByText('finance_store_expense_not_positive_hint')
// Escolhe a conta, testa 'Gerar despesa' de ida e volta pelo custo zero e
// deixa o custo em 10 com a caixa desmarcada.
const expenseFollowsTotal = (unitCost: HTMLInputElement) => {
  fireEvent.change(screen.getAllByRole('combobox').find(s => s.querySelector('option[value="acc"]'))!, { target: { value: 'acc' } })
  expect(expenseBox().disabled).toBe(true)
  expect(expenseBox().checked).toBe(false)
  expect(zeroHint()).not.toBeNull()
  fireEvent.change(unitCost, { target: { value: '10' } })
  expect(expenseBox().disabled).toBe(false)
  expect(zeroHint()).toBeNull()
  fireEvent.click(expenseBox())
  expect(expenseBox().checked).toBe(true)
  fireEvent.change(unitCost, { target: { value: '0' } })
  expect(expenseBox().checked).toBe(false)
  expect(expenseBox().disabled).toBe(true)
  expect(zeroHint()).not.toBeNull()
  // Voltar a um total positivo religa, mas não marca sozinho.
  fireEvent.change(unitCost, { target: { value: '10' } })
  expect(expenseBox().checked).toBe(false)
}
const saveButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'finance_save' })
// Escolhe "fornecedor novo" e digita o nome.
const typeNewSupplier = () => {
  fireEvent.change(screen.getAllByRole('combobox').find(s => s.querySelector('option[value="__new"]'))!, { target: { value: '__new' } })
  fireEvent.change(screen.getByPlaceholderText('finance_store_supplier_name_placeholder'), { target: { value: 'Loja X' } })
}
// O 1º createSupplier devolve f1; um 2º devolveria f2 (o fornecedor duplicado).
const supplierOnce = () => vi.fn<FinanceStoreStore['createSupplier']>()
  .mockResolvedValueOnce(supplier('f1'))
  .mockResolvedValue(supplier('f2'))

describe('PurchaseModal', () => {
  it('outros custos negativos: Salvar desligado, com o aviso; nada vai ao banco', async () => {
    const store = fakeStore()
    render(<PurchaseModal store={store} product={product()} accounts={[]} categories={[]} onClose={() => {}} />)
    const [, unitCost, otherCosts] = numberInputs()
    fireEvent.change(unitCost, { target: { value: '10' } })
    fireEvent.change(otherCosts, { target: { value: '-2' } })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('finance_store_error_negative')
    await userEvent.setup().click(saveButton())
    expect(store.createPurchase).not.toHaveBeenCalled()
    // Voltando a um valor válido, o Salvar religa.
    fireEvent.change(otherCosts, { target: { value: '2' } })
    expect(saveButton().disabled).toBe(false)
  })

  it('compra nova recusada: o modal fica aberto com o motivo; aceita, fecha', async () => {
    const refused = fakeStore({ createPurchase: vi.fn(() => Promise.resolve(null)), error: 'Valores em dinheiro não podem ser negativos.' })
    const onClose = vi.fn()
    const { unmount } = render(<PurchaseModal store={refused} product={product()} accounts={[]} categories={[]} onClose={onClose} />)
    await userEvent.setup().click(saveButton())
    expect(refused.createPurchase).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('Valores em dinheiro não podem ser negativos.')
    unmount()
    const store = fakeStore()
    const onClose2 = vi.fn()
    render(<PurchaseModal store={store} product={product()} accounts={[]} categories={[]} onClose={onClose2} />)
    await userEvent.setup().click(saveButton())
    expect(onClose2).toHaveBeenCalledTimes(1)
  })

  it('fornecedor novo e compra recusada: salvar de novo não recria o fornecedor e vai com o id criado', async () => {
    const createSupplier = supplierOnce()
    const createPurchase = vi.fn<FinanceStoreStore['createPurchase']>(() => Promise.resolve(null))
    const store = fakeStore({ createSupplier, createPurchase, error: 'motivo' })
    const onClose = vi.fn()
    render(<PurchaseModal store={store} product={product()} accounts={[]} categories={[]} onClose={onClose} />)
    typeNewSupplier()
    await userEvent.setup().click(saveButton())
    expect(createSupplier).toHaveBeenCalledWith('Loja X')
    expect(createPurchase.mock.calls[0][0]).toMatchObject({ supplier_id: 'f1' })
    expect(onClose).not.toHaveBeenCalled()
    createPurchase.mockResolvedValueOnce(purchase({ id: 'novo', supplier_id: 'f1' }))
    await userEvent.setup().click(saveButton())
    expect(createSupplier).toHaveBeenCalledTimes(1)
    expect(createPurchase).toHaveBeenCalledTimes(2)
    expect(createPurchase.mock.calls[1][0]).toMatchObject({ supplier_id: 'f1' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('total zero: "Gerar despesa" desliga e desmarca, com a dica', async () => {
    const store = fakeStore()
    render(<PurchaseModal store={store} product={product()} accounts={accounts} categories={[]} onClose={() => {}} />)
    const [, unitCost] = numberInputs()
    expenseFollowsTotal(unitCost)
    fireEvent.change(unitCost, { target: { value: '0' } })
    await userEvent.setup().click(saveButton())
    expect(vi.mocked(store.createPurchase).mock.calls[0][1]).toMatchObject({ createTransaction: false })
  })

  it('edição recusada: fica aberto; aceita, fecha', async () => {
    const refused = fakeStore({ updatePurchase: vi.fn(() => Promise.resolve(false)), error: 'motivo' })
    const onClose = vi.fn()
    const { unmount } = render(<PurchaseModal store={refused} product={product()} purchase={purchase()} accounts={[]} categories={[]} onClose={onClose} />)
    await userEvent.setup().click(saveButton())
    expect(refused.updatePurchase).toHaveBeenCalledWith('pu1', expect.objectContaining({ unit_cost: 10_000 }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('motivo')
    unmount()
    const onClose2 = vi.fn()
    render(<PurchaseModal store={fakeStore()} product={product()} purchase={purchase()} accounts={[]} categories={[]} onClose={onClose2} />)
    await userEvent.setup().click(saveButton())
    expect(onClose2).toHaveBeenCalledTimes(1)
  })
})

describe('ProductModal', () => {
  const typeName = () => fireEvent.change(screen.getByPlaceholderText('finance_store_product_placeholder'), { target: { value: 'GPU' } })

  it('preço-alvo ou custo da compra inicial negativos: Salvar desligado, com o aviso', () => {
    render(<ProductModal store={fakeStore()} accounts={[]} onClose={() => {}} />)
    typeName()
    const [targetPrice, unitCost] = numberInputs()
    fireEvent.change(targetPrice, { target: { value: '-1' } })
    expect(saveButton().disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toBe('finance_store_error_negative')
    fireEvent.change(targetPrice, { target: { value: '1' } })
    fireEvent.change(unitCost, { target: { value: '-5' } })
    expect(saveButton().disabled).toBe(true)
    fireEvent.change(unitCost, { target: { value: '5' } })
    expect(saveButton().disabled).toBe(false)
  })

  it('total zero na compra inicial: "Gerar despesa" desliga e desmarca, com a dica', async () => {
    const store = fakeStore()
    render(<ProductModal store={store} accounts={accounts} onClose={() => {}} />)
    typeName()
    const [, unitCost] = numberInputs()
    expenseFollowsTotal(unitCost)
    fireEvent.change(unitCost, { target: { value: '' } })
    await userEvent.setup().click(saveButton())
    expect(vi.mocked(store.createPurchase).mock.calls[0][1]).toMatchObject({ createTransaction: false })
  })

  it('compra inicial recusada: fica aberto, avisa que o produto está sem estoque, e salvar de novo regrava só a compra', async () => {
    const createPurchase = vi.fn<FinanceStoreStore['createPurchase']>(() => Promise.resolve(null))
    const store = fakeStore({ createPurchase, error: 'Valores em dinheiro não podem ser negativos.' })
    const onClose = vi.fn()
    render(<ProductModal store={store} accounts={[]} onClose={onClose} />)
    typeName()
    await userEvent.setup().click(saveButton())
    expect(store.createProduct).toHaveBeenCalledTimes(1)
    expect(createPurchase.mock.calls[0][0]).toMatchObject({ product_id: 'criado', status: 'received' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('finance_store_product_saved_no_stock Valores em dinheiro não podem ser negativos.')
    // De novo: o produto já existe (atualiza, não cria outro) e a compra vai.
    createPurchase.mockResolvedValueOnce(purchase({ id: 'novo', product_id: 'criado' }))
    await userEvent.setup().click(saveButton())
    expect(store.createProduct).toHaveBeenCalledTimes(1)
    expect(store.updateProduct).toHaveBeenCalledWith('criado', expect.objectContaining({ name: 'GPU' }))
    expect(createPurchase).toHaveBeenCalledTimes(2)
    expect(createPurchase.mock.calls[1][0]).toMatchObject({ product_id: 'criado' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fornecedor novo e compra inicial recusada: salvar de novo não recria o fornecedor e vai com o id criado', async () => {
    const createSupplier = supplierOnce()
    const createPurchase = vi.fn<FinanceStoreStore['createPurchase']>(() => Promise.resolve(null))
    const store = fakeStore({ createSupplier, createPurchase, error: 'motivo' })
    const onClose = vi.fn()
    render(<ProductModal store={store} accounts={[]} onClose={onClose} />)
    typeName()
    typeNewSupplier()
    await userEvent.setup().click(saveButton())
    expect(createSupplier).toHaveBeenCalledWith('Loja X')
    expect(createPurchase.mock.calls[0][0]).toMatchObject({ product_id: 'criado', supplier_id: 'f1' })
    expect(onClose).not.toHaveBeenCalled()
    createPurchase.mockResolvedValueOnce(purchase({ id: 'novo', product_id: 'criado', supplier_id: 'f1' }))
    await userEvent.setup().click(saveButton())
    expect(store.createProduct).toHaveBeenCalledTimes(1)
    expect(createSupplier).toHaveBeenCalledTimes(1)
    expect(createPurchase).toHaveBeenCalledTimes(2)
    expect(createPurchase.mock.calls[1][0]).toMatchObject({ product_id: 'criado', supplier_id: 'f1' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('produto novo recusado: fica aberto e não tenta a compra', async () => {
    const store = fakeStore({ createProduct: vi.fn(() => Promise.resolve(null)), error: 'motivo' })
    const onClose = vi.fn()
    render(<ProductModal store={store} accounts={[]} onClose={onClose} />)
    typeName()
    await userEvent.setup().click(saveButton())
    expect(store.createPurchase).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('motivo')
  })

  it('edição e arquivamento recusados: fica aberto; aceitos, fecha', async () => {
    const refused = fakeStore({ updateProduct: vi.fn(() => Promise.resolve(false)), error: 'motivo' })
    const onClose = vi.fn()
    const { unmount } = render(<ProductModal store={refused} product={product()} accounts={[]} onClose={onClose} />)
    await userEvent.setup().click(saveButton())
    await userEvent.setup().click(screen.getByRole('button', { name: 'finance_store_archive' }))
    expect(refused.updateProduct).toHaveBeenCalledTimes(2)
    expect(vi.mocked(refused.updateProduct).mock.calls[1]).toEqual(['p1', { archived: true }])
    expect(onClose).not.toHaveBeenCalled()
    unmount()
    const onClose2 = vi.fn()
    render(<ProductModal store={fakeStore()} product={product()} accounts={[]} onClose={onClose2} />)
    await userEvent.setup().click(saveButton())
    expect(onClose2).toHaveBeenCalledTimes(1)
  })
})
