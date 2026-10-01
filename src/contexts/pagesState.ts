import { createContext, useContext } from 'react'
import type { Page, PageType, PageShareRole } from '../types'
import type { ActivePanel } from '../lib/docsNavigation'

// Contexts e hooks do PagesProvider (PagesContext.tsx). Ficam num arquivo sem
// componentes para o fast refresh continuar funcionando no provider.
//
// PERF-007: três contexts, para quem só precisa de um pedaço não re-renderizar
// com o resto. Antes era um só, e cada PageItem (memo) lia tudo: a árvore
// inteira re-renderizava a cada navegação, carga ou evento do realtime.
//   - dados: a árvore e os papéis (muda com carga/realtime);
//   - navegação: a página ou o painel aberto (muda ao navegar);
//   - ações: criar/editar/apagar/recarregar (estáveis).
// `usePages()` junta os três, para quem ainda usa tudo.
export interface PagesDataContextType {
  pages: Page[]
  sharedPages: Page[]
  loading: boolean
  userShareRole: (pageId: string) => PageShareRole | 'owner' | null
}

export interface PageNavigationContextType {
  /** Derivada da árvore pelo id: um rename vindo do realtime aparece aqui também. */
  activePage: Page | null
  setActivePage: (page: Page | null) => void
  activePanel: ActivePanel | null
  setActivePanel: (panel: ActivePanel | null) => void
}

export interface PageActionsContextType {
  createPage: (opts?: { parent_id?: string; type?: PageType }) => Promise<Page | null>
  updatePage: (id: string, updates: Partial<Page>) => Promise<void>
  deletePage: (id: string) => Promise<void>
  refreshPages: () => Promise<void>
}

export type PagesContextType = PagesDataContextType & PageNavigationContextType & PageActionsContextType

export const PagesDataContext = createContext<PagesDataContextType | undefined>(undefined)
export const PageNavigationContext = createContext<PageNavigationContextType | undefined>(undefined)
export const PageActionsContext = createContext<PageActionsContextType | undefined>(undefined)

function required<T>(value: T | undefined, hook: string): T {
  if (!value) throw new Error(`${hook} must be used within PagesProvider`)
  return value
}

/** Árvore, carregamento e papéis. */
export function usePagesData() {
  return required(useContext(PagesDataContext), 'usePagesData')
}

/** Página ou painel aberto. */
export function usePageNavigation() {
  return required(useContext(PageNavigationContext), 'usePageNavigation')
}

/** Criar, editar, apagar e recarregar (estáveis). */
export function usePageActions() {
  return required(useContext(PageActionsContext), 'usePageActions')
}

/** Tudo junto; re-renderiza com qualquer mudança. Prefira os hooks acima. */
export function usePages(): PagesContextType {
  return { ...usePagesData(), ...usePageNavigation(), ...usePageActions() }
}
