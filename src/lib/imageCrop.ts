// Canvas-based crop for the avatar cropper (src/components/AvatarCropModal.tsx).
// Browser-only (uses Image/canvas) — not unit-tested, kept separate from the
// React component so the component stays focused on the UI.

export interface PixelCrop {
  x: number
  y: number
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Needed so a cross-origin (signed Supabase Storage URL) source doesn't
    // taint the canvas — required for re-cropping an already-uploaded photo,
    // not for a freshly picked file (blob: URLs are always same-origin).
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// Draws the selected crop rectangle onto a square canvas, matching the
// circular, object-fit:cover rendering of UserAvatar.tsx, and encodes it as a
// JPEG blob ready to upload.
export async function cropImageToBlob(
  imageSrc: string,
  crop: PixelCrop,
  outputSize = 320,
): Promise<Blob> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unavailable')
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, outputSize, outputSize)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('crop_failed'))), 'image/jpeg', 0.92)
  })
}
