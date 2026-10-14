import type React from 'react'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { TranslationKey } from '../../../i18n/translations'
import type { FinanceGoal, FinanceGoalContribution } from '../../../types'
import { segBtnStyle, segTrackStyle } from '../ui'
import { SummaryView } from './SummaryView'
import { PROJECTS_SECTIONS, type ProjectsSection } from './section'

// "Projetos": Metas e um Resumo que mostra as metas por fase. A Loja saiu do
// frontend em 14/10/2026; as tabelas ficaram no banco para os módulos novos
// (ver "Fora do frontend" em docs/arquitetura.md).

const SECTION_KEY: Record<ProjectsSection, TranslationKey> = {
  summary: 'finance_myproj_nav_summary',
  // Reusa a chave da aba antiga em vez de duplicar o rótulo.
  goals: 'finance_tab_goals',
}

export default function MyProjectsTab({
  section, onSectionChange, goals, contributions, goalsSlot,
}: {
  section: ProjectsSection
  onSectionChange: (s: ProjectsSection) => void
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
  const { t } = useLanguage()

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
        <SummaryView goals={goals} contributions={contributions} onOpenSection={onSectionChange} />
      )}

      {/* Sem Suspense: o GoalsTab não é lazy, vem montado do FinancePanel. */}
      {section === 'goals' && goalsSlot}
    </div>
  )
}
