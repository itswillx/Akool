// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LOCAL_KEYS } from '../../lib/localKeys'
import { render, screen, userEvent, waitFor } from '../../test/rtl'

// ARCH-001: o painel inteiro monta depois da divisão em hooks e arquivos —
// carga (useFinanceData), navegação, modais e ações ligados. Supabase falso,
// tudo vazio; o que importa é nenhuma aba ou modal quebrar.

vi.mock('../../lib/supabase', () => {
  const result = { data: [], error: null, count: 0 }
  const builder: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'gte', 'lt', 'lte', 'gt', 'order', 'range', 'limit', 'insert', 'update', 'delete', 'upsert', 'overrideTypes']) {
    builder[m] = () => builder
  }
  builder.single = () => Promise.resolve({ data: null, error: null })
  builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return {
    supabase: {
      from: () => builder,
      rpc: () => Promise.resolve({ data: null, error: null }),
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
vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import FinancePanel from './FinancePanel'

beforeEach(() => { localStorage.clear() })

describe('FinancePanel (montagem completa)', () => {
  it('carrega, passa por todas as abas e abre o lançamento', async () => {
    const user = userEvent.setup()
    render(<FinancePanel />)
    await waitFor(() => expect(screen.getAllByText('finance_tab_overview').length).toBeGreaterThan(0))

    for (const tab of ['transactions', 'budgets', 'accounts', 'categories', 'recurring', 'overview']) {
      await user.click(screen.getAllByRole('button', { name: `finance_tab_${tab}` })[0])
      await waitFor(() => expect(localStorage.getItem(LOCAL_KEYS.financeTab)).toBe(tab))
    }

    await user.click(screen.getAllByRole('button', { name: /finance_new_transaction/ })[0])
    expect(await screen.findByRole('button', { name: 'finance_save' })).toBeTruthy()
  })
})
