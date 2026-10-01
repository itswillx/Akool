// PERF-010: fotos de celular (4 a 8 MB, às vezes mais de 10) iam cruas para
// notas, cards e comprovantes. Antes do upload, a imagem é reduzida (lado maior
// até 2048 px) e recodificada em WebP, ou JPEG se o navegador não gerar WebP.
// O original fica quando comprimir não ajuda: PDF, GIF (perderia a animação),
// formato que o navegador não decodifica (HEIC fora do Safari), arquivo já
// pequeno, ou resultado maior que o original.

export const MAX_SIDE = 2048
export const SMALL_BYTES = 300 * 1024
export const QUALITY = 0.82
const OUTPUT_TYPES = ['image/webp', 'image/jpeg'] as const
const KEEP_TYPES = new Set(['image/gif', 'image/svg+xml'])

export interface DecodedImage {
  width: number
  height: number
  source: CanvasImageSource
  close?: () => void
}

export interface CompressDeps {
  decode: (file: Blob) => Promise<DecodedImage>
  encode: (image: DecodedImage, width: number, height: number, type: string, quality: number) => Promise<Blob | null>
}

/** Dimensões finais: o lado maior cabe em `max`, sem ampliar imagem pequena. */
export function targetSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function renamed(name: string, type: string): string {
  const ext = type === 'image/webp' ? 'webp' : 'jpg'
  const base = name.replace(/\.[^./\\]+$/, '') || 'image'
  return `${base}.${ext}`
}

const browserDeps: CompressDeps = {
  async decode(file) {
    // imageOrientation: a foto de celular "em pé" não sai deitada.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() }
  },
  async encode(image, width, height, type, quality) {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(image.source, 0, 0, width, height)
      return canvas.convertToBlob({ type, quality })
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(image.source, 0, 0, width, height)
    return new Promise(resolve => canvas.toBlob(resolve, type, quality))
  },
}

/** Devolve a foto pronta para subir: reduzida e recodificada, ou o original. */
export async function compressImage(file: File, deps: CompressDeps = browserDeps): Promise<File> {
  if (!file.type.startsWith('image/') || KEEP_TYPES.has(file.type)) return file
  let image: DecodedImage
  try {
    image = await deps.decode(file)
  } catch {
    return file
  }
  try {
    const { width, height } = targetSize(image.width, image.height)
    const resized = width !== image.width || height !== image.height
    if (!resized && file.size <= SMALL_BYTES) return file
    for (const type of OUTPUT_TYPES) {
      const blob = await deps.encode(image, width, height, type, QUALITY).catch(() => null)
      // Sem suporte ao tipo, o canvas devolve PNG: tenta o próximo.
      if (!blob || blob.type !== type) continue
      if (blob.size >= file.size) return file
      return new File([blob], renamed(file.name, type), { type, lastModified: file.lastModified })
    }
    return file
  } finally {
    image.close?.()
  }
}
