// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import type { AppNotification } from '../../types'

// A central com o contexto simulado: o que ela mostra e o que pede ao contexto.
const ctx = vi.hoisted(() => ({
  notifications: [] as AppNotification[],
  unreadCount: 0,
  loading: false,
  error: false,
  hasMore: false,
  loadingMore: false,
  loadMore: vi.fn(),
  reload: vi.fn(),
  setRead: vi.fn(),
  markAllRead: vi.fn(),
  remove: vi.fn(),
  clearRead: vi.fn(),
}))
vi.mock('../../contexts/NotificationsContext', () => ({ useNotifications: () => ctx }))
const data = vi.hoisted(() => ({ fetchInviteStates: vi.fn(), acceptWorkspaceInvite: vi.fn(), declineWorkspaceInvite: vi.fn() }))
vi.mock('../../lib/data/notifications', () => data)
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

import { onAppEvent } from '../../lib/appEvents'
import NotificationCenter from './NotificationCenter'

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
const note = (id: string, type: string, read: boolean, created_at: string, data: Record<string, unknown> = {}): AppNotification =>
  ({ id, user_id: 'u1', type, title: `gravado ${id}`, body: '', read, created_at, data })

function renderCenter(isMobile = false) {
  const onClose = vi.fn()
  const onOpenItem = vi.fn()
  const utils = render(<NotificationCenter isMobile={isMobile} onClose={onClose} onOpenItem={onOpenItem} />)
  return { ...utils, onClose, onOpenItem }
}

beforeEach(() => {
  ctx.notifications = [
    note('p', 'page_shared', false, hoursAgo(1), { page_id: 'p1', page_title: 'Plano', actor_name: 'Ana' }),
    note('c', 'card_assigned', true, hoursAgo(1.5), { card_id: 'c1', board_id: 'b1', card_title: 'Tela', actor_name: 'Bia' }),
    note('w', 'workspace_invite', false, hoursAgo(24 * 10), { workspace_id: 'w1', workspace_name: 'Família', invite_id: 'i1', actor_name: 'Caio' }),
  ]
  ctx.unreadCount = 2
  ctx.loading = false
  ctx.error = false
  ctx.hasMore = false
  ctx.loadingMore = false
  for (const fn of [ctx.loadMore, ctx.reload, ctx.setRead, ctx.markAllRead, ctx.remove, ctx.clearRead, ...Object.values(data)]) fn.mockReset()
  data.fetchInviteStates.mockResolvedValue({ i1: 'pending' })
})

describe('NotificationCenter', () => {
  it('é um diálogo com título, contagem, grupos por dia e o convite com Aceitar; sem violações sérias', async () => {
    const { container } = renderCenter()
    const dialog = screen.getByRole('dialog', { name: 'Notificações' })
    expect(within(dialog).getByText('2')).toBeTruthy()
    // Hoje e Antes (a ordem dos grupos segue a do tempo).
    const groups = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)
    expect(groups[groups.length - 1]).toBe('Antes')
    expect(await screen.findByRole('button', { name: 'Aceitar' })).toBeTruthy()
    expect(data.fetchInviteStates).toHaveBeenCalledWith(['i1'])
    await expectNoAxeViolations(container)
  })

  it('Não lidas e categorias filtram; vazio tem texto próprio', async () => {
    renderCenter()
    fireEvent.click(screen.getByRole('tab', { name: 'Não lidas' }))
    expect(screen.queryByRole('button', { name: /Bia atribuiu/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Ana compartilhou/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Projetos/ }))
    expect(screen.getByText('Nada nesta categoria.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Todas' }))
    expect(screen.getByRole('button', { name: /Bia atribuiu/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Projetos/ }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /^Tudo/ }))
    fireEvent.click(screen.getByRole('tab', { name: 'Não lidas' }))
    ctx.notifications = ctx.notifications.map(n => ({ ...n, read: true }))
    ctx.unreadCount = 0
    renderCenter()
    fireEvent.click(screen.getAllByRole('tab', { name: 'Não lidas' })[1])
    expect(screen.getByText('Nenhuma notificação não lida.')).toBeTruthy()
    await waitFor(() => expect(data.fetchInviteStates).toHaveBeenCalled())
  })

  it('abrir um item, ler/excluir, marcar todas e preferências chegam ao contexto e aos eventos', async () => {
    const settings = vi.fn()
    const off = onAppEvent('settings_open', settings)
    const { onOpenItem, onClose } = renderCenter()
    fireEvent.click(screen.getByRole('button', { name: /Ana compartilhou/ }))
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ id: 'p' }), { kind: 'page', pageId: 'p1' })
    fireEvent.click(screen.getAllByRole('button', { name: 'Mostrar detalhes' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como lida' }))
    expect(ctx.setRead).toHaveBeenCalledWith('p', true)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(ctx.remove).toHaveBeenCalledWith('p')
    fireEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
    expect(ctx.markAllRead).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Preferências' }))
    expect(onClose).toHaveBeenCalled()
    expect(settings).toHaveBeenCalledWith({ tab: 'notifications' })
    off()
    await waitFor(() => expect(data.fetchInviteStates).toHaveBeenCalled())
  })

  it('aceitar o convite atualiza a situação na hora', async () => {
    data.acceptWorkspaceInvite.mockResolvedValue({ error: null })
    renderCenter()
    fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull())
  })

  it('limpar lidas pede confirmação; carregar mais; Esc e o X fecham', async () => {
    ctx.hasMore = true
    const { onClose } = renderCenter(true)
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))
    expect(ctx.loadMore).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar lidas' }))
    const confirm = screen.getByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Limpar lidas' }))
    await waitFor(() => expect(ctx.clearRead).toHaveBeenCalled())
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    onClose.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar notificações' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('excluir leva o foco ao item seguinte (não ao <body>)', async () => {
    renderCenter()
    fireEvent.click(screen.getAllByRole('button', { name: 'Mostrar detalhes' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(ctx.remove).toHaveBeenCalledWith('p')
    await waitFor(() => expect(document.activeElement?.getAttribute('data-notif-id')).toBe('c'))
    await waitFor(() => expect(data.fetchInviteStates).toHaveBeenCalled())
  })

  it('contagens seguem a aba; "Tudo" ganha "+" com mais para carregar; não lidas antigas avisam', async () => {
    ctx.hasMore = true
    renderCenter()
    expect(screen.getByRole('button', { name: /^Tudo/ }).textContent).toContain('3+')
    fireEvent.click(screen.getByRole('tab', { name: 'Não lidas' }))
    expect(screen.getByRole('button', { name: /^Projetos/ }).textContent).toContain('0')
    // Nenhuma não lida carregada nesta categoria, mas há não lidas antigas.
    ctx.unreadCount = 9
    fireEvent.click(screen.getByRole('button', { name: /^Projetos/ }))
    expect(screen.getByText('As não lidas mais antigas ainda não foram carregadas: use "Carregar mais".')).toBeTruthy()
    await waitFor(() => expect(data.fetchInviteStates).toHaveBeenCalled())
  })

  it('carregando, erro com "tentar de novo" e lista vazia', () => {
    ctx.loading = true
    const first = renderCenter()
    expect(screen.getByText('Carregando…')).toBeTruthy()
    first.unmount()
    ctx.loading = false
    ctx.error = true
    const second = renderCenter()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(ctx.reload).toHaveBeenCalled()
    second.unmount()
    ctx.error = false
    ctx.notifications = []
    ctx.unreadCount = 0
    renderCenter()
    expect(screen.getByText('Nenhuma notificação')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Limpar lidas' })).toBeNull()
  })

  it('clicar no fundo fecha; clicar no painel não', () => {
    const { onClose } = renderCenter()
    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalled()
  })
})
