// Passos do tour de boas-vindas, fora do helpContent (PERF-009): a tela de
// login mostra o tour, e importar o helpContent inteiro (artigos da Ajuda,
// ~37 KB) só por causa dele o punha no boot de todo mundo.
import type { Lang } from './translations'
import type { TourStep } from './helpContent'

export const tourSteps: Record<Lang, TourStep[]> = {
  'pt-BR': [
    {
      icon: 'sparkles',
      color: '#6366f1',
      title: 'Bem-vindo ao Akool',
      description: 'Diagramas e notas, unificados. Em poucos passos você vai conhecer o que dá para fazer aqui.',
    },
    {
      icon: 'fileText',
      color: '#3b82f6',
      title: 'Crie páginas do seu jeito',
      description: 'Notas com blocos, desenhos, tela dividida (nota + desenho) e listas de tarefas. Tudo começa no botão "Criar" da barra lateral.',
    },
    {
      icon: 'pencil',
      color: '#8b5cf6',
      title: 'Desenhe e diagrame',
      description: 'Use o quadro Excalidraw completo, ou insira um diagrama dentro de uma nota sem trocar de página.',
    },
    {
      icon: 'checkSquare',
      color: '#f59e0b',
      title: 'Organize tarefas e projetos',
      description: 'Listas de tarefas com prioridade e prazos, e quadros Kanban para acompanhar projetos de ponta a ponta.',
    },
    {
      icon: 'wallet',
      color: '#10b981',
      title: 'Controle suas finanças',
      description: 'Transações, contas, orçamentos, metas e contas recorrentes — com visão individual ou em família.',
    },
    {
      icon: 'help',
      color: '#14b8a6',
      title: 'Colabore e encontre ajuda',
      description: 'Compartilhe páginas, exporte para PDF e abra a Central de Ajuda na barra lateral sempre que precisar.',
    },
  ],
  en: [
    {
      icon: 'sparkles',
      color: '#6366f1',
      title: 'Welcome to Akool',
      description: 'Diagrams and notes, unified. In a few steps you will discover what you can do here.',
    },
    {
      icon: 'fileText',
      color: '#3b82f6',
      title: 'Create pages your way',
      description: 'Block notes, drawings, split view (note + drawing) and to-do lists. It all starts with the "Create" button in the sidebar.',
    },
    {
      icon: 'pencil',
      color: '#8b5cf6',
      title: 'Draw and diagram',
      description: 'Use the full Excalidraw canvas, or embed a diagram inside a note without switching pages.',
    },
    {
      icon: 'checkSquare',
      color: '#f59e0b',
      title: 'Organize tasks and projects',
      description: 'To-do lists with priority and due dates, and Kanban boards to track projects end to end.',
    },
    {
      icon: 'wallet',
      color: '#10b981',
      title: 'Manage your finances',
      description: 'Transactions, accounts, budgets, goals and recurring bills — with individual or family view.',
    },
    {
      icon: 'help',
      color: '#14b8a6',
      title: 'Collaborate and find help',
      description: 'Share pages, export to PDF and open the Help Center from the sidebar whenever you need.',
    },
  ],
}

// UX-012: mini-tour de cada módulo, 3 passos, mostrado uma vez na primeira
// abertura (depois do tour geral). As cores são dado de conteúdo, como acima.
export type TourModule = 'projects' | 'finance' | 'study'

export const moduleTours: Record<Lang, Record<TourModule, TourStep[]>> = {
  'pt-BR': {
    projects: [
      { icon: 'kanban', color: '#0ea5e9', title: 'Quadros e colunas', description: 'Cada quadro tem colunas com limite de WIP opcional. Arraste os cards entre elas para mudar o status.' },
      { icon: 'checkSquare', color: '#f59e0b', title: 'Cards com tudo dentro', description: 'Prioridade, prazo, checklist, anexos e um link para a página do Akool que dá contexto.' },
      { icon: 'layers', color: '#8b5cf6', title: 'Visões e fila', description: 'Kanban, lista, visão geral e linha do tempo do mesmo quadro. A fila de desenvolvimento ordena por prioridade.' },
    ],
    finance: [
      { icon: 'wallet', color: '#10b981', title: 'Contas e transações', description: 'Crie as contas, lance receitas e despesas (ou importe o extrato) e veja o saldo por conta.' },
      { icon: 'layers', color: '#f59e0b', title: 'Orçamentos e metas', description: 'Limite por categoria no mês e metas com aportes; recorrências entram sozinhas.' },
      { icon: 'share', color: '#0ea5e9', title: 'Workspace em família', description: 'Convide alguém para o workspace e marquem o que é compartilhado, transação por transação.' },
    ],
    study: [
      { icon: 'graduationCap', color: '#8b5cf6', title: 'Tópicos e cards', description: 'Um tópico por assunto, com cards de um conceito cada. Marque o card ao dominá-lo.' },
      { icon: 'checkSquare', color: '#0ea5e9', title: 'Planejamento', description: 'Data-alvo por tópico e a fila de revisões vencidas, para saber o que estudar hoje.' },
      { icon: 'fileText', color: '#10b981', title: 'Diário e estatísticas', description: 'Registre as sessões e acompanhe o ritmo por área e a sequência de dias.' },
    ],
  },
  en: {
    projects: [
      { icon: 'kanban', color: '#0ea5e9', title: 'Boards and columns', description: 'Each board has columns with an optional WIP limit. Drag cards between them to change status.' },
      { icon: 'checkSquare', color: '#f59e0b', title: 'Cards with everything', description: 'Priority, due date, checklist, attachments and a link to the Akool page that gives context.' },
      { icon: 'layers', color: '#8b5cf6', title: 'Views and queue', description: 'Kanban, list, overview and timeline of the same board. The development queue orders by priority.' },
    ],
    finance: [
      { icon: 'wallet', color: '#10b981', title: 'Accounts and transactions', description: 'Create accounts, add income and expenses (or import a statement) and see the balance per account.' },
      { icon: 'layers', color: '#f59e0b', title: 'Budgets and goals', description: 'A monthly cap per category and goals with contributions; recurring bills come in by themselves.' },
      { icon: 'share', color: '#0ea5e9', title: 'Family workspace', description: 'Invite someone to the workspace and mark what is shared, transaction by transaction.' },
    ],
    study: [
      { icon: 'graduationCap', color: '#8b5cf6', title: 'Topics and cards', description: 'One topic per subject, with one-concept cards. Tick a card when you master it.' },
      { icon: 'checkSquare', color: '#0ea5e9', title: 'Planning', description: 'A target date per topic and the overdue review queue, so you know what to study today.' },
      { icon: 'fileText', color: '#10b981', title: 'Diary and statistics', description: 'Log sessions and follow your pace by area and your day streak.' },
    ],
  },
}
