import { describe, expect, it } from 'vitest'
import exampleMd from '../../docs/exemplos/estudo-api021.md?raw'
import { parseStudyMarkdown, type ParsedStudyCard } from './studyMarkdownParser'
import { buildStudyPrompt } from './studyPrompt'
import {
  isSafeStudyUrl,
  STUDY_CHECKPOINT_TEXT_MAX,
  STUDY_CHECKPOINTS_MAX,
  STUDY_EXPLANATION_MAX,
  STUDY_JSON_MAX_BYTES,
  STUDY_OPTION_MAX,
  STUDY_OPTIONS_MAX,
  STUDY_OPTIONS_MIN,
  STUDY_QUIZ_MAX,
  STUDY_RESOURCE_TITLE_MAX,
  STUDY_RESOURCES_MAX,
  STUDY_STATEMENT_MAX,
  studyJsonBytes,
} from './studyLimits'

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

  it('parses multiple-choice [Q] questions with options, correct index and explanations', () => {
    const doc = [
      '# Estudo: Geografia',
      '| **Área** | Humanas |',
      '## Card: Capitais',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- [C] O Brasil fica na América do Sul.',
      '  Justificativa: Localização continental básica.',
      '- [Q] Qual é a capital do Brasil?',
      '  - [ ] São Paulo',
      '  - [x] Brasília',
      '  - [ ] Rio de Janeiro',
      '  - [ ] Salvador',
      '  Justificativa: Brasília é a capital desde 1960.',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.warnings).toEqual([])
    expect(result.cards[0].quiz).toHaveLength(2)

    const [bool, choice] = result.cards[0].quiz
    expect(bool).toEqual(expect.objectContaining({
      statement: 'O Brasil fica na América do Sul.',
      answer: 'certo',
      userAnswer: null,
      explanation: 'Localização continental básica.',
    }))
    expect(choice).toEqual(expect.objectContaining({
      kind: 'choice',
      statement: 'Qual é a capital do Brasil?',
      options: ['São Paulo', 'Brasília', 'Rio de Janeiro', 'Salvador'],
      answer: 1,
      userAnswer: null,
      explanation: 'Brasília é a capital desde 1960.',
    }))
  })

  it('accepts explanation label variants (Explicação, bold, blockquote)', () => {
    const doc = [
      '# Estudo: Química',
      '| **Área** | Exatas |',
      '## Card: Água',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- [C] A água é H2O.',
      '> **Explicação:** Dois hidrogênios e um oxigênio.',
    ].join('\n')
    const quiz = parseStudyMarkdown(doc).cards[0].quiz
    expect(quiz[0].explanation).toBe('Dois hidrogênios e um oxigênio.')
  })

  it('discards invalid [Q] questions with a warning (no [x], <2 options) and keeps the first of duplicate [x]', () => {
    const doc = [
      '# Estudo: História',
      '| **Área** | Humanas |',
      '## Card: Descobrimento',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- [Q] Pergunta sem correta?',
      '  - [ ] Opção A',
      '  - [ ] Opção B',
      '- [Q] Pergunta com uma só alternativa?',
      '  - [x] Única',
      '- [Q] Pergunta com duas marcadas?',
      '  - [x] Primeira correta',
      '  - [x] Segunda marcada',
      '  - [ ] Errada',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.warnings.some(w => w.includes('nenhuma alternativa marcada com [x]'))).toBe(true)
    expect(result.warnings.some(w => w.includes('menos de 2 alternativas'))).toBe(true)
    expect(result.warnings.some(w => w.includes('mais de uma alternativa marcada com [x]'))).toBe(true)
    expect(result.cards[0].quiz).toHaveLength(1)
    expect(result.cards[0].quiz[0]).toEqual(expect.objectContaining({ kind: 'choice', answer: 0 }))
  })

  it('warns on checkbox options outside a [Q] question and ignores them', () => {
    const doc = [
      '# Estudo: Física',
      '| **Área** | Exatas |',
      '## Card: Luz',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '**Quiz:**',
      '- [C] A luz tem velocidade finita.',
      '- [x] alternativa órfã',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].quiz).toHaveLength(1)
    expect(result.warnings.some(w => w.includes('alternativa de quiz fora de uma pergunta [Q]'))).toBe(true)
  })

  it('recovers a [Q] question that appears after the resources without a Quiz marker', () => {
    const doc = [
      '# Estudo: Biologia',
      '| **Área** | Ciências |',
      '## Card: Células',
      '**Pontos de estudo:**',
      '- [ ] Algo',
      '**Recursos:**',
      '- [Docs](https://example.com)',
      '- [Q] Qual organela produz energia?',
      '  - [x] Mitocôndria',
      '  - [ ] Ribossomo',
    ].join('\n')
    const result = parseStudyMarkdown(doc)
    expect(result.cards[0].resources).toHaveLength(1)
    expect(result.cards[0].quiz).toHaveLength(1)
    expect(result.cards[0].quiz[0]).toEqual(expect.objectContaining({ kind: 'choice', answer: 0 }))
    expect(result.warnings).toEqual(['"Células": quiz encontrado sem o marcador "Quiz:"'])
  })

  it('adds the quiz contract and rule to the prompt only when quizCount is given', () => {
    const withQuiz = buildStudyPrompt({ title: 'Rust', quizCount: 10 })
    expect(withQuiz).toContain('**Quiz:**')
    expect(withQuiz).toContain('- [C]')
    expect(withQuiz).toContain('- [Q]')
    expect(withQuiz).toContain('- [x]')
    expect(withQuiz).toContain('Justificativa:')
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

// API-021: o que o parser entrega é o que o gatilho study_cards_rules aceita
// (as regras de private.study_*_problem, no mesmo formato que o insertCards
// grava). Um card fora delas derrubaria a importação inteira.
function serverProblems(card: ParsedStudyCard): string[] {
  const problems: string[] = []
  const blank = (text: string) => !/\S/.test(text)
  if (card.checkpoints.length > STUDY_CHECKPOINTS_MAX) problems.push('pontos: quantidade')
  if (card.resources.length > STUDY_RESOURCES_MAX) problems.push('recursos: quantidade')
  if (card.quiz.length > STUDY_QUIZ_MAX) problems.push('quiz: quantidade')
  for (const [column, list] of [['pontos', card.checkpoints], ['recursos', card.resources], ['quiz', card.quiz]] as const) {
    if (studyJsonBytes(list) > STUDY_JSON_MAX_BYTES) problems.push(`${column}: 256 KiB`)
    if (new Set(list.map(item => item.id)).size !== list.length) problems.push(`${column}: ids repetidos`)
  }
  card.checkpoints.forEach((point, i) => {
    if (blank(point.text) || point.text.length > STUDY_CHECKPOINT_TEXT_MAX) problems.push(`ponto ${i}: text`)
    if (typeof point.completed !== 'boolean') problems.push(`ponto ${i}: completed`)
  })
  card.resources.forEach((resource, i) => {
    if (!isSafeStudyUrl(resource.url)) problems.push(`recurso ${i}: url`)
    if (resource.title.length > STUDY_RESOURCE_TITLE_MAX) problems.push(`recurso ${i}: title`)
  })
  card.quiz.forEach((question, i) => {
    if (blank(question.statement) || question.statement.length > STUDY_STATEMENT_MAX) problems.push(`pergunta ${i}: statement`)
    if ((question.explanation?.length ?? 0) > STUDY_EXPLANATION_MAX) problems.push(`pergunta ${i}: explanation`)
    if (question.kind === 'choice') {
      const n = question.options.length
      if (n < STUDY_OPTIONS_MIN || n > STUDY_OPTIONS_MAX) problems.push(`pergunta ${i}: options`)
      if (question.options.some(option => blank(option) || option.length > STUDY_OPTION_MAX)) problems.push(`pergunta ${i}: alternativa`)
      if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= n) problems.push(`pergunta ${i}: answer`)
    } else if (question.answer !== 'certo' && question.answer !== 'errado') {
      problems.push(`pergunta ${i}: answer`)
    }
  })
  return problems
}

describe('parseStudyMarkdown: limites do servidor (API-021)', () => {
  const card = (body: string[]) => ['# Estudo: Limites', '| **Área** | Testes |', '## Card: Grande', ...body].join('\n')

  it('um .md grande sai inteiro dentro dos limites, com aviso do que ficou de fora', () => {
    const doc = card([
      '**Pontos de estudo:**',
      ...Array.from({ length: 230 }, (_, i) => `- [ ] Ponto ${i} ${'é'.repeat(i % 2 === 0 ? 1900 : 10)}`),
      `- [ ] ${'x'.repeat(STUDY_CHECKPOINT_TEXT_MAX + 1)}`,
      '**Recursos:**',
      ...Array.from({ length: 60 }, (_, i) => `- [Link ${i}](https://example.com/${i}/${'p'.repeat(2000)})`),
      `- https://example.com/${'u'.repeat(STUDY_RESOURCE_TITLE_MAX)}`,
      '- [Com controle](https://example.com/a\u0007b)',
      '**Quiz:**',
      ...Array.from({ length: 120 }, (_, i) => [`- [C] Afirmação ${i} ${'s'.repeat(1500)}`, `  Justificativa: ${'j'.repeat(1500)}`]).flat(),
      `- [C] ${'s'.repeat(STUDY_STATEMENT_MAX + 1)}`,
      '- [Q] Escolha com 11 alternativas?',
      ...Array.from({ length: 11 }, (_, i) => `  - [${i === 0 ? 'x' : ' '}] Opção ${i}`),
      '- [Q] Alternativa longa?',
      `  - [x] ${'o'.repeat(STUDY_OPTION_MAX + 1)}`,
      '  - [ ] curta',
      '- [E] Justificativa longa demais.',
      `  Justificativa: ${'j'.repeat(STUDY_EXPLANATION_MAX + 1)}`,
    ])
    const result = parseStudyMarkdown(doc)
    const [parsed] = result.cards
    expect(serverProblems(parsed)).toEqual([])
    expect(parsed.checkpoints.length).toBeGreaterThan(0)
    expect(parsed.checkpoints.length).toBeLessThanOrEqual(STUDY_CHECKPOINTS_MAX)
    expect(parsed.resources.length).toBeGreaterThan(0)
    expect(parsed.quiz.length).toBeGreaterThan(0)
    // Os descartes vêm à parte dos avisos de formato (a prévia os mostra primeiro).
    expect(result.warnings).toEqual([])
    const dropped = result.dropped.join('\n')
    expect(dropped).toContain('ponto de estudo 231 ignorado (mais de 2000 caracteres)')
    expect(dropped).toContain('só os primeiros 200 pontos de estudo foram mantidos')
    expect(dropped).toContain('pontos de estudo passam de 256 KiB')
    expect(dropped).toContain('recurso 61 ignorado (URL com caractere inválido ou mais de 2048 caracteres)')
    expect(dropped).toContain('recurso 62 ignorado (URL com caractere inválido ou mais de 2048 caracteres)')
    expect(new Set(result.dropped).size).toBe(result.dropped.length)
    expect(dropped).toContain('só os primeiros 50 recursos foram mantidos')
    expect(dropped).toContain('pergunta 121 do quiz ignorada (enunciado com mais de 2000 caracteres)')
    expect(dropped).toContain('pergunta 122 do quiz ignorada (mais de 10 alternativas)')
    expect(dropped).toContain('pergunta 123 do quiz ignorada (alternativa com mais de 1000 caracteres)')
    expect(dropped).toContain('justificativa da pergunta 124 ignorada (mais de 4000 caracteres)')
    expect(dropped).toContain('só as primeiras 100 perguntas do quiz foram mantidas')
    expect(dropped).toContain('quiz passa de 256 KiB')
  })

  it('a pergunta com justificativa longa fica, sem a justificativa', () => {
    const result = parseStudyMarkdown(card([
      '**Pontos de estudo:**', '- [ ] Algo', '**Recursos:**', '- [Docs](https://example.com)', '**Quiz:**',
      '- [E] Justificativa longa demais.', `  Justificativa: ${'j'.repeat(STUDY_EXPLANATION_MAX + 1)}`,
      '- [C] Curta.', '  Justificativa: Ok.',
    ]))
    const [long, short] = result.cards[0].quiz
    expect(long.statement).toBe('Justificativa longa demais.')
    expect(long).not.toHaveProperty('explanation')
    expect(short.explanation).toBe('Ok.')
  })

  it('o que está dentro dos limites passa igual, sem aviso novo', () => {
    const doc = card([
      '**Pontos de estudo:**',
      `- [ ] ${'x'.repeat(STUDY_CHECKPOINT_TEXT_MAX)}`,
      '**Recursos:**',
      `- https://a.b/${'u'.repeat(2048 - 'https://a.b/'.length)}`,
      '**Quiz:**',
      '- [Q] Dez alternativas?',
      ...Array.from({ length: STUDY_OPTIONS_MAX }, (_, i) => `  - [${i === 9 ? 'x' : ' '}] Opção ${i}`),
    ])
    const result = parseStudyMarkdown(doc)
    expect(result.warnings).toEqual([])
    expect(result.dropped).toEqual([])
    expect(result.cards[0].checkpoints[0].text).toHaveLength(STUDY_CHECKPOINT_TEXT_MAX)
    expect(result.cards[0].resources[0].url).toHaveLength(2048)
    expect(result.cards[0].quiz[0]).toEqual(expect.objectContaining({ kind: 'choice', answer: 9 }))
    expect(serverProblems(result.cards[0])).toEqual([])
  })
})

describe('docs/exemplos/estudo-api021.md (validação no staging)', () => {
  it('importa sem aviso e sem perder nada: pontos, recursos, quiz misto e justificativas', () => {
    const result = parseStudyMarkdown(exampleMd)
    expect(result.warnings).toEqual([])
    expect(result.dropped).toEqual([])
    expect(result.topic).toEqual({
      title: 'Redes de computadores',
      area: 'Tecnologia',
      level: 'Iniciante',
      objective: 'Entender o caminho de uma requisição do navegador até o servidor',
    })
    expect(result.cards.map(c => [c.checkpoints.length, c.resources.length, c.quiz.length])).toEqual([[3, 3, 3], [4, 3, 3], [3, 2, 3]])
    for (const parsed of result.cards) {
      expect(parsed.rationale).not.toBe('')
      expect(serverProblems(parsed)).toEqual([])
    }

    // Nada some: cada item do arquivo aparece no resultado.
    const all = result.cards
    const lines = exampleMd.split('\n')
    const checkpointLines = lines.filter(line => /^- \[[ x]\] /.test(line))
    expect(all.flatMap(c => c.checkpoints.map(p => p.text))).toEqual(checkpointLines.map(line => line.slice(6)))
    const questionLines = lines.filter(line => /^- \[[CEQ]\] /.test(line))
    expect(all.flatMap(c => c.quiz.map(q => q.statement))).toEqual(questionLines.map(line => line.slice(6)))
    expect(all.flatMap(c => c.quiz).every(q => q.explanation)).toBe(true)
    const optionLines = lines.filter(line => /^ {2}- \[[ x]\] /.test(line))
    expect(all.flatMap(c => c.quiz.flatMap(q => (q.kind === 'choice' ? q.options : [])))).toEqual(optionLines.map(line => line.slice(8)))
    const resourceLines = lines.filter(line => /^- (\[[^\]]+\]\(https?:|https?:)/.test(line))
    expect(all.flatMap(c => c.resources)).toHaveLength(resourceLines.length)

    const [first, second, third] = all
    expect(first.quiz.map(q => q.kind ?? 'boolean')).toEqual(['boolean', 'boolean', 'choice'])
    expect(first.resources[2]).toEqual(expect.objectContaining({
      title: 'Cloudflare Learning',
      url: 'https://www.cloudflare.com/pt-br/learning/network-layer/what-is-the-network-layer/',
    }))
    expect(second.resources.map(r => r.url)).toEqual([
      'https://datatracker.ietf.org/doc/html/rfc1035#section-4.1',
      'https://en.wikipedia.org/w/index.php?title=Domain_Name_System&action=info',
      'https://howdns.works/',
    ])
    expect(second.resources[2].title).toBe('https://howdns.works/')
    expect(third.quiz[0]).toEqual(expect.objectContaining({ kind: 'choice', answer: 1 }))
    expect(third.quiz[0].kind === 'choice' && third.quiz[0].options).toHaveLength(5)
  })
})
