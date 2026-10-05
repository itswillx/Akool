import { useCallback } from 'react'
import { usePages } from '../../contexts/PagesContext'
import { useToast } from '../../contexts/ToastContext'
import { useWorkspaceMode } from '../../contexts/WorkspaceModeContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { emitAppEvent } from '../../lib/appEvents'
import { getPageById } from '../../lib/data/pages'
import { setDocsSelection } from '../../lib/docsNavigation'
import { LOCAL_KEYS } from '../../lib/localKeys'
import type { NotificationTarget } from '../../lib/notificationKinds'
import { findPage } from '../../lib/pageTree'

// NOTIF-001: abrir o item de uma notificação. O app não tem roteador: cada
// destino usa o caminho que o resto do app já usa (página pela navegação de
// páginas; quadro/card pelas chaves que o painel de Projetos lê ao montar;
// Financeiro pelo painel e uma chave que abre o modal do workspace;
// Configurações por evento). Devolve false quando o item não existe mais.
export function useNotificationTarget(): (target: NotificationTarget) => Promise<boolean> {
  const { pages, sharedPages, setActivePage, setActivePanel, refreshPages } = usePages()
  const { mode, setMode } = useWorkspaceMode()
  const { showToast } = useToast()
  const { t } = useLanguage()

  return useCallback(async (target: NotificationTarget) => {
    switch (target.kind) {
      case 'page': {
        if (mode === 'finance') setMode('all')
        const known = findPage([pages, sharedPages], target.pageId)
        if (known) {
          setActivePage(known)
          return true
        }
        // Compartilhada agora há pouco: a árvore ainda não tem. Abre pela linha
        // (o PagesContext troca pela versão da árvore quando ela recarregar).
        const [page] = await Promise.all([getPageById(target.pageId), refreshPages()])
        if (!page) {
          showToast('warning', t('notif_unavailable'))
          return false
        }
        setActivePage(page)
        return true
      }
      case 'board':
      case 'card': {
        if (mode === 'finance') setMode('all')
        localStorage.setItem(LOCAL_KEYS.projectsActiveBoard, target.boardId)
        if (target.kind === 'card') localStorage.setItem(LOCAL_KEYS.projectsOpenCard, target.cardId)
        setDocsSelection({ kind: 'projects' })
        setActivePanel('documents')
        // Projetos já aberto não relê as chaves: o evento troca o quadro e abre o card.
        emitAppEvent('projects_open', target.kind === 'card' ? { boardId: target.boardId, cardId: target.cardId } : { boardId: target.boardId })
        return true
      }
      case 'finance-workspace': {
        localStorage.setItem(LOCAL_KEYS.financeOpenWorkspace, '1')
        // O Financeiro como painel só existe no modo Tudo; no modo Finanças ele já é a tela.
        if (mode === 'documents') setMode('all')
        if (mode !== 'finance') setActivePanel('finance')
        emitAppEvent('finance_workspace_open')
        return true
      }
      case 'settings-backup': {
        emitAppEvent('settings_open', { tab: 'backup' })
        return true
      }
    }
  }, [mode, setMode, pages, sharedPages, setActivePage, setActivePanel, refreshPages, showToast, t])
}
