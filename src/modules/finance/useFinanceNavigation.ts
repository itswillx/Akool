// ARCH-001: saiu do FinancePanel.tsx sem mudança de lógica.
import { useCallback, useEffect, useState } from 'react'
import { LOCAL_KEYS } from '../../lib/localKeys'
import type { TabId } from './financeFormat'
import { resolveTabRequest } from './financeFormat'
import { readStoredSection, type ProjectsSection } from './myprojects/section'

// Aba, sub-aba de Projetos e layout (lateral/topo) do financeiro, com o que
// fica guardado no localStorage e a navegação por evento.
export function useFinanceNavigation() {
  // Uma leitura só do localStorage: o valor gravado pode ser um id antigo
  // ('store'), que resolve para a aba nova MAIS a sub-aba correspondente.
  const [tab, setTab] = useState<TabId>(
    () => resolveTabRequest(localStorage.getItem(LOCAL_KEYS.financeTab))?.tab ?? 'overview',
  )
  // A sub-aba vive AQUI, e não dentro do MyProjectsTab: um atalho do Resumo
  // precisa poder mandar "vá para a Loja" mesmo com a aba já montada — se o
  // estado morasse lá dentro, a navegação viraria um no-op silencioso.
  const [projSection, setProjSection] = useState<ProjectsSection>(
    () => resolveTabRequest(localStorage.getItem(LOCAL_KEYS.financeTab))?.section ?? readStoredSection(),
  )
  useEffect(() => {
    localStorage.setItem(LOCAL_KEYS.financeMyprojectsSection, projSection)
  }, [projSection])

  // Navegação vinda dos atalhos do Resumo: a sub-aba entra ANTES da aba, para
  // que Projetos monte já na seção certa em vez de piscar no Resumo.
  const navigateTo = useCallback((next: TabId, section?: ProjectsSection) => {
    if (section) setProjSection(section)
    setTab(next)
  }, [])

  // Desktop navigation layout: 'side' (Lateral) or 'top' (Topo). Persisted.
  const [direction, setDirection] = useState<'side' | 'top'>(() => {
    const saved = localStorage.getItem(LOCAL_KEYS.financeLayout)
    return saved === 'top' ? 'top' : 'side'
  })
  useEffect(() => {
    localStorage.setItem(LOCAL_KEYS.financeLayout, direction)
  }, [direction])

  // Save tab to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(LOCAL_KEYS.financeTab, tab)
  }, [tab])

  return { tab, setTab, projSection, setProjSection, navigateTo, direction, setDirection }
}
