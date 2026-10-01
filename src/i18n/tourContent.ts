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
