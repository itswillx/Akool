import { useState } from 'react'
import Cropper from 'react-easy-crop'
import type { Area, Point } from 'react-easy-crop'
import { X, ZoomIn } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { cropImageToBlob } from '../lib/imageCrop'

// Round, 1:1 crop step shown between picking/opening a photo and uploading
// it, so the framing UserAvatar.tsx applies (circle, object-fit: cover) can
// be chosen by the user instead of an implicit center-crop.
export default function AvatarCropModal({ imageSrc, onClose, onSave }: {
  imageSrc: string
  onClose: () => void
  onSave: (blob: Blob) => Promise<void>
}) {
  const { t } = useLanguage()
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedArea, setCroppedArea] = useState<Area | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const handleSave = async () => {
    if (!croppedArea) return
    setSaving(true)
    try {
      const blob = await cropImageToBlob(imageSrc, croppedArea)
      await onSave(blob)
    } catch {
      setLoadError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 360, boxShadow: '0 24px 60px -20px rgba(0,0,0,0.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>{t('settings_avatar_crop_title')}</h3>
          <button onClick={onClose} aria-label={t('settings_avatar_crop_cancel')}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex', padding: 4, borderRadius: 6 }}>
            <X size={16} />
          </button>
        </div>

        {loadError ? (
          <p style={{ fontSize: 13, color: 'var(--color-error)', margin: '0 0 16px' }}>{t('settings_avatar_crop_load_error')}</p>
        ) : (
          <>
            <p style={{ fontSize: 12.5, color: 'var(--color-text-muted)', margin: '0 0 12px' }}>{t('settings_avatar_crop_hint')}</p>

            <div style={{ position: 'relative', width: '100%', height: 260, borderRadius: 10, overflow: 'hidden', backgroundColor: 'var(--color-bg-tertiary)' }}>
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, areaPixels) => setCroppedArea(areaPixels)}
                onMediaLoaded={() => setLoadError(false)}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px' }}>
              <ZoomIn size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                aria-label={t('settings_avatar_crop_zoom')}
                style={{ flex: 1 }}
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', backgroundColor: 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: 14 }}>
            {t('settings_avatar_crop_cancel')}
          </button>
          {!loadError && (
            <button type="button" onClick={handleSave} disabled={saving || !croppedArea}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: 'var(--color-btn-primary)', color: 'var(--color-btn-primary-text)', cursor: saving || !croppedArea ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600, opacity: saving || !croppedArea ? 0.7 : 1 }}>
              {t('settings_avatar_crop_save')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
