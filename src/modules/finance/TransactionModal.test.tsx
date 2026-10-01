// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent } from '../../test/rtl'
import type { FinanceAccount, FinanceCategory } from '../../types'
import { FinanceMobileContext } from './ui/mobileContext'

// QA-003: o formulário de lançamento financeiro, nos dois layouts (Drawer no
// desktop, chips no celular). Valores vão em centavos, sem valor não salva, e
// erro ao salvar mantém o formulário aberto com o aviso.
//
// O valor é preenchido com change direto: o user-event no happy-dom perde a
// vírgula de um input controlado que filtra caracteres (no navegador de
// verdade funciona; o E2E cobre a digitação). No desktop o campo é
// type="number" (o navegador entrega "12.34"); no celular é texto filtrado,
// que aceita o formato brasileiro.

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

import { TransactionModal } from './modals/TransactionModal'

const CREATED = '2026-01-01T00:00:00Z'
const category = (id: string, name: string, type: 'income' | 'expense'): FinanceCategory =>
  ({ id, user_id: 'u1', name, color: '#6366f1', icon: '🏷️', type, is_default: false, created_at: CREATED })
const account: FinanceAccount = { id: 'acc1', user_id: 'u1', name: 'Conta', type: 'checking', initial_balance: 0, color: '#10b981', icon: '🏦', created_at: CREATED }

function setup({ mobile = false } = {}) {
  const onSave = vi.fn<(data: unknown) => Promise<void>>().mockResolvedValue()
  const onClose = vi.fn()
  render(
    <FinanceMobileContext.Provider value={mobile}>
      <TransactionModal
        personalAccounts={[account]} familyAccounts={[]}
        personalCategories={[category('food', 'Mercado', 'expense'), category('salary', 'Salário', 'income')]}
        familyCategories={[]} partners={[]} userId="u1" workspace={null}
        onClose={onClose} onSave={onSave}
      />
    </FinanceMobileContext.Provider>,
  )
  const amount = screen.getByLabelText<HTMLInputElement>('finance_tx_amount')
  const setAmount = (value: string) => fireEvent.change(amount, { target: { value } })
  return { onSave, onClose, amount, setAmount, user: userEvent.setup() }
}

describe('TransactionModal (desktop)', () => {
  it('salva a despesa em centavos, com descrição aparada e sem conta/categoria', async () => {
    const { onSave, onClose, setAmount, user } = setup()
    setAmount('12.34')
    await user.type(screen.getByLabelText('finance_tx_description'), '  Padaria  ')
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      type: 'expense', amount: 1234, description: 'Padaria',
      account_id: null, category_id: null, shared_with_user_id: null, workspace_id: null, photo_url: null,
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('sem valor (ou zero), não salva', async () => {
    const { onSave, setAmount, user } = setup()
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    setAmount('0')
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('receita lista só as categorias de receita e salva a escolhida, com a conta', async () => {
    const { onSave, setAmount, user } = setup()
    await user.click(screen.getByRole('button', { name: 'finance_tx_income' }))
    const categorySelect = screen.getByLabelText('finance_tx_category')
    expect([...categorySelect.querySelectorAll('option')].map(o => o.value)).toEqual(['', 'salary'])
    await user.selectOptions(categorySelect, 'salary')
    await user.selectOptions(screen.getByLabelText('finance_tx_account'), 'acc1')
    setAmount('3500')
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'income', amount: 350_000, category_id: 'salary', account_id: 'acc1' }))
  })

  it('erro ao salvar mantém o formulário aberto e avisa', async () => {
    const { onSave, onClose, setAmount, user } = setup()
    onSave.mockRejectedValue(new Error('permission denied'))
    setAmount('10')
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    expect(await screen.findByText('finance_save_error')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('TransactionModal (celular)', () => {
  it('o valor guarda só número, vírgula e ponto (milhar brasileiro vira centavos certos)', async () => {
    const { onSave, amount, setAmount, user } = setup({ mobile: true })
    setAmount('R$ 1.234,50')
    expect(amount.value).toBe('1.234,50')
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ amount: 123_450 }))
  })

  it('o valor tem nome acessível e a categoria sai dos chips', async () => {
    const { onSave, setAmount, user } = setup({ mobile: true })
    await user.click(screen.getByRole('button', { name: /Mercado/ }))
    setAmount('7,5')
    await user.click(screen.getByRole('button', { name: 'finance_save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: 'expense', amount: 750, category_id: 'food' }))
  })
})
