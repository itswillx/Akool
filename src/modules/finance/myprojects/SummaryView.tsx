import type React from 'react'
import { useMemo } from 'react'
import { Star, Store } from 'lucide-react'
import { useLanguage } from '../../../i18n/LanguageContext'
import { formatBRL } from '../../../lib/money'
import type { FinanceGoal, FinanceGoalContribution } from '../../../types'
import { FIN_POS, cardSurfaceStyle, sectionCaptionStyle, tabularNums } from '../ui'
import type { FinanceStoreStore } from '../store/useFinanceStore'
import { SummaryBoard } from './SummaryBoard'
import { KIND_SECTION, buildUnifiedCards, type UnifiedKind } from './unifiedCards'
import type { ProjectsSection } from './section'

// Resumo de "Projetos": um cartão de entrada por domínio e, abaixo, o kanban
// unificado por fase.

export function SummaryView({ store, goals, contributions, onOpenSection }: {
  store: FinanceStoreStore
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  onOpenSection: (s: ProjectsSection) => void
}) {
  const { t } = useLanguage()

  const cards = useMemo(
    () => buildUnifiedCards(
      store, goals, contributions,
      {
        noCustomer: t('finance_store_no_customer'),
        sale: t('finance_store_sale'),
        goalTarget: target => t('finance_myproj_goal_target', { target }),
      },
      { sale: FIN_POS },
    ),
    [store, goals, contributions, t],
  )

  const loading = store.loading

  // Um card por domínio: quantos estão em andamento e quanto somam. O "ativo"
  // exclui concluído e cancelado — é o que ainda exige atenção.
  const tiles: { kind: UnifiedKind; icon: React.ReactNode; label: string }[] = [
    { kind: 'sale', icon: <Store size={16} />, label: t('finance_tab_store') },
    { kind: 'goal', icon: <Star size={16} />, label: t('finance_tab_goals') },
  ]

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_loading')}</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {tiles.map(tile => {
          const own = cards.filter(c => c.kind === tile.kind)
          const active = own.filter(c => c.phase === 'planned' || c.phase === 'doing')
          const total = active.reduce((sum, c) => sum + c.amount, 0)
          return (
            <button key={tile.kind} onClick={() => onOpenSection(KIND_SECTION[tile.kind])}
              style={{ textAlign: 'left', ...cardSurfaceStyle, padding: '14px 16px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--color-text-subtle)' }}>
                <span style={{ display: 'flex', color: 'var(--color-text-muted)' }}>{tile.icon}</span>{tile.label}
              </span>
              <span style={{ fontSize: 19, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>
                {total > 0 ? formatBRL(total) : '—'}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                {t('finance_myproj_tile_sub', { active: active.length, total: own.length })}
              </span>
            </button>
          )
        })}
      </div>

      <div>
        <h3 style={{ ...sectionCaptionStyle, marginBottom: 4 }}>{t('finance_myproj_board_title')}</h3>
        {/* O rótulo diz "valor envolvido" e não "total": somar venda + meta num
            R$ só é uma ordem de grandeza, não um saldo. Sem o rótulo, vira um
            número que ninguém sabe interpretar. */}
        <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginBottom: 10 }}>
          {t('finance_myproj_board_hint')}
        </div>
        {cards.length === 0 ? (
          <div style={{ ...cardSurfaceStyle, padding: '38px 20px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13.5 }}>
            {t('finance_myproj_board_empty')}
          </div>
        ) : (
          <SummaryBoard cards={cards} onOpenSection={onOpenSection} />
        )}
      </div>
    </div>
  )
}
