import { lazy } from 'react'
import { usePages } from '../contexts/PagesContext'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import PageEditor, { Lazy } from './PageEditor'
import ErrorBoundary from './ErrorBoundary'

const Dashboard = lazy(() => import('./Dashboard'))
const FinancePanel = lazy(() => import('../modules/finance'))
const HelpPanel = lazy(() => import('./HelpPanel'))
const DocumentsPanel = lazy(() => import('./DocumentsPanel'))

interface MainContentProps {
  isMobile?: boolean
}

export default function MainContent({ isMobile = false }: MainContentProps) {
  const { activePage, activePanel } = usePages()
  const { mode } = useWorkspaceMode()

  // Finance mode: the finance module takes over the whole content area and
  // ignores the projects-world page/panel routing entirely.
  if (mode === 'finance') {
    return <ErrorBoundary><Lazy><FinancePanel isMobile={isMobile} /></Lazy></ErrorBoundary>
  }

  // Finance as an inline panel only exists in the "all" (everything) mode.
  // In "documents" mode this branch is skipped and falls through.
  if (activePanel === 'finance' && mode === 'all') {
    return <ErrorBoundary><Lazy><FinancePanel isMobile={isMobile} /></Lazy></ErrorBoundary>
  }

  // Projetos não é mais um painel: vive dentro do DocumentsPanel como seção
  // (chunk puxado por lá). Chaves legadas migram em lib/docsNavigation.

  if (activePanel === 'documents') {
    return <Lazy><DocumentsPanel isMobile={isMobile} /></Lazy>
  }

  if (activePanel === 'help') {
    return <Lazy><HelpPanel /></Lazy>
  }

  if (!activePage) {
    return <Lazy><Dashboard isMobile={isMobile} /></Lazy>
  }

  return <PageEditor page={activePage} isMobile={isMobile} />
}
