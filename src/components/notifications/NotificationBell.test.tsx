// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../../test/rtl'
import type { AppNotification } from '../../types'

const ctx = vi.hoisted(() => ({
  notifications: [] as AppNotification[],
  unreadCount: 0,
  markAsRead: vi.fn(),
  setCenterOpen: vi.fn(),
}))
vi.mock('../../contexts/NotificationsContext', () => ({ useNotifications: () => ctx }))
const openTarget = vi.hoisted(() => vi.fn())
vi.mock('./useNotificationTarget', () => ({ useNotificationTarget: () => openTarget }))
// A central de verdade tem teste próprio; aqui só o que o sino passa para ela.
vi.mock('./NotificationCenter', () => ({
  default: ({ onClose, onOpenItem }: { onClose: () => void; onOpenItem: (n: AppNotification, target: null) => void }) => (
    <div role="dialog" aria-label="central">
      <button type="button" onClick={onClose}>fechar</button>
      <button type="button" onClick={() => onOpenItem(ctx.notifications[1], null)}>abrir sem destino</button>
    </div>
  ),
}))

import { emitAppEvent } from '../../lib/appEvents'
import { NotificationBell } from './NotificationBell'

const page: AppNotification = { id: 'p', user_id: 'u1', type: 'page_shared', title: 't', body: '', read: false, created_at: '2026-10-04T12:00:00Z', data: { page_id: 'p1' } }
const loan: AppNotification = { ...page, id: 'l', type: 'loan_approved', data: {} }

beforeEach(() => {
  ctx.notifications = [page, loan]
  ctx.unreadCount = 12
  for (const fn of [ctx.markAsRead, ctx.setCenterOpen, openTarget]) fn.mockReset()
})

describe('NotificationBell', () => {
  it('diz quantas não lidas tem, abre e fecha a central e avisa o contexto', async () => {
    render(<NotificationBell isMobile={false} />)
    const bell = screen.getByRole('button', { name: 'Notificações, 12 não lidas' })
    expect(bell.textContent).toBe('9+')
    expect(bell.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(bell)
    expect(await screen.findByRole('dialog', { name: 'central' })).toBeTruthy()
    expect(bell.getAttribute('aria-expanded')).toBe('true')
    expect(ctx.setCenterOpen).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ctx.setCenterOpen).toHaveBeenLastCalledWith(false)
  })

  it('uma não lida: singular no nome', () => {
    ctx.unreadCount = 1
    render(<NotificationBell isMobile />)
    expect(screen.getByRole('button', { name: 'Notificações, 1 não lida' }).textContent).toBe('1')
  })

  it('sem não lidas, só "Notificações" e sem contador', () => {
    ctx.unreadCount = 0
    render(<NotificationBell isMobile />)
    expect(screen.getByRole('button', { name: 'Notificações' }).textContent).toBe('')
  })

  it('"Ver" no aviso abre o item (marca lida e navega); sem destino, abre a central', async () => {
    render(<NotificationBell isMobile={false} />)
    act(() => emitAppEvent('notification_open', { id: 'p' }))
    // O destino vem do registro dos tipos, carregado sob demanda.
    await waitFor(() => expect(openTarget).toHaveBeenCalledWith({ kind: 'page', pageId: 'p1' }))
    expect(ctx.markAsRead).toHaveBeenCalledWith('p')
    act(() => emitAppEvent('notification_open', { id: 'l' }))
    expect(await screen.findByRole('dialog', { name: 'central' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'abrir sem destino' }))
    expect(ctx.markAsRead).toHaveBeenLastCalledWith('l')
    expect(screen.getByRole('dialog', { name: 'central' })).toBeTruthy()
  })

  it('id que não está na lista (ainda não carregada): abre a central', async () => {
    render(<NotificationBell isMobile={false} />)
    act(() => emitAppEvent('notification_open', { id: 'outra' }))
    expect(await screen.findByRole('dialog', { name: 'central' })).toBeTruthy()
    expect(openTarget).not.toHaveBeenCalled()
  })
})
