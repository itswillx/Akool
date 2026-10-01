// ARCH-002: saiu do ProjectsPanel.tsx sem mudança de lógica.
import {
ChevronDown,
ChevronRight,
ChevronUp,
Download,
Image,
Link2,
X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SignedImage } from '../../../components/SignedImage'
import { useDialog } from '../../../hooks/useDialog'
import { useLanguage } from '../../../i18n/LanguageContext'
import { linkDisplay, normalizeLinkUrl } from '../../../lib/cardLinks'
import { safeWebHref } from '../../../lib/safeHref'
import { resolveSignedUrl } from '../../../lib/storageUrl'
import { uploadContextBucket } from '../../../lib/uploadValidation'
import type { ProjectCardAttachment, ProjectCardChecklistItem, ProjectCardLink } from '../../../types'
import { cardLinkStyle, inputStyle, labelStyle } from '../projectsShared'
import type { PendingFile } from './cardDraft'

function CardImageLightbox({ preview, onClose }: { preview: { url: string; name: string } | null; onClose: () => void }) {
  const { t } = useLanguage()
  const [resolvedUrl, setResolvedUrl] = useState('')
  const { dialogProps } = useDialog({ open: !!preview, onClose, closeOnEsc: true, label: preview?.name })

  useEffect(() => {
    let active = true
    if (preview) resolveSignedUrl(uploadContextBucket('card-image'), preview.url).then(u => { if (active) setResolvedUrl(u) })
    else setResolvedUrl('')
    return () => { active = false }
  }, [preview])

  const handleDownload = async () => {
    if (!preview || !resolvedUrl) return
    try {
      const res = await fetch(resolvedUrl)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ext = preview.name.split('.').pop() ?? blob.type.split('/')[1] ?? 'jpg'
      a.download = preview.name.includes('.') ? preview.name : `image_${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      window.open(resolvedUrl, '_blank')
    }
  }

  if (!preview) return null

  return (
    <div role="presentation"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', padding: 16 }}
    >
      <div {...dialogProps} onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '95vw', maxHeight: '95vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'flex-end' }}>
          <button
            type="button"
            onClick={handleDownload}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.1)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            <Download size={15} />{t('projects_attachments_download')}
          </button>
          <button aria-label={t('common_close')}
            type="button"
            onClick={onClose}
            style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <X size={18} />
          </button>
        </div>
        <img
          src={resolvedUrl}
          alt={preview.name}
          style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: 8, display: 'block' }}
        />
      </div>
    </div>
  )
}

export function CardAttachmentsSection({
  attachments, pendingFiles, removedIds, canEdit, onAddPending, onRemoveExisting, onRemovePending,
}: {
  attachments: ProjectCardAttachment[]; pendingFiles: PendingFile[]; removedIds: string[];
  canEdit: boolean;
  onAddPending: (file: File) => void;
  onRemoveExisting: (id: string) => void;
  onRemovePending: (id: string) => void;
}) {
  const { t } = useLanguage()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const [open, setOpen] = useState(false)
  const visibleAttachments = attachments.filter(a => !removedIds.includes(a.id))
  const total = visibleAttachments.length + pendingFiles.length

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Validação real acontece em onAddPending (prepareUpload: comprime e valida) — este check
    // é só o filtro de picker do input accept="image/*".
    if (file) onAddPending(file)
    e.target.value = ''
  }

  return (
    <div>
      <CardImageLightbox preview={preview} onClose={() => setPreview(null)} />
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', marginBottom: open ? 4 : 0, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {open ? <ChevronDown size={14} color="var(--color-text-muted)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
          <span style={{ ...labelStyle, marginBottom: 0 }}>{t('projects_attachments')}</span>
        </span>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {t('projects_attachments_count').replace('{count}', String(total))}
          </span>
        )}
      </button>
      {open && (
      <>
      {(visibleAttachments.length > 0 || pendingFiles.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {visibleAttachments.map(a => (
            <div key={a.id} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--color-border)', flexShrink: 0 }}>
              <button
                type="button"
                title={t('projects_attachments_view')}
                onClick={() => setPreview({ url: a.url, name: a.name })}
                style={{ width: '100%', height: '100%', padding: 0, border: 'none', cursor: 'pointer', background: 'var(--color-hover)' }}
              >
                <SignedImage bucket={uploadContextBucket('card-image')} stored={a.url} alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
              {canEdit && (
                <button aria-label={t('common_remove')}
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemoveExisting(a.id) }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
          {pendingFiles.map(p => (
            <div key={p.id} style={{ position: 'relative', width: 80, height: 80, borderRadius: 8, overflow: 'hidden', border: '1px dashed #6366f1', flexShrink: 0 }}>
              <button
                type="button"
                title={t('projects_attachments_view')}
                onClick={() => setPreview({ url: p.preview, name: p.file.name || 'image' })}
                style={{ width: '100%', height: '100%', padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
              >
                <img src={p.preview} alt={p.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </button>
              {canEdit && (
                <button aria-label={t('common_remove')}
                  type="button"
                  onClick={e => { e.stopPropagation(); onRemovePending(p.id) }}
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 999, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'transparent', color: 'var(--color-text-muted)', fontSize: 12.5, cursor: 'pointer', marginBottom: 6 }}
          >
            <Image size={14} />{t('projects_attachments_add')}
          </button>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-muted)' }}>{t('projects_attachments_paste_hint')}</p>
        </>
      )}
      </>
      )}
    </div>
  )
}

export function CardChecklistSection({
  items, canEdit, onUpdate,
}: {
  items: ProjectCardChecklistItem[]; canEdit: boolean;
  onUpdate: (items: ProjectCardChecklistItem[], immediate: boolean) => void;
}) {
  const { t } = useLanguage()
  const [input, setInput] = useState('')
  const [open, setOpen] = useState(false)
  const done = items.filter(i => i.completed).length
  const total = items.length
  const progressPct = total > 0 ? Math.round((done / total) * 100) : 0

  const addItem = () => {
    const text = input.trim()
    if (!text) return
    onUpdate([...items, { id: crypto.randomUUID(), text, completed: false }], true)
    setInput('')
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, width: '100%', marginBottom: open ? 4 : 0, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {open ? <ChevronDown size={14} color="var(--color-text-muted)" /> : <ChevronRight size={14} color="var(--color-text-muted)" />}
          <span style={{ ...labelStyle, marginBottom: 0 }}>{t('projects_checklist')}</span>
        </span>
        {total > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            {t('projects_checklist_progress').replace('{done}', String(done)).replace('{total}', String(total))}
          </span>
        )}
      </button>
      {open && (
        <>
          {total > 0 && (
            <div style={{ height: 4, borderRadius: 999, backgroundColor: 'var(--color-hover)', marginBottom: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 999, backgroundColor: done === total ? '#22c55e' : '#6366f1', transition: 'width 0.2s' }} />
            </div>
          )}
          {items.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 8px', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map(item => (
                <li key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={item.completed}
                    disabled={!canEdit}
                    onChange={() => onUpdate(items.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i), true)}
                    style={{ flexShrink: 0, cursor: canEdit ? 'pointer' : 'default' }}
                  />
                  <input
                    disabled={!canEdit}
                    value={item.text}
                    onChange={e => onUpdate(items.map(i => i.id === item.id ? { ...i, text: e.target.value } : i), false)}
                    style={{
                      flex: 1, minWidth: 0, border: 'none', background: 'transparent',
                      fontSize: 13, color: item.completed ? 'var(--color-text-muted)' : 'var(--color-text)',
                      textDecoration: item.completed ? 'line-through' : 'none', padding: '4px 0',
                    }}
                  />
                  {item.owner === 'user' && (
                    <span title={t('projects_checklist_owner_user_hint')}
                      style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', backgroundColor: '#dc26261f', padding: '1px 6px', borderRadius: 999, flexShrink: 0 }}>
                      {t('projects_checklist_owner_user')}
                    </span>
                  )}
                  {canEdit && (
                    <button aria-label={t('common_remove')}
                      onClick={() => onUpdate(items.filter(i => i.id !== item.id), true)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
              placeholder={t('projects_checklist_placeholder')}
              style={inputStyle}
            />
          )}
        </>
      )}
    </div>
  )
}

// Trello-style links: attach a web URL (+ optional display text), shown as a
// clickable list that opens each link directly in a new tab.
export function CardLinksSection({ links, canEdit, onUpdate }: {
  links: ProjectCardLink[]; canEdit: boolean;
  onUpdate: (links: ProjectCardLink[], immediate: boolean) => void;
}) {
  const { t } = useLanguage()
  const [urlInput, setUrlInput] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const canAdd = !!normalizeLinkUrl(urlInput)

  const addLink = () => {
    const url = normalizeLinkUrl(urlInput)
    if (!url) return
    onUpdate([...links, { id: crypto.randomUUID(), url, title: titleInput.trim() }], true)
    setUrlInput('')
    setTitleInput('')
  }

  return (
    <div>
      <label style={labelStyle}>{t('projects_links')}</label>
      {links.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: canEdit ? 8 : 0 }}>
          {links.map(link => {
            // SEC-010: links come straight from project_cards.links, which any
            // board editor can write over REST — only http(s) becomes clickable.
            const href = safeWebHref(link.url)
            const body = (
              <>
                <Link2 size={13} style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkDisplay(link)}</span>
              </>
            )
            return (
              <div key={link.id} style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: 'var(--color-hover)', borderRadius: 6, padding: '6px 8px' }}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" title={link.url}
                    style={{ ...cardLinkStyle, color: 'var(--color-primary)' }}>
                    {body}
                  </a>
                ) : (
                  <span title={link.url} style={{ ...cardLinkStyle, color: 'var(--color-text-muted)' }}>{body}</span>
                )}
                {canEdit && (
                  <button onClick={() => onUpdate(links.filter(l => l.id !== link.id), true)} title={t('projects_delete')}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2, flexShrink: 0 }}>
                    <X size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {canEdit && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <input value={urlInput} onChange={e => setUrlInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
            placeholder={t('projects_links_url_placeholder')} style={inputStyle} />
          <input value={titleInput} onChange={e => setTitleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink() } }}
            placeholder={t('projects_links_title_placeholder')} style={inputStyle} />
          <button type="button" onClick={addLink} disabled={!canAdd}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: '1px dashed var(--color-border)', background: 'transparent', color: canAdd ? 'var(--color-primary)' : 'var(--color-text-muted)', fontSize: 12.5, fontWeight: 600, cursor: canAdd ? 'pointer' : 'default' }}>
            <Link2 size={14} />{t('projects_links_add')}
          </button>
        </div>
      )}
    </div>
  )
}

// Collapsible group used to categorize the card's meta fields (button + chevron,
// mirroring the CardFilterBar collapse pattern).
export function CollapsibleSection({ title, defaultOpen = false, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-bg)', overflow: 'hidden' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-text)', fontSize: 13, fontWeight: 600 }}>
        <span>{title}</span>
        {open ? <ChevronUp size={15} color="var(--color-text-muted)" /> : <ChevronDown size={15} color="var(--color-text-muted)" />}
      </button>
      {open && <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 12px 12px' }}>{children}</div>}
    </div>
  )
}
