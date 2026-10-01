// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
Link2,
Search,
X
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePages } from '../../../contexts/PagesContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import type { Page } from '../../../types'
import { flattenPages } from '../projectsShared'

// ─── Page picker ──────────────────────────────────────────────────────────────

export function PagePicker({ value, onChange }: { value: string | null; onChange: (id: string | null, page?: Page) => void }) {
  const { pages, sharedPages } = usePages()
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const all = useMemo(() => [...flattenPages(pages), ...flattenPages(sharedPages)], [pages, sharedPages])
  const selected = all.find(p => p.id === value)
  const results = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (term ? all.filter(p => p.title.toLowerCase().includes(term)) : all).slice(0, 8)
  }, [all, q])
  return (
    <div>
      {selected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
          <span>{selected.icon}</span>
          <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.title}</span>
          <button aria-label={t('common_clear')} onClick={() => onChange(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}><X size={14} /></button>
        </div>
      ) : open ? (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
          <div className="field-box" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
            <Search size={13} style={{ color: 'var(--color-text-muted)' }} />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={t('projects_search_page')} style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text)' }} />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {results.map(p => (
              <button key={p.id} onClick={() => { onChange(p.id, p); setOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, color: 'var(--color-text)', textAlign: 'left' }}>
                <span>{p.icon}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
              </button>
            ))}
            {results.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>—</div>}
          </div>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px dashed var(--color-border)', borderRadius: 8, background: 'transparent', color: 'var(--color-text-muted)', fontSize: 13, cursor: 'pointer', width: '100%' }}>
          <Link2 size={13} />{t('projects_link_page')}
        </button>
      )}
    </div>
  )
}
