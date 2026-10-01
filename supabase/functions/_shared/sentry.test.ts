import { describe, expect, it, vi } from 'vitest'
import { buildEnvelope, buildEvent, captureException, envelopeUrl, parseDsn, parseStack } from './sentry.ts'

const DSN = 'https://pubkey123@o42.ingest.sentry.io/4507'

describe('parseDsn / envelopeUrl', () => {
  it('lê chave, host e projeto', () => {
    const dsn = parseDsn(DSN)!
    expect(dsn).toEqual({ protocol: 'https', publicKey: 'pubkey123', host: 'o42.ingest.sentry.io', projectId: '4507' })
    expect(envelopeUrl(dsn)).toBe('https://o42.ingest.sentry.io/api/4507/envelope/')
  })

  it('DSN ausente ou inválido desliga o reporter', () => {
    expect(parseDsn(undefined)).toBeNull()
    expect(parseDsn('')).toBeNull()
    expect(parseDsn('não é url')).toBeNull()
    expect(parseDsn('https://o42.ingest.sentry.io/4507')).toBeNull()
  })
})

describe('parseStack', () => {
  it('converte o stack do V8, mais antigo primeiro', () => {
    const frames = parseStack('Error: x\n    at inner (file:///tmp/index.ts:12:3)\n    at file:///tmp/index.ts:40:9')
    expect(frames).toEqual([
      { function: '?', filename: 'file:///tmp/index.ts', lineno: 40, colno: 9 },
      { function: 'inner', filename: 'file:///tmp/index.ts', lineno: 12, colno: 3 },
    ])
  })
})

describe('buildEvent / buildEnvelope', () => {
  it('evento com tags da function e sem PII', () => {
    const event = buildEvent(new Error('falhou para a@b.com'), { fn: 'site-backup', tags: { alert: 'backup_failed' } }, 'abc123')
    expect(event).toMatchObject({
      level: 'error', environment: 'production', release: 'abc123',
      tags: { function: 'site-backup', runtime: 'supabase-edge', alert: 'backup_failed' },
      exception: { values: [{ type: 'Error', value: 'falhou para [email]' }] },
    })
  })

  it('envelope: cabeçalho, item e evento em linhas', () => {
    const event = buildEvent('texto', { fn: 'ai-chat' })
    const lines = buildEnvelope(parseDsn(DSN)!, event).trimEnd().split('\n').map(l => JSON.parse(l))
    expect(lines[0]).toMatchObject({ event_id: event.event_id, dsn: DSN })
    expect(lines[1]).toEqual({ type: 'event' })
    expect(lines[2].exception.values[0].value).toBe('texto')
  })
})

describe('captureException', () => {
  it('sem DSN não chama a rede', async () => {
    const fetchImpl = vi.fn()
    await captureException(new Error('x'), { fn: 'ai-chat' }, { dsn: null, fetchImpl })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('envia uma vez por objeto de erro (o mesmo erro sobe por vários catch)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    const err = new Error('backup falhou')
    await captureException(err, { fn: 'site-backup', tags: { alert: 'backup_failed' } }, { dsn: DSN, fetchImpl })
    await captureException(err, { fn: 'site-backup' }, { dsn: DSN, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://o42.ingest.sentry.io/api/4507/envelope/')
    expect(init.method).toBe('POST')
    expect(String((init.headers as Record<string, string>)['X-Sentry-Auth'])).toContain('sentry_key=pubkey123')
  })

  it('nunca lança: rede fora ou timeout seguem em frente', async () => {
    const failing = vi.fn(async () => { throw new Error('offline') })
    await expect(captureException(new Error('a'), { fn: 'ai-chat' }, { dsn: DSN, fetchImpl: failing })).resolves.toBeUndefined()

    const hanging = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    await expect(captureException(new Error('b'), { fn: 'ai-chat' }, { dsn: DSN, fetchImpl: hanging as unknown as typeof fetch, timeoutMs: 20 })).resolves.toBeUndefined()
  })
})
