import type { ProjectCardPriority } from '../types'
import type { Lang } from './translations'

// Prévia do app (AppPreview): uma "janela" do Akool desenhada em código. Na
// landing (hero e vitrine) é uma pequena demonstração clicável; no painel do
// login é só ilustração. Os rótulos de navegação e de finanças são os do app;
// o quadro, as tarefas e os valores são exemplos. As colunas em português são
// as que o banco cria em todo quadro novo ("A Fazer / Fazendo / Concluído");
// o app não as traduz, então o quadro de exemplo em inglês usa colunas
// próprias, que não se passam pelas padrão. O limite de WIP segue o app: a
// coluna fica vermelha só acima do limite, sem bloquear.
//
// A estrutura (ids, prioridades, coluna de partida, datas, valores) é comum aos
// dois idiomas: o estado da demonstração usa os ids, e a troca PT/EN não perde
// o que a pessoa fez. Por idioma ficam só os textos. Fora do dicionário (que
// vai no boot): só os chunks das telas públicas carregam isto. As cores são as
// das categorias da Ajuda (arquivo isento do no-hex-color, como o landingContent).

export const MODULE_COLORS = {
  pages: '#3b82f6',
  docs: '#ec4899',
  projects: '#0ea5e9',
  finance: '#10b981',
  study: '#8b5cf6',
  help: '#14b8a6',
} as const

export type PreviewCardId = 'copy' | 'mobile' | 'signup' | 'pdf' | 'backups'

export interface PreviewCardSpec {
  id: PreviewCardId
  priority: ProjectCardPriority
  /** Coluna de partida (0 a 2). */
  column: number
  /** Cronograma: [dia de início, dias] dentro de PREVIEW_TIMELINE_DAYS. */
  span: readonly [number, number]
}

export const PREVIEW_CARDS: readonly PreviewCardSpec[] = [
  { id: 'copy', priority: 'medium', column: 0, span: [8, 5] },
  { id: 'mobile', priority: 'low', column: 0, span: [12, 6] },
  { id: 'signup', priority: 'high', column: 1, span: [3, 8] },
  { id: 'pdf', priority: 'urgent', column: 1, span: [5, 4] },
  { id: 'backups', priority: 'medium', column: 2, span: [0, 4] },
]

/** Limite de WIP por coluna (null = sem limite). */
export const PREVIEW_WIP: readonly (number | null)[] = [null, 3, null]
export const PREVIEW_TIMELINE_DAYS = 21

/** Receita e despesa de maio a outubro (exemplo, em reais); começa no último mês. */
export const PREVIEW_MONTHS: readonly (readonly [number, number])[] = [
  [7300, 5650], [8240, 6480], [6830, 7190], [8950, 6120], [8010, 6710], [9850, 6120],
]

/** Tarefas da página e pontos da etapa de estudo marcados no início. */
export const PREVIEW_TASKS_DONE: readonly boolean[] = [true, true, false]
export const PREVIEW_POINTS_DONE: readonly boolean[] = [true, true, false]

type Three = [string, string, string]
type Six = [string, string, string, string, string, string]

export interface AppPreviewContent {
  nav: { dashboard: string; documents: string; projects: string; finance: string; favorites: string; search: string }
  favorites: [string, string]
  demo: {
    /** Nome do grupo para o leitor de tela. */
    label: string
    /** Dica na barra da janela. */
    hint: string
    navLabel: string
    viewsLabel: string
    monthsLabel: string
    /** "mover para" + coluna, no nome do botão do card. */
    moveTo: string
  }
  board: { name: string; views: Three; columns: Three; cards: Record<PreviewCardId, { title: string; due: string }> }
  finance: { income: string; expense: string; balance: string; months: Six; monthsLong: Six; budget: string; budgetValue: string }
  page: { title: string; tasks: Three; drawing: string }
  study: { topic: string; step: string; points: Three; quiz: string }
}

export const appPreviewContent: Record<Lang, AppPreviewContent> = {
  'pt-BR': {
    nav: { dashboard: 'Dashboard', documents: 'Documentos', projects: 'Projetos', finance: 'Finanças', favorites: 'Favoritos', search: 'Buscar' },
    favorites: ['Plano da semana', 'Reforma da casa'],
    demo: {
      label: 'Demonstração do Akool',
      hint: 'Experimente',
      navLabel: 'Navegação da demonstração',
      viewsLabel: 'Visões do quadro',
      monthsLabel: 'Meses do gráfico',
      moveTo: 'mover para',
    },
    board: {
      name: 'Lançamento do app',
      views: ['Kanban', 'Cronograma', 'Lista'],
      columns: ['A Fazer', 'Fazendo', 'Concluído'],
      cards: {
        copy: { title: 'Revisar textos da landing', due: '12 out' },
        mobile: { title: 'Testar no celular', due: '15 out' },
        signup: { title: 'Tela de cadastro', due: '10 out' },
        pdf: { title: 'Exportar relatório em PDF', due: '09 out' },
        backups: { title: 'Configurar backups', due: '03 out' },
      },
    },
    finance: {
      income: 'Receitas',
      expense: 'Despesas',
      balance: 'Saldo',
      months: ['mai', 'jun', 'jul', 'ago', 'set', 'out'],
      monthsLong: ['Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro'],
      budget: 'Mercado',
      budgetValue: 'R$ 1.080 de R$ 1.500',
    },
    page: {
      title: 'Plano da semana',
      tasks: ['Fechar o orçamento do mês', 'Rascunhar o fluxo de cadastro', 'Revisar o roteiro de estudos'],
      drawing: 'Fluxo de cadastro',
    },
    study: {
      topic: 'TypeScript avançado',
      step: 'Etapa 2 de 5',
      points: ['Tipos genéricos', 'Tipos condicionais', 'Tipos mapeados'],
      quiz: 'Quiz: 80% de acertos',
    },
  },
  en: {
    nav: { dashboard: 'Dashboard', documents: 'Documents', projects: 'Projects', finance: 'Finance', favorites: 'Favorites', search: 'Search' },
    favorites: ['Weekly plan', 'House renovation'],
    demo: {
      label: 'Akool demo',
      hint: 'Try it',
      navLabel: 'Demo navigation',
      viewsLabel: 'Board views',
      monthsLabel: 'Chart months',
      moveTo: 'move to',
    },
    board: {
      name: 'App launch',
      views: ['Kanban', 'Timeline', 'List'],
      columns: ['Backlog', 'In progress', 'Done'],
      cards: {
        copy: { title: 'Review landing copy', due: 'Oct 12' },
        mobile: { title: 'Test on mobile', due: 'Oct 15' },
        signup: { title: 'Sign-up screen', due: 'Oct 10' },
        pdf: { title: 'Export PDF report', due: 'Oct 9' },
        backups: { title: 'Set up backups', due: 'Oct 3' },
      },
    },
    finance: {
      income: 'Income',
      expense: 'Expenses',
      balance: 'Balance',
      months: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
      monthsLong: ['May', 'June', 'July', 'August', 'September', 'October'],
      budget: 'Groceries',
      budgetValue: 'R$ 1,080 of R$ 1,500',
    },
    page: {
      title: 'Weekly plan',
      tasks: ['Close the monthly budget', 'Sketch the sign-up flow', 'Review the study roadmap'],
      drawing: 'Sign-up flow',
    },
    study: {
      topic: 'Advanced TypeScript',
      step: 'Step 2 of 5',
      points: ['Generic types', 'Conditional types', 'Mapped types'],
      quiz: 'Quiz: 80% correct',
    },
  },
}
