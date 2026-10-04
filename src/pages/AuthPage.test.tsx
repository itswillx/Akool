// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, userEvent, waitFor } from '../test/rtl'
import { LOCAL_KEYS } from '../lib/localKeys'
import { loadLang } from '../i18n/translations'
import { authContent } from '../i18n/authContent'
import { landingContent } from '../i18n/landingContent'

// O gate da tela pública: landing em `/`, formulário em #entrar/#cadastro,
// seletor de idioma e tema do aparelho. O formulário em si tem teste próprio
// (auth/AuthForm.test.tsx).

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendPasswordReset: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({ supabase: { rpc: auth.rpc }, recoveryLinkError: false }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: auth.signIn, signUp: auth.signUp, sendPasswordReset: auth.sendPasswordReset }),
}))

import AuthPage from './AuthPage'

const PT = landingContent['pt-BR']
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const heroTitle = (lang: 'pt-BR' | 'en') => screen.findByRole('heading', { level: 1, name: landingContent[lang].hero.title })

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  document.documentElement.classList.remove('dark')
  document.documentElement.lang = 'pt-BR'
  for (const fn of [auth.signIn, auth.signUp, auth.sendPasswordReset, auth.rpc]) fn.mockReset()
})

describe('AuthPage: página pública', () => {
  it('abre na landing, com Entrar e Criar conta e sem formulário', async () => {
    render(<AuthPage />)
    await heroTitle('pt-BR')
    expect(document.querySelector('form')).toBeNull()
    expect(screen.getAllByRole('link', { name: 'Entrar' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Criar conta' })[0].getAttribute('href')).toBe('#cadastro')
    // Foco no contêiner de rolagem: Space/PageDown rolam a landing sem clique.
    expect(document.activeElement?.classList.contains('auth-scroll')).toBe(true)
    expect(document.title).toBe('Akool')
  })

  it('#cadastro abre direto o cadastro, com o foco no título', () => {
    window.history.replaceState(null, '', '#cadastro')
    render(<AuthPage />)
    expect(screen.getByLabelText('Código de convite')).toBeTruthy()
    expect(document.querySelectorAll('form input')).toHaveLength(3)
    expect(screen.queryByRole('heading', { level: 1, name: PT.hero.title })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Criar conta' }))
    expect(document.title).toBe('Criar conta · Akool')
  })

  it('Entrar ↔ Criar conta troca a URL sem empilhar histórico; a aba ativa tem aria-current', () => {
    window.history.replaceState(null, '', '#entrar')
    render(<AuthPage />)
    const before = window.history.length
    const signup = screen.getByRole('link', { name: 'Criar conta' })
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(signup)
    expect(window.location.hash).toBe('#cadastro')
    expect(window.history.length).toBe(before)
    expect(screen.getByRole('link', { name: 'Criar conta' }).getAttribute('aria-current')).toBe('page')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Criar conta' }))
    // Abrir a recuperação empilha (o Voltar devolve o login).
    fireEvent.click(screen.getAllByRole('link', { name: 'Entrar' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    expect(window.location.hash).toBe('#recuperar')
    expect(window.history.length).toBe(before + 1)
  })

  it('Entrar troca para o formulário, grava #entrar, e o Voltar devolve a landing', async () => {
    render(<AuthPage />)
    await heroTitle('pt-BR')
    fireEvent.click(screen.getAllByRole('link', { name: 'Entrar' })[0])
    const title = screen.getByRole('heading', { level: 1, name: 'Bem-vindo de volta' })
    expect(screen.getByLabelText('Senha')).toBeTruthy()
    expect(window.location.hash).toBe('#entrar')
    // O foco vai ao título da tela nova e a aba ganha o nome dela.
    expect(document.activeElement).toBe(title)
    expect(document.title).toBe('Entrar · Akool')

    await act(async () => {
      window.history.back()
      await tick()
    })
    await heroTitle('pt-BR')
    expect(document.querySelector('form')).toBeNull()
    expect(window.location.hash).toBe('')
    expect(document.title).toBe('Akool')
  })

  it('"Voltar ao início" na tela de login volta para a landing, com o foco no título dela', async () => {
    window.history.replaceState(null, '', '#entrar')
    render(<AuthPage />)
    fireEvent.click(screen.getByRole('link', { name: 'Voltar ao início' }))
    const title = await heroTitle('pt-BR')
    expect(window.location.hash).toBe('')
    // Abriu direto no login: ao chegar à landing, o h1 recebe o foco (mesmo se o chunk demorou).
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('login diário abre direto no formulário, com a faixa, e espelha #entrar', () => {
    render(<AuthPage dailyLoginRequired />)
    expect(screen.getByText('Sessão expirada. Faça login diariamente para continuar.')).toBeTruthy()
    expect(screen.getByLabelText('Senha')).toBeTruthy()
    expect(window.location.hash).toBe('#entrar')
  })

  it('entrar com sucesso limpa o hash e avisa o App', async () => {
    auth.signIn.mockResolvedValue({ error: null })
    window.history.replaceState(null, '', '#entrar')
    const onSignedIn = vi.fn()
    render(<AuthPage onSignedIn={onSignedIn} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.type(screen.getByLabelText('Senha'), 'qualquer-coisa')
    await user.keyboard('{Enter}')
    expect(auth.signIn).toHaveBeenCalledWith('pessoa@example.com', 'qualquer-coisa')
    await waitFor(() => expect(window.location.hash).toBe(''))
    expect(onSignedIn).toHaveBeenCalledTimes(1)
  })
})

describe('AuthPage: idioma', () => {
  it('o seletor grava o idioma, troca a página inteira e o <html lang>', async () => {
    render(<AuthPage />)
    await heroTitle('pt-BR')
    // No celular (mock) o seletor é um botão só, com o código do outro idioma;
    // há um na barra e outro no rodapé.
    fireEvent.click(screen.getAllByRole('button', { name: 'EN · English' })[0])
    expect(localStorage.getItem(LOCAL_KEYS.authLang)).toBe('en')
    await act(() => loadLang('en'))
    await heroTitle('en')
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'PT · Português' }).length).toBeGreaterThan(0)
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('AuthPage: transições', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
    delete document.documentElement.dataset.authVt
  })

  it('landing → Entrar é transição de página; trocar de aba, do cartão; a aba ativa não faz nada', async () => {
    // Dublê síncrono: o update roda dentro do clique, como sem a API.
    const start = vi.fn((update: () => void) => {
      update()
      return { ready: Promise.resolve(), finished: new Promise<void>(() => {}), updateCallbackDone: Promise.resolve(), skipTransition: () => {} }
    })
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true, writable: true })
    render(<AuthPage />)
    await heroTitle('pt-BR')

    fireEvent.click(screen.getAllByRole('link', { name: 'Entrar' })[0])
    expect(start).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.authVt).toBe('page')
    // O foco e a rolagem rodam dentro do update (flushSync): o título já está focado.
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Bem-vindo de volta' }))
    // O painel embaixo do cartão (celular) acompanha a tela.
    expect(screen.getByRole('heading', { level: 2, name: authContent['pt-BR'].signin.title })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'Criar conta' }))
    expect(start).toHaveBeenCalledTimes(2)
    expect(document.documentElement.dataset.authVt).toBe('card')
    expect(screen.getByRole('heading', { level: 2, name: authContent['pt-BR'].signup.title })).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: 'Criar conta' }))
    expect(start).toHaveBeenCalledTimes(2)
  })
})
