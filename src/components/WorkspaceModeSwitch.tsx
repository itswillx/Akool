import type { ReactNode } from 'react'
import { LayoutGrid, PenTool, Wallet, Files } from 'lucide-react'
import { useWorkspaceMode } from '../contexts/WorkspaceModeContext'
import type { WorkspaceMode } from '../contexts/WorkspaceModeContext'
import { usePages } from '../contexts/PagesContext'
import { useLanguage } from '../i18n/LanguageContext'

// Compact segmented control rendered next to the "Akool" name in the top bar.
// Each mode is a compact icon-logo; the active one also shows its label. Hovering
// the finance/documents segments prefetches their chunk so the first switch feels
// instant.
function prefetchFinance() {
  import('../modules/finance')
}

function prefetchDocuments() {
  import('./DocumentsPanel')
}

export default function WorkspaceModeSwitch() {
  const { mode, setMode } = useWorkspaceMode()
  const { setActivePanel, setActivePage } = usePages()
  const { t } = useLanguage()

  const items: { id: WorkspaceMode; icon: ReactNode; label: string; tooltip: string }[] = [
    { id: 'all', icon: <LayoutGrid size={15} />, label: t('mode_all'), tooltip: t('mode_all_tooltip') },
    { id: 'finance', icon: <Wallet size={15} />, label: t('mode_finance'), tooltip: t('mode_finance_tooltip') },
    { id: 'projects', icon: <PenTool size={15} />, label: t('mode_projects'), tooltip: t('mode_projects_tooltip') },
    { id: 'documents', icon: <Files size={15} />, label: t('mode_documents'), tooltip: t('mode_documents_tooltip') },
  ]

  // The top selector is the primary view switcher: each option navigates to its
  // canonical surface so the content always matches the highlighted segment.
  const handleSelect = (id: WorkspaceMode) => {
    setMode(id)
    if (id === 'projects') setActivePanel('projects')
    else if (id === 'documents') setActivePanel('documents')
    else if (id === 'all') { setActivePage(null); setActivePanel(null) }
    // 'finance' is rendered by MainContent's finance-mode takeover.
  }

  return (
    <div
      role="group"
      aria-label={t('mode_switch_aria')}
      style={{
        display: 'flex', alignItems: 'center', gap: 2, padding: 2,
        borderRadius: 9, border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg-secondary)',
      }}
    >
      {items.map(item => {
        const active = mode === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelect(item.id)}
            onMouseEnter={item.id === 'finance' ? prefetchFinance : item.id === 'documents' ? prefetchDocuments : undefined}
            title={item.tooltip}
            aria-label={item.tooltip}
            aria-pressed={active}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              height: 28, padding: active ? '0 10px' : '0 8px', borderRadius: 7,
              border: 'none', cursor: 'pointer',
              backgroundColor: active ? 'var(--color-logo-bg)' : 'transparent',
              color: active ? 'var(--color-logo-text)' : 'var(--color-text-muted)',
              fontSize: 12.5, fontWeight: 600, lineHeight: 1,
              transition: 'background-color 0.12s, color 0.12s',
            }}
          >
            {item.icon}
            {active && <span>{item.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
