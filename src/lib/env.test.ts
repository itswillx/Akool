import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkEnv } from './env'

// DEV-003: a env do build é validada sem lançar exceção, com as mesmas regras
// do createClient do supabase-js.

const URL_OK = 'https://abcdefgh.supabase.co'

describe('checkEnv', () => {
  it('accepts a valid configuration and drops the trailing slash', () => {
    expect(checkEnv({ VITE_SUPABASE_URL: ` ${URL_OK}/ `, VITE_SUPABASE_ANON_KEY: ' chave ' })).toEqual({
      supabaseUrl: URL_OK, supabaseAnonKey: 'chave', missing: [],
    })
  })

  it('lists what is missing or empty', () => {
    expect(checkEnv({}).missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
    expect(checkEnv({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: '' }).missing).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
    expect(checkEnv({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: ' ' }).missing).toEqual(['VITE_SUPABASE_ANON_KEY'])
  })

  it('rejects URLs the Supabase client would refuse', () => {
    for (const url of ['abcdefgh.supabase.co', 'ftp://abcdefgh.supabase.co', 'https://', 'http://exa mple.com']) {
      expect(checkEnv({ VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: 'chave' }).missing, url).toEqual(['VITE_SUPABASE_URL'])
    }
  })
})

describe('build sem configuração', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('imports the Supabase client without throwing (was a white screen)', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    vi.resetModules()
    const env = await import('./env')
    expect(env.missingEnv).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'])
    const { supabase } = await import('./supabase')
    expect(supabase).toBeDefined()
  })
})
