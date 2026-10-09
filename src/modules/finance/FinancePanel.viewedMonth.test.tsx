// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent, waitFor } from '../../test/rtl'
import { currentYM, nextMonth } from './financeFormat'

// API-016: o app antigo criava, no navegador, o orçamento automático do mês
// aberto na tela. Agora o servidor cria os do mês atual e do seguinte; ao ver
// outro mês, a tela pede os orçamentos dele (p_month) e mostra o que voltou.
// O servidor falso devolve, como o de verdade, os orçamentos dos meses
// tratados: o de p_today, o seguinte e o de p_month.

const db = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  /** p_today em que a chamada sem p_month (a da janela) falha. */
  failWindowOn: null as string | null,
}))

vi.mock('../../lib/supabase', () => {
  const tables: Record<string, unknown[]> = {
    finance_categories: [{ id: 'c1', user_id: 'u1', name: 'Moradia', type: 'expense', icon: '🏠', color: null, workspace_id: null }],
    finance_recurring: [{
      id: 'r1', user_id: 'u1', type: 'expense', description: 'Aluguel', amount: 8000, is_variable: false, category_id: 'c1',
      account_id: null, day_of_month: 10, active: true, total_installments: null, workspace_id: null, created_at: '2026-01-01T12:00:00Z',
    }],
  }
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gte', 'lt', 'lte', 'gt', 'order', 'range', 'limit', 'insert', 'update', 'delete', 'upsert', 'overrideTypes']) {
      b[m] = () => b
    }
    b.single = () => Promise.resolve({ data: null, error: null })
    b.maybeSingle = () => Promise.resolve({ data: null, error: null })
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: tables[table] ?? [], error: null, count: 0 }).then(resolve, reject)
    return b
  }
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string, args: Record<string, unknown> = {}) => {
        db.calls.push({ name, args })
        if (name === 'finance_materialize_recurring' && args.p_today === db.failWindowOn && typeof args.p_month !== 'string') {
          return Promise.resolve({ data: null, error: { code: '08006', message: 'rede' } })
        }
        if (name === 'finance_materialize_recurring') {
          const [y, m] = String(args.p_today).split('-').map(Number)
          const months = [`${y}-${String(m).padStart(2, '0')}`, m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`]
          if (typeof args.p_month === 'string' && !months.includes(args.p_month.slice(0, 7))) months.push(args.p_month.slice(0, 7))
          return Promise.resolve({
            data: {
              entries: [],
              budgets: months.map(month => ({ id: `b-${month}`, user_id: 'u1', category_id: 'c1', month, amount_limit: 8000, shared_with_user_id: null, workspace_id: null, created_at: '' })),
            },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: null }) }) },
    },
  }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'eu@example.com' }, profile: { id: 'u1', email: 'eu@example.com', display_name: 'Eu', finance_dashboard_view: 'simple' } }),
}))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../contexts/OnboardingContext', () => ({ useOnboarding: () => ({ activeTour: null, showTour: false, seen: () => true, startTour: () => {}, finishTour: () => {} }) }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import FinancePanel from './FinancePanel'

beforeEach(() => {
  localStorage.clear()
  db.calls.length = 0
  db.failWindowOn = null
})
afterEach(() => { vi.useRealTimers() })

const materializeCalls = () => db.calls.filter(c => c.name === 'finance_materialize_recurring').map(c => c.args)
const viewedMonthCalls = () => db.calls.filter(c => c.name === 'finance_materialize_recurring' && 'p_month' in c.args)

describe('FinancePanel: orçamentos automáticos do mês visto (API-016)', () => {
  it('navegar para mês+3 pede os orçamentos desse mês e mostra o que voltou', async () => {
    const user = userEvent.setup()
    render(<FinancePanel />)
    await waitFor(() => expect(screen.getAllByText('finance_tab_overview').length).toBeGreaterThan(0))
    await user.click(screen.getAllByRole('button', { name: 'finance_tab_budgets' })[0])

    // A carga e o mês atual e o seguinte são do servidor sozinho: nada de p_month.
    const plus1 = nextMonth(currentYM())
    await user.click(screen.getByRole('button', { name: 'finance_next_month' }))
    expect(viewedMonthCalls()).toEqual([])

    const plus3 = nextMonth(nextMonth(plus1))
    await user.click(screen.getByRole('button', { name: 'finance_next_month' }))
    await user.click(screen.getByRole('button', { name: 'finance_next_month' }))

    await waitFor(() => expect(viewedMonthCalls().map(c => c.args.p_month)).toContain(`${plus3}-01`))
    expect(await screen.findByText('Moradia')).toBeTruthy()
    expect(screen.queryByText('finance_no_budgets')).toBeNull()
  })
})

// A tela aberta na véspera da virada (31/10 23:50) e usada no dia seguinte. A
// carga de 31/10 trouxe out e nov; o de dezembro só existe no servidor (o cron
// das 00:05 de 01/11). Medido contra o relógio, dezembro seria "o seguinte" e
// a tela não pediria nada até recarregar.
describe('FinancePanel: virada do mês com a tela aberta (API-016)', () => {
  async function openBudgetsOn31Oct() {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(2026, 9, 31, 23, 50))
    const user = userEvent.setup()
    render(<FinancePanel />)
    await waitFor(() => expect(screen.getAllByText('finance_tab_overview').length).toBeGreaterThan(0))
    await user.click(screen.getAllByRole('button', { name: 'finance_tab_budgets' })[0])
    expect(materializeCalls()).toEqual([{ p_today: '2026-10-31' }])
    return user
  }

  it('trocar de mês depois da virada materializa a janela nova (sem p_month) e dezembro aparece', async () => {
    const user = await openBudgetsOn31Oct()
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0))

    await user.click(screen.getByRole('button', { name: 'finance_next_month' })) // nov
    await waitFor(() => expect(materializeCalls()).toContainEqual({ p_today: '2026-11-01' }))
    await user.click(screen.getByRole('button', { name: 'finance_next_month' })) // dez

    expect(await screen.findByText('Moradia')).toBeTruthy()
    expect(screen.queryByText('finance_no_budgets')).toBeNull()
    // Dezembro já veio na janela nova: é o seguinte do mês materializado, sem p_month.
    expect(viewedMonthCalls()).toEqual([])
  })

  it('o foco depois da virada materializa a janela nova sem trocar de mês; antes dela, não', async () => {
    const user = await openBudgetsOn31Oct()

    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(materializeCalls()).toEqual([{ p_today: '2026-10-31' }])

    vi.setSystemTime(new Date(2026, 10, 1, 9, 0))
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    // A janela nova sem p_month; outubro, ainda na tela, virou o mês anterior
    // e pede os dele, como numa carga feita em 01/11.
    const afterTurn = [{ p_today: '2026-10-31' }, { p_today: '2026-11-01' }, { p_today: '2026-11-01', p_month: '2026-10-01' }]
    await waitFor(() => expect(materializeCalls()).toEqual(afterTurn))

    await user.click(screen.getByRole('button', { name: 'finance_next_month' })) // nov
    await user.click(screen.getByRole('button', { name: 'finance_next_month' })) // dez
    expect(await screen.findByText('Moradia')).toBeTruthy()
    expect(screen.queryByText('finance_no_budgets')).toBeNull()
    expect(materializeCalls()).toEqual(afterTurn)
  })

  it('se a janela nova falha na virada, dezembro conta como fora da janela materializada e pede os dele', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.failWindowOn = '2026-11-01'
    const user = await openBudgetsOn31Oct()
    vi.setSystemTime(new Date(2026, 10, 1, 9, 0))

    await user.click(screen.getByRole('button', { name: 'finance_next_month' })) // nov
    await user.click(screen.getByRole('button', { name: 'finance_next_month' })) // dez

    await waitFor(() => expect(viewedMonthCalls().map(c => c.args)).toContainEqual({ p_today: '2026-11-01', p_month: '2026-12-01' }))
    expect(await screen.findByText('Moradia')).toBeTruthy()
    expect(screen.queryByText('finance_no_budgets')).toBeNull()
  })
})
