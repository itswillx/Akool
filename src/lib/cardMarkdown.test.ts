import { describe, expect, it } from 'vitest'
import { formatCardAsMarkdown, type CardMarkdownSource } from './cardMarkdown'
import { getT } from '../i18n/translations'

const t = getT('pt-BR')

const baseCard: CardMarkdownSource = {
  title: 'Ajustar tela de login',
  description: '',
  priority: 'medium',
  start_date: null,
  due_date: null,
  estimated_days: 1,
  labels: [],
  completed: false,
  checklist: [],
  links: [],
  attachments: [],
}

describe('formatCardAsMarkdown', () => {
  it('serializa um card completo com todas as seções em ordem', () => {
    const md = formatCardAsMarkdown(
      {
        ...baseCard,
        description: 'Botão de entrar não responde no mobile.',
        priority: 'high',
        start_date: '2026-08-12',
        due_date: '2026-08-20',
        estimated_days: 3,
        labels: ['frontend', 'bug'],
        completed: true,
        checklist: [
          { id: '1', text: 'Reproduzir o erro', completed: true },
          { id: '2', text: 'Corrigir o handler', completed: false },
        ],
        links: [{ id: 'l1', url: 'https://figma.com/x', title: 'Figma' }],
        attachments: [{ id: 'a1', url: 'user/board/card/print.png', name: 'print.png' }],
      },
      {
        columnName: 'A fazer',
        assigneeName: 'William',
        parentTitle: 'Refatorar autenticação',
        dependencyTitles: ['Migrar sessão', 'Corrigir refresh token'],
      },
      t,
    )

    expect(md).toBe([
      '# Ajustar tela de login',
      '',
      '- **Coluna:** A fazer',
      '- **Prioridade:** Alta',
      '- **Responsável:** William',
      '- **Início:** 2026-08-12',
      '- **Prazo:** 2026-08-20',
      '- **Duração estimada (dias):** 3',
      '- **Etiquetas:** frontend, bug',
      '- **Tarefa-pai:** Refatorar autenticação',
      '- **Dependências:** Migrar sessão, Corrigir refresh token',
      '- **Concluído**',
      '',
      '## Descrição',
      '',
      'Botão de entrar não responde no mobile.',
      '',
      '## Checklist (1/2)',
      '',
      '- [x] Reproduzir o erro',
      '- [ ] Corrigir o handler',
      '',
      '## Links',
      '',
      '- [Figma](https://figma.com/x)',
      '',
      '## Imagens',
      '',
      '- print.png',
    ].join('\n'))
  })

  it('omite as seções vazias de um card mínimo', () => {
    const md = formatCardAsMarkdown(baseCard, {}, t)
    expect(md).toBe([
      '# Ajustar tela de login',
      '',
      '- **Prioridade:** Média',
      '- **Responsável:** Sem responsável',
      '- **Duração estimada (dias):** 1',
    ].join('\n'))
    expect(md).not.toContain('## ')
  })

  it('marca os itens do checklist e conta o progresso', () => {
    const md = formatCardAsMarkdown(
      {
        ...baseCard,
        checklist: [
          { id: '1', text: 'Feito', completed: true },
          { id: '2', text: 'Pendente', completed: false },
          { id: '3', text: 'Também feito', completed: true },
        ],
      },
      {},
      t,
    )
    expect(md).toContain('## Checklist (2/3)')
    expect(md).toContain('- [x] Feito')
    expect(md).toContain('- [ ] Pendente')
    expect(md).toContain('- [x] Também feito')
  })

  it('usa o rótulo de card novo quando o título está vazio', () => {
    expect(formatCardAsMarkdown({ ...baseCard, title: '   ' }, {}, t))
      .toContain('# Novo card')
  })

  it('lista só o nome dos anexos, nunca o caminho no storage', () => {
    const md = formatCardAsMarkdown(
      { ...baseCard, attachments: [{ id: 'a1', url: 'uid/board/card/123-print.png', name: 'print.png' }] },
      {},
      t,
    )
    expect(md).toContain('- print.png')
    expect(md).not.toContain('uid/board/card')
  })

  it('cai no hostname do link quando não há título', () => {
    const md = formatCardAsMarkdown(
      { ...baseCard, links: [{ id: 'l1', url: 'https://www.example.com/a', title: '' }] },
      {},
      t,
    )
    expect(md).toContain('- [example.com](https://www.example.com/a)')
  })
})
