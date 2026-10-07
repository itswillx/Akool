// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { CheckCircle2, ChevronDown, Pencil, Target, Trash2, Users, XCircle } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { localeOf } from '../../../i18n/translations'
import {
sumByGoal
} from '../../../lib/financeCalc'
import type { FinanceAccount, FinanceGoal, FinanceGoalContribution, FinanceGoalShare } from '../../../types'
import { daysUntil, fmt } from '../financeFormat'
import {
FIN_POS,
FIN_POS_SOFT
} from '../ui'
import type { PartnerProfile } from '../useFinanceData'

// ─── Goals Tab ────────────────────────────────────────────────────────────────

export function GoalsTab({ userId, goals, contributions, accounts, goalShares, incomingGoalShares, partnerProfiles, onNewGoal, onEditGoal, onDeleteGoal, onAddContribution, onDeleteContribution, onUpdateStatus, onShareGoal }: {
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  accounts: FinanceAccount[]
  goalShares: FinanceGoalShare[]
  incomingGoalShares: FinanceGoalShare[]
  /** Quem está logado: só o dono da meta compartilha, edita, muda o status e exclui. */
  userId: string | undefined
  partnerProfiles: PartnerProfile[]
  onNewGoal: () => void
  onEditGoal: (g: FinanceGoal) => void
  onDeleteGoal: (id: string) => Promise<void>
  onAddContribution: (g: FinanceGoal) => void
  onDeleteContribution: (id: string) => Promise<void>
  onUpdateStatus: (id: string, status: FinanceGoal['status']) => Promise<void>
  onShareGoal: (g: FinanceGoal) => void
}) {
  const { t, lang } = useLanguage()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null)
  const [confirmDeleteContrib, setConfirmDeleteContrib] = useState<string | null>(null)

  const accMap = new Map(accounts.map(a => [a.id, a]))
  const profileMap = new Map(partnerProfiles.map(p => [p.id, p]))
  const sharerMap = new Map(incomingGoalShares.map(s => [s.goal_id, profileMap.get(s.owner_id)]))

  // PERF-005: aportes indexados por meta uma vez (antes, dois filtros da lista
  // inteira por meta a cada render).
  const { contribsByGoal, accumulatedByGoal } = useMemo(() => {
    const contribsByGoal = new Map<string, FinanceGoalContribution[]>()
    for (const c of contributions) {
      const list = contribsByGoal.get(c.goal_id)
      if (list) list.push(c)
      else contribsByGoal.set(c.goal_id, [c])
    }
    for (const list of contribsByGoal.values()) list.sort((a, b) => b.date.localeCompare(a.date))
    return { contribsByGoal, accumulatedByGoal: sumByGoal(contributions) }
  }, [contributions])
  const getContributions = (goalId: string) => contribsByGoal.get(goalId) ?? []
  const getAccumulated = (goalId: string) => accumulatedByGoal.get(goalId) ?? 0

  const getEffectiveStatus = (goal: FinanceGoal): 'active' | 'completed' | 'cancelled' | 'overdue' => {
    if (goal.status === 'completed') return 'completed'
    if (goal.status === 'cancelled') return 'cancelled'
    const days = daysUntil(goal.deadline)
    if (days < 0) return 'overdue'
    return 'active'
  }

  const statusBadge = (status: ReturnType<typeof getEffectiveStatus>) => {
    const configs = {
      completed: { bg: FIN_POS_SOFT, color: FIN_POS, label: t('finance_goal_status_completed') },
      cancelled:  { bg: '#6b728022', color: '#6b7280', label: t('finance_goal_status_cancelled') },
      overdue:    { bg: '#ef444422', color: '#ef4444', label: t('finance_goal_status_overdue') },
      active:     { bg: 'var(--color-active)', color: 'var(--color-text)', label: t('finance_goal_status_active') },
    }
    const c = configs[status]
    return (
      <span style={{ fontSize: 11, fontWeight: 700, backgroundColor: c.bg, color: c.color, padding: '2px 8px', borderRadius: 10 }}>
        {c.label}
      </span>
    )
  }

  const deadlineLabel = (goal: FinanceGoal, status: ReturnType<typeof getEffectiveStatus>) => {
    if (status === 'completed' || status === 'cancelled') {
      return new Date(goal.deadline + 'T00:00:00').toLocaleDateString(localeOf(lang))
    }
    const days = Math.abs(daysUntil(goal.deadline))
    const raw = daysUntil(goal.deadline)
    if (raw < 0) {
      return <span style={{ color: '#ef4444', fontWeight: 600 }}>{days === 1 ? t('finance_goal_overdue', { n: days }) : t('finance_goal_overdue_plural', { n: days })}</span>
    }
    if (raw === 0) return <span style={{ color: '#f59e0b', fontWeight: 600 }}>{t('finance_goal_due_today')}</span>
    return <span style={{ color: raw <= 30 ? '#f59e0b' : FIN_POS, fontWeight: 600 }}>{days === 1 ? t('finance_goal_days_left', { n: days }) : t('finance_goal_days_left_plural', { n: days })}</span>
  }

  // API-012: dono é quem criou a meta. Meta de workspace de outro membro vai
  // para "compartilhadas", sem os botões de dono (antes aparecia como sua, e
  // compartilhar a meta alheia passava no banco).
  const ownedGoals = goals.filter(g => g.user_id === userId)
  const sharedGoals = goals.filter(g => g.user_id !== userId)
  const active = ownedGoals.filter(g => g.status !== 'cancelled')
  const cancelled = ownedGoals.filter(g => g.status === 'cancelled')

  const renderGoal = (goal: FinanceGoal, isOwned = true) => {
    const accumulated = getAccumulated(goal.id)
    const pctRaw = goal.target_amount > 0 ? (accumulated / goal.target_amount) * 100 : 0
    const pct = Math.min(pctRaw, 100)
    const status = getEffectiveStatus(goal)
    const goalContribs = getContributions(goal.id)
    const isExpanded = expanded[goal.id] ?? false
    const barColor = status === 'overdue' ? '#ef4444' : status === 'completed' ? FIN_POS : pct >= 80 ? '#f59e0b' : goal.color
    const acc = goal.account_id ? accMap.get(goal.account_id) : null
    const sharer = sharerMap.get(goal.id)
    const sharesForGoal = goalShares.filter(s => s.goal_id === goal.id)

    return (
      <div key={goal.id} style={{ backgroundColor: 'var(--color-surface)', border: `1px solid var(--color-border)`, borderRadius: 14, overflow: 'hidden', borderTop: `4px solid ${goal.color}` }}>
        {/* Card header */}
        <div style={{ padding: '16px 18px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: `${goal.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
              {goal.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{goal.name}</span>
                {statusBadge(status)}
                {!isOwned && sharer && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={10} />{t('finance_goal_shared_by')} {sharer.display_name || sharer.email}
                  </span>
                )}
                {isOwned && sharesForGoal.length > 0 && (
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Users size={10} />{sharesForGoal.length}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {t('finance_goal_deadline')}: {deadlineLabel(goal, status)}
                {acc && <span> · {acc.icon} {acc.name}</span>}
              </div>
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {status !== 'cancelled' && (
                <button onClick={() => onAddContribution(goal)} title={t('finance_goal_add_contribution')}
                  style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${goal.color}`, backgroundColor: `${goal.color}22`, color: goal.color, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  {t('finance_goal_add_contribution')}
                </button>
              )}
              {isOwned && (
                <button onClick={() => onShareGoal(goal)} title={t('finance_goal_share_btn')}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                  <Users size={12} />
                </button>
              )}
              {isOwned && (
                <button aria-label={t('common_edit')} onClick={() => onEditGoal(goal)}
                  style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
                  <Pencil size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Progress */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {t('finance_goal_accumulated')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(accumulated)}</strong>
              </span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {t('finance_goal_target')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(goal.target_amount)}</strong>
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 5, backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 5, width: `${pct}%`, backgroundColor: barColor, transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <span style={{ fontWeight: 600, color: barColor }}>{pctRaw.toFixed(1)}%</span>
              {status !== 'completed' && (
                <span>{t('finance_goal_remaining')}: <strong style={{ color: 'var(--color-text)' }}>{fmt(Math.max(goal.target_amount - accumulated, 0))}</strong></span>
              )}
              {status === 'completed' && (
                <span style={{ color: FIN_POS, fontWeight: 700 }}>{t('finance_goal_completed_badge')}</span>
              )}
            </div>
          </div>

          {/* Status actions + expand */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isOwned && status === 'active' && accumulated >= goal.target_amount && (
              <button onClick={() => onUpdateStatus(goal.id, 'completed')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: FIN_POS_SOFT, color: FIN_POS, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                <CheckCircle2 size={12} />{t('finance_goal_mark_completed')}
              </button>
            )}
            {isOwned && status === 'completed' && (
              <button onClick={() => onUpdateStatus(goal.id, 'active')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-active)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                {t('finance_goal_mark_active')}
              </button>
            )}
            {isOwned && status !== 'cancelled' && status !== 'completed' && (
              confirmCancel === goal.id ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_goal_cancel_goal')}?</span>
                  <button onClick={() => { onUpdateStatus(goal.id, 'cancelled'); setConfirmCancel(null) }}
                    style={{ padding: '3px 10px', borderRadius: 6, border: 'none', backgroundColor: '#6b728033', color: '#6b7280', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {t('finance_confirm_delete')}
                  </button>
                  <button onClick={() => setConfirmCancel(null)}
                    style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
                    {t('finance_cancel')}
                  </button>
                </div>
              ) : (
                <button onClick={() => { setConfirmCancel(goal.id); setConfirmDelete(null) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, border: 'none', backgroundColor: '#6b728022', color: '#6b7280', cursor: 'pointer', fontSize: 12 }}>
                  <XCircle size={12} />{t('finance_goal_cancel_goal')}
                </button>
              )
            )}
            <button
              onClick={() => setExpanded(e => ({ ...e, [goal.id]: !e[goal.id] }))}
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
              <span>{t('finance_goal_contributions_title')} ({goalContribs.length})</span>
              <ChevronDown size={12} style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
          </div>
        </div>

        {/* Contributions panel */}
        {isExpanded && (
          <div style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', padding: '12px 18px' }}>
            {goalContribs.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('finance_goal_no_contributions')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {goalContribs.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: goal.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--color-text-muted)', minWidth: 80 }}>
                      {new Date(c.date + 'T12:00:00').toLocaleDateString(localeOf(lang), { day: '2-digit', month: 'short' })}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: goal.color }}>{fmt(c.amount)}</span>
                    {c.note && <span style={{ fontSize: 12, color: 'var(--color-text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.note}</span>}
                  {c.contributor_profile && (
                    <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, backgroundColor: 'var(--color-active)', color: 'var(--color-text)', fontWeight: 600, flexShrink: 0 }}>
                      {t('finance_goal_contribution_by')} {c.contributor_profile.display_name || c.contributor_profile.email}
                    </span>
                  )}
                    {/* API-012: dono e membros veem os aportes dos outros, mas só
                        o autor apaga (policy de DELETE). Sem lixeira no aporte alheio. */}
                    {c.user_id !== userId ? null : confirmDeleteContrib === c.id ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                        <button onClick={() => { onDeleteContribution(c.id); setConfirmDeleteContrib(null) }}
                          style={{ width: 22, height: 22, borderRadius: 4, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                          ✓
                        </button>
                        <button onClick={() => setConfirmDeleteContrib(null)}
                          style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button aria-label={t('common_delete')} onClick={() => { setConfirmDeleteContrib(c.id); setConfirmCancel(null) }}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', padding: 3, borderRadius: 4, flexShrink: 0 }}>
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete goal — owner only */}
        {isOwned && (
          <div style={{ borderTop: '1px solid var(--color-border)', padding: '8px 18px', display: 'flex', justifyContent: 'flex-end' }}>
            {confirmDelete === goal.id ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('finance_goal_delete_confirm')}</span>
                <button onClick={() => { onDeleteGoal(goal.id); setConfirmDelete(null) }}
                  style={{ padding: '4px 10px', borderRadius: 6, border: 'none', backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
                  {t('finance_confirm_delete')}
                </button>
                <button onClick={() => setConfirmDelete(null)}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 12 }}>
                  {t('finance_cancel')}
                </button>
              </div>
            ) : (
              <button onClick={() => { setConfirmDelete(goal.id); setConfirmCancel(null); setConfirmDeleteContrib(null) }}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '4px 6px', borderRadius: 6 }}>
                <Trash2 size={11} />{t('finance_delete')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onNewGoal}
          style={{ padding: '7px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          {t('finance_goal_new')}
        </button>
      </div>

      {goals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Target size={40} color="var(--color-text-muted)" strokeWidth={1.5} />
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>{t('finance_goal_no_goals')}</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {active.map(g => renderGoal(g, true))}
            </div>
          )}
          {cancelled.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{t('finance_goal_cancelled_section')}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: 0.6 }}>
                {cancelled.map(g => renderGoal(g, true))}
              </div>
            </div>
          )}
          {sharedGoals.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Users size={11} />{t('finance_goal_shared_section')}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {sharedGoals.map(g => renderGoal(g, false))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
