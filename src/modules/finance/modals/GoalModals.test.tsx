// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent } from '../../../test/rtl'
import type { FinanceGoal } from '../../../types'

// API-012: a RPC finance_goal_contribute recusa nota acima de 500 caracteres
// (22023, hint 'akool'). O campo já limita a 500 e, se o servidor recusar uma
// regra, o modal mostra a mensagem dele em vez do erro genérico.

vi.mock('../../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../../i18n/LanguageContext', () => ({
  useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => (k === 'finance_rule_error' ? 'recusado: {message}' : k) }),
}))
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))

const { ContributionModal } = await import('./GoalModals')

const goal: FinanceGoal = {
  id: 'g1', user_id: 'eu', name: 'Viagem', icon: '🎯', color: '#6366f1', target_amount: 100000,
  deadline: '2026-12-31', account_id: null, status: 'active', created_at: '2026-10-01T00:00:00Z',
}

function setup(onSave: (data: unknown) => Promise<void>) {
  const onClose = vi.fn()
  render(<ContributionModal goal={goal} onClose={onClose} onSave={onSave} />)
  // Valor com change direto (ver TransactionModal.test.tsx: o happy-dom perde caracteres no type).
  fireEvent.change(screen.getByLabelText('finance_goal_contribution_amount'), { target: { value: '10' } })
  return { onClose, user: userEvent.setup() }
}

describe('ContributionModal', () => {
  it('a nota aceita no máximo 500 caracteres', () => {
    setup(() => Promise.resolve())
    expect(screen.getByLabelText<HTMLInputElement>('finance_goal_contribution_note').maxLength).toBe(500)
  })

  it('regra recusada pelo servidor (hint akool) mostra a mensagem dele e mantém o modal aberto', async () => {
    const { onClose, user } = setup(() => Promise.reject(Object.assign(new Error('A nota passa de 500 caracteres'), { code: '22023', hint: 'akool' })))
    await user.click(screen.getByRole('button', { name: 'finance_save' }))

    expect(await screen.findByText('recusado: A nota passa de 500 caracteres')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('outro erro continua no aviso genérico', async () => {
    const { onClose, user } = setup(() => Promise.reject(Object.assign(new Error('permission denied'), { code: '42501' })))
    await user.click(screen.getByRole('button', { name: 'finance_save' }))

    expect(await screen.findByText('finance_save_error')).toBeTruthy()
    expect(screen.queryByText(/permission denied/)).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
