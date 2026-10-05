import { useEffect, useRef, useState } from 'react'
import { LOCAL_KEYS } from '../lib/localKeys'
import { flattenTree as flatten } from '../lib/pageTree'
import { StickyNote, Trash2, Plus, Link2, X, FileText, FolderKanban } from 'lucide-react'
import type { QuickNote, QuickNoteColor, QuickNoteLinkedItem } from '../types'
import { useQuickNotes, type QuickNoteChange, type QuickNoteConflict } from '../hooks/useQuickNotes'
import { EditConflictBanner } from './SaveStatusBadge'
import { usePages } from '../contexts/PagesContext'
import { setDocsSelection } from '../lib/docsNavigation'
import { activateProps } from '../lib/a11y'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import ItemPicker, { type PickedItem } from './ItemPicker'
import ConfirmDeleteModal from '@/shared/ui/ConfirmDeleteModal'

const COLORS: QuickNoteColor[] = ['yellow', 'green', 'pink', 'blue', 'purple']


function ColorDot({ color, selected, onClick, title }: {
  color: QuickNoteColor; selected: boolean; onClick: () => void; title: string
}) {
  return (
    <button
      onClick={onClick} title={title} type="button"
      style={{
        width: 18, height: 18, borderRadius: '50%', cursor: 'pointer', padding: 0, flexShrink: 0,
        backgroundColor: `var(--sticky-${color}-border)`,
        border: selected ? '2px solid var(--color-text)' : '2px solid transparent',
      }}
    />
  )
}

export default function QuickNotes({ isMobile = false }: { isMobile?: boolean }) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const { notes, conflicts, createNote, updateNote, deleteNote, resolveConflict } = useQuickNotes(user?.id)
  const [draft, setDraft] = useState('')
  const [draftColor, setDraftColor] = useState<QuickNoteColor>('yellow')
  // Delete asks for confirmation; beforeDelete lets the card cancel its
  // pending autosave only once the user actually confirms.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; beforeDelete: () => void } | null>(null)

  const submit = async () => {
    const content = draft.trim()
    if (!content) return
    setDraft('')
    // REL-004: na falha, o texto volta para o campo (se nada novo foi digitado).
    if (!(await createNote({ content, color: draftColor }))) setDraft(prev => prev || content)
  }

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, color: 'var(--color-text)' }}>
        <StickyNote size={13} />
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t('quick_notes_title')}</h3>
      </div>

      {/* Composer */}
      <div style={{
        display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 8, alignItems: isMobile ? 'stretch' : 'flex-end',
        padding: 10, borderRadius: 12, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', marginBottom: 12,
      }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() } }}
          placeholder={t('quick_notes_placeholder')}
          rows={2}
          style={{ flex: 1, resize: 'none', border: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', lineHeight: 1.45 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {COLORS.map(c => (
            <ColorDot key={c} color={c} selected={draftColor === c} onClick={() => setDraftColor(c)} title={t(`quick_notes_color_${c}`)} />
          ))}
          <button
            onClick={submit} disabled={!draft.trim()} type="button"
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, border: 'none',
              backgroundColor: 'var(--color-accent)', color: '#fff', fontSize: 12.5, fontWeight: 600,
              cursor: draft.trim() ? 'pointer' : 'default', opacity: draft.trim() ? 1 : 0.5, marginLeft: 4,
            }}
          >
            <Plus size={13} />{t('quick_notes_add')}
          </button>
        </div>
      </div>

      {/* Notes grid */}
      {notes.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)' }}>{t('quick_notes_empty')}</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 150 : 210}px, 1fr))`, gap: 10 }}>
          {notes.map(n => (
            <QuickNoteCard
              key={n.id}
              note={n}
              conflict={conflicts[n.id]}
              onUpdate={updateNote}
              onResolveConflict={resolveConflict}
              onRequestDelete={(id, beforeDelete) => setConfirmDelete({ id, beforeDelete })}
            />
          ))}
        </div>
      )}

      <ConfirmDeleteModal
        open={!!confirmDelete}
        title={t('quick_notes_delete_title')}
        message={t('quick_notes_delete_message')}
        onConfirm={() => {
          if (!confirmDelete) return
          confirmDelete.beforeDelete()
          deleteNote(confirmDelete.id)
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

// ─── Single sticky note ───────────────────────────────────────────────────────

function QuickNoteCard({ note, conflict, onUpdate, onResolveConflict, onRequestDelete }: {
  note: QuickNote
  conflict?: QuickNoteConflict
  onUpdate: (id: string, change: QuickNoteChange) => Promise<void>
  onResolveConflict: (id: string, choice: 'load' | 'keep') => Promise<void>
  onRequestDelete: (id: string, beforeDelete: () => void) => void
}) {
  const { t } = useLanguage()
  const { pages, sharedPages, setActivePage, setActivePanel } = usePages()
  const [text, setText] = useState(note.content)
  // API-003: fora de foco, o campo acompanha a nota (versão salva escolhida no
  // conflito, rascunho recuperado, edição desfeita). Em foco, quem manda é o teclado.
  const [shown, setShown] = useState(note.content)
  const [focused, setFocused] = useState(false)
  if (!focused && note.content !== shown) {
    setShown(note.content)
    setText(note.content)
  }
  const [hov, setHov] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestRef = useRef({ text: note.content, dirty: false, deleted: false })

  // Debounced autosave: partial patch only (never touches linked_items/color).
  const scheduleSave = (value: string) => {
    setText(value)
    latestRef.current.text = value
    latestRef.current.dirty = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, 600)
  }

  const flush = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const s = latestRef.current
    if (!s.dirty || s.deleted) return
    s.dirty = false
    onUpdate(note.id, { content: s.text })
  }

  useEffect(() => flush, []) // flush pending edit on unmount

  const handleDelete = () => {
    // Only mark deleted / drop the pending autosave once the user confirms;
    // cancelling the dialog keeps the note (and its debounced edit) alive.
    onRequestDelete(note.id, () => {
      latestRef.current.deleted = true
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    })
  }

  const openLinked = (item: QuickNoteLinkedItem) => {
    if (item.type === 'page') {
      const p = [...flatten(pages), ...flatten(sharedPages)].find(x => x.id === item.targetId)
      if (p) setActivePage(p)
    } else if (item.boardId) {
      // Chaves gravadas ANTES da troca: o ProjectsPanel as lê no mount. Quando
      // este componente roda dentro do DocumentsPanel (já montado), é o
      // setDocsSelection que efetivamente troca a seção — setActivePanel vira no-op.
      localStorage.setItem(LOCAL_KEYS.projectsActiveBoard, item.boardId)
      localStorage.setItem(LOCAL_KEYS.projectsOpenCard, item.targetId)
      setDocsSelection({ kind: 'projects' })
      setActivePanel('documents')
    }
  }

  // API-003: vínculos são operações sobre a nota mais recente. Se outra aba
  // mexeu na lista, o item entra (ou sai) da lista de lá, sem apagar o resto.
  const addLink = (picked: PickedItem) => {
    setPickerOpen(false)
    const item: QuickNoteLinkedItem = { id: crypto.randomUUID(), ...picked }
    void onUpdate(note.id, current => ({ linked_items: [...current.linked_items, item] }))
  }

  const removeLink = (id: string) => {
    void onUpdate(note.id, current => ({ linked_items: current.linked_items.filter(l => l.id !== id) }))
  }

  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px 10px', borderRadius: 10, minWidth: 0,
        backgroundColor: `var(--sticky-${note.color}-bg)`,
        borderTop: `3px solid var(--sticky-${note.color}-border)`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ display: 'flex', gap: 4, flex: 1, opacity: hov ? 1 : 0, transition: 'opacity 0.15s' }}>
          {COLORS.filter(c => c !== note.color).map(c => (
            <ColorDot key={c} color={c} selected={false} onClick={() => onUpdate(note.id, { color: c })} title={t(`quick_notes_color_${c}`)} />
          ))}
        </div>
        <button
          onClick={() => setPickerOpen(o => !o)} title={t('quick_notes_add_link')} type="button"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, opacity: hov || pickerOpen ? 1 : 0, transition: 'opacity 0.15s' }}
        >
          <Link2 size={13} />
        </button>
        <button
          onClick={handleDelete} title={t('quick_notes_delete')} type="button"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, opacity: hov ? 1 : 0, transition: 'opacity 0.15s' }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {conflict && (
        <EditConflictBanner
          inline
          message={t('quick_notes_conflict')}
          onLoadSaved={() => void onResolveConflict(note.id, 'load')}
          onKeepMine={() => void onResolveConflict(note.id, 'keep')}
        />
      )}

      <textarea
        value={text}
        onChange={e => scheduleSave(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); flush() }}
        rows={Math.min(Math.max(text.split('\n').length, 2), 8)}
        style={{ resize: 'none', border: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)', fontFamily: 'inherit', lineHeight: 1.45, width: '100%' }}
      />

      {pickerOpen && <ItemPicker onSelect={addLink} onClose={() => setPickerOpen(false)} />}

      {note.linked_items.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {note.linked_items.map(item => (
            <span
              key={item.id}
              {...activateProps(() => openLinked(item))}
              onClick={() => openLinked(item)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', padding: '2px 7px',
                borderRadius: 999, fontSize: 11, cursor: 'pointer', color: 'var(--color-text)',
                backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)',
              }}
            >
              {item.type === 'page' ? <FileText size={10} style={{ flexShrink: 0 }} /> : <FolderKanban size={10} style={{ flexShrink: 0 }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{item.title}</span>
              <button aria-label={t('common_remove')}
                onClick={e => { e.stopPropagation(); removeLink(item.id) }} type="button"
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 0 }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
