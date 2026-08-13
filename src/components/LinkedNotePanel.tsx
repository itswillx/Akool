import { useState, useEffect } from 'react'
import { StickyNote, X, ChevronLeft, ChevronRight } from 'lucide-react'
import NoteEditor from './NoteEditor'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useIsMobile } from '../hooks/useIsMobile'
import { useLanguage } from '../i18n/LanguageContext'

interface LinkedNotePanelProps {
  pageId: string
}

export default function LinkedNotePanel({ pageId }: LinkedNotePanelProps) {
  const [open, setOpen] = useState(false)
  const [noteReady, setNoteReady] = useState(false)
  const { user } = useAuth()
  const isMobile = useIsMobile()
  const { t } = useLanguage()
  const panelWidth = isMobile ? Math.min(window.innerWidth - 24, 360) : PANEL_WIDTH

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const ensureNote = async () => {
      const { data: existing } = await supabase
        .from('note_contents')
        .select('id')
        .eq('page_id', pageId)
        .single()

      if (!cancelled) {
        if (!existing) {
          await supabase.from('note_contents').insert({ page_id: pageId, content: [] })
        }
        setNoteReady(true)
      }
    }

    ensureNote()
    return () => { cancelled = true }
  }, [open, pageId, user?.id])

  return (
    <>
      {/* Toggle button — floating over the canvas */}
      <div
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20"
        style={{ right: open ? panelWidth : 0 }}
      >
        <button
          onClick={() => setOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)', borderRadius: '12px 0 0 12px', padding: '12px 8px', color: 'var(--color-text-muted)', cursor: 'pointer', transition: 'background-color 0.15s, color 0.15s' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)' }}
          title={t('linked_note_title')}
        >
          <StickyNote size={14} />
          {open ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>

      {/* Side panel */}
      {open && (
        <div
          style={{ position: 'absolute', right: 0, top: 0, bottom: 0, zIndex: 10, backgroundColor: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 16px rgba(0,0,0,0.12)', width: panelWidth }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg-secondary)', flexShrink: 0 }}>
            <StickyNote size={13} style={{ color: 'var(--color-text-muted)' }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-muted)' }}>{t('linked_note_title')}</span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setOpen(false)}
              style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, cursor: 'pointer', border: 'none', backgroundColor: 'transparent', color: 'var(--color-text-muted)' }}
            >
              <X size={12} />
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {noteReady
              ? <NoteEditor pageId={pageId} />
              : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 13, color: 'var(--color-text-muted)' }}>{t('app_loading')}</div>
            }
          </div>
        </div>
      )}
    </>
  )
}

const PANEL_WIDTH = 380
