// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QRCodeSVG } from 'qrcode.react'
import { fireEvent, render, screen, userEvent } from '../test/rtl'
import { expectNoAxeViolations } from '../test/axe'

// MFA em Configurações → Segurança: o QR code gerado no app a partir da URI
// otpauth, o link para o app autenticador no celular, copiar a chave e mais de
// um aparelho (adicionar com o MFA ativo, remover sem desligar).

type Err = { code?: string; message: string } | null
interface FakeFactor { id: string; status: 'verified' | 'unverified'; factor_type: 'totp'; created_at: string }

// Chave de baixa entropia de propósito (o gitleaks roda no pre-commit e no CI).
const SECRET = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH'
const URI = `otpauth://totp/Akool:ana@exemplo.com?algorithm=SHA1&digits=6&issuer=Akool&period=30&secret=${SECRET}`
const QR_URL = 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"></svg>'

const server = vi.hoisted(() => ({
  factors: [] as { id: string; status: 'verified' | 'unverified'; factor_type: 'totp'; created_at: string }[],
  uri: '',
  enrollError: null as Err,
  verifyError: null as Err,
  unenrollError: null as Err,
}))
const mfa = vi.hoisted(() => ({
  listFactors: vi.fn<() => Promise<unknown>>(),
  enroll: vi.fn<(args: unknown) => Promise<unknown>>(),
  unenroll: vi.fn<(args: { factorId: string }) => Promise<unknown>>(),
  challengeAndVerify: vi.fn<(args: { factorId: string; code: string }) => Promise<unknown>>(),
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

import MfaSection from './MfaSection'

const verified = (id: string, createdAt = '2026-10-03T12:00:00Z'): FakeFactor =>
  ({ id, status: 'verified', factor_type: 'totp', created_at: createdAt })

function listResult(factors: FakeFactor[]) {
  return { data: { all: [...factors], totp: factors.filter(f => f.status === 'verified'), phone: [], webauthn: [] }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  device.mobile = false
  server.factors = []
  server.uri = URI
  server.enrollError = null
  server.verifyError = null
  server.unenrollError = null
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
