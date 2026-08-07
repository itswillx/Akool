import { useMemo } from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { TranslationKey } from '../../../i18n/translations'
import { useIsMobile } from '../../../hooks/useIsMobile'
import { formatBRL } from '../../../lib/money'
import { FINANCE_PHASES, type FinancePhaseOrCancelled } from '../../../lib/financePhase'
import { stepIndexOf, type StepDef } from '../../../lib/boardStepper'
import { BoardStepper, KanbanBoard, type BoardColumnDef, type BoardSortOption } from '../../../components/board'
import { FIN_NEG, FIN_POS, FIN_WARN, badgeStyle, tabularNums } from '../ui'
import { KIND_SECTION, type UnifiedCard, type UnifiedKind } from './unifiedCards'
import type { ProjectsSection } from './section'

// Kanban unificado do Resumo: vendas e metas nas mesmas colunas de fase.
//
// Read-only de propósito. "Em andamento → Concluído" significa duas coisas
// diferentes (sales.status='delivered' COM efeito em finance_transactions,
// finance_goals.status='completed'). Reimplementar o modal de confirmação da
// venda aqui duplicaria a lógica mais perigosa do módulo. Clicar no card leva à
// sub-aba de origem, onde o movimento é seguro.

const PHASE_COLOR: Record<FinancePhaseOrCancelled, string> = {
  planned: 'var(--color-text-muted)',
  doing: FIN_WARN,
  done: FIN_POS,
  cancelled: FIN_NEG,
}

const PHASE_KEY = {
  planned: 'finance_myproj_phase_planned',
  doing: 'finance_myproj_phase_doing',
  done: 'finance_myproj_phase_done',
  cancelled: 'finance_myproj_phase_cancelled',
} as const

const KIND_KEY: Record<UnifiedKind, TranslationKey> = {
  sale: 'finance_myproj_kind_sale',
  goal: 'finance_tab_goals',
}

export function SummaryBoard({ cards, onOpenSection }: {
  cards: UnifiedCard[]
  onOpenSection: (s: ProjectsSection) => void
}) {
  const { t } = useLanguage()
  const isMobile = useIsMobile()

  const columns: BoardColumnDef[] = useMemo(
    () => FINANCE_PHASES.map(p => ({ id: p, label: t(PHASE_KEY[p]), color: PHASE_COLOR[p] })),
    [t],
  )

  // A trilha tem três passos: 'cancelled' fica fora dela de propósito, então
  // um card cancelado aparece com o stepper todo apagado.
  const steps: StepDef[] = useMemo(() => [
    { id: 'planned', label: t(PHASE_KEY.planned) },
    { id: 'doing', label: t(PHASE_KEY.doing) },
    { id: 'done', label: t(PHASE_KEY.done) },
  ], [t])

  const sortOptions: BoardSortOption<UnifiedCard>[] = useMemo(() => [
    { id: 'recent', label: t('board_sort_recent'), compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt) },
    { id: 'value', label: t('board_sort_value'), compare: (a, b) => b.amount - a.amount },
    { id: 'name', label: t('board_sort_name'), compare: (a, b) => a.title.localeCompare(b.title) },
  ], [t])

  return (
    <KanbanBoard
      storageKey="finance_board_summary"
      columns={columns}
      items={cards}
      isMobile={isMobile}
      readOnly
      defaultHiddenColumns={['cancelled']}
      getId={c => c.id}
      getColumnId={c => c.phase}
      getAmount={c => c.amount}
      getSearchText={c => `${c.title} ${c.subtitle}`}
      sortOptions={sortOptions}
      onCardClick={c => onOpenSection(KIND_SECTION[c.kind])}
      renderCard={card => (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ width: 26, height: 26, borderRadius: 7, background: `color-mix(in srgb, ${card.accent} 18%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
              {card.icon}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {card.title}
              </div>
              {card.subtitle && (
                <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {card.subtitle}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={badgeStyle(card.accent)}>{t(KIND_KEY[card.kind])}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text)', ...tabularNums }}>
              {formatBRL(card.amount)}
            </span>
          </div>
          <BoardStepper steps={steps} currentIndex={stepIndexOf(steps, card.phase)} compact />
        </>
      )}
    />
  )
}
