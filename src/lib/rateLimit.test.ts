import { describe, expect, it } from 'vitest'
import { isRateLimited, rateLimitRetryAfter } from './rateLimit'

// Corpo real devolvido pelo PostgREST no 429, capturado por fetch contra o
// projeto remoto em 2026-08-12 (SEC-012). É este shape exato que os call sites
// dependem — se a migration mudar o `code` ou o formato do `hint`, estes testes
// quebram antes de a UI voltar a mostrar "nenhum usuário encontrado" num 429.
const ERRO_BUSCA_429 = {
  code: 'rate_limited',
  details: null,
  hint: 'retry_after_seconds=35',
  message: 'Muitas buscas em sequencia. Aguarde alguns segundos.',
}

const ERRO_CONVITE_429 = {
  code: 'rate_limited',
  details: null,
  hint: 'retry_after_seconds=196',
  message: 'Muitas tentativas. Tente novamente em instantes.',
}

describe('isRateLimited', () => {
  it('reconhece o 429 das duas RPCs', () => {
    expect(isRateLimited(ERRO_BUSCA_429)).toBe(true)
    expect(isRateLimited(ERRO_CONVITE_429)).toBe(true)
  })

  it('não confunde outros erros do PostgREST com rate limit', () => {
    // 42501 é o "Not authenticated" que search_users_for_share levanta.
    expect(isRateLimited({ code: '42501', message: 'Not authenticated' })).toBe(false)
    expect(isRateLimited({ code: 'PGRST202', message: 'function not found' })).toBe(false)
  })

  it('é seguro contra ausência de erro e valores não-objeto', () => {
    expect(isRateLimited(null)).toBe(false)
    expect(isRateLimited(undefined)).toBe(false)
    expect(isRateLimited('rate_limited')).toBe(false)
    expect(isRateLimited({})).toBe(false)
  })
})

describe('rateLimitRetryAfter', () => {
  it('extrai os segundos do hint', () => {
    expect(rateLimitRetryAfter(ERRO_BUSCA_429)).toBe(35)
    expect(rateLimitRetryAfter(ERRO_CONVITE_429)).toBe(196)
  })

  it('devolve null quando o hint não traz os segundos', () => {
    // O header Retry-After existe na resposta, mas o browser não o expõe ao JS
    // (não está em Access-Control-Expose-Headers) — por isso o hint é a única
    // fonte legível, e o chamador precisa de um fallback quando ele falta.
    expect(rateLimitRetryAfter({ code: 'rate_limited', hint: null })).toBeNull()
    expect(rateLimitRetryAfter({ code: 'rate_limited' })).toBeNull()
    expect(rateLimitRetryAfter({ code: 'rate_limited', hint: 'sem numero aqui' })).toBeNull()
    expect(rateLimitRetryAfter(null)).toBeNull()
  })
})
