import { lazy, Suspense, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useNotifications } from '../../contexts/NotificationsContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { onAppEvent } from '../../lib/appEvents'
import { ErrorBoundary } from '../ErrorBoundary'
import type { NotificationTarget } from '../../lib/notificationKinds'
import type { AppNotification } from '../../types'
import { useNotificationTarget } from './useNotificationTarget'

// O sino da barra do topo (NOTIF-001): aparece em todas as telas (antes, só no
// Dashboard), com a contagem de não lidas no nome acessível. Abre a central
// (chunk à parte, baixado no primeiro clique) e atende o "Ver" do aviso de
// notificação nova, abrindo direto o item. O sino vai no chunk de entrada:
// central e registro dos tipos ficam de fora, carregados sob demanda.
const NotificationCenter = lazy(() => import('./NotificationCenter'))

export function NotificationBell({ isMobile }: { isMobile: boolean }) {
  const { t } = useLanguage()
  const { notifications, unreadCount, markAsRead, setCenterOpen } = useNotifications()
  const openTarget = useNotificationTarget()
  const [open, setOpen] = useState(false)

  useEffect(() => { setCenterOpen(open) }, [open, setCenterOpen])

  // Abre o item: marca como lida, fecha a central e navega. Sem destino (tipo
  // sem tela, como empréstimos), a central fica aberta com o item à vista.
  const openItem = (n: AppNotification, target: NotificationTarget | null) => {
    void markAsRead(n.id)
    if (!target) {
      setOpen(true)
      return
    }
    setOpen(false)
    void openTarget(target)
  }

  useEffect(() => onAppEvent('notification_open', ({ id }) => {
    const n = notifications.find(item => item.id === id)
    if (!n) {
      setOpen(true)
      return
    }
    void import('../../lib/notificationKinds')
      .then(kinds => openItem(n, kinds.notificationTarget(n)))
      .catch(() => setOpen(true))
  }))

  const badge = unreadCount > 9 ? '9+' : String(unreadCount)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unreadCount === 0 ? t('notif_title') : t(unreadCount === 1 ? 'notif_bell_unread' : 'notif_bell_unread_plural', { n: unreadCount })}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t('notif_title')}
        style={{
          position: 'relative', width: 34, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          borderRadius: 9, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-text)',
        }}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box',
              // --color-error-text: 4,5:1 com o texto (o --color-error dava 3,8:1 no claro).
              borderRadius: 999, backgroundColor: 'var(--color-error-text)', color: 'var(--color-btn-primary-text)',
              fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--color-bg)',
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {/* Chunk que não baixou (sem rede): a central não abre, o app segue. */}
      {open && (
        <ErrorBoundary fallback={null} resetKey={open}>
          <Suspense fallback={null}>
            <NotificationCenter isMobile={isMobile} onClose={() => setOpen(false)} onOpenItem={openItem} />
          </Suspense>
        </ErrorBoundary>
      )}
    </>
  )
}
