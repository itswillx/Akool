import { useEffect } from 'react'
import type { TranslationKey } from '../i18n/translations'

const APP_NAME = 'Akool'

/**
 * UX-006: título da aba por seção ("Finanças · Akool"), para distinguir abas
 * e para o leitor de tela anunciar onde se está. Volta a "Akool" ao desmontar
 * (sair da conta).
 */
export function useDocumentTitle(section: string | null | undefined) {
  useEffect(() => {
    document.title = section ? `${section} · ${APP_NAME}` : APP_NAME
    return () => { document.title = APP_NAME }
  }, [section])
}

/**
 * A seção da aba, com as mesmas regras do MainContent. O painel Documentos tem
 * uma seleção própria (useDocsSelection), fora do `activePage`: com uma página
 * selecionada ali, o título é o dela, e não "Documentos".
 */
export function documentTitleFor({ financeOpen, activePanel, docsPage, activePage, t }: {
  financeOpen: boolean
  activePanel: string | null
  docsPage: { title: string } | null
  activePage: { title: string } | null
  t: (key: TranslationKey) => string
}): string {
  if (financeOpen) return t('sidebar_section_finance')
  if (activePanel === 'documents') return docsPage ? docsPage.title || t('page_header_untitled') : t('sidebar_section_documents')
  if (activePanel === 'help') return t('sidebar_help')
  if (activePage) return activePage.title || t('page_header_untitled')
  return t('sidebar_dashboard')
}
