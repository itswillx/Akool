import { useEffect, useState } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { resolveSignedUrl } from '../lib/storageUrl'

// <img> para buckets privados: recebe o valor armazenado (path novo ou URL
// publica antiga) e resolve para uma signed URL antes de renderizar.
export function SignedImage(
  { bucket, stored, ...imgProps }: { bucket: string; stored: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>,
) {
  const [src, setSrc] = useState<string>('')
  useEffect(() => {
    let active = true
    resolveSignedUrl(bucket, stored).then(url => { if (active) setSrc(url) })
    return () => { active = false }
  }, [bucket, stored])
  if (!src) return null
  return <img src={src} {...imgProps} />
}
