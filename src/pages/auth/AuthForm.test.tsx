// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createEvent, fireEvent, render, screen, userEvent, waitFor } from '../../test/rtl'
import { getT } from '../../i18n/translations'
import type { AuthFormView } from './authView'

// QA-003: o formulário de login/cadastro/recuperação. Senhas aqui são fictícias:
// o supabase e o AuthContext são falsos, nada sai da máquina.

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendPasswordReset: vi.fn(),
  rpc: vi.fn(),
}))

// validateInviteCode (src/lib/data/invites.ts) importa este mesmo módulo.
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: auth.rpc }, recoveryLinkError: false }))
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ signIn: auth.signIn, signUp: auth.signUp, sendPasswordReset: auth.sendPasswordReset }),
}))

import { AuthForm } from './AuthForm'

const t = getT('pt-BR')
const STRONG = 'Fict1ciaForte'

beforeEach(() => {
  for (const fn of [auth.signIn, auth.signUp, auth.sendPasswordReset, auth.rpc]) fn.mockReset()
})

function renderForm(view: AuthFormView, extra: Partial<{ dailyLoginRequired: boolean; recoveryExpired: boolean }> = {}) {
  const onSwitch = vi.fn()
  const onSignedIn = vi.fn()
  render(
    <AuthForm
      view={view}
      onSwitch={onSwitch}
      t={t}
      dailyLoginRequired={extra.dailyLoginRequired ?? false}
      recoveryExpired={extra.recoveryExpired ?? false}
      onSignedIn={onSignedIn}
    />,
  )
  return { onSwitch, onSignedIn, user: userEvent.setup() }
}

// Com as abas como links, o único botão chamado "Entrar" é o de enviar; o
// filtro por type continua por segurança.
const submitButton = (name: string) => {
  const button = screen.getAllByRole('button', { name }).find(b => b.getAttribute('type') === 'submit')
  if (!button) throw new Error('botão de enviar não encontrado: ' + name)
  return button
}

describe('AuthForm: login', () => {
  it('entra com o e-mail e a senha digitados e avisa o gate', async () => {
    auth.signIn.mockResolvedValue({ error: null })
    const { user, onSignedIn } = renderForm('signin')
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.type(screen.getByLabelText('Senha'), 'qualquer-coisa')
    await user.click(submitButton('Entrar'))
    expect(auth.signIn).toHaveBeenCalledWith('pessoa@example.com', 'qualquer-coisa')
    expect(onSignedIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('mostra o erro do login e não avisa o gate', async () => {
    auth.signIn.mockResolvedValue({ error: { message: 'Email ou senha incorretos.' } })
    const { user, onSignedIn } = renderForm('signin')
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.type(screen.getByLabelText('Senha'), 'errada')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Email ou senha incorretos.')
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('erro conhecido do Supabase aparece traduzido', async () => {
    auth.signIn.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } })
    const { user } = renderForm('signin')
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.type(screen.getByLabelText('Senha'), 'errada')
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe('E-mail ou senha incorretos.')
  })

  it('validação própria: e-mail vazio e inválido param no campo, com foco', async () => {
    const { user } = renderForm('signin')
    await user.type(screen.getByLabelText('Senha'), 'qualquer-coisa')
    await user.click(submitButton('Entrar'))
    const email = screen.getByLabelText('Email')
    expect(screen.getByRole('alert').textContent).toBe('Informe seu e-mail.')
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(email)
    expect(auth.signIn).not.toHaveBeenCalled()
    await user.type(email, 'sem-arroba')
    // Digitar limpa o erro do campo.
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(submitButton('Entrar'))
    expect(screen.getByRole('alert').textContent).toBe('Informe um e-mail válido.')
    expect(auth.signIn).not.toHaveBeenCalled()
  })

  it('mostra/oculta a senha e avisa do Caps Lock', async () => {
    const { user } = renderForm('signin')
    const password = screen.getByLabelText('Senha')
    expect(password.getAttribute('type')).toBe('password')
    await user.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(password.getAttribute('type')).toBe('text')
    const keyUp = createEvent.keyUp(password, { key: 'a' })
    Object.defineProperty(keyUp, 'getModifierState', { value: () => true })
    fireEvent(password, keyUp)
    expect(screen.getByText('Caps Lock ativado')).toBeTruthy()
  })

  it('enquanto envia, o botão fica aria-disabled, o form aria-busy e um segundo envio é ignorado', async () => {
    let finish: (v: { error: null }) => void = () => undefined
    auth.signIn.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const { user, onSignedIn } = renderForm('signin')
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.type(screen.getByLabelText('Senha'), 'qualquer-coisa')
    await user.click(submitButton('Entrar'))
    const form = document.querySelector('form')
    expect(form?.getAttribute('aria-busy')).toBe('true')
    expect(submitButton('Entrando…').getAttribute('aria-disabled')).toBe('true')
    await user.click(submitButton('Entrando…'))
    expect(auth.signIn).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ error: null }) })
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1))
  })

  it('"Esqueci minha senha" pede a view de recuperação ao gate', async () => {
    const { user, onSwitch } = renderForm('signin')
    await user.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    expect(onSwitch).toHaveBeenCalledWith('forgot')
  })

  it('mostra a faixa do login diário', () => {
    renderForm('signin', { dailyLoginRequired: true })
    expect(screen.getByText(t('auth_daily_login_required'))).toBeTruthy()
  })
})

describe('AuthForm: cadastro', () => {
  async function fillSignup(user: ReturnType<typeof userEvent.setup>, password: string) {
    await user.type(screen.getByLabelText('Email'), 'nova@example.com')
    await user.type(screen.getByLabelText('Senha'), password)
    await user.type(screen.getByLabelText('Código de convite'), 'abc123')
    await user.keyboard('{Enter}')
  }

  it('senha fraca não chega a consultar o convite', async () => {
    const { user } = renderForm('signup')
    await fillSignup(user, 'curta')
    expect((await screen.findByRole('alert')).textContent).toMatch(/pelo menos 10 caracteres/)
    expect(auth.rpc).not.toHaveBeenCalled()
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('convite inválido para antes de criar a conta', async () => {
    auth.rpc.mockResolvedValue({ data: { valid: false }, error: null })
    const { user } = renderForm('signup')
    await fillSignup(user, STRONG)
    expect((await screen.findByRole('alert')).textContent).toBe('Código de convite inválido ou expirado.')
    expect(auth.rpc).toHaveBeenCalledWith('validate_invite_code', { p_code: 'ABC123' })
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('convite válido cria a conta com o código em maiúsculas e pede a confirmação', async () => {
    auth.rpc.mockResolvedValue({ data: { valid: true }, error: null })
    auth.signUp.mockResolvedValue({ error: null })
    const { user } = renderForm('signup')
    await fillSignup(user, STRONG)
    // O formulário sai de cena: painel com o e-mail, reenvio e volta ao login.
    expect(await screen.findByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('nova@example.com')
    expect(screen.getByRole('button', { name: /Reenviar/ })).toBeTruthy()
    expect(document.querySelector('form')).toBeNull()
    expect(auth.signUp).toHaveBeenCalledWith('nova@example.com', STRONG, 'ABC123')
  })

  it('erro do servidor que não é do convite nem da senha vira aviso traduzido', async () => {
    auth.rpc.mockResolvedValue({ data: { valid: true }, error: null })
    auth.signUp.mockResolvedValue({ error: { code: 'user_already_exists', message: 'User already registered' } })
    const { user } = renderForm('signup')
    await fillSignup(user, STRONG)
    expect((await screen.findByRole('alert')).textContent).toBe('Já existe uma conta com este e-mail.')
  })

  it('normaliza o código colado com espaços antes de consultar', async () => {
    auth.rpc.mockResolvedValue({ data: { valid: false }, error: null })
    const { user } = renderForm('signup')
    await user.type(screen.getByLabelText('Email'), 'nova@example.com')
    await user.type(screen.getByLabelText('Senha'), STRONG)
    fireEvent.change(screen.getByLabelText('Código de convite'), { target: { value: ' local-convite ' } })
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')
    expect(auth.rpc).toHaveBeenCalledWith('validate_invite_code', { p_code: 'LOCAL-CONVITE' })
  })

  it('falha ao verificar o convite (rede) não vira "código inválido"', async () => {
    auth.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    const { user } = renderForm('signup')
    await fillSignup(user, STRONG)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível verificar o código/)
  })

  it('a RPC rejeitando (sem resposta) também avisa que não deu para verificar', async () => {
    auth.rpc.mockRejectedValue(new Error('offline'))
    const { user } = renderForm('signup')
    await fillSignup(user, STRONG)
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível verificar o código/)
    expect(auth.signUp).not.toHaveBeenCalled()
  })
})

describe('AuthForm: recuperar senha', () => {
  it('só pede o e-mail e confirma o envio', async () => {
    auth.sendPasswordReset.mockResolvedValue({ error: null })
    const { user } = renderForm('forgot')
    expect(document.querySelectorAll('form input')).toHaveLength(1)
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(auth.sendPasswordReset).toHaveBeenCalledWith('pessoa@example.com')
    expect(await screen.findByRole('heading', { level: 1, name: 'Link enviado' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('pessoa@example.com')
  })

  it('mostra a faixa do link expirado e "Voltar ao login" devolve o modo de entrar', async () => {
    const { user, onSwitch } = renderForm('forgot', { recoveryExpired: true })
    expect(screen.getByText(t('auth_recovery_expired'))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Voltar ao login/ }))
    expect(onSwitch).toHaveBeenCalledWith('signin')
  })
})

describe('AuthForm: transições do cartão', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
    delete document.documentElement.dataset.authVt
  })

  it('o painel de sucesso e a volta ao login passam pela transição do cartão', async () => {
    // Dublê da View Transitions API: roda o update na hora e nunca termina.
    const start = vi.fn((update: () => void) => {
      update()
      return { ready: Promise.resolve(), finished: new Promise<void>(() => {}), updateCallbackDone: Promise.resolve(), skipTransition: () => {} }
    })
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true, writable: true })
    auth.sendPasswordReset.mockResolvedValue({ error: null })
    const { user, onSwitch } = renderForm('forgot')
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Link enviado' })).toBeTruthy()
    expect(start).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.authVt).toBe('card')

    await user.click(screen.getByRole('link', { name: 'Voltar ao login' }))
    expect(start).toHaveBeenCalledTimes(2)
    expect(onSwitch).toHaveBeenCalledWith('signin')
  })
})

describe('AuthForm: recuperação sem revelar se a conta existe', () => {
  it('segundo pedido em menos de 60 s (só acontece com conta existente) mostra o mesmo painel', async () => {
    auth.sendPasswordReset.mockResolvedValue({ error: 'For security purposes, you can only request this after 41 seconds.' })
    const { user } = renderForm('forgot')
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Link enviado' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('AuthForm: resposta depois de sair da tela', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'startViewTransition')
    delete document.documentElement.dataset.authVt
  })

  it('não inicia a transição de sucesso se o formulário já saiu da tela', async () => {
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { value: start, configurable: true, writable: true })
    let resolve: (value: { error: null }) => void = () => {}
    auth.sendPasswordReset.mockReturnValue(new Promise(r => { resolve = r }))
    const onSwitch = vi.fn()
    const { unmount } = render(
      <AuthForm view="forgot" onSwitch={onSwitch} t={t} dailyLoginRequired={false} recoveryExpired={false} onSignedIn={vi.fn()} />,
    )
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Email'), 'pessoa@example.com')
    await user.click(screen.getByRole('button', { name: 'Enviar link' }))
    unmount()
    await act(async () => { resolve({ error: null }) })
    expect(start).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.authVt).toBeUndefined()
  })
})
