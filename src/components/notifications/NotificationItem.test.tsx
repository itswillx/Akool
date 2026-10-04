// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import type { AppNotification } from '../../types'

const data = vi.hoisted(() => ({ acceptWorkspaceInvite: vi.fn(), declineWorkspaceInvite: vi.fn(), fetchInviteStates: vi.fn() }))
vi.mock('../../lib/data/notifications', () => data)

import { onAppEvent } from '../../lib/appEvents'
import { NotificationItem } from './NotificationItem'

const NOW = new Date('2026-10-04T12:10:00Z')
const note = (extra: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', user_id: 'u1', type: 'page_shared', title: 'gravado', body: '', read: false, created_at: '2026-10-04T12:05:00Z',
  data: { page_id: 'p1', page_title: 'Plano', role: 'editor', actor_id: 'a1', actor_name: 'Ana' }, ...extra,
})
const invite = note({ type: 'workspace_invite', data: { workspace_id: 'w1', workspace_name: 'Família', invite_id: 'i1', actor_id: 'a1', actor_name: 'Ana' } })

function renderItem(n: AppNotification, inviteState?: 'pending' | 'accepted' | 'declined') {
  const props = { onOpen: vi.fn(), onSetRead: vi.fn(), onDelete: vi.fn(), onInviteState: vi.fn() }
  const utils = render(<ul><NotificationItem notification={n} now={NOW} inviteState={inviteState} {...props} /></ul>)
  return { ...utils, ...props }
}

beforeEach(() => { for (const fn of Object.values(data)) fn.mockReset() })

describe('NotificationItem', () => {
  it('mostra autor, texto traduzido e tempo; o clique abre o item; sem violações sérias', async () => {
    const { container, onOpen } = renderItem(note())
    const main = screen.getByRole('button', { name: /Ana compartilhou "Plano" com você/ })
    expect(main.textContent).toContain('Papel: Editor')
    expect(main.textContent).toContain('há 5 minutos')
    expect(main.textContent).toContain('Não lida')
    expect(container.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-04T12:05:00Z')
    fireEvent.click(main)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), { kind: 'page', pageId: 'p1' })
    await expectNoAxeViolations(container)
  })

  it('detalhes: a seta mostra, com lida/não lida e excluir', () => {
    const { onSetRead, onDelete } = renderItem(note({ read: true }))
    const toggle = screen.getByRole('button', { name: 'Mostrar detalhes' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Ocultar detalhes' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Página')).toBeTruthy()
    expect(screen.getByText('Recebida em')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como não lida' }))
    expect(onSetRead).toHaveBeenCalledWith('n1', false)
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }))
    expect(onDelete).toHaveBeenCalledWith('n1')
  })

  it('sem quem agiu (alerta de backup), o ícone do tipo no lugar do avatar', () => {
    const { onSetRead } = renderItem(note({ type: 'backup_stale', data: { last_completed_at: null } }))
    expect(screen.getByRole('button', { name: /Backup atrasado/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar detalhes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como lida' }))
    expect(onSetRead).toHaveBeenCalledWith('n1', true)
  })

  it('convite pendente: aceitar muda a situação, marca lida e avisa o Financeiro', async () => {
    data.acceptWorkspaceInvite.mockResolvedValue({ error: null })
    const changed = vi.fn()
    const off = onAppEvent('finance_workspace_changed', changed)
    const { onInviteState, onSetRead } = renderItem(invite, 'pending')
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
    await waitFor(() => expect(onInviteState).toHaveBeenCalledWith('i1', 'accepted'))
    expect(onSetRead).toHaveBeenCalledWith('n1', true)
    expect(changed).toHaveBeenCalled()
    off()
  })

  it('recusar com erro: se já foi respondido, mostra a situação real; senão, o erro no item', async () => {
    data.declineWorkspaceInvite.mockResolvedValue({ error: { message: 'Invite is no longer pending' } })
    data.fetchInviteStates.mockResolvedValueOnce({ i1: 'accepted' })
    const first = renderItem(invite, 'pending')
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    await waitFor(() => expect(first.onInviteState).toHaveBeenCalledWith('i1', 'accepted'))
    expect(screen.queryByRole('alert')).toBeNull()
    first.unmount()

    data.fetchInviteStates.mockResolvedValueOnce({ i1: 'pending' })
    const second = renderItem(invite, 'pending')
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível responder ao convite. Tente de novo.')
    expect(second.onInviteState).not.toHaveBeenCalled()
  })

  it('aceitar estando em outro workspace: explica e deixa só Recusar', async () => {
    data.acceptWorkspaceInvite.mockResolvedValue({ error: { message: 'You already belong to a workspace' } })
    renderItem(invite, 'pending')
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Você já pertence a um workspace')
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeTruthy()
    expect(data.fetchInviteStates).not.toHaveBeenCalled()
  })

  it('convite já respondido: sem botões, situação nos detalhes', () => {
    renderItem(invite, 'declined')
    expect(screen.queryByRole('button', { name: 'Aceitar' })).toBeNull()
    // O corpo passa a dizer a situação (não "aceite para…"); os detalhes repetem.
    expect(screen.getByRole('button', { name: /Ana convidou você/ }).textContent).toContain('Recusado')
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar detalhes' }))
    expect(screen.getAllByText('Recusado')).toHaveLength(2)
    expect(screen.getByText('Família')).toBeTruthy()
  })
})
