import { describe, expect, it, vi } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { createObservability, scrubBreadcrumb, scrubEvent, type SentryLike } from './observability'

function fakeSdk() {
  return {
    init: vi.fn(),
    captureException: vi.fn(() => 'id'),
    captureMessage: vi.fn(() => 'id'),
    setUser: vi.fn(),
  } satisfies SentryLike
}

describe('createObservability', () => {
  it('sem DSN é no-op e nem carrega o SDK', async () => {
    const loadSdk = vi.fn()
    const obs = createObservability({ dsn: '', release: '', environment: 'production', loadSdk })
    obs.reportError(new Error('x'))
    await obs.ready
    expect(loadSdk).not.toHaveBeenCalled()
    expect(obs.status()).toBe('off')
    expect(obs.sendTestEvent()).toBe(false)
  })

  it('com DSN inicia sem PII e sem tracing, e esvazia a fila de antes do carregamento', async () => {
    const sdk = fakeSdk()
    const obs = createObservability({ dsn: 'https://k@o1.ingest.sentry.io/1', release: 'abc', environment: 'production', loadSdk: async () => sdk })
    obs.reportError(new Error('cedo'), { where: 'boot' })
    expect(obs.status()).toBe('loading')
    await obs.ready
    expect(obs.status()).toBe('on')
    expect(sdk.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://k@o1.ingest.sentry.io/1', release: 'abc', sendDefaultPii: false, tracesSampleRate: 0,
    }))
    expect(sdk.captureException).toHaveBeenCalledWith(new Error('cedo'), { extra: { where: 'boot' } })

    obs.reportError(new Error('depois'))
    expect(sdk.captureException).toHaveBeenCalledTimes(2)
    expect(obs.sendTestEvent()).toBe(true)
    expect(sdk.captureMessage).toHaveBeenCalledTimes(1)
  })

  it('SDK que não carrega (bloqueador) não quebra nada', async () => {
    const obs = createObservability({ dsn: 'https://k@o1.ingest.sentry.io/1', release: '', environment: 'production', loadSdk: () => Promise.reject(new Error('blocked')) })
    obs.reportError(new Error('x'))
    await obs.ready
    expect(obs.status()).toBe('failed')
    expect(() => obs.reportError(new Error('y'))).not.toThrow()
  })
})

describe('scrubEvent / scrubBreadcrumb', () => {
  it('usuário fica só com o id; cookies e headers saem; textos passam pelo scrub', () => {
    const event = {
      type: undefined,
      message: 'falhou para a@b.com',
      user: { id: 'u-1', email: 'a@b.com', ip_address: '1.2.3.4' },
      request: { url: 'https://app/?token=abc', cookies: { sb: 'x' }, headers: { Cookie: 'sb=x' } },
    } as unknown as ErrorEvent
    const clean = scrubEvent(event)
    expect(clean.user).toEqual({ id: 'u-1' })
    expect(clean.message).toBe('falhou para [email]')
    expect(clean.request).toEqual({ url: 'https://app/?token=[redacted]' })
  })

  it('breadcrumb de console fica de fora', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'payload' })).toBeNull()
    expect(scrubBreadcrumb({ category: 'navigation', data: { to: '/?code=abc' } })).toEqual({ category: 'navigation', data: { to: '/?code=[redacted]' } })
  })
})
