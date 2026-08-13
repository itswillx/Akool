import { useEffect, useMemo, useState } from 'react'
import { Search, X, FolderKanban } from 'lucide-react'
import type { Page } from '../types'
import { usePages } from '../contexts/PagesContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { useLanguage } from '../i18n/LanguageContext'

export interface PickedItem {
  type: 'page' | 'card'
  targetId: string
  title: string
  boardId?: string
}

interface PickerCard {
  id: string
  title: string
  board_id: string
  boardName: string
}

function flatten(ps: Page[]): Page[] {
  return ps.flatMap(p => [p, ...flatten(p.children ?? [])])
}

export default function ItemPicker({ onSelect, onClose }: {
  onSelect: (item: PickedItem) => void
  onClose: () => void
}) {
  const { pages, sharedPages } = usePages()
  const { user } = useAuth()
  const { t } = useLanguage()
  const [q, setQ] = useState('')
  const [cards, setCards] = useState<PickerCard[]>([])

  const allPages = useMemo(() => [...flatten(pages), ...flatten(sharedPages)], [pages, sharedPages])

  useEffect(() => {
    const userId = user?.id
    if (!userId) return
    let cancelled = false
    const load = async () => {
      const [ownRes, sharedRes] = await Promise.all([
        supabase.from('project_boards').select('id, name').eq('user_id', userId),
        supabase.from('project_shares').select('project_boards(id, name)').eq('shared_with_user_id', userId),
      ])
      const boards = new Map<string, string>()
      ;(ownRes.data ?? []).forEach(b => boards.set(b.id as string, b.name as string))
      ;(sharedRes.data ?? []).forEach(r => {
        type BoardRef = { id: string; name: string }
        const raw = (r as unknown as { project_boards: BoardRef | BoardRef[] | null }).project_boards
        const b = Array.isArray(raw) ? raw[0] : raw
        if (b) boards.set(b.id, b.name)
      })
      if (boards.size === 0) return
      const { data } = await supabase
        .from('project_cards').select('id, title, board_id')
        .in('board_id', [...boards.keys()])
        .order('updated_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      setCards(((data ?? []) as { id: string; title: string; board_id: string }[])
        .map(c => ({ ...c, boardName: boards.get(c.board_id) ?? '' })))
    }
    load()
    return () => { cancelled = true }
  }, [user?.id])

  const term = q.trim().toLowerCase()
  const pageResults = useMemo(
    () => (term ? allPages.filter(p => p.title.toLowerCase().includes(term)) : allPages).slice(0, 8),
    [allPages, term],
  )
  const cardResults = useMemo(
    () => (term ? cards.filter(c => c.title.toLowerCase().includes(term)) : cards).slice(0, 8),
    [cards, term],
  )

  const groupLabel: React.CSSProperties = {
    padding: '6px 10px 2px', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
    textTransform: 'uppercase', color: 'var(--color-text-muted)',
  }
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
    border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13,
    color: 'var(--color-text)', textAlign: 'left',
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden', backgroundColor: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
        <Search size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        <input
          autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder={t('item_picker_placeholder')}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)', minWidth: 0 }}
        />
        <button onClick={onClose} title={t('projects_cancel')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}>
          <X size={13} />
        </button>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {pageResults.length > 0 && (
          <>
            <div style={groupLabel}>{t('item_picker_group_pages')}</div>
            {pageResults.map(p => (
              <button key={p.id} onClick={() => onSelect({ type: 'page', targetId: p.id, title: p.title || 'Untitled' })} style={rowStyle}>
                <span style={{ flexShrink: 0 }}>{p.icon || '📄'}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || 'Untitled'}</span>
              </button>
            ))}
          </>
        )}
        {cardResults.length > 0 && (
          <>
            <div style={groupLabel}>{t('item_picker_group_cards')}</div>
            {cardResults.map(c => (
              <button key={c.id} onClick={() => onSelect({ type: 'card', targetId: c.id, title: c.title, boardId: c.board_id })} style={rowStyle}>
                <FolderKanban size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.boardName}</span>
              </button>
            ))}
          </>
        )}
        {pageResults.length === 0 && cardResults.length === 0 && (
          <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>{t('item_picker_empty')}</div>
        )}
      </div>
    </div>
  )
}
