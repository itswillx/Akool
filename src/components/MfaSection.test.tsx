// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QRCodeSVG } from 'qrcode.react'
import { fireEvent, render, screen, userEvent } from '../test/rtl'
import { expectNoAxeViolations } from '../test/axe'

// MFA em Configurações → Segurança: o QR code gerado no app a partir da URI
// otpauth, o link para o app autenticador no celular, copiar a chave e mais de
// um aparelho (adicionar com o MFA ativo, remover sem desligar) e a passkey
// para entrar com o celular.

type Err = { code?: string; message: string } | null
interface FakeFactor { id: string; status: 'verified' | 'unverified'; factor_type: 'totp' | 'webauthn'; created_at: string }

// Chave de baixa entropia de propósito (o gitleaks roda no pre-commit e no CI).
const SECRET = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH'
const URI = `otpauth://totp/Akool:ana@exemplo.com?algorithm=SHA1&digits=6&issuer=Akool&period=30&secret=${SECRET}`
const QR_URL = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>'

const server = vi.hoisted(() => {
  // Local tipado: `null as unknown` dentro do vi.hoisted cai no no-unnecessary-type-assertion.
  const state: {
    factors: { id: string; status: 'verified' | 'unverified'; factor_type: 'totp' | 'webauthn'; created_at: string }[]
    uri: string
    enrollError: Err
    registerError: unknown
    registerCreatesFactor: boolean
    listCallsAtRegister: number
    verifyError: Err
    unenrollError: Err
  } = { factors: [], uri: '', enrollError: null, registerError: null, registerCreatesFactor: true, listCallsAtRegister: -1, verifyError: null, unenrollError: null }
  return state
})
const mfa = vi.hoisted(() => ({
  listFactors: vi.fn<() => Promise<unknown>>(),
  enroll: vi.fn<(args: unknown) => Promise<unknown>>(),
  unenroll: vi.fn<(args: { factorId: string }) => Promise<unknown>>(),
  challengeAndVerify: vi.fn<(args: { factorId: string; code: string }) => Promise<unknown>>(),
  webauthn: { register: vi.fn<(params: { friendlyName: string }, overrides?: unknown) => Promise<unknown>>() },
}))
vi.mock('../lib/supabase', () => ({ supabase: { auth: { mfa } } }))

const device = vi.hoisted(() => ({ mobile: false }))
vi.mock('@/shared/hooks/useIsMobile', () => ({ useIsMobile: () => device.mobile }))
const clipboard = vi.hoisted(() => ({ copy: vi.fn<(text: string) => Promise<boolean>>() }))
vi.mock('../lib/clipboard', () => ({ copyToClipboard: (text: string) => clipboard.copy(text) }))
// O `t` do app é estável (useMemo por idioma); um `t` novo a cada render
// refaria a busca dos fatores.
const language = vi.hoisted(() => ({
  lang: 'pt-BR',
  t: (k: string, vars?: Record<string, string | number>) => (vars ? [k, ...Object.values(vars)].join(' ') : k),
}))
vi.mock('../i18n/LanguageContext', () => ({ useLanguage: () => language }))
// happy-dom não tem WebAuthn: o suporte é decidido aqui (desligado por padrão).
const env = vi.hoisted(() => ({ webauthn: false }))
vi.mock('../lib/mfa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/mfa')>(),
  supportsPasskeys: () => env.webauthn,
}))

// A passkey fica atrás de VITE_MFA_PASSKEY (o Supabase hospedado ainda não liga o WebAuthn de MFA).
const flags = vi.hoisted(() => ({ passkey: true }))
vi.mock('../lib/env', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/env')>(),
  get MFA_PASSKEY_ENABLED() { return flags.passkey },
}))

import MfaSection from './MfaSection'
import { passkeyCreateOptions } from '../lib/mfa'

const verified = (id: string, createdAt = '2026-10-03T12:00:00Z'): FakeFactor =>
  ({ id, status: 'verified', factor_type: 'totp', created_at: createdAt })

const passkey = (id: string, createdAt = '2026-10-04T12:00:00Z'): FakeFactor =>
  ({ id, status: 'verified', factor_type: 'webauthn', created_at: createdAt })

function listResult(factors: FakeFactor[]) {
  const verifiedOf = (type: FakeFactor['factor_type']) => factors.filter(f => f.factor_type === type && f.status === 'verified')
  return { data: { all: [...factors], totp: verifiedOf('totp'), phone: [], webauthn: verifiedOf('webauthn') }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  device.mobile = false
  server.factors = []
  server.uri = URI
  server.enrollError = null
  server.verifyError = null
  server.unenrollError = null
  server.registerError = null
  server.registerCreatesFactor = true
  server.listCallsAtRegister = -1
  env.webauthn = false
  flags.passkey = true
  clipboard.copy.mockResolvedValue(true)
  mfa.listFactors.mockImplementation(() => Promise.resolve(listResult(server.factors)))
  mfa.enroll.mockImplementation(() => {
    if (server.enrollError) return Promise.resolve({ data: null, error: server.enrollError })
    server.factors.push({ id: 'new', status: 'unverified', factor_type: 'totp', created_at: '2026-10-04T17:00:00Z' })
    return Promise.resolve({ data: { id: 'new', type: 'totp', totp: { qr_code: QR_URL, secret: SECRET, uri: server.uri } }, error: null })
  })
  mfa.challengeAndVerify.mockImplementation(({ factorId }) => {
    if (server.verifyError) return Promise.resolve({ data: null, error: server.verifyError })
    server.factors = server.factors.map(f => (f.id === factorId ? { ...f, status: 'verified' } : f))
    return Promise.resolve({ data: {}, error: null })
  })
  mfa.webauthn.register.mockImplementation(() => {
    server.listCallsAtRegister = mfa.listFactors.mock.calls.length
    if (server.registerCreatesFactor) server.factors.push({ id: 'pk-new', status: 'unverified', factor_type: 'webauthn', created_at: '2026-10-04T17:00:00Z' })
    if (server.registerError) return Promise.resolve({ data: null, error: server.registerError })
    server.factors = server.factors.map(f => (f.id === 'pk-new' ? { ...f, status: 'verified' } : f))
    return Promise.resolve({ data: {}, error: null })
  })
  mfa.unenroll.mockImplementation(({ factorId }) => {
    if (server.unenrollError) return Promise.resolve({ data: null, error: server.unenrollError })
    server.factors = server.factors.filter(f => f.id !== factorId)
    return Promise.resolve({ data: { id: factorId }, error: null })
  })
})
afterEach(() => { vi.restoreAllMocks() })

/** viewBox e desenho de um QR de referência: provam o conteúdo sem decodificador. */
function referenceQr(value: string) {
  const { container, unmount } = render(<QRCodeSVG value={value} level="M" marginSize={4} />)
  const svg = container.querySelector('svg')
  const ref = { viewBox: svg?.getAttribute('viewBox'), d: [...(svg?.querySelectorAll('path') ?? [])].at(-1)?.getAttribute('d') }
  unmount()
  return ref
}

function mockCoarsePointer() {
  vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
    matches: query.includes('coarse'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as MediaQueryList)
}

async function openEnrollment(buttonName = 'mfa_enable') {
  const user = userEvent.setup()
  const view = render(<MfaSection />)
  await user.click(await screen.findByRole('button', { name: buttonName }))
  return { user, ...view }
}

function typeCode(code: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'mfa_code_label' }), { target: { value: code } })
}

describe('MfaSection: ativar', () => {
  it('antes da lista chegar, não mostra "Desativada" nem o botão de ativar', async () => {
    let resolve: (value: unknown) => void = () => {}
    mfa.listFactors.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    render(<MfaSection />)
    expect(screen.queryByText('mfa_status_off')).toBeNull()
    expect(screen.queryByRole('button', { name: 'mfa_enable' })).toBeNull()
    resolve(listResult([verified('f1')]))
    expect(await screen.findByText('mfa_status_on')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'mfa_add_device' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'mfa_enable' })).toBeNull()
    expect(mfa.listFactors).toHaveBeenCalledTimes(1)
  })

  it('gera o QR no app, com o emissor Akool, a chave agrupada e o foco no painel', async () => {
    const { user, container } = await openEnrollment()
    const qr = await screen.findByRole('img', { name: 'mfa_qr_alt' })

    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      issuer: 'Akool',
      friendlyName: expect.stringMatching(/^Akool \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/) as string,
    })
    // SVG inline (não a imagem do Supabase), com a mesma URI, correção M e margem.
    expect(qr.tagName.toLowerCase()).toBe('svg')
    expect(container.querySelector('img')).toBeNull()
    const expected = referenceQr(URI)
    expect(qr.getAttribute('viewBox')).toBe(expected.viewBox)
    expect([...qr.querySelectorAll('path')].at(-1)?.getAttribute('d')).toBe(expected.d)
    expect(referenceQr(URI.replace('ana@', 'bia@')).d).not.toBe(expected.d)

    expect(screen.getByText('AAAA BBBB CCCC DDDD EEEE FFFF GGGG HHHH')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'mfa_scan' }))

    typeCode('123456')
    await user.click(screen.getByRole('button', { name: 'mfa_verify' }))
    expect(mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: 'new', code: '123456' })
    expect((await screen.findByRole('status')).textContent).toBe('mfa_enabled_ok')
    expect(screen.queryByRole('img', { name: 'mfa_qr_alt' })).toBeNull()
    expect(await screen.findByText(/^mfa_factor_added /)).toBeTruthy()
  })

  it('copiar leva a chave crua; se a cópia falhar, avisa', async () => {
    const { user } = await openEnrollment()
    await user.click(await screen.findByRole('button', { name: 'mfa_copy_key' }))
    expect(clipboard.copy).toHaveBeenCalledWith(SECRET)
    expect(await screen.findByRole('button', { name: 'mfa_key_copied' })).toBeTruthy()

    clipboard.copy.mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: 'mfa_key_copied' }))
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_copy_failed')
    expect(screen.getByRole('button', { name: 'mfa_copy_key' })).toBeTruthy()
  })

  it('no celular, o link abre o app autenticador e vem antes do QR', async () => {
    device.mobile = true
    await openEnrollment()
    const link = await screen.findByRole('link', { name: 'mfa_open_app' })
    const qr = screen.getByRole('img', { name: 'mfa_qr_alt' })
    expect(link.getAttribute('href')).toBe(URI)
    expect(link.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('mfa_scan_mobile')).toBeTruthy()
    expect(screen.getByText('mfa_open_app_hint')).toBeTruthy()
    expect(screen.getByText('mfa_scan_other_device')).toBeTruthy()
  })

  it('no tablet (toque, tela larga), o link aparece depois do QR', async () => {
    mockCoarsePointer()
    await openEnrollment()
    const link = await screen.findByRole('link', { name: 'mfa_open_app' })
    const qr = screen.getByRole('img', { name: 'mfa_qr_alt' })
    expect(qr.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('mfa_scan')).toBeTruthy()
    expect(screen.queryByText('mfa_scan_other_device')).toBeNull()
  })

  it('sem URI otpauth, volta para a imagem do Supabase e não mostra o link', async () => {
    server.uri = ''
    device.mobile = true
    await openEnrollment()
    const img = await screen.findByRole('img', { name: 'mfa_qr_alt' })
    expect(img.tagName.toLowerCase()).toBe('img')
    expect(img.getAttribute('src')).toBe(QR_URL)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('mfa_scan')).toBeTruthy()
  })

  it('limpa o fator unverified abandonado antes de criar outro', async () => {
    server.factors = [{ id: 'stale', status: 'unverified', factor_type: 'totp', created_at: '2026-10-04T16:00:00Z' }]
    await openEnrollment()
    await screen.findByRole('img', { name: 'mfa_qr_alt' })
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'stale' })
    expect(mfa.unenroll.mock.invocationCallOrder[0]).toBeLessThan(mfa.enroll.mock.invocationCallOrder[0])
  })

  it('painel aberto sem violações de acessibilidade', async () => {
    const { container } = await openEnrollment()
    await screen.findByRole('img', { name: 'mfa_qr_alt' })
    await expectNoAxeViolations(container)
  })
})

describe('MfaSection: mais de um aparelho', () => {
  it('com MFA ativo, adiciona outro aparelho sem mexer no atual', async () => {
    server.factors = [verified('f1')]
    const { user } = await openEnrollment('mfa_add_device')
    expect(await screen.findByText('mfa_add_intro')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'mfa_qr_alt' })).toBeTruthy()
    // Com o painel aberto, não dá para remover aparelhos.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'mfa_remove' }).disabled).toBe(true)

    typeCode('654321')
    await user.click(screen.getByRole('button', { name: 'mfa_verify' }))
    expect((await screen.findByRole('status')).textContent).toBe('mfa_device_added_ok')
    expect(await screen.findAllByText(/^mfa_device_row /)).toHaveLength(2)
    expect(mfa.unenroll).not.toHaveBeenCalled()
  })

  it('cancelar o novo aparelho remove só o fator novo', async () => {
    server.factors = [verified('f1')]
    const { user } = await openEnrollment('mfa_add_device')
    await user.click(await screen.findByRole('button', { name: 'mfa_cancel' }))
    expect(mfa.unenroll.mock.calls).toEqual([[{ factorId: 'new' }]])
    expect(await screen.findByRole('button', { name: 'mfa_add_device' })).toBeTruthy()
  })

  it('com dois aparelhos, remover um mantém o MFA; o último volta a "Desativar"', async () => {
    server.factors = [verified('f1', '2026-10-03T12:00:00Z'), verified('f2', '2026-10-04T12:00:00Z')]
    const user = userEvent.setup()
    render(<MfaSection />)
    const removes = await screen.findAllByRole('button', { name: 'mfa_remove_device' })
    expect(removes).toHaveLength(2)

    await user.click(removes[0])
    await user.click(screen.getByRole('button', { name: 'mfa_remove_device_confirm' }))
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' })
    expect((await screen.findByRole('status')).textContent).toBe('mfa_device_removed_ok')

    const last = await screen.findByRole('button', { name: 'mfa_remove' })
    expect(last.getAttribute('aria-describedby')).toBe(screen.getByText(/^mfa_factor_added /).id)
    await user.click(last)
    await user.click(screen.getByRole('button', { name: 'mfa_remove_confirm' }))
    expect((await screen.findByRole('status')).textContent).toBe('mfa_removed_ok')
    expect(await screen.findByRole('button', { name: 'mfa_enable' })).toBeTruthy()
  })
})

describe('MfaSection: erros', () => {
  it('falha no enroll mostra a mensagem do servidor', async () => {
    server.enrollError = { message: 'boom' }
    await openEnrollment()
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_error boom')
  })

  it('sessão sem AAL2 ganha mensagem própria', async () => {
    server.factors = [verified('f1')]
    server.enrollError = { code: 'insufficient_aal', message: 'AAL2 required to enroll a new factor' }
    await openEnrollment('mfa_add_device')
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_need_aal2')
  })

  it('código recusado mantém o painel aberto; erro de rede mostra a mensagem', async () => {
    const { user } = await openEnrollment()
    await screen.findByRole('img', { name: 'mfa_qr_alt' })
    server.verifyError = { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' }
    typeCode('111111')
    await user.click(screen.getByRole('button', { name: 'mfa_verify' }))
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_invalid_code')
    expect(screen.getByRole('img', { name: 'mfa_qr_alt' })).toBeTruthy()

    server.verifyError = { message: 'Failed to fetch' }
    await user.click(screen.getByRole('button', { name: 'mfa_verify' }))
    expect((await screen.findByText('mfa_error Failed to fetch')).getAttribute('role')).toBe('alert')
  })

  it('falha ao remover mostra a mensagem e mantém o aparelho', async () => {
    server.factors = [verified('f1')]
    server.unenrollError = { message: 'boom' }
    const user = userEvent.setup()
    render(<MfaSection />)
    await user.click(await screen.findByRole('button', { name: 'mfa_remove' }))
    await user.click(screen.getByRole('button', { name: 'mfa_remove_confirm' }))
    expect((await screen.findByRole('alert')).textContent).toBe('mfa_error boom')
    expect(screen.getByText(/^mfa_factor_added /)).toBeTruthy()
  })
})

describe('MfaSection: passkey para entrar com o celular', () => {
  it('sem app autenticador, não oferece passkey', async () => {
    env.webauthn = true
    render(<MfaSection />)
    await screen.findByRole('button', { name: 'mfa_enable' })
    expect(screen.queryByText('mfa_passkey_title')).toBeNull()
  })

  it('com VITE_MFA_PASSKEY desligada, não oferece passkey', async () => {
    env.webauthn = true
    flags.passkey = false
    server.factors = [verified('f1')]
    render(<MfaSection />)
    await screen.findByRole('button', { name: 'mfa_add_device' })
    expect(screen.queryByText('mfa_passkey_title')).toBeNull()
    expect(screen.queryByRole('button', { name: 'mfa_passkey_add' })).toBeNull()
  })

  it('em navegador sem WebAuthn, não oferece cadastrar', async () => {
    server.factors = [verified('f1')]
    render(<MfaSection />)
    await screen.findByRole('button', { name: 'mfa_add_device' })
    expect(screen.queryByText('mfa_passkey_title')).toBeNull()
    expect(screen.queryByRole('button', { name: 'mfa_passkey_add' })).toBeNull()
  })

  it('no computador, cadastra a passkey no celular pelo QR, sem ida à rede antes', async () => {
    env.webauthn = true
    server.factors = [verified('f1')]
    const user = userEvent.setup()
    render(<MfaSection />)
    expect(await screen.findByRole('group', { name: 'mfa_passkey_title' })).toBeTruthy()
    expect(screen.getByText('mfa_passkey_add_hint')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'mfa_passkey_add' }))
    expect(mfa.webauthn.register).toHaveBeenCalledWith(
      { friendlyName: expect.stringMatching(/^Passkey \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/) as string },
      passkeyCreateOptions('phone'),
    )
    // Só a carga inicial da lista: nada entre o clique e o register().
    expect(server.listCallsAtRegister).toBe(1)
    expect((await screen.findByRole('status')).textContent).toBe('mfa_passkey_added_ok')
    expect(await screen.findByText(/^mfa_passkey_row /)).toBeTruthy()
  })

  it('no celular, cadastra a passkey do próprio aparelho', async () => {
    env.webauthn = true
    device.mobile = true
    server.factors = [verified('f1')]
    const user = userEvent.setup()
    render(<MfaSection />)
    expect(await screen.findByText('mfa_passkey_add_hint_mobile')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'mfa_passkey_add' }))
    expect(mfa.webauthn.register).toHaveBeenCalledWith(expect.anything(), passkeyCreateOptions('this'))
  })

  it.each<[string, unknown, boolean, string]>([
    ['cancelada', Object.assign(new Error('x'), { name: 'NotAllowedError', code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY' }), true, 'mfa_passkey_cancelled'],
    ['já cadastrada', { code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', message: 'x' }, true, 'mfa_passkey_exists'],
    ['fora do site oficial', { code: 'ERROR_INVALID_RP_ID', message: 'x' }, true, 'mfa_passkey_wrong_domain'],
    ['desligada no Supabase', { code: 'mfa_webauthn_enroll_not_enabled', message: 'MFA enroll is disabled for WebAuthn' }, false, 'mfa_passkey_unavailable'],
    ['sessão sem AAL2', { code: 'insufficient_aal', message: 'AAL2 required to enroll a new factor' }, false, 'mfa_need_aal2'],
  ])('passkey %s: mensagem própria e o fator pendente sai', async (_case, error, createsFactor, message) => {
    env.webauthn = true
    server.factors = [verified('f1')]
    server.registerError = error
    server.registerCreatesFactor = createsFactor
    const user = userEvent.setup()
    render(<MfaSection />)
    await user.click(await screen.findByRole('button', { name: 'mfa_passkey_add' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(server.factors.map(f => f.id)).toEqual(['f1'])
    if (createsFactor) expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'pk-new' })
  })

  it('remove a passkey e destrava o Desativar do último app', async () => {
    env.webauthn = true
    server.factors = [verified('f1'), passkey('pk1')]
    const user = userEvent.setup()
    render(<MfaSection />)

    const totpButton = await screen.findByRole('button', { name: 'mfa_remove' })
    const lockHint = screen.getByText('mfa_last_totp_locked')
    expect((totpButton as HTMLButtonElement).disabled).toBe(true)
    expect(totpButton.getAttribute('aria-describedby')?.split(' ')).toContain(lockHint.id)

    await user.click(screen.getByRole('button', { name: 'mfa_remove_device' }))
    await user.click(screen.getByRole('button', { name: 'mfa_remove_device_confirm' }))
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'pk1' })
    expect((await screen.findByRole('status')).textContent).toBe('mfa_passkey_removed_ok')
    expect(screen.queryByText('mfa_last_totp_locked')).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'mfa_remove' }).disabled).toBe(false)
  })

  it('com duas passkeys, numera as linhas', async () => {
    env.webauthn = true
    server.factors = [verified('f1'), passkey('pk1'), passkey('pk2', '2026-10-05T12:00:00Z')]
    render(<MfaSection />)
    expect(await screen.findAllByText(/^mfa_passkey_row_n /)).toHaveLength(2)
  })

  it('sem WebAuthn, a passkey já cadastrada ainda pode ser removida', async () => {
    server.factors = [verified('f1'), passkey('pk1')]
    render(<MfaSection />)
    expect(await screen.findByText(/^mfa_passkey_row /)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'mfa_remove_device' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'mfa_passkey_add' })).toBeNull()
  })

  it('bloco da passkey sem violações de acessibilidade', async () => {
    env.webauthn = true
    server.factors = [verified('f1'), passkey('pk1')]
    const { container } = render(<MfaSection />)
    await screen.findByRole('group', { name: 'mfa_passkey_title' })
    await expectNoAxeViolations(container)
  })
})
