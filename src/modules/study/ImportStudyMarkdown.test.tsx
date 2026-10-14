// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '../../test/rtl'
import type { StudyParseResult } from '../../lib/studyMarkdownParser'
import ImportStudyMarkdown from './ImportStudyMarkdown'

// API-021: o parser descarta, com aviso na prévia, o que o servidor recusaria.
// Esse aviso não pode sumir atrás dos avisos de formato (a prévia mostrava só
// os 8 primeiros): os descartes vêm numa lista própria, primeiro e inteiros, e
// os avisos de formato vêm todos, numa caixa que rola.

vi.mock('../../i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key, lang: 'pt-BR' }) }))

// 9 cards sem "Recursos" (9 avisos de formato, mais o dos metadados) e, no
// último, uma pergunta com 11 alternativas, que passa do limite do servidor.
const doc = [
  '# Estudo: Muitos avisos',
  ...Array.from({ length: 9 }, (_, i) => [
    `## Card: Card ${i + 1}`,
    '**Pontos de estudo:**',
    '- [ ] Ler',
    ...(i === 8
      ? ['**Quiz:**', '- [Q] Onze alternativas?', ...Array.from({ length: 11 }, (_, j) => `  - [${j === 0 ? 'x' : ' '}] Opção ${j}`)]
      : []),
  ]).flat(),
].join('\n')

describe('ImportStudyMarkdown: prévia dos avisos', () => {
  it('com mais de 8 avisos de formato, o descarte aparece primeiro e todos os avisos são listados', () => {
    const onResult = vi.fn<(result: StudyParseResult | null) => void>()
    render(<ImportStudyMarkdown onResult={onResult} />)
    fireEvent.change(screen.getByPlaceholderText('study_import_paste_placeholder'), { target: { value: doc } })

    const parsed = onResult.mock.calls.at(-1)?.[0]
    expect(parsed?.warnings).toHaveLength(10)
    expect(parsed?.dropped).toEqual(['"Card 9": pergunta 1 do quiz ignorada (mais de 10 alternativas)'])

    const drop = screen.getByText('"Card 9": pergunta 1 do quiz ignorada (mais de 10 alternativas)')
    const droppedHeader = screen.getByText('study_import_dropped')
    const warningsHeader = screen.getByText('study_import_warnings')
    expect(droppedHeader.compareDocumentPosition(warningsHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(drop.compareDocumentPosition(warningsHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.getAllByText(/nenhum recurso encontrado/)).toHaveLength(9)
    expect(screen.getByText('Metadados do estudo não encontrados (Área/Nível/Objetivo)')).toBeTruthy()
    const warningsBox = warningsHeader.parentElement as HTMLElement
    expect(warningsBox.style.overflowY).toBe('auto')
    expect(warningsBox.querySelectorAll('li')).toHaveLength(10)
  })

  it('sem descarte, a caixa de descartes não aparece', () => {
    render(<ImportStudyMarkdown onResult={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('study_import_paste_placeholder'), { target: { value: '# Estudo: X\n## Card: A\n**Pontos de estudo:**\n- [ ] Ler' } })
    expect(screen.queryByText('study_import_dropped')).toBeNull()
    expect(screen.getByText('study_import_warnings')).toBeTruthy()
  })
})
