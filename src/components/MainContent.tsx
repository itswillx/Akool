import { lazy } from 'react'
import { usePages } from '../contexts/PagesContext'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import PageEditor, { Lazy } from './PageEditor'
import ErrorBoundary from './ErrorBoundary'

const Dashboard = lazy(() => import('./Dashboard'))
const FinancePanel = lazy(() => import('../modules/finance'))
const HelpPanel = lazy(() => import('./HelpPanel'))
const DocumentsPanel = lazy(() => import('./DocumentsPanel'))

interface MainContentProps {
  isMobile?: boolean
}

// Every branch renders its ErrorBoundary at the same spot, so without a `key`
// React reuses one boundary for all panels and an error in one panel stays on
// screen after switching to another (REL-005). Each panel gets its own key;
// pages share one boundary that forgets the error when the open page changes.
export default function MainContent({ isMobile = false }: MainContentProps) {
  const { activePage, activePanel } = usePages()
  const { mode } = useWorkspaceMode()
  const { t } = useLanguage()

  // UX-006: título da aba pela seção aberta (mesmas regras dos ramos abaixo).
  const financeOpen = mode === 'finance' || (activePanel === 'finance' && mode === 'all')
  useDocumentTitle(
    financeOpen ? t('sidebar_section_finance')
      : activePanel === 'documents' ? t('sidebar_section_documents')
      : activePanel === 'help' ? t('sidebar_help')
      : activePage ? activePage.title || t('page_header_untitled')
      : t('sidebar_dashboard'),
  )

  // Finance mode: the finance module takes over the whole content area and
  // ignores the projects-world page/panel routing entirely.
  if (mode === 'finance') {
    return <ErrorBoundary key="finance"><Lazy><FinancePanel isMobile={isMobile} /></Lazy></ErrorBoundary>
  }

  // Finance as an inline panel only exists in the "all" (everything) mode.
  // In "documents" mode this branch is skipped and falls through.
  if (activePanel === 'finance' && mode === 'all') {
    return <ErrorBoundary key="finance"><Lazy><FinancePanel isMobile={isMobile} /></Lazy></ErrorBoundary>
  }

  // Projetos não é mais um painel: vive dentro do DocumentsPanel como seção
  // (chunk puxado por lá). Chaves legadas migram em lib/docsNavigation.

  if (activePanel === 'documents') {
    return <ErrorBoundary key="documents"><Lazy><DocumentsPanel isMobile={isMobile} /></Lazy></ErrorBoundary>
  }

  if (activePanel === 'help') {
    return <ErrorBoundary key="help"><Lazy><HelpPanel /></Lazy></ErrorBoundary>
  }

  if (!activePage) {
    return <ErrorBoundary key="dashboard"><Lazy><Dashboard isMobile={isMobile} /></Lazy></ErrorBoundary>
  }

  return <ErrorBoundary key="page" resetKey={activePage.id}><PageEditor page={activePage} isMobile={isMobile} /></ErrorBoundary>
}
