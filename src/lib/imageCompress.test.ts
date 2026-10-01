import { describe, expect, it, vi } from 'vitest'
import { compressImage, targetSize, type CompressDeps, type DecodedImage } from './imageCompress'

// Arquivo com MIME e tamanho controlados, sem alocar os bytes de verdade.
function fakeFile(type: string, size: number, name = 'foto.jpg'): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

function fakeBlob(type: string, size: number): Blob {
  const blob = new Blob(['x'], { type })
  Object.defineProperty(blob, 'size', { value: size })
  return blob
}

// Decodificador e codificador falsos: o happy-dom não tem canvas.
function deps(opts: { width: number; height: number; encoded?: Record<string, Blob | null>; decodeFails?: boolean }) {
  const close = vi.fn()
  const encode = vi.fn((_img: DecodedImage, _w: number, _h: number, type: string) =>
    Promise.resolve(opts.encoded && type in opts.encoded ? opts.encoded[type] : fakeBlob(type, 200_000)))
  const d: CompressDeps = {
    decode: () => opts.decodeFails
      ? Promise.reject(new Error('formato não suportado'))
      : Promise.resolve({ width: opts.width, height: opts.height, source: {} as CanvasImageSource, close }),
    encode,
  }
  return { d, encode, close }
}

const MB = 1024 * 1024

describe('targetSize', () => {
  it('reduz o lado maior para 2048 e mantém a proporção', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 2048, height: 1536 })
    expect(targetSize(3000, 4000)).toEqual({ width: 1536, height: 2048 })
  })

  it('não amplia imagem pequena', () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 })
  })
})

describe('compressImage', () => {
  it('reduz a foto grande para WebP no lado máximo', async () => {
    const { d, encode, close } = deps({ width: 4000, height: 3000 })
    const out = await compressImage(fakeFile('image/jpeg', 6 * MB, 'IMG_0001.JPG'), d)
    expect(out.type).toBe('image/webp')
    expect(out.name).toBe('IMG_0001.webp')
    expect(out.size).toBe(200_000)
    expect(encode).toHaveBeenCalledWith(expect.anything(), 2048, 1536, 'image/webp', 0.82)
    expect(close).toHaveBeenCalled()
  })

  it('cai para JPEG quando o navegador não gera WebP (o canvas devolve PNG)', async () => {
    const { d } = deps({ width: 4000, height: 3000, encoded: { 'image/webp': fakeBlob('image/png', 900_000) } })
    const out = await compressImage(fakeFile('image/png', 5 * MB, 'print.png'), d)
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toBe('print.jpg')
  })

  it('mantém o original quando o resultado sairia maior', async () => {
    const original = fakeFile('image/jpeg', 150_000)
    const { d } = deps({ width: 3000, height: 2000, encoded: { 'image/webp': fakeBlob('image/webp', 400_000) } })
    expect(await compressImage(original, d)).toBe(original)
  })

  it('mantém arquivo pequeno que já cabe no lado máximo', async () => {
    const original = fakeFile('image/png', 120_000)
    const { d, encode } = deps({ width: 800, height: 600 })
    expect(await compressImage(original, d)).toBe(original)
    expect(encode).not.toHaveBeenCalled()
  })

  it('recomprime arquivo pesado mesmo sem precisar reduzir', async () => {
    const { d, encode } = deps({ width: 1600, height: 1200 })
    const out = await compressImage(fakeFile('image/png', 3 * MB), d)
    expect(out.type).toBe('image/webp')
    expect(encode).toHaveBeenCalledWith(expect.anything(), 1600, 1200, 'image/webp', 0.82)
  })

  it('não toca em GIF (animação), PDF nem SVG', async () => {
    const { d, encode } = deps({ width: 4000, height: 3000 })
    for (const type of ['image/gif', 'application/pdf', 'image/svg+xml']) {
      const original = fakeFile(type, 8 * MB)
      expect(await compressImage(original, d)).toBe(original)
    }
    expect(encode).not.toHaveBeenCalled()
  })

  it('mantém o original quando o navegador não decodifica (HEIC fora do Safari)', async () => {
    const original = fakeFile('image/heic', 4 * MB, 'IMG.HEIC')
    const { d } = deps({ width: 0, height: 0, decodeFails: true })
    expect(await compressImage(original, d)).toBe(original)
  })

  it('mantém o original quando a codificação falha', async () => {
    const original = fakeFile('image/jpeg', 6 * MB)
    const { d, close } = deps({ width: 4000, height: 3000, encoded: { 'image/webp': null, 'image/jpeg': null } })
    expect(await compressImage(original, d)).toBe(original)
    expect(close).toHaveBeenCalled()
  })
})
