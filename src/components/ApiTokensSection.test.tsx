// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '../test/rtl'
import { expectNoAxeViolations } from '../test/axe'

// API-009: a aba API montada sobre um banco falso que imita as RPCs da
// migration api001_token_scopes: criar com preset e mostrar o token uma vez,
// validade pelo nível, erro de segundo fator com o atalho para Segurança,
// editar o token migrado para ativar Validação, as travas da edição, excluir
// em dois passos, limpar inativos, revogar e o limite de 20 ativos.

const DAY = 86_400_000

type Row = {
  id: string
  name: string
  prefix: string
  scopes: Record<string, string>
  created_at: string
  last_used_at: string | null
  last_client: string | null
  expires_at: string
  revoked_at: string | null
}
type RpcArgs = { p_id?: string; p_name?: string; p_expires_in_days?: number; p_scopes?: Record<string, string> }
type Failure = { code: string; message: string }

const backend = vi.hoisted(() => {
  // failures: número da chamada de RPC (1, 2…) → erro que ela devolve.
  const state = { rows: [] as Row[], calls: [] as [string, RpcArgs][], failures: new Map<number, Failure>(), listError: null as Failure | null }
  const ok = (data: unknown) => Promise.resolve({ data, error: null })
  const fail = (error: Failure) => Promise.resolve({ data: null, error })
  const rpc = (name: string, args: RpcArgs = {}) => {
    state.calls.push([name, args])
    const failure = state.failures.get(state.calls.length)
    if (failure) return fail(failure)
    const now = Date.now()
    const row = state.rows.find(r => r.id === args.p_id)
    switch (name) {
      case 'create_api_token': {
        const created: Row = {
          id: `novo-${state.calls.length}`, name: args.p_name ?? 'Token', prefix: 'akool_pat_novo', scopes: args.p_scopes ?? {},
          created_at: new Date(now).toISOString(), last_used_at: null, last_client: null,
          expires_at: new Date(now + (args.p_expires_in_days ?? 90) * 86_400_000).toISOString(), revoked_at: null,
        }
        state.rows.unshift(created)
        return ok({ id: created.id, token: `akool_pat_segredo_${created.id}`, prefix: created.prefix, expires_at: created.expires_at, scopes: created.scopes })
      }
      case 'update_api_token_scopes':
        if (row) row.scopes = args.p_scopes ?? {}
        return ok({ id: args.p_id, scopes: args.p_scopes })
      case 'revoke_api_token':
        if (row) row.revoked_at = new Date(now).toISOString()
        return ok(null)
      case 'revoke_all_my_api_tokens': {
        const active = state.rows.filter(r => !r.revoked_at && Date.parse(r.expires_at) > now)
        for (const r of active) r.revoked_at = new Date(now).toISOString()
        return ok(active.length)
      }
      case 'delete_api_token':
        if (!row) return fail({ code: 'P0002', message: 'Token não encontrado' })
        state.rows = state.rows.filter(r => r !== row)
        return ok(null)
      default:
        return fail({ code: '42883', message: `função ${name} não existe` })
    }
  }
  return { state, rpc }
})
const auth = vi.hoisted(() => ({ isAdmin: false }))
const clip = vi.hoisted(() => ({ ok: true }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve(backend.state.listError
          ? { data: null, error: backend.state.listError }
          : { data: backend.state.rows.map(r => ({ ...r })), error: null }),
      }),
    }),
    rpc: backend.rpc,
  },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }))
vi.mock('../lib/clipboard', () => ({ copyToClipboard: () => Promise.resolve(clip.ok) }))
vi.mock('../i18n/LanguageContext', async () => {
  const { getT } = await import('../i18n/translations')
  const t = getT('pt-BR')
  return { useLanguage: () => ({ lang: 'pt-BR', t }) }
})

const { default: ApiTokensSection } = await import('./ApiTokensSection')

const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString()
const MIGRATED: Row = {
  id: 'migrado', name: 'Claude Code (fila)', prefix: 'akool_pat_abcd',
  scopes: { 'projetos.quadros': 'read', 'projetos.cards': 'read', 'projetos.fila': 'write' },
  created_at: iso(-10), last_used_at: iso(-1), last_client: 'akool-cards-cli', expires_at: iso(80), revoked_at: null,
}
const REVOKED: Row = { ...MIGRATED, id: 'revogado', name: 'Antigo', prefix: 'akool_pat_rev1', scopes: { 'projetos.cards': 'read' }, last_used_at: null, last_client: null, revoked_at: iso(-5) }
const EXPIRED: Row = { ...MIGRATED, id: 'expirado', name: 'Vencido', prefix: 'akool_pat_exp1', scopes: { 'financas.contas': 'read' }, last_used_at: null, last_client: null, expires_at: iso(-3) }

const onOpenSecurity = vi.fn()
/** O segredo que o banco falso devolve na criação (um por chamada). */
const SECRET = /^akool_pat_segredo_novo-\d+$/
/** A próxima RPC devolve este erro. */
const failNext = (error: Failure) => backend.state.failures.set(backend.state.calls.length + 1, error)

beforeEach(() => {
  backend.state.rows = [{ ...MIGRATED }, { ...REVOKED }, { ...EXPIRED }]
  backend.state.calls = []
  backend.state.failures = new Map()
  backend.state.listError = null
  auth.isAdmin = false
  clip.ok = true
  onOpenSecurity.mockReset()
})

async function renderSection() {
  const view = render(<ApiTokensSection onOpenSecurity={onOpenSecurity} />)
  await screen.findByRole('list', { name: 'Seus tokens' })
  return view
}
function row(name: string) {
  const item = screen.getByText(name).closest('li')
  if (!item) throw new Error(`sem linha para ${name}`)
  return within(item)
}
const radio = (group: string, option: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole<HTMLButtonElement>('radio', { name: option })
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })
const openForm = () => fireEvent.click(button('Gerar novo token'))

describe('ApiTokensSection: lista', () => {
  it('mostra status, prefixo, chips por seção, último uso e cliente, sem violações de acessibilidade', async () => {
    const { container } = await renderSection()
    expect(row('Claude Code (fila)').getByText('Ativo')).toBeTruthy()
    expect(row('Claude Code (fila)').getByText('Projetos: até Escrever em 3 de 4')).toBeTruthy()
    expect(row('Claude Code (fila)').getByText(/Cliente: akool-cards-cli/)).toBeTruthy()
    expect(row('Claude Code (fila)').getByText('akool_pat_abcd…')).toBeTruthy()
    expect(row('Antigo').getByText('Revogado')).toBeTruthy()
    expect(row('Antigo').getByText(/Revogado em/)).toBeTruthy()
    expect(row('Vencido').getByText('Expirado')).toBeTruthy()
    expect(row('Vencido').getByText('Finanças: Ler em 1 de 7')).toBeTruthy()
    expect(screen.getByText('1 de 20 ativos')).toBeTruthy()
    // Revogado e expirado: só Excluir.
    expect(row('Antigo').queryByRole('button', { name: 'Editar permissões' })).toBeNull()
    expect(row('Antigo').queryByRole('button', { name: 'Revogar' })).toBeNull()
    expect(row('Antigo').getByRole('button', { name: 'Excluir' })).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('erro ao listar aparece, e a lista fica vazia', async () => {
    backend.state.listError = { code: '', message: 'TypeError: Failed to fetch' }
    render(<ApiTokensSection />)
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível concluir: TypeError: Failed to fetch')
    expect(screen.getByText('Nenhum token ainda.')).toBeTruthy()
  })

  it('no limite de 20 ativos, gerar fica desligado e a tela diz por quê', async () => {
    backend.state.rows = Array.from({ length: 20 }, (_, i) => ({ ...MIGRATED, id: `t${i}`, name: `Token ${i}` }))
    await renderSection()
    expect(button('Gerar novo token').disabled).toBe(true)
    expect(screen.getByText(/Você já tem 20 tokens ativos/)).toBeTruthy()
  })
})

describe('ApiTokensSection: criação', () => {
  it('cria com preset: escopos explícitos, validade escolhida e o token aparece uma vez', async () => {
    await renderSection()
    openForm()
    expect(screen.queryByRole('button', { name: 'Administração' })).toBeNull()
    fireEvent.change(screen.getByLabelText('Nome do token'), { target: { value: 'Claude no Mac' } })
    const generate = button('Gerar token')
    expect(generate.disabled).toBe(true)
    fireEvent.click(radio('Ponto de partida', 'Claude Code: fila'))
    expect(radio('Validade', '365 dias').disabled).toBe(true)
    fireEvent.click(radio('Validade', '90 dias'))
    fireEvent.click(generate)

    expect(await screen.findByText(SECRET)).toBeTruthy()
    expect(document.activeElement).toBe(button('Copiar'))
    expect(backend.state.calls).toEqual([['create_api_token', {
      p_name: 'Claude no Mac', p_expires_in_days: 90, p_scopes: { 'projetos.quadros': 'read', 'projetos.cards': 'read', 'projetos.fila': 'write' },
    }]])
    expect(screen.queryByRole('button', { name: 'Gerar token' })).toBeNull()
    expect(row('Claude no Mac').getByText('Ativo')).toBeTruthy()

    fireEvent.click(button('Copiar'))
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy()
    fireEvent.click(button('Já copiei'))
    expect(screen.queryByText(SECRET)).toBeNull()
  })

  it('cópia que falha avisa para copiar à mão; cancelar fecha o formulário', async () => {
    clip.ok = false
    await renderSection()
    openForm()
    fireEvent.click(radio('Ponto de partida', 'Somente leitura'))
    fireEvent.click(button('Gerar token'))
    await screen.findByText(SECRET)
    fireEvent.click(button('Copiar'))
    expect((await screen.findByRole('alert')).textContent).toBe('Não deu para copiar. Selecione o token e copie à mão.')

    openForm()
    fireEvent.click(button('Cancelar'))
    expect(screen.queryByRole('button', { name: 'Gerar token' })).toBeNull()
  })

  it('a validade segue o nível: leitura aceita 365 dias; Administração, até 30', async () => {
    auth.isAdmin = true
    await renderSection()
    openForm()
    fireEvent.click(radio('Validade', '365 dias'))
    fireEvent.click(radio('Ponto de partida', 'Somente leitura'))
    expect(radio('Validade', '365 dias').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radio('Todas de Administração', 'Ler'))
    expect(radio('Validade', '30 dias').getAttribute('aria-checked')).toBe('true')
    expect(radio('Validade', '90 dias').disabled).toBe(true)
    // Tirar a Administração devolve a validade pedida.
    fireEvent.click(radio('Todas de Administração', 'Nenhum'))
    expect(radio('Validade', '365 dias').getAttribute('aria-checked')).toBe('true')
  })

  it('erro de segundo fator explica o motivo e leva para Segurança; o formulário fica', async () => {
    await renderSection()
    openForm()
    fireEvent.click(radio('Ponto de partida', 'Claude Code: fila'))
    failNext({ code: '42501', message: 'Confirme o segundo fator (MFA) antes de dar Escrever, Excluir ou Administração a um token' })
    fireEvent.click(button('Gerar token'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('a sessão precisa do segundo fator')
    fireEvent.click(within(alert).getByRole('button', { name: 'Abrir Segurança' }))
    expect(onOpenSecurity).toHaveBeenCalledOnce()
    expect(button('Gerar token')).toBeTruthy()
  })

  it('recusa do servidor mostra o motivo', async () => {
    await renderSection()
    openForm()
    fireEvent.click(radio('Ponto de partida', 'Somente leitura'))
    failNext({ code: '22023', message: 'Validade deve ser de 7, 30, 90 ou 365 dias' })
    fireEvent.click(button('Gerar token'))
    expect((await screen.findByRole('alert')).textContent).toBe('O servidor recusou: Validade deve ser de 7, 30, 90 ou 365 dias')
  })
})

describe('ApiTokensSection: edição', () => {
  it('edita o token migrado para ativar Validação, sem trocar o segredo', async () => {
    await renderSection()
    fireEvent.click(row('Claude Code (fila)').getByRole('button', { name: 'Editar permissões' }))
    const panel = within(screen.getByRole('region', { name: 'Editar permissões de Claude Code (fila)' }))
    expect(panel.getByText(/O segredo não muda/)).toBeTruthy()
    const save = panel.getByRole<HTMLButtonElement>('button', { name: 'Salvar permissões' })
    expect(save.disabled).toBe(true)

    fireEvent.click(panel.getByRole('button', { name: 'Projetos' }))
    expect(radio('Fila de desenvolvimento', 'Escrever').getAttribute('aria-checked')).toBe('true')
    expect(radio('Quadros e colunas', 'Ler').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(radio('Validação (aprovar/reprovar)', 'Escrever'))
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    expect(await screen.findByText('Permissões salvas.')).toBeTruthy()
    expect(backend.state.calls).toEqual([['update_api_token_scopes', {
      p_id: 'migrado', p_scopes: { 'projetos.cards': 'read', 'projetos.fila': 'write', 'projetos.quadros': 'read', 'projetos.validacao': 'write' },
    }]])
    expect(screen.queryByRole('region', { name: /Editar permissões de/ })).toBeNull()
    expect(row('Claude Code (fila)').getByText('Projetos: até Escrever em 4 de 4')).toBeTruthy()
  })

  it('tirar tudo não salva: para desligar, revogue; cancelar fecha', async () => {
    await renderSection()
    fireEvent.click(row('Claude Code (fila)').getByRole('button', { name: 'Editar permissões' }))
    fireEvent.click(radio('Todas de Projetos', 'Nenhum'))
    expect(screen.getByText('Escolha ao menos uma permissão. Para desligar o token, revogue.')).toBeTruthy()
    expect(button('Salvar permissões').disabled).toBe(true)
    fireEvent.click(button('Cancelar'))
    expect(screen.queryByRole('region', { name: /Editar permissões de/ })).toBeNull()
  })

  it('token que vence em mais de 90 dias só aceita Ler, e a tela explica', async () => {
    backend.state.rows.unshift({ ...MIGRATED, id: 'longo', name: 'Leitura longa', scopes: { 'financas.contas': 'read' }, expires_at: iso(200) })
    await renderSection()
    fireEvent.click(row('Leitura longa').getByRole('button', { name: 'Editar permissões' }))
    expect(screen.getByText(/Escrever e Excluir só valem para tokens que vencem em até 90 dias/)).toBeTruthy()
    expect(radio('Todas de Finanças', 'Escrever').disabled).toBe(true)
    expect(radio('Ponto de partida', 'Entrada de dados financeiros').disabled).toBe(true)
  })
})

describe('ApiTokensSection: revogar e excluir', () => {
  it('excluir pede dois cliques; o ativo avisa que para na hora; sair do botão desarma', async () => {
    await renderSection()
    const other = row('Antigo').getByRole('button', { name: 'Excluir' })
    fireEvent.click(other)
    fireEvent.blur(other)
    expect(other.textContent).toBe('Excluir')

    const del = row('Claude Code (fila)').getByRole('button', { name: 'Excluir' })
    fireEvent.click(del)
    expect(del.textContent).toBe('Confirmar exclusão')
    expect(screen.getByText('O token para de funcionar na hora, e a IA que o usa perde o acesso.')).toBeTruthy()
    expect(backend.state.calls).toEqual([])
    fireEvent.click(del)
    expect(await screen.findByText('Token excluído.')).toBeTruthy()
    expect(backend.state.calls).toEqual([['delete_api_token', { p_id: 'migrado' }]])
    expect(screen.queryByText('Claude Code (fila)')).toBeNull()
  })

  it('token que outra aba já excluiu: avisa e relê a lista', async () => {
    await renderSection()
    backend.state.rows = backend.state.rows.filter(r => r.id !== 'revogado')
    const del = row('Antigo').getByRole('button', { name: 'Excluir' })
    fireEvent.click(del)
    fireEvent.click(del)
    expect((await screen.findByRole('alert')).textContent).toContain('Esse token não existe mais')
    await waitFor(() => expect(screen.queryByText('Antigo')).toBeNull())
  })

  it('limpar revogados e expirados exclui só os inativos', async () => {
    await renderSection()
    const purge = button('Limpar revogados e expirados')
    fireEvent.click(purge)
    expect(purge.textContent).toBe('Confirmar: excluir 2')
    fireEvent.click(purge)
    expect(await screen.findByText('Tokens excluídos: 2.')).toBeTruthy()
    expect(backend.state.calls.map(([, args]) => args.p_id)).toEqual(['revogado', 'expirado'])
    expect(screen.getByText('Claude Code (fila)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Limpar revogados e expirados' })).toBeNull()
  })

  it('limpeza que para no meio diz quantos saíram e mostra o erro', async () => {
    await renderSection()
    // O primeiro sai; no segundo, a rede cai.
    backend.state.failures.set(2, { code: '', message: 'TypeError: Failed to fetch' })
    const purge = button('Limpar revogados e expirados')
    fireEvent.click(purge)
    fireEvent.click(purge)
    expect((await screen.findByRole('alert')).textContent).toBe('Não foi possível concluir: TypeError: Failed to fetch')
    expect(screen.getByText('Tokens excluídos: 1.')).toBeTruthy()
    expect(backend.state.calls.map(([, args]) => args.p_id)).toEqual(['revogado', 'expirado'])
    expect(screen.getByText('Vencido')).toBeTruthy()
  })

  it('revogar um e revogar todos', async () => {
    backend.state.rows.unshift({ ...MIGRATED, id: 'segundo', name: 'Segundo' })
    await renderSection()
    const revoke = row('Segundo').getByRole('button', { name: 'Revogar' })
    fireEvent.click(revoke)
    expect(revoke.textContent).toBe('Confirmar revogação')
    fireEvent.click(revoke)
    expect(await screen.findByText('Token revogado.')).toBeTruthy()
    expect(row('Segundo').getByText('Revogado')).toBeTruthy()

    const all = button('Revogar todos')
    fireEvent.click(all)
    expect(all.textContent).toBe('Confirmar: revogar 1')
    fireEvent.click(all)
    expect(await screen.findByText('Tokens revogados: 1.')).toBeTruthy()
    expect(row('Claude Code (fila)').getByText('Revogado')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Revogar todos' })).toBeNull()
  })
})

describe('ApiTokensSection: estado e foco', () => {
  /** Cria pelo formulário e espera o segredo novo (diferente de `previous`, se a faixa anterior ainda está lá). */
  const createWith = async (preset: string, previous?: string | null) => {
    openForm()
    fireEvent.click(radio('Ponto de partida', preset))
    fireEvent.click(button('Gerar token'))
    return screen.findByText(text => SECRET.test(text) && text !== previous)
  }

  it('o segundo token recomeça a faixa: sem "Copiado" herdado, foco no Copiar e o segredo novo', async () => {
    await renderSection()
    const first = await createWith('Somente leitura')
    fireEvent.click(button('Copiar'))
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeTruthy()
    const second = await createWith('Claude Code: fila', first.textContent)
    expect(second.textContent).not.toBe(first.textContent)
    expect(screen.queryByText(first.textContent ?? '')).toBeNull()
    expect(button('Copiar')).toBeTruthy()
    expect(document.activeElement).toBe(button('Copiar'))
  })

  it('a segunda criação que falha não apaga a faixa do primeiro token', async () => {
    await renderSection()
    const first = await createWith('Somente leitura')
    openForm()
    fireEvent.click(radio('Ponto de partida', 'Claude Code: fila'))
    failNext({ code: '42501', message: 'Confirme o segundo fator (MFA) antes de dar Escrever, Excluir ou Administração a um token' })
    fireEvent.click(button('Gerar token'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(first.textContent ?? '')).toBeTruthy()
  })

  it('"Já copiei" devolve o foco para o "Gerar novo token"', async () => {
    await renderSection()
    await createWith('Somente leitura')
    const dismiss = button('Já copiei')
    dismiss.focus()
    fireEvent.click(dismiss)
    await waitFor(() => expect(document.activeElement).toBe(button('Gerar novo token')))
  })

  it('revogar o token recém-criado tira o segredo da tela', async () => {
    await renderSection()
    await createWith('Somente leitura')
    const name = within(screen.getByRole('list', { name: 'Seus tokens' })).getAllByText('Token')[0]
    const revoke = within(name.closest('li') as HTMLElement).getByRole('button', { name: 'Revogar' })
    fireEvent.click(revoke)
    fireEvent.click(revoke)
    expect(await screen.findByText('Token revogado.')).toBeTruthy()
    expect(screen.queryByText(SECRET)).toBeNull()
  })

  it('o painel de edição fecha quando o token deixa de estar ativo', async () => {
    await renderSection()
    fireEvent.click(row('Claude Code (fila)').getByRole('button', { name: 'Editar permissões' }))
    expect(screen.getByRole('region', { name: /Editar permissões de/ })).toBeTruthy()
    const all = button('Revogar todos')
    fireEvent.click(all)
    fireEvent.click(all)
    expect(await screen.findByText('Tokens revogados: 1.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /Editar permissões de/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Salvar permissões' })).toBeNull()
  })

  it('fechar a aba durante o "Gerando…" não perde o segredo: ele aparece ao voltar', async () => {
    const first = await renderSection()
    openForm()
    fireEvent.click(radio('Ponto de partida', 'Somente leitura'))
    fireEvent.click(button('Gerar token'))
    first.unmount()
    await waitFor(() => expect(backend.state.rows.some(r => r.id.startsWith('novo-'))).toBe(true))
    await renderSection()
    expect(await screen.findByText(SECRET)).toBeTruthy()
  })

  it('o foco não cai no body: formulário, cancelar, edição e exclusão', async () => {
    await renderSection()
    openForm()
    expect(document.activeElement).toBe(screen.getByLabelText('Nome do token'))
    fireEvent.click(button('Cancelar'))
    await waitFor(() => expect(document.activeElement).toBe(button('Gerar novo token')))

    const edit = row('Claude Code (fila)').getByRole('button', { name: 'Editar permissões' })
    fireEvent.click(edit)
    const cancel = within(screen.getByRole('region', { name: /Editar permissões de/ })).getByRole('button', { name: 'Cancelar' })
    cancel.focus()
    fireEvent.click(cancel)
    await waitFor(() => expect(document.activeElement).toBe(edit))

    const del = row('Antigo').getByRole('button', { name: 'Excluir' })
    del.focus()
    fireEvent.click(del)
    fireEvent.click(del)
    expect(await screen.findByText('Token excluído.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Seus tokens' })))
  })

  it('cada botão da linha diz de qual token é; o Copiar diz o que fazer; o "Copiado" é anunciado', async () => {
    await renderSection()
    const describedBy = (el: HTMLElement) => (el.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(describedBy(row('Antigo').getByRole('button', { name: 'Excluir' }))).toContain('Antigo')
    expect(describedBy(row('Claude Code (fila)').getByRole('button', { name: 'Revogar' }))).toContain('Claude Code (fila)')
    expect(describedBy(row('Claude Code (fila)').getByRole('button', { name: 'Editar permissões' }))).toContain('akool_pat_abcd')

    await createWith('Somente leitura')
    // A instrução é o nome do grupo da faixa: lida uma vez ao entrar, não repetida no botão.
    const banner = screen.getByRole('group', { name: /Copie agora/ })
    expect(within(banner).getByRole('button', { name: 'Copiar' }).getAttribute('aria-describedby')).toBeNull()
    fireEvent.click(button('Copiar'))
    await waitFor(() => expect(screen.getAllByRole('status').some(s => s.textContent === 'Copiado')).toBe(true))
  })

  it('a seção com níveis diferentes avisa "Misto" também para o leitor de tela', async () => {
    await renderSection()
    fireEvent.click(row('Claude Code (fila)').getByRole('button', { name: 'Editar permissões' }))
    const group = screen.getByRole('radiogroup', { name: 'Todas de Projetos' })
    expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Misto')
  })
})
