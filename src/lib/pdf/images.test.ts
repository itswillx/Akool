// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { jsPDF } from 'jspdf'
import { CONTENT_W, MARGIN, PAGE_H } from './layout'
import { addImageAspectFit, blobToDataUrl, getImageDimensions } from './images'

// ARCH-005: o desenho exportado entra no PDF na largura útil, encolhe para
// caber na altura que sobra e pula de página quando sobra pouco.

function fakeDoc() {
  const doc = { addImage: vi.fn(), addPage: vi.fn() }
  return { doc: doc as unknown as jsPDF, raw: doc }
}

const NativeImage = globalThis.Image
afterEach(() => { globalThis.Image = NativeImage })

/** Image falsa: "carrega" com as medidas dadas, ou falha. */
function stubImage(size: { w: number; h: number } | null) {
  class FakeImage {
    naturalWidth = size?.w ?? 0
    naturalHeight = size?.h ?? 0
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_v: string) { queueMicrotask(() => (size ? this.onload : this.onerror)?.()) }
  }
  globalThis.Image = FakeImage as unknown as typeof Image
}

describe('blobToDataUrl', () => {
  it('converte o blob em data URL base64', async () => {
    const url = await blobToDataUrl(new Blob(['png-bytes'], { type: 'image/png' }))
    expect(url).toBe(`data:image/png;base64,${btoa('png-bytes')}`)
  })
})

describe('getImageDimensions', () => {
  it('devolve as medidas naturais da imagem', async () => {
    stubImage({ w: 800, h: 400 })
    await expect(getImageDimensions('data:image/png;base64,')).resolves.toEqual({ w: 800, h: 400 })
  })

  it('cai em 1×1 quando a imagem não carrega', async () => {
    stubImage(null)
    await expect(getImageDimensions('data:image/png;base64,')).resolves.toEqual({ w: 1, h: 1 })
  })
})

describe('addImageAspectFit', () => {
  it('imagem larga ocupa a largura útil, encostada na margem', () => {
    const { doc, raw } = fakeDoc()
    const next = addImageAspectFit(doc, 'data:x', 1800, 900, 20)
    const h = CONTENT_W / 2
    expect(raw.addImage).toHaveBeenCalledWith('data:x', 'PNG', MARGIN, 20, CONTENT_W, h)
    expect(raw.addPage).not.toHaveBeenCalled()
    expect(next).toBe(20 + h + 6)
  })

  it('imagem alta encolhe para a altura que sobra e fica centralizada', () => {
    const { doc, raw } = fakeDoc()
    const y = 100
    const next = addImageAspectFit(doc, 'data:x', 500, 1000, y)
    const avail = PAGE_H - y - MARGIN - 10
    const w = avail * 0.5
    expect(raw.addPage).not.toHaveBeenCalled()
    expect(raw.addImage).toHaveBeenCalledWith('data:x', 'PNG', MARGIN + (CONTENT_W - w) / 2, y, w, avail)
    expect(next).toBe(y + avail + 6)
  })

  it('com pouco espaço na página, abre página nova e desenha no topo', () => {
    const { doc, raw } = fakeDoc()
    const y = PAGE_H - MARGIN - 10 - 30 // sobram 30 mm: menos que o mínimo de 40
    const next = addImageAspectFit(doc, 'data:x', 1800, 900, y)
    const h = CONTENT_W / 2
    expect(raw.addPage).toHaveBeenCalledOnce()
    expect(raw.addImage).toHaveBeenCalledWith('data:x', 'PNG', MARGIN, MARGIN, CONTENT_W, h)
    expect(next).toBe(MARGIN + h + 6)
  })
})
