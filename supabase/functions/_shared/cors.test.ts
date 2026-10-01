import { describe, expect, it } from 'vitest'
import { PRODUCTION_ORIGINS, allowedOrigins, corsHeaders } from './cors.ts'

const req = (origin?: string) => new Request('https://x.supabase.co/functions/v1/f', {
  method: 'OPTIONS',
  headers: origin ? { origin } : {},
})

describe('allowedOrigins', () => {
  it('sem env, só produção (sem localhost)', () => {
    for (const env of [undefined, null, '', ' , ']) {
      const origins = allowedOrigins(env)
      expect(origins).toEqual(PRODUCTION_ORIGINS)
      expect(origins.some(o => o.includes('localhost'))).toBe(false)
    }
  })

  it('com env, usa a lista informada (dev com localhost)', () => {
    expect(allowedOrigins(' http://localhost:5173 , https://staging.example ')).toEqual(['http://localhost:5173', 'https://staging.example'])
  })
})

describe('corsHeaders', () => {
  const origins = allowedOrigins(undefined)

  it('ecoa a origem permitida', () => {
    expect(corsHeaders(req('https://www.slinkysalsichinha.com.br'), origins)['Access-Control-Allow-Origin']).toBe('https://www.slinkysalsichinha.com.br')
  })

  it('a origem da Netlify desativada não é mais aceita', () => {
    expect(PRODUCTION_ORIGINS).not.toContain('https://akool.netlify.app')
    expect(corsHeaders(req('https://akool.netlify.app'), origins)['Access-Control-Allow-Origin']).toBe(PRODUCTION_ORIGINS[0])
  })

  it('origem estranha ou localhost em produção recebe a 1ª de produção', () => {
    for (const o of ['https://evil.example', 'http://localhost:5173', undefined]) {
      expect(corsHeaders(req(o), origins)['Access-Control-Allow-Origin']).toBe(PRODUCTION_ORIGINS[0])
    }
  })

  it('mantém os headers de antes e aceita extras', () => {
    const base = corsHeaders(req('https://www.slinkysalsichinha.com.br'), origins)
    expect(base).toEqual({
      'Access-Control-Allow-Origin': 'https://www.slinkysalsichinha.com.br',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
    })
    const extra = corsHeaders(req(), origins, { allowHeaders: ['x-cron-secret'], exposeHeaders: ['Retry-After'] })
    expect(extra['Access-Control-Allow-Headers']).toBe('authorization, x-client-info, apikey, content-type, x-cron-secret')
    expect(extra['Access-Control-Expose-Headers']).toBe('Retry-After')
  })
})
