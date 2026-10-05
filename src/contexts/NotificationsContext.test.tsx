// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../test/rtl'
import type { AppNotification } from '../types'

// NOTIF-001: o contexto das notificações com a camada de dados simulada.
type Handlers = { onInsert: (n: AppNotification) => void; onUpdate: (n: AppNotification) => void }
const data = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  countUnreadNotifications: vi.fn(),
  setNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  deleteNotification: vi.fn(),
  deleteReadNotifications: vi.fn(),
  subscribeNotifications: vi.fn(),
}))
const live: { handlers: Handlers | null } = { handlers: null }
vi.mock('../lib/data/notifications', () => ({
  NOTIFICATIONS_PAGE: 3,
  listNotifications: data.listNotifications,
  countUnreadNotifications: data.countUnreadNotifications,
  setNotificationRead: data.setNotificationRead,
  markAllNotificationsRead: data.markAllNotificationsRead,
  deleteNotification: data.deleteNotification,
  deleteReadNotifications: data.deleteReadNotifications,
  subscribeNotifications: data.subscribeNotifications,
}))
const auth = vi.hoisted((): { user: { id: string } | null } => ({ user: { id: 'u1' } }))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }))

import { onAppEvent } from '../lib/appEvents'
import { writeNotificationPrefs } from '../lib/notificationPrefs'
import { NotificationsProvider, useNotifications } from './NotificationsContext'
import { ToastProvider } from './ToastContext'

const note = (id: string, read = false, extra: Partial<AppNotification> = {}): AppNotification => ({
  id, user_id: 'u1', type: 'page_shared', title: `Título ${id}`, body: '', read,
  data: { page_id: 'p1', page_title: `Página ${id}`, actor_name: 'Ana', role: 'editor' },
  created_at: `2026-10-0${9 - id.length}T12:00:00Z`, ...extra,
})
const ok = (rows: AppNotification[]) => ({ data: rows, error: null })

let ctx: ReturnType<typeof useNotifications>
const report = (value: ReturnType<typeof useNotifications>) => { ctx = value }
function Probe() {
  const value = useNotifications()
  report(value)
  return <p data-testid="unread">{value.unreadCount}</p>
}
const renderProvider = () => render(<ToastProvider><NotificationsProvider><Probe /></NotificationsProvider></ToastProvider>)

beforeEach(() => {
  auth.user = { id: 'u1' }
  for (const fn of Object.values(data)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset()
  data.subscribeNotifications.mockImplementation((_id: string, handlers: Handlers) => {
    live.handlers = handlers
    return () => { live.handlers = null }
  })
  data.countUnreadNotifications.mockResolvedValue({ count: 0, error: null })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => { localStorage.clear() })

describe('NotificationsProvider', () => {
  it('carrega a primeira página e conta as não lidas que ainda não vieram', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a'), note('bb', true)]))
    data.countUnreadNotifications.mockResolvedValue({ count: 5, error: null })
    renderProvider()
    await waitFor(() => expect(ctx.loading).toBe(false))
    expect(ctx.notifications.map(n => n.id)).toEqual(['a', 'bb'])
    expect(ctx.unreadCount).toBe(5)
    expect(ctx.hasMore).toBe(false)
  })

  it('erro na carga vira estado de erro; tentar de novo carrega', async () => {
    data.listNotifications.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    renderProvider()
    await waitFor(() => expect(ctx.error).toBe(true))
    data.listNotifications.mockResolvedValue(ok([note('a')]))
    data.countUnreadNotifications.mockResolvedValue({ count: null, error: { message: 'x' } })
    await act(() => ctx.reload())
    expect(ctx.error).toBe(false)
    expect(ctx.unreadCount).toBe(1)
  })

  it('sem usuário, lista vazia', async () => {
    auth.user = null
    renderProvider()
    await waitFor(() => expect(ctx.loading).toBe(false))
    expect(ctx.notifications).toEqual([])
    expect(data.listNotifications).not.toHaveBeenCalled()
  })

  it('carregar mais: página seguinte pelo cursor, desconta as não lidas escondidas; erro avisa', async () => {
    data.listNotifications.mockResolvedValueOnce(ok([note('a'), note('bb'), note('ccc', true)]))
    data.countUnreadNotifications.mockResolvedValue({ count: 3, error: null })
    renderProvider()
    await waitFor(() => expect(ctx.hasMore).toBe(true))
    expect(ctx.unreadCount).toBe(3)
    data.listNotifications.mockResolvedValueOnce(ok([note('dddd')]))
    await act(() => ctx.loadMore())
    expect(data.listNotifications).toHaveBeenLastCalledWith('u1', { created_at: note('ccc').created_at, id: 'ccc' })
    expect(ctx.notifications.map(n => n.id)).toEqual(['a', 'bb', 'ccc', 'dddd'])
    expect(ctx.unreadCount).toBe(3)
    expect(ctx.hasMore).toBe(false)

    data.listNotifications.mockResolvedValueOnce({ data: null, error: { message: 'x' } })
    await act(() => ctx.loadMore())
    expect(screen.getByText('Não foi possível carregar as notificações.')).toBeTruthy()
  })

  it('notificação nova: entra no topo e avisa com "Ver" (que pede para abrir o item)', async () => {
    data.listNotifications.mockResolvedValue(ok([]))
    renderProvider()
    await waitFor(() => expect(live.handlers).not.toBeNull())
    const opened = vi.fn()
    const off = onAppEvent('notification_open', opened)
    act(() => live.handlers?.onInsert(note('nova')))
    expect(ctx.notifications[0].id).toBe('nova')
    // O texto vem do registro dos tipos, carregado sob demanda.
    expect(await screen.findByText('Ana compartilhou "Página nova" com você')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    expect(opened).toHaveBeenCalledWith({ id: 'nova' })
    off()
    // Repetida (chegou também pela carga): nada de aviso novo.
    act(() => live.handlers?.onInsert(note('nova')))
    expect(ctx.notifications).toHaveLength(1)
  })

  it('sem aviso: categoria silenciada, central aberta, aba escondida ou já lida', async () => {
    data.listNotifications.mockResolvedValue(ok([]))
    renderProvider()
    await waitFor(() => expect(live.handlers).not.toBeNull())
    // O registro dos tipos chega por import dinâmico: espera antes de mudar o cenário.
    const settle = () => act(async () => {
      await import('../lib/notificationKinds')
      await import('../lib/notificationPrefs')
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    writeNotificationPrefs({ muted: ['pages'] })
    act(() => live.handlers?.onInsert(note('a')))
    await settle()
    writeNotificationPrefs({ muted: [] })
    act(() => ctx.setCenterOpen(true))
    act(() => live.handlers?.onInsert(note('bb')))
    await settle()
    act(() => ctx.setCenterOpen(false))
    act(() => live.handlers?.onInsert(note('ccc', true)))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => live.handlers?.onInsert(note('dddd')))
    await settle()
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull()
    expect(ctx.notifications).toHaveLength(4)
  })

  it('lida em outra aba (UPDATE) atualiza a contagem', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a')]))
    renderProvider()
    await waitFor(() => expect(ctx.unreadCount).toBe(1))
    act(() => live.handlers?.onUpdate({ ...note('a'), read: true }))
    expect(ctx.unreadCount).toBe(0)
  })

  it('lida/não lida otimista; erro desfaz e avisa', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a')]))
    renderProvider()
    await waitFor(() => expect(ctx.unreadCount).toBe(1))
    data.setNotificationRead.mockResolvedValue({ data: [{ id: 'a' }], error: null })
    await act(() => ctx.markAsRead('a'))
    expect(ctx.unreadCount).toBe(0)
    await act(() => ctx.markAsRead('a'))
    expect(data.setNotificationRead).toHaveBeenCalledTimes(1)
    data.setNotificationRead.mockResolvedValue({ data: null, error: { message: 'falhou' } })
    await act(() => ctx.setRead('a', false))
    expect(ctx.unreadCount).toBe(0)
    expect(screen.getByRole('alert')).toBeTruthy()
    await act(() => ctx.setRead('zz', true))
  })

  it('marcar todas zera inclusive as não carregadas; erro restaura', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a')]))
    data.countUnreadNotifications.mockResolvedValue({ count: 4, error: null })
    renderProvider()
    await waitFor(() => expect(ctx.unreadCount).toBe(4))
    data.markAllNotificationsRead.mockResolvedValue({ data: null, error: { message: 'falhou' } })
    await act(() => ctx.markAllRead())
    expect(ctx.unreadCount).toBe(4)
    data.markAllNotificationsRead.mockResolvedValue({ data: null, error: null })
    await act(() => ctx.markAllRead())
    expect(ctx.unreadCount).toBe(0)
  })

  it('excluir e limpar lidas; erro devolve na ordem', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a'), note('bb', true), note('ccc', true)]))
    renderProvider()
    await waitFor(() => expect(ctx.notifications).toHaveLength(3))
    data.deleteNotification.mockResolvedValue({ data: null, error: { message: 'falhou' } })
    await act(() => ctx.remove('bb'))
    expect(ctx.notifications.map(n => n.id)).toEqual(['a', 'bb', 'ccc'])
    data.deleteNotification.mockResolvedValue({ data: [{ id: 'bb' }], error: null })
    await act(() => ctx.remove('bb'))
    await act(() => ctx.remove('zz'))
    expect(ctx.notifications.map(n => n.id)).toEqual(['a', 'ccc'])
    data.deleteReadNotifications.mockResolvedValue({ data: null, error: { message: 'falhou' } })
    await act(() => ctx.clearRead())
    expect(ctx.notifications.map(n => n.id)).toEqual(['a', 'ccc'])
    data.deleteReadNotifications.mockResolvedValue({ data: null, error: null })
    await act(() => ctx.clearRead())
    expect(ctx.notifications.map(n => n.id)).toEqual(['a'])
  })

  it('lida em outra aba fora das carregadas: recontagem no servidor (uma por rajada)', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a')]))
    data.countUnreadNotifications.mockResolvedValue({ count: 4, error: null })
    renderProvider()
    await waitFor(() => expect(ctx.unreadCount).toBe(4))
    data.countUnreadNotifications.mockResolvedValue({ count: 1, error: null })
    act(() => {
      live.handlers?.onUpdate({ ...note('zz'), read: true })
      live.handlers?.onUpdate({ ...note('yy'), read: true })
    })
    await waitFor(() => expect(ctx.unreadCount).toBe(1))
    expect(data.countUnreadNotifications).toHaveBeenCalledTimes(2)
  })

  it('lista esvaziada: "carregar mais" recomeça da primeira página; limpar tudo recarrega', async () => {
    data.listNotifications.mockResolvedValue(ok([note('a', true)]))
    renderProvider()
    await waitFor(() => expect(ctx.notifications).toHaveLength(1))
    data.deleteReadNotifications.mockResolvedValue({ data: null, error: null })
    data.listNotifications.mockResolvedValue(ok([note('bb')]))
    await act(() => ctx.clearRead())
    await waitFor(() => expect(ctx.notifications.map(n => n.id)).toEqual(['bb']))
    data.deleteNotification.mockResolvedValue({ data: [{ id: 'bb' }], error: null })
    await act(() => ctx.remove('bb'))
    await act(() => ctx.loadMore())
    expect(data.listNotifications).toHaveBeenLastCalledWith('u1', undefined)
  })

  it('no teto de 500, a mais antiga sai da lista e volta a contar como "carregar mais"', async () => {
    const many = Array.from({ length: 500 }, (_, i) => note(`n${i}`))
    data.listNotifications.mockResolvedValue(ok(many))
    data.countUnreadNotifications.mockResolvedValue({ count: 500, error: null })
    renderProvider()
    await waitFor(() => expect(ctx.unreadCount).toBe(500))
    act(() => live.handlers?.onInsert(note('nova')))
    expect(ctx.notifications).toHaveLength(500)
    expect(ctx.unreadCount).toBe(501)
    expect(ctx.hasMore).toBe(true)
  })

  it('fora do provider, erro claro', () => {
    const Bad = () => { useNotifications(); return null }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bad />)).toThrow('useNotifications must be used within NotificationsProvider')
  })
})
