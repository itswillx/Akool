// @vitest-environment happy-dom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '../../test/rtl'
import { expectNoAxeViolations } from '../../test/axe'
import { LEGACY_SCOPES } from '../../../supabase/functions/_api/catalog'
import { createLimits, type PickerLimits, type ScopeMap } from './scopeModel'
import { SegmentedRadio } from './SegmentedRadio'
import { TokenScopePicker } from './TokenScopePicker'

// API-009: o seletor de permissões montado, com os textos reais em pt-BR:
// presets, lote por seção, subseções, Administração só para admin, travas da
// edição, avisos e o teclado do grupo de rádio.

vi.mock('../../i18n/LanguageContext', async () => {
  const { getT } = await import('../../i18n/translations')
  const t = getT('pt-BR')
  return { useLanguage: () => ({ lang: 'pt-BR', t }) }
})

function Harness({ initial = {}, isAdmin = false, limits }: { initial?: ScopeMap; isAdmin?: boolean; limits?: PickerLimits }) {
  const [value, setValue] = useState<ScopeMap>(initial)
  const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
  return (
    <>
      <TokenScopePicker value={value} onChange={setValue} isAdmin={isAdmin} limits={limits ?? createLimits(isAdmin)} />
      <output data-testid="value">{JSON.stringify(sorted)}</output>
    </>
  )
}

const current = () => JSON.parse(screen.getByTestId('value').textContent ?? '{}') as Record<string, string>
const radio = (group: string, option: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: option })
const openSection = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

describe('TokenScopePicker', () => {
  it('preset troca as permissões; mexer depois vira Personalizado', () => {
    render(<Harness />)
    expect(screen.getByText('Escolha ao menos uma permissão.')).toBeTruthy()
    fireEvent.click(radio('Ponto de partida', 'Claude Code: fila'))
    expect(current()).toEqual(LEGACY_SCOPES)
    expect(radio('Ponto de partida', 'Claude Code: fila').getAttribute('aria-checked')).toBe('true')
    // A descrição do preset vem ligada por aria-describedby.
    expect(radio('Ponto de partida', 'Claude Code: fila').getAttribute('aria-describedby')).toBeTruthy()

    openSection('Projetos')
    fireEvent.click(radio('Validação (aprovar/reprovar)', 'Escrever'))
    expect(current()['projetos.validacao']).toBe('write')
    expect(radio('Ponto de partida', 'Personalizado').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('Validação deixa a IA aprovar e reprovar cards no seu lugar.')).toBeTruthy()
  })

  it('Personalizado escolhido à mão fica marcado sem trocar as permissões', () => {
    render(<Harness initial={{ ...LEGACY_SCOPES }} />)
    fireEvent.click(radio('Ponto de partida', 'Personalizado'))
    expect(radio('Ponto de partida', 'Personalizado').getAttribute('aria-checked')).toBe('true')
    expect(current()).toEqual(LEGACY_SCOPES)
  })

  it('lote por seção: Excluir limita cada subseção ao máximo dela e mostra Misto quando diferem', () => {
    render(<Harness initial={{ ...LEGACY_SCOPES }} />)
    expect(screen.getByText('Misto')).toBeTruthy()
    fireEvent.click(radio('Todas de Projetos', 'Excluir'))
    expect(current()).toEqual({ 'projetos.cards': 'delete', 'projetos.fila': 'write', 'projetos.quadros': 'delete', 'projetos.validacao': 'write' })
    expect(radio('Todas de Projetos', 'Excluir').getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText('Misto')).toBeNull()
    expect(screen.getByText('Excluir deixa a IA apagar itens. Dê só onde ela precisa.')).toBeTruthy()
    fireEvent.click(radio('Todas de Projetos', 'Nenhum'))
    expect(current()).toEqual({})
  })

  it('subseção mostra só os níveis que aceita; abrir e fechar a seção', () => {
    render(<Harness />)
    const toggle = screen.getByRole('button', { name: 'Projetos' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    openSection('Projetos')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const fila = within(screen.getByRole('radiogroup', { name: 'Fila de desenvolvimento' })).getAllByRole('radio').map(r => r.textContent)
    expect(fila).toEqual(['Nenhum', 'Ler', 'Escrever'])
    openSection('Projetos')
    expect(screen.queryByRole('radiogroup', { name: 'Fila de desenvolvimento' })).toBeNull()
  })

  it('Administração só aparece para admin, com aviso; sem a permissão de admin no limite, fica travada', () => {
    const { unmount } = render(<Harness />)
    expect(screen.queryByRole('button', { name: 'Administração' })).toBeNull()
    unmount()

    const admin = render(<Harness isAdmin />)
    fireEvent.click(radio('Todas de Administração', 'Ler'))
    expect(current()).toEqual({ 'admin.auditoria': 'read', 'admin.backups': 'read', 'admin.convites': 'read', 'admin.usuarios': 'read' })
    expect(screen.getByText(/Administração deixa a IA ler dados de todos os usuários/)).toBeTruthy()
    admin.unmount()

    render(<Harness isAdmin limits={{ maxLevel: 'delete', admin: false }} />)
    expect((radio('Todas de Administração', 'Ler') as HTMLButtonElement).disabled).toBe(true)
  })

  it('trava da edição: acima de Ler fica desligado, inclusive os presets que escrevem', () => {
    render(<Harness limits={{ maxLevel: 'read', admin: false }} />)
    expect((radio('Ponto de partida', 'Claude Code: fila') as HTMLButtonElement).disabled).toBe(true)
    expect((radio('Ponto de partida', 'Somente leitura') as HTMLButtonElement).disabled).toBe(false)
    expect((radio('Todas de Projetos', 'Escrever') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(radio('Todas de Projetos', 'Excluir'))
    expect(current()).toEqual({})
  })

  it('visões combinadas dizem o que exigem', () => {
    render(<Harness initial={{ ...LEGACY_SCOPES }} />)
    expect(screen.getByText('Visões combinadas')).toBeTruthy()
    expect(screen.getByText(/1 de 7 fontes liberadas/)).toBeTruthy()
    expect(screen.getByText(/sempre liberada/)).toBeTruthy()
  })

  it('sem violações de acessibilidade, com uma seção aberta', async () => {
    const { container } = render(<Harness isAdmin initial={{ ...LEGACY_SCOPES }} />)
    openSection('Projetos')
    await expectNoAxeViolations(container)
  })
})

describe('SegmentedRadio', () => {
  function Radios({ disabled = [], initial = 'b' }: { disabled?: string[]; initial?: string | null }) {
    const [value, setValue] = useState<string | null>(initial)
    return (
      <SegmentedRadio
        label="Grupo"
        value={value}
        onChange={setValue}
        options={['a', 'b', 'c', 'd'].map(v => ({ value: v, label: v.toUpperCase(), disabled: disabled.includes(v) }))}
      />
    )
  }
  const option = (name: string) => screen.getByRole('radio', { name })

  it('uma parada de Tab por grupo: a opção marcada', () => {
    render(<Radios />)
    expect(['A', 'B', 'C', 'D'].map(n => option(n).tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('sem opção marcada, a parada é a primeira livre', () => {
    render(<Radios initial={null} disabled={['a']} />)
    expect(['A', 'B', 'C', 'D'].map(n => option(n).tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('setas movem e escolhem, dando a volta; Home e End vão às pontas; desligadas ficam de fora', () => {
    render(<Radios disabled={['c']} />)
    fireEvent.keyDown(option('B'), { key: 'ArrowRight' })
    expect(option('D').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(option('D'))
    fireEvent.keyDown(option('D'), { key: 'ArrowDown' })
    expect(option('A').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('A'), { key: 'ArrowLeft' })
    expect(option('D').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('D'), { key: 'Home' })
    expect(option('A').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('A'), { key: 'End' })
    expect(option('D').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('D'), { key: 'ArrowUp' })
    expect(option('B').getAttribute('aria-checked')).toBe('true')
    // Outra tecla não mexe.
    fireEvent.keyDown(option('B'), { key: 'x' })
    expect(option('B').getAttribute('aria-checked')).toBe('true')
  })
})
