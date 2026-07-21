// Builds the standardized Portuguese prompt the user copies into Claude to
// generate a study roadmap. The output contract below is the single source of
// truth shared with studyMarkdownParser — keep the structural markers
// (# Estudo:, ## Card:, **Por que agora:**, **Pontos de estudo:**,
// **Recursos:**, **Quiz:**) in sync.

import type { DurationUnit } from './studySchedule'

export interface StudyPromptInput {
  title: string
  area?: string
  level?: string
  objective?: string
  duration?: { qty: number; unit: DurationUnit } | null
  // Certo/Errado questions per card; null/undefined = no quiz section.
  quizCount?: number | null
}

// The prompt is always Portuguese, so the unit words live here (not in i18n).
const UNIT_WORDS: Record<DurationUnit, { singular: string; plural: string }> = {
  days: { singular: 'dia', plural: 'dias' },
  weeks: { singular: 'semana', plural: 'semanas' },
  months: { singular: 'mês', plural: 'meses' },
}

function durationText(duration: { qty: number; unit: DurationUnit }): string {
  const words = UNIT_WORDS[duration.unit]
  return `${duration.qty} ${duration.qty === 1 ? words.singular : words.plural}`
}

// Static level options offered by the UI selects. Always Portuguese — the
// value is data (stored in study_topics.level and embedded in the prompt),
// same rationale as UNIT_WORDS.
export const STUDY_LEVELS = ['Iniciante', 'Intermediário', 'Avançado', 'Especialista'] as const

// Quiz block appended to the card 1 example when the user asked for quizzes.
const QUIZ_CONTRACT_BLOCK = `

**Quiz:**

- [C] <afirmação VERDADEIRA sobre o conteúdo do card>
- [E] <afirmação FALSA sobre o conteúdo do card>
- [C] <outra afirmação verdadeira>`

export function buildStudyContract(withQuiz: boolean): string {
  return `# Estudo: <título do estudo>

| Campo | Valor |
| --- | --- |
| **Área** | <área, ex.: Programação> |
| **Nível** | <nível: Iniciante, Intermediário, Avançado ou Especialista> |
| **Objetivo** | <objetivo em uma frase> |

## Card: <título da etapa 1>

<CONTEÚDO COMPLETO da etapa em markdown — este é o material de estudo em si: explicação didática dos conceitos em 3 a 6 parágrafos, termos-chave em **negrito**, pelo menos 1 exemplo prático (com bloco de código quando o tema envolver código) e uma linha final começando com "Em resumo:">

**Por que agora:** Ponto de partida — <razão para começar por aqui>

**Pontos de estudo:**

- [ ] <ponto de estudo 1>
- [ ] <ponto de estudo 2>
- [ ] <ponto de estudo 3>

**Recursos:**

- [<título do artigo ou documentação>](https://url-real)${withQuiz ? QUIZ_CONTRACT_BLOCK : ''}

## Card: <título da etapa 2>

<conteúdo completo da etapa, no mesmo formato da etapa 1>

**Por que agora:** <1 frase explicando por que esta etapa vem depois da anterior>

(repita a estrutura acima para cada etapa, na ordem do roadmap de aprendizado)`
}

export const STUDY_MD_CONTRACT = buildStudyContract(false)

export function buildStudyPrompt(input: StudyPromptInput): string {
  const title = input.title.trim()
  const area = input.area?.trim()
  const level = input.level?.trim()
  const objective = input.objective?.trim()

  const contextLines = [
    area ? `- Área: ${area}` : null,
    level ? `- Nível do estudante: ${level}` : null,
    objective ? `- Objetivo/foco: ${objective}` : null,
  ].filter(Boolean) as string[]

  return [
    `Você é um especialista em ${area || title} e em planejamento de estudos.`,
    '',
    `Monte um roadmap de estudo completo sobre "${title}": uma trilha de etapas sequenciais em que cada card é uma etapa do caminho de aprendizado.`,
    ...(contextLines.length > 0 ? ['', 'Contexto:', ...contextLines] : []),
    '',
    'Regras de qualidade:',
    '- Crie de 6 a 12 cards (etapas), ordenados por dependência de aprendizado: conceitos fundamentais primeiro; cada etapa deve construir sobre o conhecimento das etapas anteriores.',
    '- Cubra o tema de ponta a ponta: fundamentos e terminologia, prática guiada, tópicos intermediários, tópicos avançados, erros comuns/pegadinhas e uma etapa final de consolidação com um projeto prático que integre tudo o que foi estudado.',
    ...(input.duration
      ? [`- Prazo total: o plano deve caber em ${durationText(input.duration)} — dimensione a quantidade de cards e o tamanho dos pontos de estudo para esse período.`]
      : []),
    '- O corpo de cada card é o CONTEÚDO de estudo em si, não um resumo: escreva de 300 a 500 palavras por card em markdown, com explicação didática dos conceitos em 3 a 6 parágrafos, termos-chave em **negrito**, pelo menos 1 exemplo prático (use blocos de código ``` quando o tema envolver código) e uma linha final começando com "Em resumo:" consolidando a etapa. Quem ler apenas o card deve conseguir aprender o tema da etapa.',
    '- Adapte a profundidade ao nível informado: Iniciante parte do zero, sem pressupor conhecimento prévio e com analogias; Intermediário revisa fundamentos rapidamente e foca em prática real; Avançado foca em funcionamento interno, performance e edge cases; Especialista foca em arquitetura, trade-offs, limites da tecnologia e estado da arte.',
    '- Logo após a descrição, cada card deve ter a linha "**Por que agora:**" com 1 frase explicando por que esta etapa vem depois da anterior (qual conhecimento anterior ela usa ou o que ela desbloqueia). No primeiro card, comece a frase com "Ponto de partida — ".',
    '- Cada card deve ter de 6 a 12 pontos de estudo: tarefas específicas e verificáveis, começando com verbo de ação (ex.: "Implementar...", "Ler...", "Explicar...", "Depurar..."). Misture teoria (ler, explicar, comparar) e prática (implementar, criar, depurar) — pelo menos 2 pontos práticos por card. Nunca temas vagos.',
    '- Cada card deve ter de 2 a 5 recursos: links de artigos e documentação para referência, com URLs reais e confiáveis (documentação oficial, artigos aprofundados, vídeos). Não invente URLs — na dúvida, use a página oficial da tecnologia.',
    ...(input.quizCount
      ? [`- Cada card deve terminar com a seção "**Quiz:**" contendo exatamente ${input.quizCount} afirmações no formato Certo/Errado: "- [C] afirmação" quando a afirmação for verdadeira e "- [E] afirmação" quando for falsa. Misture C e E (aproximadamente metade de cada, em ordem imprevisível), cubra os conceitos centrais do card e escreva afirmações objetivas, verificáveis apenas com o conteúdo do card. Não use nenhuma outra sintaxe nos itens do quiz.`]
      : []),
    '- Seja completo e aprofundado: o roadmap deve ser suficiente para levar a pessoa do nível informado até o objetivo sem precisar de outro guia. Não resuma por economia de espaço. A resposta será longa — isso é esperado e desejado.',
    '- Preencha a tabela de metadados (Área, Nível, Objetivo) usando os valores fornecidos; se ausentes, infira a partir do título.',
    '- Todo o texto em português do Brasil.',
    '',
    'Formato de saída (OBRIGATÓRIO — siga exatamente esta estrutura, sem cercas de código e sem nenhum texto antes ou depois):',
    '',
    buildStudyContract(!!input.quizCount),
    '',
    'Responda APENAS com o Markdown final.',
  ].join('\n')
}
