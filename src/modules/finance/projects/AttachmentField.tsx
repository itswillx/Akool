import { useEffect, useState } from 'react'
import { Download, Paperclip, Trash2, X } from 'lucide-react'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { supabase } from '../../../lib/supabase'
import { resolveSignedUrl } from '../../../lib/storageUrl'
import type { FinanceAttachment } from '../../../types'
import { ghostBtnStyle, labelStyle } from '../ui'
import { ATTACHMENT_BUCKET } from './useFinanceProjects'

// Small inline preview so a receipt photo can be seen without downloading it.
// Images resolve their signed URL once on mount (same shape as the transaction
// photo preview in FinancePanel); anything else keeps the paperclip square.
function AttachmentThumb({ attachment, bucket, onView }: {
  attachment: FinanceAttachment
  bucket: string
  onView: (url: string) => void
}) {
  const isImage = attachment.mime.startsWith('image/')
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!isImage) return
    let active = true
    resolveSignedUrl(bucket, attachment.path).then(signed => {
      if (active) setUrl(signed)
    })
    return () => { active = false }
    // Resolve once per attachment; the path never changes for a given id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id])

  const box: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 7,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-bg-secondary)',
    color: 'var(--color-text-muted)',
    overflow: 'hidden',
  }

  if (!isImage || !url) {
    return <div style={box}><Paperclip size={15} /></div>
  }

  return (
    <button type="button" onClick={() => onView(url)} title={attachment.name}
      style={{ ...box, padding: 0, border: '1px solid var(--color-border)', cursor: 'zoom-in' }}>
      <img src={url} alt={attachment.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </button>
  )
}

// Fullscreen viewer for a clicked thumbnail. Unlike the form modals, the
// backdrop DOES dismiss: there is nothing typed to lose in a viewer.
function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}>
      <img src={url} alt={name} onClick={e => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 10, boxShadow: '0 12px 48px rgba(0,0,0,0.5)', cursor: 'default' }} />
      <button type="button" onClick={onClose}
        style={{ position: 'absolute', top: 16, right: 16, width: 38, height: 38, borderRadius: 10, border: 'none', background: 'rgba(0,0,0,0.55)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={20} />
      </button>
    </div>
  )
}

// Multi-file field for receipts and product photos. Uploads land in a private
// bucket under `<uid>/<projectId>/`, which is what the storage policies key on,
// and are read back through signed URLs (never getPublicUrl). The bucket
// defaults to the obras one; the store submodule passes its own.
export function AttachmentField({ projectId, value, onChange, bucket = ATTACHMENT_BUCKET }: {
  projectId: string
  value: FinanceAttachment[]
  onChange: (next: FinanceAttachment[]) => void
  bucket?: string
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ url: string; name: string } | null>(null)

  const handlePick = async (files: FileList | null) => {
    if (!files || !user) return
    setBusy(true)
    setError(null)
    const added: FinanceAttachment[] = []
    for (const file of Array.from(files)) {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`
      const { error: err } = await supabase.storage.from(bucket).upload(path, file)
      if (err) { setError(err.message); continue }
      added.push({
        id: crypto.randomUUID(),
        path,
        name: file.name,
        mime: file.type,
        size: file.size,
        uploaded_at: new Date().toISOString(),
      })
    }
    if (added.length) onChange([...value, ...added])
    setBusy(false)
  }

  const handleRemove = async (attachment: FinanceAttachment) => {
    // Drop the object as well — the jsonb column has no cascade to storage.
    await supabase.storage.from(bucket).remove([attachment.path])
    onChange(value.filter(a => a.id !== attachment.id))
  }

  const handleOpen = async (attachment: FinanceAttachment) => {
    const url = await resolveSignedUrl(bucket, attachment.path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div>
      <label style={labelStyle}>{t('finance_proj_attachments')}</label>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {value.map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px', border: '1px solid var(--color-border)', borderRadius: 7, background: 'var(--color-surface)' }}>
              <AttachmentThumb attachment={a} bucket={bucket} onView={url => setViewing({ url, name: a.name })} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--color-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {a.name}
              </span>
              <button type="button" onClick={() => handleOpen(a)} title={t('finance_proj_open_file')}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 2 }}>
                <Download size={14} />
              </button>
              <button type="button" onClick={() => handleRemove(a)} title={t('finance_delete')}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-error)', display: 'flex', padding: 2 }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <label style={{ ...ghostBtnStyle, opacity: busy ? 0.6 : 1 }}>
        <Paperclip size={14} />
        {busy ? t('finance_proj_uploading') : t('finance_proj_add_file')}
        <input type="file" multiple hidden disabled={busy} onChange={e => { handlePick(e.target.files); e.target.value = '' }} />
      </label>
      {error && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-error)' }}>{error}</div>}
      {viewing && <Lightbox url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
    </div>
  )
}
