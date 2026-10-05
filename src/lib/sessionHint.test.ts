import { expect, it } from 'vitest'
import { hasStoredSession } from './sessionHint'

function fakeStorage(keys: string[]): Pick<Storage, 'length' | 'key'> {
  return { length: keys.length, key: i => keys[i] ?? null }
}

it('reconhece a chave da sessão do Supabase pelo nome, sem ler o valor', () => {
  expect(hasStoredSession(fakeStorage(['akool:theme', 'sb-nhfftophadasiezrzlsv-auth-token']))).toBe(true)
  expect(hasStoredSession(fakeStorage(['akool:theme', 'sb-nhfftophadasiezrzlsv-auth-token-code-verifier']))).toBe(false)
  expect(hasStoredSession(fakeStorage([]))).toBe(false)
  expect(hasStoredSession(null)).toBe(false)
})
