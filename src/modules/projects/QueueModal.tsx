import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ListOrdered, RotateCcw, Search, X } from 'lucide-react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  enqueueCards, listQueue, moveQueueItem, removeQueueItem, reprioritizeQueue, validateQueueCard,
} from '../../lib/data/projects'
import {
  PRIORITY_CODE,
  blockedCardIds,
  emptyQueueFilter,
  isEmptyQueueFilter,
  previewQueueOrder,
  type CardQueueItem,
  type CardQueueStatus,
  type QueueFilter,
} from '../../lib/cardQueue'
import type { ProjectCard, ProjectCardPriority, ProjectColumn } from '../../types'
import ModalShell from './ModalShell'

const PRIORITIES: ProjectCardPriority[] = ['urgent', 'high', 'medium', 'low']
const PRIORITY_COLORS: Record<ProjectCardPriority, string> = {
  low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
}
const STATUS_COLORS: Record<CardQueueStatus, string> = {
  queued: '#6366f1', in_progress: '#f59e0b', review: '#0891b2', done: '#22c55e', blocked: '#dc2626', cancelled: '#94a3b8',
}

interface QueueModalProps {
  boardId: string
  columns: ProjectColumn[]
  cards: ProjectCard[]
  canEdit: boolean
  isMobile?: boolean
  /** Muda a cada evento realtime da fila: recarrega a lista aberta. */
  refreshKey: number
  onClose: () => void
  onChanged: () => void
}

function Chip({ active, color, onClick, children }: { active: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  const c = color ?? '#6366f1'
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
        border: `1px solid ${active ? c : 'var(--color-border)'}`, backgroundColor: active ? `${c}1f` : 'var(--color-surface)',
        color: active ? c : 'var(--color-text)', fontSize: 12.5, fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  )
}

const LIST_STYLE: React.CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{children}</div>
}

export default function QueueModal({ boardId, columns, cards, canEdit, isMobile, refreshKey, onClose, onChanged }: QueueModalProps) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<'build' | 'list'>('build')
  const [filter, setFilter] = useState<QueueFilter>(emptyQueueFilter)
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<CardQueueItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const reasonId = useId()

  const applyList = useCallback(({ data, error }: { data: unknown; error: { message: string } | null }) => {
    if (error) {
      setMessage({ kind: 'error', text: t('projects_queue_error').replace('{message}', error.message) })
      return
    }
    // cq_list devolve jsonb: o formato de cada item é o da função SQL.
    setItems((data as CardQueueItem[] | null) ?? [])
  }, [t])

  const loadList = useCallback(async () => {
    applyList(await listQueue(boardId))
  }, [boardId, applyList])

  // refreshKey muda a cada evento realtime da fila (ProjectsPanel).
  useEffect(() => {
    let cancelled = false
    void listQueue(boardId).then(result => { if (!cancelled) applyList(result) })
    return () => { cancelled = true }
  }, [boardId, applyList, refreshKey])

  const activeItems = useMemo(() => items.filter(i => i.status === 'queued' || i.status === 'in_progress'), [items])
  // Fluxo v2: o que espera o usuário (validar ou fazer a parte dele) vem antes.
  const forYouItems = useMemo(() => items.filter(i => i.status === 'review' || i.status === 'blocked'), [items])
  const historyItems = useMemo(() => items.filter(i => i.status === 'done' || i.status === 'cancelled'), [items])
  const activeCardIds = useMemo(() => new Set(activeItems.map(i => i.card_id)), [activeItems])
  const blockedIds = useMemo(() => blockedCardIds(items), [items])
  const openCards = useMemo(() => cards.filter(c => !c.completed), [cards])
  const openCountByColumn = useMemo(() => {
    const map = new Map<string, number>()
    openCards.forEach(c => map.set(c.column_id, (map.get(c.column_id) ?? 0) + 1))
    return map
  }, [openCards])

  const preview = useMemo(
    () => previewQueueOrder(cards, columns, filter, activeCardIds, blockedIds),
    [cards, columns, filter, activeCardIds, blockedIds],
  )
  const columnName = useMemo(() => new Map(columns.map(c => [c.id, c.name])), [columns])
  // Temas: labels dos cards abertos (sem as de esforço), dos mais usados.
  const labelCounts = useMemo(() => {
    const map = new Map<string, number>()
    openCards.forEach(c => (c.labels ?? []).forEach(l => { if (!l.startsWith('esforço:')) map.set(l, (map.get(l) ?? 0) + 1) }))
    return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 16)
  }, [openCards])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return openCards
      .filter(c => !filter.cardIds.includes(c.id) && !activeCardIds.has(c.id) && c.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [search, openCards, filter.cardIds, activeCardIds])

  const toggle = <K extends 'columnIds' | 'priorities' | 'cardIds' | 'labels'>(key: K, value: QueueFilter[K][number]) => {
    setFilter(f => {
      const list = f[key] as string[]
      const next = list.includes(value) ? list.filter(v => v !== value) : [...list, value]
      return { ...f, [key]: next }
    })
    setMessage(null)
  }

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>, success?: string) => {
    setBusy(true)
    setMessage(null)
    const { error } = await fn()
    setBusy(false)
    if (error) {
      setMessage({ kind: 'error', text: t('projects_queue_error').replace('{message}', error.message) })
      return false
    }
    if (success) setMessage({ kind: 'ok', text: success })
    await loadList()
    onChanged()
    return true
  }

  const startQueue = async () => {
    const count = preview.length
    const ok = await run(
      () => enqueueCards(boardId, {
        cards: filter.cardIds.length ? filter.cardIds : null,
        columns: filter.columnIds.length ? filter.columnIds : null,
        priorities: filter.priorities.length ? filter.priorities : null,
        labels: filter.labels.length ? filter.labels : null,
      }),
      t('projects_queue_added').replace('{count}', String(count)),
    )
    if (ok) {
      setFilter(emptyQueueFilter())
      setSearch('')
      setTab('list')
    }
  }

  const queuedIds = activeItems.filter(i => i.status === 'queued').map(i => i.id)
  const move = (id: string, delta: number) => {
    const rank = queuedIds.indexOf(id) + 1
    void run(() => moveQueueItem(id, rank + delta))
  }
  const remove = (id: string) => { void run(() => removeQueueItem(id)) }
  // Desfaz ajustes manuais: prioridade → esforço (S, M, L) → posição atual.
  const reprioritize = () => {
    void run(() => reprioritizeQueue(boardId), t('projects_queue_reprioritized'))
  }
  // Validação: aprovar conclui o card; reprovar (com motivo) devolve ao topo da fila.
  const validate = async (item: CardQueueItem, approve: boolean, note?: string) => {
    const ok = await run(
      () => validateQueueCard(boardId, item.card_id, approve, note ?? null),
      t(approve ? 'projects_queue_approved' : 'projects_queue_rejected'),
    )
    if (ok) { setRejectingId(null); setRejectReason('') }
  }

  const tabBtn = (key: 'build' | 'list', label: string) => (
    <button
      type="button"
      onClick={() => { setTab(key); setMessage(null) }}
      style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === key ? 700 : 500, backgroundColor: tab === key ? 'var(--color-active)' : 'transparent', color: tab === key ? 'var(--color-text)' : 'var(--color-text-muted)' }}
    >
      {label}
    </button>
  )

  let queuedRank = 0

  const renderItem = (item: CardQueueItem) => {
    const rank = item.status === 'queued' ? ++queuedRank : null
    const color = STATUS_COLORS[item.status]
    const rejecting = rejectingId === item.id
    return (
      <li key={item.id} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 8, opacity: item.status === 'cancelled' ? 0.6 : 1 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <span style={{ minWidth: 26, fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', paddingTop: 2 }}>{rank ? `#${rank}` : ''}</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color, backgroundColor: `${color}1f`, padding: '1px 7px', borderRadius: 999 }}>
                {item.status === 'in_progress' && item.phase
                  ? t(`projects_queue_phase_${item.phase}`)
                  : t(`projects_queue_status_${item.status}`)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: PRIORITY_COLORS[item.priority] }}>{PRIORITY_CODE[item.priority]}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.column}</span>
            </div>
            <span style={{ fontSize: 13, color: 'var(--color-text)', wordBreak: 'break-word' }}>{item.title}</span>
            {item.status === 'blocked' && !!item.user_pending && (
              <span style={{ fontSize: 12, fontWeight: 600, color: STATUS_COLORS.blocked }}>
                {t('projects_queue_user_pending').replace('{count}', String(item.user_pending))}
              </span>
            )}
            {item.note && (item.status === 'blocked' || item.status === 'review' || item.status === 'done') && (
              <span style={{ fontSize: 12, color: item.status === 'blocked' ? STATUS_COLORS.blocked : 'var(--color-text-muted)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                {item.note.length > 280 ? `${item.note.slice(0, 280)}…` : item.note}
              </span>
            )}
          </div>
          {canEdit && (
            <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
              {item.status === 'review' && (
                <>
                  <IconBtn label={t('projects_queue_approve')} disabled={busy} onClick={() => { void validate(item, true) }}><Check size={13} /></IconBtn>
                  <IconBtn label={t('projects_queue_reject')} disabled={busy} onClick={() => { setRejectingId(rejecting ? null : item.id); setRejectReason('') }}><RotateCcw size={13} /></IconBtn>
                </>
              )}
              {item.status === 'queued' && (
                <>
                  <IconBtn label={t('projects_queue_move_up')} disabled={busy || rank === 1} onClick={() => move(item.id, -1)}><ArrowUp size={13} /></IconBtn>
                  <IconBtn label={t('projects_queue_move_down')} disabled={busy || rank === queuedIds.length} onClick={() => move(item.id, 1)}><ArrowDown size={13} /></IconBtn>
                </>
              )}
              {(item.status === 'queued' || item.status === 'in_progress' || item.status === 'blocked' || item.status === 'review') && (
                <IconBtn label={t('projects_queue_remove')} disabled={busy} onClick={() => remove(item.id)}><X size={13} /></IconBtn>
              )}
            </div>
          )}
        </div>
        {rejecting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 36 }}>
            <label htmlFor={reasonId} style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>{t('projects_queue_reject_reason')}</label>
            <textarea id={reasonId} value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} autoFocus
              style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, resize: 'vertical' }} />
            <button type="button" disabled={busy || !rejectReason.trim()} onClick={() => { void validate(item, false, rejectReason.trim()) }}
              style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: busy || !rejectReason.trim() ? 'default' : 'pointer', opacity: rejectReason.trim() ? 1 : 0.6 }}>
              <RotateCcw size={12} />{t('projects_queue_reject_confirm')}
            </button>
          </div>
        )}
      </li>
    )
  }

  return (
    <ModalShell title={t('projects_queue_title')} onClose={onClose} isMobile={isMobile}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 10, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          {canEdit && tabBtn('build', t('projects_queue_tab_build'))}
          {tabBtn('list', t('projects_queue_tab_list').replace('{count}', String(activeItems.length)))}
        </div>

        {tab === 'build' && canEdit ? (
          <>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('projects_queue_intro')}</p>

            <div>
              <SectionTitle>{t('projects_queue_columns')}</SectionTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {columns.map(col => (
                  <Chip key={col.id} active={filter.columnIds.includes(col.id)} color={col.color} onClick={() => toggle('columnIds', col.id)}>
                    {col.name}
                    <span style={{ opacity: 0.7 }}>{openCountByColumn.get(col.id) ?? 0}</span>
                  </Chip>
                ))}
              </div>
            </div>

            {labelCounts.length > 0 && (
              <div>
                <SectionTitle>{t('projects_queue_labels')}</SectionTitle>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {labelCounts.map(([label, count]) => (
                    <Chip key={label} active={filter.labels.includes(label)} onClick={() => toggle('labels', label)}>
                      {label}
                      <span style={{ opacity: 0.7 }}>{count}</span>
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            <div>
              <SectionTitle>{t('projects_queue_priorities')}</SectionTitle>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PRIORITIES.map(p => (
                  <Chip key={p} active={filter.priorities.includes(p)} color={PRIORITY_COLORS[p]} onClick={() => toggle('priorities', p)}>
                    {PRIORITY_CODE[p]} · {t(`projects_priority_${p}`)}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>{t('projects_queue_cards')}</SectionTitle>
              {filter.cardIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {filter.cardIds.map(id => {
                    const card = cards.find(c => c.id === id)
                    return (
                      <Chip key={id} active onClick={() => toggle('cardIds', id)}>
                        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card?.title ?? id}</span>
                        <X size={12} />
                      </Chip>
                    )
                  })}
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--color-text-muted)' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('projects_queue_search_placeholder')}
                  style={{ width: '100%', padding: '8px 12px 8px 30px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
              {searchResults.length > 0 && (
                <div style={{ marginTop: 6, border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
                  {searchResults.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { toggle('cardIds', c.id); setSearch('') }}
                      style={{ display: 'flex', width: '100%', gap: 8, padding: '7px 10px', border: 'none', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, textAlign: 'left', cursor: 'pointer' }}
                    >
                      <span style={{ color: PRIORITY_COLORS[c.priority], fontWeight: 700 }}>{PRIORITY_CODE[c.priority]}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                      <span style={{ color: 'var(--color-text-muted)' }}>{columnName.get(c.column_id)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!isEmptyQueueFilter(filter) && (
              <div>
                <SectionTitle>
                  {preview.length > 0
                    ? t('projects_queue_preview').replace('{count}', String(preview.length))
                    : t('projects_queue_preview_empty')}
                </SectionTitle>
                {preview.length > 0 && (
                  <ol style={{ margin: 0, paddingLeft: 22, maxHeight: 200, overflowY: 'auto', fontSize: 12.5, color: 'var(--color-text)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {preview.map(c => (
                      <li key={c.id}>
                        <span style={{ color: PRIORITY_COLORS[c.priority], fontWeight: 700 }}>{PRIORITY_CODE[c.priority]}</span>{' '}
                        {c.title} <span style={{ color: 'var(--color-text-muted)' }}>· {columnName.get(c.column_id)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            {items.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)' }}>{t('projects_queue_empty')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: isMobile ? undefined : 420, overflowY: 'auto' }}>
                {forYouItems.length > 0 && (
                  <div>
                    <SectionTitle>{t('projects_queue_for_you').replace('{count}', String(forYouItems.length))}</SectionTitle>
                    <ul style={LIST_STYLE}>{forYouItems.map(renderItem)}</ul>
                  </div>
                )}
                {activeItems.length > 0 && <ul style={LIST_STYLE}>{activeItems.map(renderItem)}</ul>}
                {historyItems.length > 0 && <ul style={LIST_STYLE}>{historyItems.map(renderItem)}</ul>}
              </div>
            )}
            {canEdit && queuedIds.length > 1 && (
              <button
                type="button"
                onClick={reprioritize}
                disabled={busy}
                style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 12.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}
              >
                <ListOrdered size={13} />{t('projects_queue_reprioritize')}
              </button>
            )}
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('projects_queue_priority_hint')}</p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>{t('projects_queue_how_to')}</p>
          </>
        )}

        {message && (
          <div role={message.kind === 'error' ? 'alert' : 'status'} style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, backgroundColor: message.kind === 'error' ? '#ef444418' : '#22c55e18', color: message.kind === 'error' ? '#ef4444' : '#22c55e' }}>
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer' }}>
            {t('projects_cancel')}
          </button>
          {tab === 'build' && canEdit && (
            <button
              type="button"
              onClick={() => { void startQueue() }}
              disabled={busy || preview.length === 0}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer', opacity: preview.length === 0 ? 0.5 : 1 }}
            >
              {t('projects_queue_start')}
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ display: 'flex', padding: 5, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text-muted)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1 }}
    >
      {children}
    </button>
  )
}
