// Localização dentro da aba "Projetos". Puro e sem React, importado
// estaticamente pelo FinancePanel — são poucas linhas e a resolução da aba
// acontece no primeiro render, antes de qualquer lazy chunk carregar.

export const PROJECTS_SECTIONS = ['summary', 'store', 'goals'] as const
export type ProjectsSection = typeof PROJECTS_SECTIONS[number]

export const MYPROJECTS_TAB_ID = 'myprojects'
export const MYPROJECTS_SECTION_KEY = 'finance_myprojects_section'
export const FINANCE_TAB_KEY = 'finance_active_tab'

/**
 * Abas que existiam antes da unificação → sub-aba equivalente.
 *
 * Sem isto, quem tinha 'store' gravado no localStorage cairia no Resumo geral
 * do financeiro depois do deploy, sem entender para onde a Loja foi.
 *
 * `projects` (Obras) e `investments` caem no Resumo: as sub-abas deixaram de
 * existir, e mandar para um id inválido faria `isProjectsSection` recusar e a
 * navegação virar um no-op silencioso.
 */
export const LEGACY_TAB_TO_SECTION: Record<string, ProjectsSection> = {
  projects: 'summary',
  store: 'store',
  investments: 'summary',
  goals: 'goals',
}

export function isProjectsSection(value: unknown): value is ProjectsSection {
  return typeof value === 'string' && (PROJECTS_SECTIONS as readonly string[]).includes(value)
}

export interface FinanceLocation {
  /** Id de aba ainda NÃO validado contra TAB_IDS — quem chama valida. */
  tab: string
  /** Sub-aba pedida explicitamente, ou null para manter a atual. */
  section: ProjectsSection | null
}

/**
 * Interpreta um pedido de navegação. Aceita três formas:
 *
 *   'transactions'        → aba comum
 *   'myprojects'          → Projetos, mantendo a sub-aba atual
 *   'myprojects:store'    → Projetos, forçando a Loja
 *   'store' (legado)      → Projetos → Loja
 *
 * Devolve null para entrada vazia ou desconhecida — o chamador ignora e não
 * navega, em vez de cair numa aba arbitrária.
 */
export function parseFinanceLocation(raw: string | null | undefined): FinanceLocation | null {
  if (!raw) return null
  const [tab, rest] = raw.split(':', 2)
  if (!tab) return null

  if (tab === MYPROJECTS_TAB_ID) {
    return { tab, section: isProjectsSection(rest) ? rest : null }
  }
  const legacy = LEGACY_TAB_TO_SECTION[tab]
  if (legacy) return { tab: MYPROJECTS_TAB_ID, section: legacy }

  return { tab, section: null }
}

/** Sub-aba gravada, com 'summary' como padrão. Tolera lixo no localStorage. */
export function readStoredSection(): ProjectsSection {
  const saved = localStorage.getItem(MYPROJECTS_SECTION_KEY)
  return isProjectsSection(saved) ? saved : 'summary'
}
