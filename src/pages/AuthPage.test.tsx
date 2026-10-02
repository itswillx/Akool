// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, userEvent } from '../test/rtl'

// QA-003: o formulário de login/cadastro. Senhas aqui são fictícias: o
// supabase e o AuthContext são falsos, nada sai da máquina.

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

const STRONG = 'Fict1ciaForte'

beforeEach(() => {
  localStorage.clear()
  for (const fn of [auth.signIn, auth.signUp, auth.sendPasswordReset, auth.rpc]) fn.mockReset()
})

async function fillLogin(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Senha'), password)
  return user
}

describe('AuthPage: login', () => {
  it('entra com o e-mail e a senha digitados', async () => {
    auth.signIn.mockResolvedValue({ error: null })
    render(<AuthPage />)
    const user = await fillLogin('pessoa@example.com', 'qualquer-coisa')
    // Há a aba "Entrar" e o botão de enviar; o que interessa é o do formulário.
    const submit = screen.getAllByRole('button', { name: 'Entrar' }).find(b => b.getAttribute('type') === 'submit')
    await user.click(submit!)
    expect(auth.signIn).toHaveBeenCalledWith('pessoa@example.com', 'qualquer-coisa')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('mostra o erro do login', async () => {
    auth.signIn.mockResolvedValue({ error: { message: 'Email ou senha incorretos.' } })
    render(<AuthPage />)
    const user = await fillLogin('pessoa@example.com', 'errada')
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Email ou senha incorretos.')
  })
})

describe('AuthPage: cadastro', () => {
  async function openSignup() {
    render(<AuthPage />)
    const user = userEvent.setup()
    await user.click(screen.getAllByRole('button', { name: 'Criar conta' })[0])
    return user
  }

  it('senha fraca não chega a consultar o convite', async () => {
    const user = await openSignup()
    await user.type(screen.getByLabelText('Email'), 'nova@example.com')
    await user.type(screen.getByLabelText('Senha'), 'curta')
    await user.type(screen.getByLabelText('Código de convite'), 'abc123')
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toMatch(/pelo menos 10 caracteres/)
    expect(auth.rpc).not.toHaveBeenCalled()
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('convite inválido para antes de criar a conta', async () => {
    auth.rpc.mockResolvedValue({ data: { valid: false }, error: null })
    const user = await openSignup()
    await user.type(screen.getByLabelText('Email'), 'nova@example.com')
    await user.type(screen.getByLabelText('Senha'), STRONG)
    await user.type(screen.getByLabelText('Código de convite'), 'abc123')
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe('Código de convite inválido ou expirado.')
    expect(auth.rpc).toHaveBeenCalledWith('validate_invite_code', { p_code: 'ABC123' })
    expect(auth.signUp).not.toHaveBeenCalled()
  })

  it('convite válido cria a conta com o código em maiúsculas e pede a confirmação', async () => {
    auth.rpc.mockResolvedValue({ data: { valid: true }, error: null })
    auth.signUp.mockResolvedValue({ error: null })
    const user = await openSignup()
    await user.type(screen.getByLabelText('Email'), 'nova@example.com')
    await user.type(screen.getByLabelText('Senha'), STRONG)
    await user.type(screen.getByLabelText('Código de convite'), 'abc123')
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('status')).textContent).toBe('Verifique seu email para confirmar a conta.')
    expect(auth.signUp).toHaveBeenCalledWith('nova@example.com', STRONG, 'ABC123')
  })

  it('falha ao verificar o convite (rede) não vira "código inválido"', async () => {
    auth.rpc.mockResolvedValue({ data: null, error: { message: 'Failed to fetch' } })
    const user = await openSignup()
    await user.type(screen.getByLabelText('Email'), 'nova@example.com')
    await user.type(screen.getByLabelText('Senha'), STRONG)
    await user.type(screen.getByLabelText('Código de convite'), 'abc123')
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível verificar o código/)
  })
})
