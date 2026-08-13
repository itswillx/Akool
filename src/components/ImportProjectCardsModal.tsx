import { useEffect, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronLeft, ChevronRight, Search, Check, FolderKanban } from 'lucide-react'
import type { ProjectBoard, ProjectCard, ProjectColumn, ProjectCardPriority } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { fetchAccessibleBoards, fetchBoardCards } from '../lib/projectImport'

const PRIORITY_COLORS: Record<ProjectCardPriority, string> = {
  low: '#94a3b8', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444',
}

interface Props {
  open: boolean
  onClose: () => void
  onImport: (cards: ProjectCard[], board: ProjectBoard, columns: ProjectColumn[]) => void
}

// Two-step picker that lets a user browse their project boards, then multi-select
// cards to import into the current note. Back button returns to the board list.
export default function ImportProjectCardsModal({ open, onClose, onImport }: Props) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const isMobile = useIsMobile()

  const [step, setStep] = useState<'boards' | 'cards'>('boards')
  const [boards, setBoards] = useState<ProjectBoard[]>([])
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [board, setBoard] = useState<ProjectBoard | null>(null)
  const [columns, setColumns] = useState<ProjectColumn[]>([])
  const [cards, setCards] = useState<ProjectCard[]>([])
  const [loadingCards, setLoadingCards] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const resetToBoards = useCallback(() => {
    setStep('boards')
    setBoard(null)
    setColumns([])
    setCards([])
    setSearch('')
    setSelected(new Set())
  }, [])

  // Load boards each time the modal opens, starting fresh at step 1.
  useEffect(() => {
    const userId = user?.id
    if (!open || !userId) return
    resetToBoards()
    let cancelled = false
    setLoadingBoards(true)
    fetchAccessibleBoards(userId)
      .then(b => { if (!cancelled) setBoards(b) })
      .finally(() => { if (!cancelled) setLoadingBoards(false) })
    return () => { cancelled = true }
  }, [open, user?.id, resetToBoards])

  // Esc closes the modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const openBoard = useCallback((b: ProjectBoard) => {
    setBoard(b)
    setStep('cards')
    setSearch('')
    setSelected(new Set())
    let cancelled = false
    setLoadingCards(true)
    fetchBoardCards(b.id)
      .then(({ columns: cols, cards: cds }) => {
        if (cancelled) return
        setColumns(cols)
        setCards(cds)
      })
      .finally(() => { if (!cancelled) setLoadingCards(false) })
    return () => { cancelled = true }
  }, [])

  const toggleCard = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cards
    return cards.filter(c => c.title.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q))
  }, [cards, search])

  // Group filtered cards by column, preserving column order.
  const groups = useMemo(() => {
    const byCol = new Map<string, ProjectCard[]>()
    for (const c of filteredCards) {
      const arr = byCol.get(c.column_id) ?? []
      arr.push(c)
      byCol.set(c.column_id, arr)
    }
    const ordered = columns
      .map(col => ({ col, items: byCol.get(col.id) ?? [] }))
      .filter(g => g.items.length > 0)
    // Cards whose column is missing (e.g. deleted) fall into an "uncategorised" bucket.
    const known = new Set(columns.map(c => c.id))
    const orphan = filteredCards.filter(c => !known.has(c.column_id))
    if (orphan.length) ordered.push({ col: { id: '__none__', name: '', color: '', board_id: '', wip_limit: null, sort_order: 0, created_at: '' }, items: orphan })
    return ordered
  }, [filteredCards, columns])

  const handleImport = () => {
    if (!board || selected.size === 0) return
    const chosen = cards.filter(c => selected.has(c.id))
    onImport(chosen, board, columns)
  }

  if (!open) return null

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 12 : 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          backgroundColor: 'var(--color-surface)', borderRadius: 16, boxShadow: '0 8px 40px rgba(0,0,0,0.24)',
          width: '100%', maxWidth: 560, height: 'min(620px, calc(100dvh - 48px))', maxHeight: 'calc(100dvh - 48px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
          {step === 'cards' ? (
            <button type="button" onClick={resetToBoards} title={t('import_cards_back')} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <ChevronLeft size={18} />
            </button>
          ) : (
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, color: 'var(--color-text-muted)' }}>
              <FolderKanban size={18} />
            </span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step === 'boards' ? t('import_cards_modal_title') : (board?.name || t('import_cards_step_cards'))}
            </h2>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)' }}>
              {step === 'boards' ? t('import_cards_step_projects') : t('import_cards_step_cards')}
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px' }}>
          {step === 'boards' && (
            loadingBoards ? (
              <Empty text={t('app_loading')} />
            ) : boards.length === 0 ? (
              <Empty text={t('import_cards_empty_boards')} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {boards.map(b => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => openBoard(b)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface)', cursor: 'pointer' }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 8, fontSize: 16, backgroundColor: `${b.color || '#6366f1'}22` }}>{b.icon || '📋'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                      {b.is_shared ? <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{t('projects_shared_badge')}</span> : null}
                    </span>
                    <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                  </button>
                ))}
              </div>
            )
          )}

          {step === 'cards' && (
            <>
              <div style={{ position: 'relative', margin: '4px 2px 10px' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('projects_filter_search')}
                  style={{ width: '100%', padding: '8px 10px 8px 30px', border: '1px solid var(--color-border)', borderRadius: 8, fontSize: 13, backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
              {loadingCards ? (
                <Empty text={t('app_loading')} />
              ) : filteredCards.length === 0 ? (
                <Empty text={t('import_cards_empty_cards')} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {groups.map(({ col, items }) => (
                    <div key={col.id}>
                      {col.name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 4px' }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: col.color || 'var(--color-border)' }} />
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{col.name}</span>
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {items.map(c => {
                          const isSel = selected.has(c.id)
                          const pColor = PRIORITY_COLORS[c.priority] ?? PRIORITY_COLORS.medium
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => toggleCard(c.id)}
                              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', padding: '9px 11px', borderRadius: 9, border: `1px solid ${isSel ? 'var(--color-primary)' : 'var(--color-border)'}`, background: isSel ? 'color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))' : 'var(--color-surface)', cursor: 'pointer' }}
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, marginTop: 1, borderRadius: 5, flexShrink: 0, border: `1.5px solid ${isSel ? 'var(--color-primary)' : 'var(--color-border)'}`, background: isSel ? 'var(--color-primary)' : 'transparent', color: '#fff' }}>
                                {isSel ? <Check size={12} /> : null}
                              </span>
                              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)', lineHeight: 1.35, textDecoration: c.completed ? 'line-through' : 'none', wordBreak: 'break-word' }}>{c.title || t('projects_new_card')}</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontSize: 9.5, fontWeight: 700, color: pColor, backgroundColor: `${pColor}1f`, padding: '1px 6px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{t(`projects_priority_${c.priority}` as Parameters<typeof t>[0])}</span>
                                  {(c.checklist?.length ?? 0) > 0 ? <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{`${c.checklist.filter(i => i.completed).length}/${c.checklist.length}`}</span> : null}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--color-border)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>
            {step === 'cards' && selected.size > 0 ? t('import_cards_selected_n').replace('{n}', String(selected.size)) : ''}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
              {t('projects_cancel')}
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={step !== 'cards' || selected.size === 0}
              style={{ padding: '9px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-primary)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: step === 'cards' && selected.size > 0 ? 'pointer' : 'not-allowed', opacity: step === 'cards' && selected.size > 0 ? 1 : 0.5 }}
            >
              {t('import_cards_import_n').replace('{n}', String(selected.size))}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 120, color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', padding: 16 }}>
      {text}
    </div>
  )
}
