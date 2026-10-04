import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCheck, Settings2, X } from 'lucide-react'
import { useNotifications } from '../../contexts/NotificationsContext'
import { useLanguage } from '../../i18n/LanguageContext'
import { emitAppEvent } from '../../lib/appEvents'
import { fetchInviteStates } from '../../lib/data/notifications'
import type { InviteState } from '../../lib/data/notifications'
import { CATEGORY_LABELS, NOTIFICATION_CATEGORIES, notificationCategory, notificationInviteId } from '../../lib/notificationKinds'
import type { NotificationCategory, NotificationTarget } from '../../lib/notificationKinds'
import { dayGroup } from '../../lib/relativeTime'
import type { DayGroup } from '../../lib/relativeTime'
import { tabPanelProps } from '../../lib/tabs'
import { useDialog } from '@/shared/hooks/useDialog'
import { Backdrop } from '@/shared/ui/Backdrop'
import ConfirmDeleteModal from '@/shared/ui/ConfirmDeleteModal'
import { Tabs } from '@/shared/ui/Tabs'
import { ghostBtnStyle, segBtnStyle, segTrackStyle } from '@/shared/ui/uiTokens'
import type { TranslationKey } from '../../i18n/translations'
import type { AppNotification } from '../../types'
import { NotificationItem } from './NotificationItem'

// A central de notificações (NOTIF-001): gaveta à direita no desktop, folha de
// baixo no celular. Abas Todas / Não lidas, filtro por categoria, grupos por
// dia, "carregar mais" e "limpar lidas". Esc fecha, o foco fica preso e volta
// ao sino (useDialog). Carregada sob demanda (o sino importa no 1º clique).

type View = 'all' | 'unread'
const VIEWS: readonly View[] = ['all', 'unread']
const TABS_ID = 'notif-tabs'
const GROUPS: readonly DayGroup[] = ['today', 'yesterday', 'week', 'earlier']
const GROUP_LABELS: Record<DayGroup, TranslationKey> = {
  today: 'notif_group_today',
  yesterday: 'notif_group_yesterday',
  week: 'notif_group_week',
  earlier: 'notif_group_earlier',
}
const FILTER_LABELS: Record<NotificationCategory | 'all', TranslationKey> = { all: 'notif_cat_all', ...CATEGORY_LABELS }
const MINUTE = 60_000

export default function NotificationCenter({ isMobile, onClose, onOpenItem }: {
  isMobile: boolean
  onClose: () => void
  /** Abrir o item da notificação (o sino fecha a central e navega). */
  onOpenItem: (n: AppNotification, target: NotificationTarget | null) => void
}) {
  const { t } = useLanguage()
  const {
    notifications, unreadCount, loading, error, hasMore, loadingMore,
    loadMore, reload, setRead, markAllRead, remove, clearRead,
  } = useNotifications()
  const { titleId, dialogProps } = useDialog({ onClose, closeOnEsc: true })
  const [view, setView] = useState<View>('all')
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all')
  const [confirmClear, setConfirmClear] = useState(false)
  const [inviteStates, setInviteStates] = useState<Record<string, InviteState>>({})
  // "Há 5 minutos" anda sozinho enquanto a central fica aberta.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), MINUTE)
    return () => clearInterval(id)
  }, [])

  // Situação dos convites citados (pendente / aceito / recusado).
  const inviteIds = useMemo(() => notifications.map(notificationInviteId).filter((id): id is string => !!id), [notifications])
  const inviteKey = inviteIds.join(',')
  useEffect(() => {
    if (!inviteKey) return
    let alive = true
    void fetchInviteStates(inviteKey.split(',')).then(states => {
      if (alive) setInviteStates(prev => ({ ...prev, ...states }))
    })
    return () => { alive = false }
  }, [inviteKey])

  const inView = notifications.filter(n => view === 'all' || !n.read)
  const visible = inView.filter(n => category === 'all' || notificationCategory(n) === category)
  // Contagens da aba atual (Todas ou Não lidas), das notificações carregadas.
  const counts = useMemo(() => {
    const out: Record<NotificationCategory, number> = { finance: 0, projects: 0, pages: 0, system: 0 }
    for (const n of notifications) if (view === 'all' || !n.read) out[notificationCategory(n)]++
    return out
  }, [notifications, view])
  const loadedUnread = notifications.filter(n => !n.read).length
  const groups = GROUPS
    .map(group => ({ group, items: visible.filter(n => dayGroup(new Date(n.created_at), now) === group) }))
    .filter(g => g.items.length > 0)
  const hasRead = notifications.some(n => n.read)
  const emptyText = notifications.length === 0 && !hasMore ? t('notif_empty')
    : view === 'unread' && unreadCount > loadedUnread ? t('notif_empty_unread_older')
      : view === 'unread' && category === 'all' ? t('notif_empty_unread')
        : notifications.length === 0 ? t('notif_empty') : t('notif_empty_filter')

  // O item que some da lista (excluído, ou lido na aba Não lidas) levaria o
  // foco junto para o <body>: ele passa ao item seguinte (ou ao anterior, ou à lista).
  const listRef = useRef<HTMLDivElement>(null)
  const focusAfterRemoval = (id: string) => {
    const ids = visible.map(n => n.id)
    const index = ids.indexOf(id)
    const nextId = ids[index + 1] ?? ids[index - 1]
    requestAnimationFrame(() => {
      const next = nextId ? listRef.current?.querySelector<HTMLElement>(`[data-notif-id="${nextId}"]`) : null
      ;(next ?? listRef.current)?.focus()
    })
  }

  const openPrefs = () => {
    onClose()
    emitAppEvent('settings_open', { tab: 'notifications' })
  }

  return (
    <>
    {/* Clicar fora (no fundo, não no painel) fecha; arrastar uma seleção de texto até o fundo, não.
        Mesma camada dos modais (1000): a confirmação, que vem depois no DOM, fica por cima. */}
    <Backdrop
      align={isMobile ? 'bottom' : 'right'}
      zIndex={1000}
      color="rgba(0,0,0,0.32)"
      onClick={e => { if (e.target === e.currentTarget && !window.getSelection()?.toString()) onClose() }}
    >
      <div
        {...dialogProps}
        style={{
          display: 'flex', flexDirection: 'column', backgroundColor: 'var(--color-surface)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          ...(isMobile
            ? { width: '100%', height: '85vh', borderRadius: '16px 16px 0 0' }
            : { width: 420, maxWidth: '100vw', height: '100%', borderLeft: '1px solid var(--color-border)' }),
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 14px 10px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>{t('notif_title')}</h2>
          {unreadCount > 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, color: 'var(--color-text)', backgroundColor: 'var(--color-accent-soft)' }}>
              {unreadCount}
            </span>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {/* Fica na tela (aria-disabled) mesmo sem não lidas: o foco não cai no <body> depois do clique. */}
            <button
              type="button"
              aria-disabled={unreadCount === 0}
              onClick={() => { if (unreadCount > 0) void markAllRead() }}
              title={t('notif_mark_all_read')}
              aria-label={t('notif_mark_all_read')}
              style={{ ...iconBtn, opacity: unreadCount === 0 ? 0.45 : 1, cursor: unreadCount === 0 ? 'default' : 'pointer' }}
            >
              <CheckCheck size={16} />
            </button>
            <button type="button" onClick={openPrefs} title={t('notif_prefs')} aria-label={t('notif_prefs')} style={iconBtn}>
              <Settings2 size={16} />
            </button>
            <button type="button" onClick={onClose} title={t('notif_close')} aria-label={t('notif_close')} style={iconBtn}>
              <X size={16} />
            </button>
          </span>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
          <Tabs
            idBase={TABS_ID}
            items={VIEWS}
            selected={view}
            onSelect={setView}
            label={t('notif_tabs_label')}
            style={{ ...segTrackStyle, display: 'flex' }}
            renderTab={(id, props, isSelected) => (
              <button key={id} type="button" {...props} style={segBtnStyle(isSelected, { wide: true })}>
                {id === 'all' ? t('notif_tab_all') : t('notif_tab_unread')}
              </button>
            )}
          />
          <div role="group" aria-label={t('notif_filter_label')} style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
            {(['all', ...NOTIFICATION_CATEGORIES] as const).map(cat => {
              // "Tudo" com "+" quando ainda há mais para carregar.
              const count = cat === 'all' ? `${inView.length}${hasMore ? '+' : ''}` : counts[cat]
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={category === cat}
                  onClick={() => setCategory(cat)}
                  style={{
                    flexShrink: 0, fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${category === cat ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    color: category === cat ? 'var(--color-text)' : 'var(--color-text-subtle)',
                    backgroundColor: category === cat ? 'var(--color-accent-soft)' : 'transparent',
                  }}
                >
                  {t(FILTER_LABELS[cat])} <span style={{ fontWeight: 500, opacity: 0.8 }}>{count}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div ref={listRef} {...tabPanelProps(TABS_ID, view)} style={{ flex: 1, overflowY: 'auto', padding: '6px 6px 12px' }}>
          {loading ? (
            <p style={statusText}>{t('notif_loading')}</p>
          ) : error ? (
            <div style={{ ...statusText, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <span>{t('notif_load_error')}</span>
              <button type="button" onClick={() => { void reload() }} style={ghostBtnStyle}>{t('notif_retry')}</button>
            </div>
          ) : groups.length === 0 ? (
            <p style={statusText}>{emptyText}</p>
          ) : (
            groups.map(({ group, items }) => (
              <section key={group} aria-labelledby={`notif-group-${group}`} style={{ marginTop: 8 }}>
                <h3 id={`notif-group-${group}`} style={{ margin: '4px 10px 4px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
                  {t(GROUP_LABELS[group])}
                </h3>
                <ul style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {items.map(n => {
                    const inviteId = notificationInviteId(n)
                    return (
                      <NotificationItem
                        key={n.id}
                        notification={n}
                        now={now}
                        inviteState={inviteId ? inviteStates[inviteId] : undefined}
                        onOpen={onOpenItem}
                        onSetRead={(id, read) => {
                          if (view === 'unread' && read) focusAfterRemoval(id)
                          void setRead(id, read)
                        }}
                        onDelete={id => {
                          focusAfterRemoval(id)
                          void remove(id)
                        }}
                        onInviteState={(id, state) => setInviteStates(prev => ({ ...prev, [id]: state }))}
                      />
                    )
                  })}
                </ul>
              </section>
            ))
          )}
          {!loading && !error && hasMore && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
              <button type="button" aria-disabled={loadingMore} onClick={() => { void loadMore() }} style={ghostBtnStyle}>
                {loadingMore ? t('notif_loading') : t('notif_load_more')}
              </button>
            </div>
          )}
        </div>

        {hasRead && (
          <footer style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px', borderTop: '1px solid var(--color-border)' }}>
            <button type="button" onClick={() => setConfirmClear(true)} style={{ ...ghostBtnStyle, fontSize: 12.5 }}>{t('notif_clear_read')}</button>
          </footer>
        )}
      </div>
    </Backdrop>
    {/* Fora do Backdrop da central: o clique no fundo da confirmação não pode fechar a central. */}
    <ConfirmDeleteModal
        open={confirmClear}
        title={t('notif_clear_read_title')}
        message={t('notif_clear_read_text')}
        confirmLabel={t('notif_clear_read')}
        onConfirm={async () => {
          setConfirmClear(false)
          // O botão "Limpar lidas" some junto com as lidas: depois que a
          // confirmação fecha (e devolve o foco a ele), o foco vai para a lista.
          requestAnimationFrame(() => listRef.current?.focus())
          await clearRead()
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </>
  )
}

const iconBtn = {
  width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', borderRadius: 8, background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)',
} as const

const statusText = { margin: '28px 16px', textAlign: 'center', fontSize: 13.5, color: 'var(--color-text-muted)' } as const
