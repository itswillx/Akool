// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { clearAuthHash, hrefForView, initialView, isPlainClick, pushAuthView, replaceAuthView, subscribeAuthHash, viewFromHash } from './authView'

// A view da página pública espelhada no hash (#entrar, #cadastro, #recuperar).

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => { window.history.replaceState(null, '', '/') })

describe('viewFromHash', () => {
  it.each([
    ['', 'landing'],
    ['#entrar', 'signin'],
    ['#cadastro', 'signup'],
    ['#recuperar', 'forgot'],
    ['entrar', 'signin'],
    ['#outra', 'landing'],
    // Callbacks do auth-js nunca viram view nossa.
    ['#error=access_denied&error_code=otp_expired', 'landing'],
    ['#access_token=abc&type=signup', 'landing'],
  ])('%j → %s', (hash, view) => {
    expect(viewFromHash(hash)).toBe(view)
  })

  it('a view forçada (login diário, link expirado) vence o hash', () => {
    expect(initialView('signin', '#cadastro')).toBe('signin')
    expect(initialView(null, '#cadastro')).toBe('signup')
  })
})

describe('isPlainClick', () => {
  const click = (over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) =>
    ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over }) as unknown as ReactMouseEvent

  it('clique comum troca a view na mesma aba', () => {
    expect(isPlainClick(click({}))).toBe(true)
  })

  // Botão do meio e modificadores deixam o href real agir (nova aba, janela…).
  it.each([
    ['botão do meio', { button: 1 }],
    ['cmd', { metaKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['shift', { shiftKey: true }],
    ['alt', { altKey: true }],
  ])('%s não é clique comum', (_name, over) => {
    expect(isPlainClick(click(over))).toBe(false)
  })
})

describe('histórico', () => {
  it('hrefForView: a landing preserva caminho e query; as outras são o hash', () => {
    expect(hrefForView('landing', { pathname: '/', search: '?x=1' })).toBe('/?x=1')
    expect(hrefForView('signup')).toBe('#cadastro')
  })

  it('pushAuthView grava o hash e cria uma entrada; repetir é no-op', () => {
    const before = window.history.length
    pushAuthView('signin')
    expect(window.location.hash).toBe('#entrar')
    expect(window.history.length).toBe(before + 1)
    pushAuthView('signin')
    expect(window.history.length).toBe(before + 1)
    pushAuthView('landing')
    expect(window.location.hash).toBe('')
  })

  it('replaceAuthView troca a URL sem entrada nova', () => {
    window.history.replaceState(null, '', '#error=access_denied&error_code=otp_expired')
    const before = window.history.length
    replaceAuthView('forgot')
    expect(window.location.hash).toBe('#recuperar')
    expect(window.history.length).toBe(before)
  })

  it('clearAuthHash só limpa hash nosso', () => {
    window.history.replaceState(null, '', '#error=access_denied')
    clearAuthHash()
    expect(window.location.hash).toBe('#error=access_denied')
    window.history.replaceState(null, '', '#entrar')
    clearAuthHash()
    expect(window.location.hash).toBe('')
  })

  // O happy-dom pode disparar mais de um hashchange por mudança; o que importa
  // é avisar ao menos uma vez e ficar quieto depois do cleanup.
  it('subscribeAuthHash avisa quando o hash muda e para depois do cleanup', async () => {
    let calls = 0
    const stop = subscribeAuthHash(() => { calls++ })
    window.location.hash = '#cadastro'
    await tick()
    expect(calls).toBeGreaterThan(0)
    stop()
    const seen = calls
    window.location.hash = '#entrar'
    await tick()
    expect(calls).toBe(seen)
  })
})
