import { useEffect, useState } from 'react'
import { avatarColor, initials } from '../lib/avatar'
import { resolveSignedUrl } from '../lib/storageUrl'

export const AVATAR_BUCKET = 'avatars'

// The one user-avatar renderer. Priority: photo (private-bucket path resolved
// to a signed URL) → chosen emoji over the chosen color → the historical
// fallback, first initial over a color derived from the seed. Replaces the
// three duplicated initials/color implementations that used to live in
// ProjectsPanel, SharePageModal and PageHeader.
export function UserAvatar({ name, seed, emoji, color, url, size = 28, title }: {
  /** Display name (or email) the initial falls back to. */
  name: string
  /** Stable seed for the fallback color — use the email when available. */
  seed?: string | null
  emoji?: string | null
  color?: string | null
  /** Storage PATH in the avatars bucket (not a URL). */
  url?: string | null
  size?: number
  title?: string
}) {
  // The resolved URL remembers which path it belongs to, so a stale photo is
  // ignored by derivation instead of being cleared with a setState in the
  // effect body (which would cascade a render).
  const [photo, setPhoto] = useState<{ path: string; src: string } | null>(null)

  useEffect(() => {
    if (!url) return
    let active = true
    resolveSignedUrl(AVATAR_BUCKET, url).then(signed => {
      if (active) setPhoto({ path: url, src: signed })
    })
    return () => { active = false }
  }, [url])

  const photoSrc = url && photo?.path === url ? photo.src : null

  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    userSelect: 'none',
  }

  if (photoSrc) {
    return (
      <span style={base} title={title}>
        <img src={photoSrc} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </span>
    )
  }

  if (emoji) {
    // A chosen color stays solid (deliberate pick). Without one, a soft tint
    // of the user's deterministic color — the old var(--color-active) fallback
    // read as a muddy gray blob on the dark topbar chip.
    const bg = color || `color-mix(in srgb, ${avatarColor(seed || name)} 30%, transparent)`
    return (
      <span style={{ ...base, background: bg, fontSize: size * 0.62, lineHeight: 1 }} title={title}>
        {emoji}
      </span>
    )
  }

  return (
    <span style={{ ...base, background: color || avatarColor(seed || name), color: '#fff', fontSize: size * 0.42, fontWeight: 700 }} title={title}>
      {initials(name)}
    </span>
  )
}
