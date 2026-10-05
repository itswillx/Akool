import { useId, useState } from 'react'
import type { ComponentType } from 'react'
import { Banknote, Bell, ChevronDown, Database, FileText, Mail, MailOpen, SquareCheck, SquareKanban, Trash2, UserCheck, UserMinus, UserPlus, Users, UserX } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import { emitAppEvent } from '../../lib/appEvents'
import { acceptWorkspaceInvite, declineWorkspaceInvite, fetchInviteStates } from '../../lib/data/notifications'
import type { InviteState } from '../../lib/data/notifications'
import { notificationActor, notificationDetails, notificationInviteId, notificationLook, notificationTarget, notificationText } from '../../lib/notificationKinds'
import type { NotificationIcon, NotificationTarget, NotificationTone } from '../../lib/notificationKinds'
import { exactDateTime, relativeTime } from '../../lib/relativeTime'
import { UserAvatar } from '@/shared/ui/UserAvatar'
import { ghostBtnStyle, primaryBtnStyle } from '@/shared/ui/uiTokens'
import type { AppNotification } from '../../types'

// Um item da central de notificações (NOTIF-001). O clique principal marca
// como lida e abre o item relacionado (página, quadro, card, Financeiro,
// Backup); a seta mostra os detalhes e as ações (lida/não lida, excluir). Um
// convite de workspace pendente traz Aceitar/Recusar no próprio item, com a
// situação real do convite e o erro tratado (antes: o erro sumia e a página
// recarregava inteira).

const ICONS: Record<NotificationIcon, ComponentType<{ size?: number }>> = {
  userPlus: UserPlus,
  userCheck: UserCheck,
  userX: UserX,
  users: Users,
  userMinus: UserMinus,
  database: Database,
  fileText: FileText,
  kanban: SquareKanban,
  cardCheck: SquareCheck,
  banknote: Banknote,
  bell: Bell,
}

const TONES: Record<NotificationTone, string> = {
  accent: 'var(--color-accent)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  error: 'var(--color-error)',
  neutral: 'var(--color-text-subtle)',
}

const INVITE_LABELS = {
  pending: 'notif_invite_pending',
  accepted: 'notif_invite_accepted',
  declined: 'notif_invite_declined',
} as const

const SMALL_BTN = { ...ghostBtnStyle, fontSize: 12, padding: '5px 10px', color: 'var(--color-text)' } as const

export function NotificationItem({ notification: n, now, inviteState, onOpen, onSetRead, onDelete, onInviteState }: {
  notification: AppNotification
  now: Date
  /** Situação atual do convite (só para workspace_invite); undefined = desconhecida. */
  inviteState?: InviteState
  onOpen: (n: AppNotification, target: NotificationTarget | null) => void
  onSetRead: (id: string, read: boolean) => void
  onDelete: (id: string) => void
  onInviteState: (inviteId: string, state: InviteState) => void
}) {
  const { t, lang } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const [responding, setResponding] = useState(false)
  // Erro ao responder: transitório (tente de novo) ou "já está num workspace" (aceitar não vai dar).
  const [inviteError, setInviteError] = useState<'retry' | 'already' | null>(null)
  const detailsId = useId()
  const created = new Date(n.created_at)
  const text = notificationText(n, t, lang)
  const title = text.title
  const { icon, tone } = notificationLook(n)
  const Icon = ICONS[icon]
  const actor = notificationActor(n)
  const target = notificationTarget(n)
  const inviteId = notificationInviteId(n)
  // Convite já respondido: o corpo diz a situação, não "aceite para…".
  const body = inviteId && inviteState && inviteState !== 'pending' ? t(INVITE_LABELS[inviteState]) : text.body
  const details = notificationDetails(n, t, lang)

  const respond = async (accept: boolean) => {
    if (!inviteId || responding) return
    setResponding(true)
    setInviteError(null)
    const { error } = await (accept ? acceptWorkspaceInvite(inviteId) : declineWorkspaceInvite(inviteId))
    setResponding(false)
    if (error) {
      // Já está num workspace: aceitar nunca vai dar certo (só recusar).
      if (/already belong/i.test(error.message)) {
        setInviteError('already')
        return
      }
      // Já respondido (em outra aba, pelo Financeiro): mostra a situação real
      // em vez do erro; senão, o erro fica no item e os botões continuam.
      const current = (await fetchInviteStates([inviteId]))[inviteId]
      if (current && current !== 'pending') onInviteState(inviteId, current)
      else setInviteError('retry')
      return
    }
    onInviteState(inviteId, accept ? 'accepted' : 'declined')
    onSetRead(n.id, true)
    emitAppEvent('finance_workspace_changed')
  }

  return (
    <li style={{ listStyle: 'none' }}>
      <article
        aria-label={title}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 10,
          backgroundColor: n.read ? 'transparent' : 'color-mix(in srgb, var(--color-accent) 7%, transparent)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {/* Quem agiu (sem foto: o perfil nem sempre é legível) com o ícone do tipo no canto. */}
          <span aria-hidden="true" style={{ position: 'relative', flexShrink: 0, width: 34, height: 34 }}>
            {actor.name ? (
              <UserAvatar name={actor.name} seed={actor.id ?? actor.name} size={34} />
            ) : (
              <span style={{ width: 34, height: 34, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TONES[tone], backgroundColor: `color-mix(in srgb, ${TONES[tone]} 14%, transparent)` }}>
                <Icon size={17} />
              </span>
            )}
            {actor.name && (
              <span style={{ position: 'absolute', right: -3, bottom: -3, width: 18, height: 18, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', color: TONES[tone], backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <Icon size={11} />
              </span>
            )}
          </span>
          <button
            type="button"
            data-notif-id={n.id}
            onClick={() => onOpen(n, target)}
            style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', color: 'var(--color-text)' }}
          >
            <span style={{ fontSize: 13.5, fontWeight: n.read ? 500 : 650, lineHeight: 1.35 }}>{title}</span>
            {body && <span style={{ fontSize: 12.5, lineHeight: 1.4, color: 'var(--color-text-subtle)' }}>{body}</span>}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 11.5, color: 'var(--color-text-subtle)' }}>
              <time dateTime={n.created_at} title={exactDateTime(created, lang)}>{relativeTime(created, now, lang)}</time>
              {!n.read && (
                <>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: 'var(--color-accent)' }} />
                  <span className="sr-only">{t('notif_unread')}</span>
                </>
              )}
            </span>
          </button>
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={expanded ? t('notif_details_hide') : t('notif_details_show')}
            onClick={() => setExpanded(e => !e)}
            style={{ flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', borderRadius: 7, background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
          >
            <ChevronDown size={16} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
          </button>
        </div>

        {inviteId && inviteState === 'pending' && (
          <div style={{ display: 'flex', gap: 8, paddingLeft: 44 }}>
            {inviteError !== 'already' && (
              <button type="button" aria-disabled={responding} onClick={() => { void respond(true) }} style={{ ...primaryBtnStyle, fontSize: 12, padding: '6px 12px' }}>
                {t('finance_workspace_invite_accept')}
              </button>
            )}
            <button type="button" aria-disabled={responding} onClick={() => { void respond(false) }} style={SMALL_BTN}>
              {t('finance_workspace_invite_decline')}
            </button>
          </div>
        )}
        {inviteError && (
          <p role="alert" style={{ margin: 0, paddingLeft: 44, fontSize: 12.5, color: 'var(--color-error-text)' }}>
            {inviteError === 'already' ? t('finance_workspace_error_already') : t('notif_invite_error')}
          </p>
        )}

        {/* O conteúdo só existe aberto: escondido, os botões ainda contariam para o Tab (o foco escaparia da central). */}
        <div id={detailsId} hidden={!expanded} style={{ paddingLeft: 44 }}>
          {expanded && (
          <>
          <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 12.5 }}>
            {details.map(row => (
              <div key={row.label} style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--color-text-muted)' }}>{row.label}</dt>
                <dd style={{ margin: 0, color: 'var(--color-text)', overflowWrap: 'anywhere' }}>{row.value}</dd>
              </div>
            ))}
            {inviteId && inviteState && (
              <div style={{ display: 'contents' }}>
                <dt style={{ color: 'var(--color-text-muted)' }}>{t('notif_detail_invite')}</dt>
                <dd style={{ margin: 0, color: 'var(--color-text)' }}>{t(INVITE_LABELS[inviteState])}</dd>
              </div>
            )}
            <div style={{ display: 'contents' }}>
              <dt style={{ color: 'var(--color-text-muted)' }}>{t('notif_received_at')}</dt>
              <dd style={{ margin: 0, color: 'var(--color-text)' }}>{exactDateTime(created, lang)}</dd>
            </div>
          </dl>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <button type="button" onClick={() => onSetRead(n.id, !n.read)} style={SMALL_BTN}>
              {n.read ? <Mail size={13} aria-hidden="true" /> : <MailOpen size={13} aria-hidden="true" />}
              {n.read ? t('notif_mark_unread') : t('notif_mark_read')}
            </button>
            <button type="button" onClick={() => onDelete(n.id)} style={SMALL_BTN}>
              <Trash2 size={13} aria-hidden="true" />
              {t('notif_delete')}
            </button>
          </div>
          </>
          )}
        </div>
      </article>
    </li>
  )
}
