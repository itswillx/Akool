import { describe, expect, it, vi } from 'vitest'
import { prepareUpload, uploadContextBucket, validateUpload, type UploadContext } from './uploadValidation'

// Arquivo com MIME e tamanho controlados, sem alocar os bytes de verdade.
function fakeFile(type: string, size: number, name = 'arquivo'): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const MB = 1024 * 1024

describe('validateUpload', () => {
  it('derives the extension from the validated MIME, never from the file name', () => {
    const result = validateUpload('transaction-photo', fakeFile('image/png', 1000, 'foto.exe'))
    expect(result).toMatchObject({ ok: true, ext: 'png' })
  })

  it.each<[UploadContext, string, number]>([
    ['note-image', 'image/heic', 10 * MB],
    ['card-image', 'image/webp', 10 * MB],
    ['finance-attachment', 'application/pdf', 15 * MB],
    ['avatar', 'image/jpeg', 2 * MB],
    ['transaction-photo', 'image/gif', 10 * MB],
  ])('%s accepts %s up to the bucket limit', (context, type, max) => {
    expect(validateUpload(context, fakeFile(type, max)).ok).toBe(true)
    expect(validateUpload(context, fakeFile(type, max + 1))).toEqual({ ok: false, reason: 'too_large', context })
  })

  it('refuses types outside each allowlist (SVG anywhere, PDF in photos)', () => {
    const svg = fakeFile('image/svg+xml', 1000)
    for (const context of ['note-image', 'card-image', 'finance-attachment', 'avatar', 'transaction-photo'] as const) {
      expect(validateUpload(context, svg), context).toEqual({ ok: false, reason: 'invalid_type', context })
    }
    expect(validateUpload('transaction-photo', fakeFile('application/pdf', 1000)).ok).toBe(false)
    expect(validateUpload('avatar', fakeFile('image/gif', 1000)).ok).toBe(false)
    expect(validateUpload('avatar', fakeFile('', 1000)).ok).toBe(false)
  })
})

describe('uploadContextBucket', () => {
  it('maps each context to its storage bucket', () => {
    expect(uploadContextBucket('avatar')).toBe('avatars')
    expect(uploadContextBucket('transaction-photo')).toBe('transaction-photos')
    expect(uploadContextBucket('finance-attachment')).toBe('store-files')
  })
})

describe('prepareUpload (PERF-010)', () => {
  it('comprime antes de validar: a foto de 12 MB passa depois de reduzida', async () => {
    const big = fakeFile('image/jpeg', 12 * MB, 'IMG_0001.JPG')
    expect(validateUpload('card-image', big)).toEqual({ ok: false, reason: 'too_large', context: 'card-image' })
    const small = fakeFile('image/webp', 400_000, 'IMG_0001.webp')
    const result = await prepareUpload('card-image', big, () => Promise.resolve(small))
    expect(result).toEqual({ ok: true, file: small, ext: 'webp' })
  })

  it('o avatar segue direto, sem recompressão (já vem recortado)', async () => {
    const compress = vi.fn((f: File) => Promise.resolve(f))
    const avatar = fakeFile('image/jpeg', 200_000)
    expect((await prepareUpload('avatar', avatar, compress)).ok).toBe(true)
    expect(compress).not.toHaveBeenCalled()
  })

  it('continua recusando o que não é aceito no contexto', async () => {
    const pdf = fakeFile('application/pdf', 1000)
    expect(await prepareUpload('transaction-photo', pdf, f => Promise.resolve(f))).toEqual({ ok: false, reason: 'invalid_type', context: 'transaction-photo' })
  })
})
