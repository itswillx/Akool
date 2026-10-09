// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '../../../test/rtl'
import type { FinanceRecurring, FinanceRecurringEntry } from '../../../types'

// API-016: o selo do mês vem do vencimento do lançamento (o mesmo que a Visão
// geral usa), não do dia atual do recorrente, e "Quitado" conta pagas e
// puladas, como o encerramento no servidor.

vi.mock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { RecurringTab } = await import('./RecurringTab')

const rec = (extra: Partial<FinanceRecurring> = {}): FinanceRecurring => ({
  id: 'r1', user_id: 'eu', type: 'expense', description: 'Aluguel', amount: 5000, is_variable: false,
  category_id: null, account_id: null, day_of_month: 20, active: true, total_installments: null,
  workspace_id: null, created_at: '2026-01-01T00:00:00Z', ...extra,
})

const entry = (id: string, due_date: string, status: FinanceRecurringEntry['status'] = 'pending'): FinanceRecurringEntry => ({
  id, user_id: 'eu', recurring_id: 'r1', due_date, status, amount: null, transaction_id: null, created_at: '',
})

function renderTab(recurring: FinanceRecurring[], entries: FinanceRecurringEntry[]) {
  const noop = () => {}
  return render(
    <RecurringTab recurring={recurring} recurringEntries={entries} categories={[]} month="2026-10"
      onAdd={noop} onEdit={noop} onMarkPaid={noop} onSkip={noop} />,
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T12:00:00'))
})
afterEach(() => { vi.useRealTimers() })

describe('RecurringTab: selo do mês', () => {
  it('pendente do dia 10 com o recorrente já no dia 20: atrasado (pela data do lançamento)', () => {
    renderTab([rec()], [entry('e1', '2026-10-10')])
    expect(screen.getByText('finance_entry_overdue')).toBeTruthy()
    expect(screen.queryByText('finance_entry_pending')).toBeNull()
  })

  it('pendente com vencimento à frente: pendente', () => {
    renderTab([rec({ day_of_month: 5 })], [entry('e1', '2026-10-25')])
    expect(screen.getByText('finance_entry_pending')).toBeTruthy()
  })
})

describe('RecurringTab: parcelas', () => {
  it('3 parcelas com 2 pagas e 1 pulada: Quitado', () => {
    renderTab(
      [rec({ total_installments: 3, active: false })],
      [entry('e1', '2026-08-20', 'paid'), entry('e2', '2026-09-20', 'skipped'), entry('e3', '2026-10-20', 'paid')],
    )
    expect(screen.getByText('finance_recurring_installments_done')).toBeTruthy()
    expect(screen.queryByText('finance_recurring_inactive')).toBeNull()
  })

  it('3 parcelas com 1 paga e 1 pulada: ainda não quitado', () => {
    renderTab(
      [rec({ total_installments: 3 })],
      [entry('e1', '2026-08-20', 'paid'), entry('e2', '2026-09-20', 'skipped'), entry('e3', '2026-10-20')],
    )
    expect(screen.queryByText('finance_recurring_installments_done')).toBeNull()
    expect(screen.getByText('finance_recurring_installment_badge')).toBeTruthy()
  })
})
