import { beforeEach, describe, expect, it, vi } from 'vitest'

// QA-001: leitura de anexos em buckets privados. O valor salvo no banco pode
// ser o path novo ou uma URL pública antiga; os dois viram signed URL.

const createSignedUrl = vi.fn<(path: string, expiresIn: number) => Promise<{
  data: { signedUrl: string } | null
  error: { message: string } | null
}>>()
const from = vi.fn((bucket: string) => {
  void bucket
  return { createSignedUrl }
})
vi.mock('./supabase', () => ({ supabase: { storage: { from: (bucket: string) => from(bucket) } } }))

const { extractStoragePath, resolveSignedUrl } = await import('./storageUrl')

describe('extractStoragePath', () => {
  it.each([
    ['uid/123.jpg', 'uid/123.jpg'],
    ['/uid/123.jpg', 'uid/123.jpg'],
    ['receipts/uid/123.jpg', 'uid/123.jpg'],
    ['https://x.supabase.co/storage/v1/object/public/receipts/uid/a%20b.jpg', 'uid/a b.jpg'],
    ['https://x.supabase.co/storage/v1/object/sign/receipts/uid/1.png?token=abc', 'uid/1.png'],
  ])('%s → %s', (stored, path) => {
    expect(extractStoragePath('receipts', stored)).toBe(path)
  })

  it.each([
    [''],
    ['data:image/png;base64,AAAA'],
    ['blob:http://localhost/uuid'],
    ['https://x.supabase.co/storage/v1/object/public/other-bucket/uid/1.png'],
    ['https://example.com/img.png'],
  ])('%s não é objeto do bucket', stored => {
    expect(extractStoragePath('receipts', stored)).toBeNull()
  })
})

describe('resolveSignedUrl', () => {
  beforeEach(() => {
    createSignedUrl.mockReset()
    from.mockClear()
  })

  it('assina o path e guarda em cache enquanto vale', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/1' }, error: null })
    expect(await resolveSignedUrl('avatars', 'u1/cache-hit.png')).toBe('https://signed/1')
    expect(await resolveSignedUrl('avatars', 'u1/cache-hit.png')).toBe('https://signed/1')
    expect(from).toHaveBeenCalledWith('avatars')
    expect(createSignedUrl).toHaveBeenCalledTimes(1)
    expect(createSignedUrl).toHaveBeenCalledWith('u1/cache-hit.png', 3600)
  })

  it('assina de novo quando a URL está perto de vencer', async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/short' }, error: null })
    // 30 s de validade: menos que a margem de 60 s do cache.
    await resolveSignedUrl('avatars', 'u1/short.png', 30)
    await resolveSignedUrl('avatars', 'u1/short.png', 30)
    expect(createSignedUrl).toHaveBeenCalledTimes(2)
  })

  it('com erro, devolve o valor salvo (a imagem antiga ainda pode abrir)', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'Object not found' } })
    expect(await resolveSignedUrl('receipts', 'u1/missing.jpg')).toBe('u1/missing.jpg')
  })

  it('o que não é do bucket volta como está, sem chamar o storage', async () => {
    expect(await resolveSignedUrl('receipts', 'blob:http://localhost/x')).toBe('blob:http://localhost/x')
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('SEC-014: URL de terceiros vira vazio e nem chega ao storage', async () => {
    expect(await resolveSignedUrl('note-images', 'https://rastreador.example.com/pixel.gif')).toBe('')
    expect(await resolveSignedUrl('avatars', 'http://outro.example.com/a.png')).toBe('')
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('SEC-014: URL do próprio Supabase e prévia local passam', async () => {
    // Nos testes, o Supabase do projeto é http://127.0.0.1:54321 (vite.config.ts).
    expect(await resolveSignedUrl('note-images', 'http://127.0.0.1:54321/storage/v1/object/public/outro-bucket/x.png'))
      .toBe('http://127.0.0.1:54321/storage/v1/object/public/outro-bucket/x.png')
    expect(await resolveSignedUrl('note-images', 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
})
