import type React from 'react'
import { lazy, Suspense } from 'react'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { TranslationKey } from '../../../i18n/translations'
import type {
  FinanceAccount, FinanceCategory, FinanceGoal, FinanceGoalContribution,
} from '../../../types'
import { segBtnStyle, segTrackStyle } from '../ui'
import { useFinanceStore } from '../store/useFinanceStore'
import { SummaryView } from './SummaryView'
import { PROJECTS_SECTIONS, type ProjectsSection } from './section'

// "Projetos": Loja e Metas numa seção só, mais um Resumo que cruza as duas.
//
// Este componente hospeda `useFinanceStore` UMA vez e passa o store adiante.
// Antes cada aba chamava o seu; com o Resumo lendo os mesmos dados, duas cópias
// divergiriam na primeira escrita. Metas não tem hook aqui: seus dados já vêm
// do `useFinanceData` do FinancePanel, de onde o Resumo geral também depende.

const FinanceStoreTab = lazy(() => import('../store/FinanceStoreTab'))

const SECTION_KEY: Record<ProjectsSection, TranslationKey> = {
  summary: 'finance_myproj_nav_summary',
  store: 'finance_myproj_nav_store',
  // Reusa a chave da aba antiga em vez de duplicar o rótulo.
  goals: 'finance_tab_goals',
}

export default function MyProjectsTab({
  section, onSectionChange, workspaceId, accounts, categories, month,
  goals, contributions, goalsSlot,
}: {
  section: ProjectsSection
  onSectionChange: (s: ProjectsSection) => void
  workspaceId: string | null
  accounts: FinanceAccount[]
  categories: FinanceCategory[]
  month: string
  /** Só para o Resumo: a sub-aba de Metas em si chega pronta em `goalsSlot`. */
  goals: FinanceGoal[]
  contributions: FinanceGoalContribution[]
  /**
   * A aba de Metas montada pelo FinancePanel.
   *
   * É um slot e não props porque o `GoalsTab` recebe treze delas e seus três
   * modais (incluindo o de compartilhar, que depende do `UserPicker` privado do
   * painel) continuam vivendo lá. Encanar tudo isso por um componente que não
   * tem nada a ver com metas seria pior do que passar o elemento pronto.
   */
  goalsSlot: React.ReactNode
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const store = useFinanceStore(user?.id, workspaceId)

  const fallback = (
    <div style={{ padding: 24, color: 'var(--color-text-muted)', fontSize: 13 }}>{t('finance_loading')}</div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* O trilho pode não caber num telefone de 375px: rola, não quebra linha. */}
      <div className="finance-hide-scrollbar"
        style={{ ...segTrackStyle, alignSelf: 'flex-start', maxWidth: '100%', overflowX: 'auto' }}>
        {PROJECTS_SECTIONS.map(s => (
          <button key={s} style={segBtnStyle(section === s)} onClick={() => onSectionChange(s)}>
            {t(SECTION_KEY[s])}
          </button>
        ))}
      </div>

      {section === 'summary' && (
        <SummaryView
          store={store}
          goals={goals}
          contributions={contributions}
          onOpenSection={onSectionChange}
        />
      )}

      {section === 'store' && (
        <Suspense fallback={fallback}>
          <FinanceStoreTab store={store} accounts={accounts} categories={categories} month={month} />
        </Suspense>
      )}

      {/* Sem Suspense: o GoalsTab não é lazy, vem montado do FinancePanel. */}
      {section === 'goals' && goalsSlot}
    </div>
  )
}
