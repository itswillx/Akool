import { describe, expect, it } from 'vitest'
import { parseStudyMarkdown } from './studyMarkdownParser'
import { buildStudyPrompt } from './studyPrompt'

const FULL_DOC = `# Estudo: TypeScript avançado

| Campo | Valor |
| --- | --- |
| **Área** | Programação |
| **Nível** | Intermediário |
| **Objetivo** | Dominar generics e utility types |

## Card: Fundamentos de tipos

Revisão dos blocos básicos do sistema de tipos. Essencial antes de avançar.

**Por que agora:** Ponto de partida — base para todo o restante do roadmap.

**Pontos de estudo:**

- [ ] Ler a documentação de tipos primitivos
- [ ] Implementar exemplos com union types
- [x] Explicar a diferença entre type e interface

**Recursos:**

- [Handbook oficial](https://www.typescriptlang.org/docs/handbook/intro.html)

## Card: Generics

Aprofundamento em generics para funções e classes reutilizáveis.

**Por que agora:** Usa os fundamentos de tipos da etapa anterior.

**Pontos de estudo:**

- [ ] Implementar uma função genérica de cache
- [ ] Usar constraints com extends

**Recursos:**

- [Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
- https://www.totaltypescript.com — Total TypeScript
`

describe('parseStudyMarkdown', () => {
  it('parses the full contract document', () => {
    const result = parseStudyMarkdown(FULL_DOC)
    expect(result.topic.title).toBe('TypeScript avançado')
    expect(result.topic.area).toBe('Programação')
    expect(result.topic.level).toBe('Intermediário')
    expect(result.topic.objective).toBe('Dominar generics e utility types')
    expect(result.cards).toHaveLength(2)
    expect(result.warnings).toEqual([])

    const [first, second] = result.cards
    expect(first.title).toBe('Fundamentos de tipos')
    expect(first.description).toContain('blocos básicos')
    expect(first.description).not.toContain('Por que agora')
    expect(first.rationale).toBe('Ponto de partida — base para todo o restante do roadmap.')
    expect(second.rationale).toBe('Usa os fundamentos de tipos da etapa anterior.')
    expect(first.checkpoints).toHaveLength(3)
    expect(first.checkpoints[0].completed).toBe(false)
    expect(first.checkpoints[2].completed).toBe(true)
    expect(first.resources).toEqual([
      expect.objectContaining({ title: 'Handbook oficial', url: 'https://www.typescriptlang.org/docs/handbook/intro.html' }),
    ])

    expect(second.title).toBe('Generics')
    expect(second.resources).toHaveLength(2)
    expect(second.resources[1]).toEqual(
      expect.objectContaining({ title: 'Total TypeScript', url: 'https://www.totaltypescript.com' }),
    )
  })

  it('parses metadata written as a list instead of a table', () => {
    const doc = [
      '# Estudo: Docker',
      '',
      '- **Área:** DevOps',
      '- **Nível**: Iniciante',
      '- Objetivo: Containerizar aplicações',
      '',
      '## Card: Primeiros passos',
      'Introdução.',
      '**Pontos de estudo:**',
      '- [ ] Instalar o Docker',
      '**Recursos:**',
      '- [Docs](https://docs.docker.com)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.topic.area).toBe('DevOps')
    expect(result.topic.level).toBe('Iniciante')
    expect(result.topic.objective).toBe('Containerizar aplicações')
    expect(result.warnings).toEqual([])
  })

  it('accepts accent/case variations of field names and Foco as objective', () => {
    const doc = [
      '# Estudo: Redes',
      '| Campo | Valor |',
      '| --- | --- |',
      '| AREA | Infraestrutura |',
      '| Nivel | Avançado |',
      '| FOCO | Entender TCP/IP |',
      '## Card: Modelo OSI',
      '**Pontos de estudo:**',
      '- [ ] Listar as 7 camadas',
      '**Recursos:**',
      '- [Artigo](https://example.com/osi)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.topic.area).toBe('Infraestrutura')
    expect(result.topic.level).toBe('Avançado')
    expect(result.topic.objective).toBe('Entender TCP/IP')
  })

  it('accepts ### Card N — heading variants and strips the number', () => {
    const doc = [
      '# Estudo: Go',
      '| **Área** | Backend |',
      '### Card 2 — Goroutines',
      '**Pontos de estudo:**',
      '- [ ] Implementar um worker pool',
      '**Recursos:**',
      '- [Tour](https://go.dev/tour)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].title).toBe('Goroutines')
  })

  it('treats plain bullets under Pontos de estudo as unchecked checkpoints', () => {
    const doc = [
      '# Estudo: SQL',
      '| **Área** | Dados |',
      '## Card: Joins',
      '**Pontos de estudo:**',
      '- Praticar INNER JOIN',
      '- [X] Revisar LEFT JOIN',
      '**Recursos:**',
      '- [Docs](https://www.postgresql.org/docs/)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].checkpoints).toHaveLength(2)
    expect(result.cards[0].checkpoints[0]).toEqual(expect.objectContaining({ text: 'Praticar INNER JOIN', completed: false }))
    expect(result.cards[0].checkpoints[1].completed).toBe(true)
  })

  it('accepts accent/case/bullet variants of the Por que agora line', () => {
    const doc = [
      '# Estudo: Git',
      '| **Área** | Ferramentas |',
      '## Card: Branches',
      'Descrição.',
      'Por quê agora: Depois dos commits básicos.',
      '**Pontos de estudo:**',
      '- [ ] Criar uma branch',
      '**Recursos:**',
      '- [Docs](https://git-scm.com/docs)',
      '## Card: Rebase',
      'Porque agora: Exige domínio de branches.',
      '**Pontos de estudo:**',
      '- [ ] Fazer um rebase interativo',
      '**Recursos:**',
      '- [Docs](https://git-scm.com/docs/git-rebase)',
      '## Card: Merge',
      '- **Por que agora**: Alternativa ao rebase.',
      '**Pontos de estudo:**',
      '- [ ] Resolver um conflito',
      '**Recursos:**',
      '- [Docs](https://git-scm.com/docs/git-merge)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].rationale).toBe('Depois dos commits básicos.')
    expect(result.cards[1].rationale).toBe('Exige domínio de branches.')
    expect(result.cards[2].rationale).toBe('Alternativa ao rebase.')
  })

  it('strips trailing bold from a fully bolded rationale line', () => {
    const doc = [
      '# Estudo: CSS',
      '| **Área** | Frontend |',
      '## Card: Flexbox',
      '**Por que agora: Base de layout moderno.**',
      '**Pontos de estudo:**',
      '- [ ] Alinhar itens com flex',
      '**Recursos:**',
      '- [MDN](https://developer.mozilla.org/docs/Web/CSS/flex)',
    ].join('\n')
    expect(parseStudyMarkdown(doc).cards[0].rationale).toBe('Base de layout moderno.')
  })

  it('keeps rationale empty without warnings when the line is absent, and first occurrence wins when duplicated', () => {
    const doc = [
      '# Estudo: SQL',
      '| **Área** | Dados |',
      '## Card: Sem linha',
      'Só descrição.',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://www.postgresql.org/docs/)',
      '## Card: Duplicada',
      '**Por que agora:** Primeira razão.',
      '**Por que agora:** Segunda razão.',
      '**Pontos de estudo:**',
      '- [ ] Algo mais',
      '**Recursos:**',
      '- [Docs](https://www.postgresql.org/docs/)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].rationale).toBe('')
    expect(result.warnings.some(w => w.toLowerCase().includes('por que agora'))).toBe(false)
    expect(result.cards[1].rationale).toBe('Primeira razão.')
    expect(result.cards[1].description).toContain('Segunda razão.')
  })

  it('warns when the study title heading is missing but still parses cards', () => {
    const doc = [
      '## Card: Solto',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [X](https://x.com)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.topic.title).toBeNull()
    expect(result.cards).toHaveLength(1)
    expect(result.warnings).toContain('Título do estudo não encontrado (esperado "# Estudo: ...")')
  })

  it('warns when a card has no study points', () => {
    const doc = [
      '# Estudo: Vazio',
      '| **Área** | Teste |',
      '## Card: Sem pontos',
      'Só descrição.',
      '**Recursos:**',
      '- [Link](https://example.com)',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].checkpoints).toEqual([])
    expect(result.warnings).toContain('"Sem pontos": nenhum ponto de estudo encontrado')
  })

  it('handles mixed resources and warns on junk lines without URL', () => {
    const doc = [
      '# Estudo: Kubernetes',
      '| **Área** | DevOps |',
      '## Card: Pods',
      '**Pontos de estudo:**',
      '- [ ] Criar um pod',
      '**Recursos:**',
      '- [Docs](https://kubernetes.io/docs/)',
      '- https://kubernetes.io/pt-br/ — Docs em português',
      '- apenas um texto sem link',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].resources).toHaveLength(2)
    expect(result.cards[0].resources[1].title).toBe('Docs em português')
    expect(result.warnings.some(w => w.startsWith('Recurso ignorado'))).toBe(true)
  })

  it('parses a document wrapped in markdown code fences', () => {
    const fenced = '```markdown\n' + FULL_DOC + '\n```'
    const result = parseStudyMarkdown(fenced)
    expect(result.topic.title).toBe('TypeScript avançado')
    expect(result.cards).toHaveLength(2)
    expect(result.warnings).toEqual([])
  })

  it('parses CRLF input without leaving \r in captured text', () => {
    const result = parseStudyMarkdown(FULL_DOC.replace(/\n/g, '\r\n'))
    expect(result.topic.title).toBe('TypeScript avançado')
    expect(result.cards[0].checkpoints[0].text).toBe('Ler a documentação de tipos primitivos')
    expect(JSON.stringify(result)).not.toContain('\\r')
  })

  it('returns the no-cards warning for empty input', () => {
    const result = parseStudyMarkdown('')
    expect(result.cards).toEqual([])
    expect(result.warnings).toContain('Nenhum card encontrado no arquivo')
  })

  it('parses a Quiz section after the resources with mixed C/E items', () => {
    const doc = [
      '# Estudo: Infra',
      '| **Área** | TI |',
      '## Card: Servidores',
      'Descrição.',
      '**Pontos de estudo:**',
      '- [ ] Explicar cliente vs servidor',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- [C] Um servidor pode atender vários clientes ao mesmo tempo.',
      '- [E] SSDs são mais lentos que HDs.',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.warnings).toEqual([])
    expect(result.cards[0].quiz).toHaveLength(2)
    expect(result.cards[0].quiz[0]).toEqual(expect.objectContaining({
      statement: 'Um servidor pode atender vários clientes ao mesmo tempo.',
      answer: 'certo',
      userAnswer: null,
    }))
    expect(result.cards[0].quiz[1].answer).toBe('errado')
  })

  it('normalizes quiz answer variants: lowercase, full words, V/F and suffix form', () => {
    const doc = [
      '# Estudo: Redes',
      '| **Área** | TI |',
      '## Card: Protocolos',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- [c] HTTP roda sobre TCP.',
      '- [Errado] UDP garante entrega.',
      '- [V] DNS resolve nomes.',
      '- [F] IP é um protocolo de aplicação.',
      '- TLS cifra a conexão. (Certo)',
    ].join('\n')
    const quiz = parseStudyMarkdown(doc).cards[0].quiz
    expect(quiz.map(q => q.answer)).toEqual(['certo', 'errado', 'certo', 'errado', 'certo'])
    expect(quiz[4].statement).toBe('TLS cifra a conexão.')
  })

  it('accepts Quiz marker variants (parenthesis and ### heading)', () => {
    const base = (marker: string) => [
      '# Estudo: Linux',
      '| **Área** | TI |',
      '## Card: Shell',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      marker,
      '- [C] O bash é um shell.',
    ].join('\n')
    expect(parseStudyMarkdown(base('Quiz (Certo ou Errado):')).cards[0].quiz).toHaveLength(1)
    expect(parseStudyMarkdown(base('### Quiz')).cards[0].quiz).toHaveLength(1)
  })

  it('keeps quiz empty without warnings for documents that have no quiz', () => {
    const result = parseStudyMarkdown(FULL_DOC)
    expect(result.cards.every(card => card.quiz.length === 0)).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('warns on quiz bullets without an answer key and on an empty quiz section', () => {
    const doc = [
      '# Estudo: Web',
      '| **Área** | TI |',
      '## Card: HTTP',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- afirmação sem gabarito',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].quiz).toEqual([])
    expect(result.warnings.some(w => w.includes('item de quiz ignorado'))).toBe(true)
    expect(result.warnings.some(w => w.includes('seção Quiz sem perguntas válidas'))).toBe(true)
  })

  it('recovers quiz items that appear after the resources without a Quiz marker', () => {
    const doc = [
      '# Estudo: Cloud',
      '| **Área** | TI |',
      '## Card: Data centers',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '- [C] Redundância evita ponto único de falha.',
      '- [E] Um data center dispensa refrigeração.',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].resources).toHaveLength(1)
    expect(result.cards[0].quiz).toHaveLength(2)
    expect(result.warnings).toEqual(['"Data centers": quiz encontrado sem o marcador "Quiz:"'])
  })

  it('adds the quiz contract and rule to the prompt only when quizCount is given', () => {
    const withQuiz = buildStudyPrompt({ title: 'Rust', quizCount: 10 })
    expect(withQuiz).toContain('**Quiz:**')
    expect(withQuiz).toContain('- [C]')
    expect(withQuiz).toContain('exatamente 10')

    expect(buildStudyPrompt({ title: 'Rust' })).not.toContain('Quiz')
    expect(buildStudyPrompt({ title: 'Rust', quizCount: null })).not.toContain('Quiz')
  })

  it('keeps the structural markers of the generated prompt in sync with the parser', () => {
    const prompt = buildStudyPrompt({ title: 'Rust' })
    expect(prompt).toContain('# Estudo:')
    expect(prompt).toContain('## Card:')
    expect(prompt).toContain('**Por que agora:**')
    expect(prompt).toContain('**Pontos de estudo:**')
    expect(prompt).toContain('**Recursos:**')
    expect(prompt).toContain('CONTEÚDO de estudo em si')
    expect(prompt).toContain('Especialista')
    expect(prompt).toContain('Responda APENAS com o Markdown final.')
  })

  it('adds the total-deadline rule to the prompt only when a duration is given', () => {
    const withDuration = buildStudyPrompt({ title: 'Rust', duration: { qty: 4, unit: 'weeks' } })
    expect(withDuration).toContain('Prazo total')
    expect(withDuration).toContain('4 semanas')

    expect(buildStudyPrompt({ title: 'Rust' })).not.toContain('Prazo total')
    expect(buildStudyPrompt({ title: 'Rust', duration: null })).not.toContain('Prazo total')

    const singular = buildStudyPrompt({ title: 'Rust', duration: { qty: 1, unit: 'months' } })
    expect(singular).toContain('1 mês')
  })
})
