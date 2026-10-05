import { beforeAll, describe, expect, it } from 'vitest'
import { getT, loadLang } from '../i18n/translations'
import type { AppNotification } from '../types'
import {
  notificationActor,
  notificationCategory,
  notificationDetails,
  notificationInviteId,
  notificationLook,
  notificationTarget,
  notificationText,
} from './notificationKinds'

const t = getT('pt-BR')
// O inglês é um chunk à parte (PERF-009): sem carregar, getT('en') responde em pt-BR.
beforeAll(async () => { await loadLang('en') })
const note = (type: string, data: Record<string, unknown> = {}, extra: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1', user_id: 'u1', type, title: 'Título gravado', body: 'Corpo gravado', data, read: false, created_at: '2026-10-04T12:00:00Z', ...extra,
})
const ws = { workspace_id: 'w1', workspace_name: 'Família Silva', actor_id: 'a1', actor_name: 'Ana' }

describe('notificationText', () => {
  it.each([
    ['workspace_invite', 'Ana convidou você para "Família Silva"', 'Aceite para compartilhar as finanças da família.'],
    ['invite_accepted', 'Ana aceitou seu convite para "Família Silva"', 'Um novo membro entrou no workspace.'],
    ['member_joined', 'Ana entrou em "Família Silva"', 'Um novo membro entrou no workspace.'],
    ['invite_declined', 'Ana recusou seu convite para "Família Silva"', 'O convite para o workspace foi recusado.'],
  ])('%s usa o nome de quem agiu e do workspace', (type, title, body) => {
    expect(notificationText(note(type, ws), t, 'pt-BR')).toEqual({ title, body })
  })

  it('member_left distingue "removeu você" de "saiu" pelo título gravado', () => {
    expect(notificationText(note('member_left', ws, { title: 'Ana removeu você de "X"' }), t, 'pt-BR').title).toBe('Ana removeu você de "Família Silva"')
    expect(notificationText(note('member_left', ws, { title: 'Ana saiu de "X"' }), t, 'pt-BR').title).toBe('Ana saiu de "Família Silva"')
  })

  it('sem os campos (notificação antiga), mostra o texto gravado', () => {
    expect(notificationText(note('workspace_invite', { workspace_id: 'w1' }), t, 'pt-BR')).toEqual({ title: 'Título gravado', body: 'Corpo gravado' })
    expect(notificationText(note('tipo_novo'), t, 'pt-BR')).toEqual({ title: 'Título gravado', body: 'Corpo gravado' })
    expect(notificationText(note('page_shared', { actor_name: 'Ana' }), t, 'pt-BR').title).toBe('Título gravado')
    expect(notificationText(note('board_shared', { actor_name: 'Ana' }), t, 'pt-BR').title).toBe('Título gravado')
    expect(notificationText(note('card_assigned', { actor_name: '  ' }), t, 'pt-BR').title).toBe('Título gravado')
  })

  it('página, quadro e card, com papel traduzido e acesso alterado', () => {
    const page = { page_id: 'p1', page_title: 'Plano', role: 'co_owner', actor_name: 'Ana' }
    expect(notificationText(note('page_shared', page), t, 'pt-BR')).toEqual({ title: 'Ana compartilhou "Plano" com você', body: 'Papel: Co-proprietário' })
    expect(notificationText(note('page_shared', { ...page, changed: true, role: 'x' }), t, 'pt-BR')).toEqual({ title: 'Ana mudou seu acesso a "Plano"', body: '' })
    const board = { board_id: 'b1', board_name: 'Lançamento', role: 'viewer', actor_name: 'Ana' }
    expect(notificationText(note('board_shared', board), t, 'pt-BR')).toEqual({ title: 'Ana compartilhou o quadro "Lançamento" com você', body: 'Papel: Leitor' })
    expect(notificationText(note('board_shared', { ...board, changed: true, role: undefined }), t, 'pt-BR').title).toBe('Ana mudou seu acesso ao quadro "Lançamento"')
    const card = { card_id: 'c1', card_title: 'Tela', board_id: 'b1', board_name: 'Lançamento', actor_name: 'Ana' }
    expect(notificationText(note('card_assigned', card), t, 'pt-BR')).toEqual({ title: 'Ana atribuiu "Tela" a você', body: 'Quadro: Lançamento' })
    const noBoard: Record<string, unknown> = { ...card }
    delete noBoard.board_name
    expect(notificationText(note('card_assigned', noBoard), t, 'pt-BR').body).toBe('')
    // Valores crus: vazio vira "Sem título"/"Quadro"; sem nome mas com actor_id, "Alguém".
    expect(notificationText(note('card_assigned', { ...card, card_title: '', board_name: '' }), t, 'pt-BR')).toEqual({ title: 'Ana atribuiu "Sem título" a você', body: 'Quadro: Quadro' })
    expect(notificationText(note('page_shared', { page_id: 'p1', page_title: '', actor_id: 'a1' }), getT('en'), 'en').title).toBe('Someone shared "Untitled" with you')
    expect(notificationText(note('board_shared', { board_name: '', actor_id: 'a1', actor_name: null }), t, 'pt-BR').title).toBe('Alguém compartilhou o quadro "Quadro" com você')
  })

  it('backup atrasado, com e sem data, no idioma da tela', () => {
    expect(notificationText(note('backup_stale', { last_completed_at: null }), t, 'pt-BR')).toEqual({ title: 'Backup atrasado', body: 'Nenhum backup concluído até agora.' })
    const since = notificationText(note('backup_stale', { last_completed_at: '2026-10-01T09:00:00Z' }), getT('en'), 'en')
    expect(since.title).toBe('Backup overdue')
    expect(since.body).toMatch(/^No backup completed since October 1, 2026/)
  })
})

describe('categoria, aparência, destino e detalhes', () => {
  it.each([
    ['workspace_invite', 'finance', 'userPlus', 'accent'],
    ['member_left', 'finance', 'userMinus', 'warning'],
    ['loan_requested', 'finance', 'banknote', 'neutral'],
    ['page_shared', 'pages', 'fileText', 'accent'],
    ['board_shared', 'projects', 'kanban', 'accent'],
    ['card_assigned', 'projects', 'cardCheck', 'accent'],
    ['backup_stale', 'system', 'database', 'warning'],
    ['desconhecido', 'system', 'bell', 'neutral'],
  ])('%s → %s / %s / %s', (type, category, icon, tone) => {
    expect(notificationCategory(note(type))).toBe(category)
    expect(notificationLook(note(type))).toEqual({ icon, tone })
  })

  it('destinos', () => {
    expect(notificationTarget(note('page_shared', { page_id: 'p1' }))).toEqual({ kind: 'page', pageId: 'p1' })
    expect(notificationTarget(note('page_shared'))).toBeNull()
    expect(notificationTarget(note('board_shared', { board_id: 'b1' }))).toEqual({ kind: 'board', boardId: 'b1' })
    expect(notificationTarget(note('board_shared'))).toBeNull()
    expect(notificationTarget(note('card_assigned', { board_id: 'b1', card_id: 'c1' }))).toEqual({ kind: 'card', boardId: 'b1', cardId: 'c1' })
    expect(notificationTarget(note('card_assigned', { board_id: 'b1' }))).toBeNull()
    expect(notificationTarget(note('invite_declined', ws))).toEqual({ kind: 'finance-workspace' })
    expect(notificationTarget(note('backup_stale'))).toEqual({ kind: 'settings-backup' })
    expect(notificationTarget(note('loan_approved'))).toBeNull()
  })

  it('detalhes por tipo', () => {
    const labels = (n: AppNotification) => notificationDetails(n, t, 'pt-BR').map(d => `${d.label}: ${d.value}`)
    expect(labels(note('member_joined', ws))).toEqual(['Workspace: Família Silva'])
    expect(labels(note('member_joined', {}))).toEqual([])
    expect(labels(note('page_shared', { page_title: 'Plano', role: 'viewer' }))).toEqual(['Página: Plano', 'Papel: Visualizador'])
    expect(labels(note('page_shared', {}))).toEqual([])
    expect(labels(note('board_shared', { board_name: 'Q', role: 'editor' }))).toEqual(['Quadro: Q', 'Papel: Editor'])
    expect(labels(note('board_shared', {}))).toEqual([])
    expect(labels(note('card_assigned', { card_title: 'C', board_name: 'Q' }))).toEqual(['Card: C', 'Quadro: Q'])
    expect(labels(note('card_assigned', {}))).toEqual([])
    expect(labels(note('backup_stale', {}))).toEqual(['Último backup: Nenhum'])
    expect(labels(note('backup_stale', { last_completed_at: '2026-10-01T09:00:00Z' }))[0]).toMatch(/^Último backup: 1 de outubro de 2026/)
    expect(labels(note('loan_approved', { amount: 123456 }))).toEqual(['Valor: R$ 1.234,56'])
    expect(notificationDetails(note('loan_approved', { amount: 500 }), getT('en'), 'en')).toEqual([{ label: 'Amount', value: 'R$5.00' }])
    expect(labels(note('loan_approved', {}))).toEqual([])
    expect(labels(note('desconhecido'))).toEqual([])
  })

  it('quem agiu e o convite', () => {
    expect(notificationActor(note('invite_accepted', ws))).toEqual({ id: 'a1', name: 'Ana' })
    expect(notificationActor(note('backup_stale'))).toEqual({ id: undefined, name: undefined })
    expect(notificationInviteId(note('workspace_invite', { invite_id: 'i1' }))).toBe('i1')
    expect(notificationInviteId(note('invite_accepted', { invite_id: 'i1' }))).toBeUndefined()
  })
})
