import type { Lang, TranslationKey } from '../i18n/translations'
import type { AppNotification } from '../types'
import { exactDateTime } from './relativeTime'

// NOTIF-001: o que o app sabe de cada tipo de notificação: categoria (filtro e
// preferência de aviso), ícone e tom, o texto no idioma de quem lê (a partir de
// `type` + `data`), para onde o clique leva e as linhas de detalhe.
//
// O banco grava título e corpo prontos em pt-BR (`_notify`); eles continuam
// como reserva: notificação antiga, tipo desconhecido ou `data` sem os campos
// necessários mostra o texto gravado. A `data` de cada tipo:
//   workspace_*/invite_*/member_* → workspace_id, workspace_name, actor_id, actor_name, invite_id?
//   backup_stale                  → last_completed_at (null = nenhum backup)
//   page_shared                   → page_id, page_title, role, changed, actor_*
//   board_shared                  → board_id, board_name, role, changed, actor_*
//   card_assigned                 → card_id, card_title, board_id, board_name, actor_*
//   loan_*                        → loan_id, amount (centavos)?, actor_* (sem tela no app)
// actor_name e workspace_name vêm do gatilho de enriquecimento (migração notif001).
// A `data` leva os valores crus: título vazio fica vazio e, sem o perfil de quem
// agiu, não há actor_name; aqui entram "Sem título" / "Alguém" no idioma da tela.

type T = (key: TranslationKey, vars?: Record<string, string | number>) => string

export type NotificationCategory = 'finance' | 'projects' | 'pages' | 'system'
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ['finance', 'projects', 'pages', 'system']
export const CATEGORY_LABELS: Record<NotificationCategory, TranslationKey> = {
  finance: 'notif_cat_finance',
  projects: 'notif_cat_projects',
  pages: 'notif_cat_pages',
  system: 'notif_cat_system',
}

export type NotificationIcon = 'userPlus' | 'userCheck' | 'userX' | 'users' | 'userMinus' | 'database' | 'fileText' | 'kanban' | 'cardCheck' | 'banknote' | 'bell'
export type NotificationTone = 'accent' | 'success' | 'warning' | 'error' | 'neutral'

export type NotificationTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'board'; boardId: string }
  | { kind: 'card'; boardId: string; cardId: string }
  | { kind: 'finance-workspace' }
  | { kind: 'settings-backup' }

export interface NotificationDetail {
  label: string
  value: string
}

interface KindSpec {
  category: NotificationCategory
  icon: NotificationIcon
  tone: NotificationTone
  render?: (n: AppNotification, t: T, lang: Lang) => { title: string; body: string } | null
  target?: (n: AppNotification) => NotificationTarget | null
  details?: (n: AppNotification, t: T, lang: Lang) => NotificationDetail[]
}

/** Campo de texto da `data` (vazio conta como ausente). */
export function dataText(n: AppNotification, key: string): string | undefined {
  const value = n.data[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Quem agiu: o nome; sem nome mas com actor_id (perfil apagado), "Alguém". */
function actorText(n: AppNotification, t: T): string | undefined {
  return dataText(n, 'actor_name') ?? (dataText(n, 'actor_id') ? t('notif_someone') : undefined)
}

/** Título/nome que veio na `data`: vazio vira o texto de reserva; ausente, undefined. */
function namedText(n: AppNotification, key: string, t: T, fallback: TranslationKey): string | undefined {
  if (!(key in n.data)) return undefined
  return dataText(n, key) ?? t(fallback)
}

const PAGE_ROLES: Record<string, TranslationKey> = { viewer: 'share_role_viewer', editor: 'share_role_editor', co_owner: 'share_role_co_owner' }
const BOARD_ROLES: Record<string, TranslationKey> = { viewer: 'projects_share_role_viewer', editor: 'projects_share_role_editor' }

function roleLabel(n: AppNotification, t: T, roles: Record<string, TranslationKey>): string | undefined {
  const role = dataText(n, 'role')
  return role && roles[role] ? t(roles[role]) : undefined
}

const moneyFormats = new Map<Lang, Intl.NumberFormat>()
function money(cents: number, lang: Lang): string {
  let format = moneyFormats.get(lang)
  if (!format) {
    format = new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'pt-BR', { style: 'currency', currency: 'BRL' })
    moneyFormats.set(lang, format)
  }
  return format.format(cents / 100)
}

/** Workspace: título com quem agiu e o nome do workspace; sem os dois, o texto gravado. */
function workspaceText(titleKey: TranslationKey, bodyKey: TranslationKey) {
  return (n: AppNotification, t: T) => {
    const actor = actorText(n, t)
    const workspace = dataText(n, 'workspace_name')
    if (!actor || !workspace) return null
    return { title: t(titleKey, { actor, workspace }), body: t(bodyKey) }
  }
}

const workspaceDetails = (n: AppNotification, t: T): NotificationDetail[] => {
  const workspace = dataText(n, 'workspace_name')
  return workspace ? [{ label: t('notif_detail_workspace'), value: workspace }] : []
}

const toFinanceWorkspace = (): NotificationTarget => ({ kind: 'finance-workspace' })

const loanKind: KindSpec = {
  category: 'finance',
  icon: 'banknote',
  tone: 'neutral',
  details: (n, t, lang) => (typeof n.data.amount === 'number' ? [{ label: t('notif_detail_amount'), value: money(n.data.amount, lang) }] : []),
}

const KINDS: Record<string, KindSpec> = {
  workspace_invite: {
    category: 'finance', icon: 'userPlus', tone: 'accent',
    render: workspaceText('notif_t_workspace_invite', 'notif_b_workspace_invite'),
    target: toFinanceWorkspace, details: workspaceDetails,
  },
  invite_accepted: {
    category: 'finance', icon: 'userCheck', tone: 'success',
    render: workspaceText('notif_t_invite_accepted', 'notif_b_member_new'),
    target: toFinanceWorkspace, details: workspaceDetails,
  },
  member_joined: {
    category: 'finance', icon: 'users', tone: 'success',
    render: workspaceText('notif_t_member_joined', 'notif_b_member_new'),
    target: toFinanceWorkspace, details: workspaceDetails,
  },
  invite_declined: {
    category: 'finance', icon: 'userX', tone: 'warning',
    render: workspaceText('notif_t_invite_declined', 'notif_b_invite_declined'),
    target: toFinanceWorkspace, details: workspaceDetails,
  },
  member_left: {
    category: 'finance', icon: 'userMinus', tone: 'warning',
    // O mesmo tipo serve para "X removeu você" e "X saiu": o banco não guarda
    // qual; o título gravado (gerado pelas RPCs, estável) diz.
    render: (n, t) => {
      const removed = /removeu você/.test(n.title)
      return workspaceText(removed ? 'notif_t_member_removed' : 'notif_t_member_left', removed ? 'notif_b_member_removed' : 'notif_b_member_left')(n, t)
    },
    target: toFinanceWorkspace, details: workspaceDetails,
  },
  backup_stale: {
    category: 'system', icon: 'database', tone: 'warning',
    render: (n, t, lang) => {
      const last = dataText(n, 'last_completed_at')
      return {
        title: t('notif_t_backup_stale'),
        body: last ? t('notif_b_backup_stale_since', { date: exactDateTime(new Date(last), lang) }) : t('notif_b_backup_stale_never'),
      }
    },
    target: () => ({ kind: 'settings-backup' }),
    details: (n, t, lang) => {
      const last = dataText(n, 'last_completed_at')
      return [{ label: t('notif_detail_last_backup'), value: last ? exactDateTime(new Date(last), lang) : t('notif_detail_none') }]
    },
  },
  page_shared: {
    category: 'pages', icon: 'fileText', tone: 'accent',
    render: (n, t) => {
      const actor = actorText(n, t)
      const page = namedText(n, 'page_title', t, 'notif_untitled')
      if (!actor || !page) return null
      const role = roleLabel(n, t, PAGE_ROLES)
      return {
        title: t(n.data.changed === true ? 'notif_t_page_access_changed' : 'notif_t_page_shared', { actor, page }),
        body: role ? t('notif_b_role', { role }) : '',
      }
    },
    target: n => {
      const pageId = dataText(n, 'page_id')
      return pageId ? { kind: 'page', pageId } : null
    },
    details: (n, t) => {
      const rows: NotificationDetail[] = []
      const page = namedText(n, 'page_title', t, 'notif_untitled')
      const role = roleLabel(n, t, PAGE_ROLES)
      if (page) rows.push({ label: t('notif_detail_page'), value: page })
      if (role) rows.push({ label: t('notif_detail_role'), value: role })
      return rows
    },
  },
  board_shared: {
    category: 'projects', icon: 'kanban', tone: 'accent',
    render: (n, t) => {
      const actor = actorText(n, t)
      const board = namedText(n, 'board_name', t, 'notif_board_fallback')
      if (!actor || !board) return null
      const role = roleLabel(n, t, BOARD_ROLES)
      return {
        title: t(n.data.changed === true ? 'notif_t_board_access_changed' : 'notif_t_board_shared', { actor, board }),
        body: role ? t('notif_b_role', { role }) : '',
      }
    },
    target: n => {
      const boardId = dataText(n, 'board_id')
      return boardId ? { kind: 'board', boardId } : null
    },
    details: (n, t) => {
      const rows: NotificationDetail[] = []
      const board = namedText(n, 'board_name', t, 'notif_board_fallback')
      const role = roleLabel(n, t, BOARD_ROLES)
      if (board) rows.push({ label: t('notif_detail_board'), value: board })
      if (role) rows.push({ label: t('notif_detail_role'), value: role })
      return rows
    },
  },
  card_assigned: {
    category: 'projects', icon: 'cardCheck', tone: 'accent',
    render: (n, t) => {
      const actor = actorText(n, t)
      const card = namedText(n, 'card_title', t, 'notif_untitled')
      const board = namedText(n, 'board_name', t, 'notif_board_fallback')
      if (!actor || !card) return null
      return { title: t('notif_t_card_assigned', { actor, card }), body: board ? t('notif_b_card_board', { board }) : '' }
    },
    target: n => {
      const boardId = dataText(n, 'board_id')
      const cardId = dataText(n, 'card_id')
      return boardId && cardId ? { kind: 'card', boardId, cardId } : null
    },
    details: (n, t) => {
      const rows: NotificationDetail[] = []
      const card = namedText(n, 'card_title', t, 'notif_untitled')
      const board = namedText(n, 'board_name', t, 'notif_board_fallback')
      if (card) rows.push({ label: t('notif_detail_card'), value: card })
      if (board) rows.push({ label: t('notif_detail_board'), value: board })
      return rows
    },
  },
  loan_borrower_linked: loanKind,
  loan_requested: loanKind,
  loan_approved: loanKind,
  loan_rejected: loanKind,
  loan_payment_reported: loanKind,
  loan_payment_confirmed: loanKind,
  loan_payment_rejected: loanKind,
}

const UNKNOWN: KindSpec = { category: 'system', icon: 'bell', tone: 'neutral' }

function spec(n: AppNotification): KindSpec {
  return KINDS[n.type] ?? UNKNOWN
}

export function notificationCategory(n: AppNotification): NotificationCategory {
  return spec(n).category
}

export function notificationLook(n: AppNotification): { icon: NotificationIcon; tone: NotificationTone } {
  const { icon, tone } = spec(n)
  return { icon, tone }
}

/** Título e corpo no idioma da tela; sem o necessário na `data`, o texto gravado. */
export function notificationText(n: AppNotification, t: T, lang: Lang): { title: string; body: string } {
  return spec(n).render?.(n, t, lang) ?? { title: n.title, body: n.body }
}

export function notificationTarget(n: AppNotification): NotificationTarget | null {
  return spec(n).target?.(n) ?? null
}

export function notificationDetails(n: AppNotification, t: T, lang: Lang): NotificationDetail[] {
  return spec(n).details?.(n, t, lang) ?? []
}

/** Nome de quem agiu (para o avatar); notificações antigas não têm. */
export function notificationActor(n: AppNotification): { id?: string; name?: string } {
  return { id: dataText(n, 'actor_id'), name: dataText(n, 'actor_name') }
}

/** Convite de workspace com id (o item mostra a situação e, se pendente, Aceitar/Recusar). */
export function notificationInviteId(n: AppNotification): string | undefined {
  return n.type === 'workspace_invite' ? dataText(n, 'invite_id') : undefined
}
