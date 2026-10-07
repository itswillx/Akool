// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '../../test/rtl'
import type { FinanceGoal, FinanceGoalContribution, FinanceGoalShare } from '../../types'
import type { useFinanceData } from './useFinanceData'
import type { useFinanceModals } from './useFinanceModals'

// API-012: o aporte vai pela RPC atômica (o servidor conclui a meta) e o share
// repetido não faz nada (sem UPDATE de share no banco).

const db = vi.hoisted(() => {
  const calls: unknown[][] = []
  const state = { rpc: { data: null as unknown, error: null as unknown }, share: { data: null as unknown, error: null as unknown } }
  return { calls, state }
})

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      db.calls.push(['rpc', name, args])
      return Promise.resolve(db.state.rpc)
    },
    from: (table: string) => ({
      upsert: (values: unknown, opts: unknown) => {
        db.calls.push(['upsert', table, values, opts])
        return { select: () => ({ maybeSingle: () => Promise.resolve(db.state.share) }) }
      },
    }),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'eu' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ lang: 'pt-BR', t: (k: string) => k }) }))

const { useFinanceActions } = await import('./useFinanceActions')

const setGoals = vi.fn()
const setContributions = vi.fn()
const setGoalShares = vi.fn()
const setPartnerProfiles = vi.fn()
const resolvePartnerProfile = vi.fn(() => Promise.resolve(null))

function renderActions() {
  const data = { partnerProfiles: [], setGoals, setContributions, setGoalShares, setPartnerProfiles, resolvePartnerProfile } as unknown as ReturnType<typeof useFinanceData>
  const modals = {} as unknown as ReturnType<typeof useFinanceModals>
  return renderHook(() => useFinanceActions({ data, modals })).result.current
}

const goal = (id: string, status: FinanceGoal['status']): FinanceGoal => ({
  id, user_id: 'dono', name: id, icon: '🎯', color: '#6366f1', target_amount: 1000, deadline: '2026-12-31', account_id: null, status, created_at: '',
})

beforeEach(() => {
  vi.clearAllMocks()
  db.calls.length = 0
  db.state.rpc = { data: null, error: null }
  db.state.share = { data: null, error: null }
})

describe('saveContribution', () => {
  it('chama a RPC atômica e aplica o status que o servidor devolveu', async () => {
    db.state.rpc = { data: { contribution_id: 'c1', status: 'completed', total_cents: 1000 }, error: null }
    await renderActions().saveContribution({ goal_id: 'g1', amount: 900, note: 'chegou', date: '2026-10-07' })

    expect(db.calls).toEqual([['rpc', 'finance_goal_contribute', { p_goal: 'g1', p_amount_cents: 900, p_date: '2026-10-07', p_note: 'chegou' }]])
    const added = (setContributions.mock.calls[0][0] as (prev: FinanceGoalContribution[]) => FinanceGoalContribution[])([])
    expect(added[0]).toMatchObject({ id: 'c1', goal_id: 'g1', user_id: 'eu', amount: 900, note: 'chegou', date: '2026-10-07' })
    const goals = (setGoals.mock.calls[0][0] as (prev: FinanceGoal[]) => FinanceGoal[])([goal('g1', 'active'), goal('g2', 'active')])
    expect(goals.map(g => g.status)).toEqual(['completed', 'active'])
  })

  it('erro do servidor sobe (o modal mostra e fica aberto)', async () => {
    db.state.rpc = { data: null, error: { code: 'P0002', message: 'Meta não encontrada' } }
    await expect(renderActions().saveContribution({ goal_id: 'g1', amount: 10, note: '', date: '2026-10-07' })).rejects.toMatchObject({ code: 'P0002' })
    expect(setContributions).not.toHaveBeenCalled()
  })
})

describe('saveGoalShare', () => {
  it('insere sem UPDATE (ignoreDuplicates) e guarda o share novo', async () => {
    const row: FinanceGoalShare = { id: 's1', goal_id: 'g1', owner_id: 'eu', shared_with_user_id: 'bia', created_at: null }
    db.state.share = { data: row, error: null }
    await renderActions().saveGoalShare('g1', 'bia')
    expect(db.calls).toEqual([['upsert', 'finance_goal_shares', { goal_id: 'g1', owner_id: 'eu', shared_with_user_id: 'bia' }, { onConflict: 'goal_id,shared_with_user_id', ignoreDuplicates: true }]])
    expect((setGoalShares.mock.calls[0][0] as (prev: FinanceGoalShare[]) => FinanceGoalShare[])([])).toEqual([{ ...row, profile: undefined }])
  })

  it('share repetido não volta linha e não muda nada', async () => {
    await renderActions().saveGoalShare('g1', 'bia')
    expect(setGoalShares).not.toHaveBeenCalled()
  })

  it('erro do servidor sobe', async () => {
    db.state.share = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }
    await expect(renderActions().saveGoalShare('alheia', 'bia')).rejects.toMatchObject({ code: '42501' })
  })
})
