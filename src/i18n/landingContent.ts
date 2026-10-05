import { MIN_PASSWORD_LENGTH } from '../lib/passwordPolicy'
import { MODULE_COLORS } from './appPreviewContent'
import type { Lang } from './translations'
import type { HelpIcon } from './helpContent'

// Texto da página pública (landing), nos dois idiomas, fora do dicionário:
// como o tourContent, é conteúdo longo, e este arquivo só entra no chunk da
// landing (import() em AuthPage), então o boot de quem já está logado não
// cresce. As cores dos módulos vêm do appPreviewContent (as das categorias da
// Ajuda). Tudo aqui descreve o que o app faz hoje (levantamento de 2026-10-03,
// com as fontes no código): cadastro só com convite (8 caracteres, 7 dias, uso
// único, 2 por conta nova); Backup, Auditoria e Usuários são de administrador;
// não há IA embutida nem PWA offline (só rascunhos guardados no aparelho); o
// "tempo real" entrega as versões salvas (não é edição simultânea); Estudos não
// tem revisões espaçadas; anexos de card são imagens; sem preço nem números
// de uso. A validade do link de recuperação não está no repositório: não citar.

export type LandingHighlightIcon = 'users' | 'fileDown' | 'languages' | 'moon' | 'shield' | 'database' | 'wifiOff' | 'smartphone'

export interface LandingModule {
  id: string
  icon: HelpIcon
  color: string
  title: string
  description: string
}

export interface LandingStep {
  title: string
  description: string
}

export interface LandingHighlight {
  icon: LandingHighlightIcon
  title: string
  description: string
}

export type LandingShowcaseId = 'pages' | 'projects' | 'finance' | 'study'

export interface LandingShowcaseItem {
  id: LandingShowcaseId
  label: string
  lead: string
  points: [string, string, string, string]
}

export interface LandingFaqItem {
  q: string
  a: string
}

export interface LandingContent {
  hero: { eyebrow: string; title: string; subtitle: string; inviteNote: string; facts: [string, string, string] }
  modules: { title: string; subtitle: string; items: LandingModule[] }
  showcase: { title: string; subtitle: string; tabsLabel: string; pause: string; resume: string; items: LandingShowcaseItem[] }
  steps: { title: string; items: LandingStep[] }
  highlights: { items: LandingHighlight[] }
  faq: { title: string; items: LandingFaqItem[] }
  cta: { title: string; text: string }
  footer: { tagline: string }
}

export const landingContent: Record<Lang, LandingContent> = {
  'pt-BR': {
    hero: {
      eyebrow: 'Páginas · Projetos · Finanças · Estudos',
      title: 'Notas, projetos, finanças e estudos num só lugar',
      subtitle: 'Espaço de trabalho pessoal e colaborativo: páginas com notas, desenhos e tarefas, projetos em kanban e Gantt, finanças e estudos, num só app.',
      inviteNote: 'Para criar uma conta você precisa de um código de convite, gerado por quem já usa o Akool (em Configurações).',
      facts: ['Verificação em duas etapas', 'Português e inglês', 'No celular e no computador'],
    },
    modules: {
      title: 'Módulos',
      subtitle: 'O que você encontra depois de entrar',
      items: [
        { id: 'pages', icon: 'fileText', color: MODULE_COLORS.pages, title: 'Páginas', description: 'Notas em blocos, desenhos no Excalidraw, nota e desenho lado a lado e listas de tarefas, organizados em árvore, com favoritos e busca.' },
        { id: 'docs', icon: 'layers', color: MODULE_COLORS.docs, title: 'Documentos', description: 'Um painel que reúne as suas páginas, os projetos e a rede de ligações entre eles.' },
        { id: 'projects', icon: 'kanban', color: MODULE_COLORS.projects, title: 'Projetos', description: 'Quadros kanban com limite de WIP opcional; cards com prioridade, prazo, checklist e imagens; visões em lista, visão geral e cronograma (Gantt); importação de backlog em Markdown.' },
        { id: 'finance', icon: 'wallet', color: MODULE_COLORS.finance, title: 'Finanças', description: 'Contas, transações com foto do comprovante, orçamentos, metas e contas recorrentes; importação de extrato OFX (qualquer banco) e PDF do C6 Bank; loja e workspace em família.' },
        { id: 'study', icon: 'graduationCap', color: MODULE_COLORS.study, title: 'Estudos', description: 'Tópicos com cards por etapa, meta com prazo, diário e estatísticas.' },
        { id: 'help', icon: 'help', color: MODULE_COLORS.help, title: 'Ajuda', description: 'Artigos passo a passo, atalhos e um tour guiado dentro do app.' },
      ],
    },
    showcase: {
      title: 'Por dentro dos módulos',
      subtitle: 'Um pouco do que cada área faz, do jeito que aparece no app.',
      tabsLabel: 'Escolha um módulo',
      pause: 'Pausar a troca automática',
      resume: 'Retomar a troca automática',
      items: [
        { id: 'pages', label: 'Páginas', lead: 'Notas, desenhos e listas de tarefas, organizados em árvore.', points: [
          'Quatro tipos de página: nota, desenho, nota e desenho lado a lado, e lista de tarefas.',
          'Notas com menu “/”, atalhos de Markdown, imagens e diagramas dentro do texto.',
          'Salvamento automático enquanto você escreve ou desenha.',
          'Favoritos, busca por título e exportação em PDF de uma ou de várias páginas.',
        ] },
        { id: 'projects', label: 'Projetos', lead: 'Quadros para tocar qualquer projeto, do backlog à entrega.', points: [
          'Cinco visões: Kanban, Cronograma (Gantt), Lista, Visão geral e Compacto.',
          'Cards com prioridade, datas, responsável, etiquetas, checklist, imagens e dependências.',
          'Cronograma com zoom por dia, semana e mês, que pode ser montado automaticamente.',
          'Quadros compartilhados como leitor ou editor, e importação de backlog em Markdown.',
        ] },
        { id: 'finance', label: 'Finanças', lead: 'Contas, orçamentos e metas, sozinho ou em família.', points: [
          'Contas corrente, poupança, cartão de crédito e dinheiro, cada uma com saldo inicial.',
          'Transações com foto do comprovante, orçamentos por categoria e metas com prazo.',
          'Contas recorrentes com vencimento e parcelas; extrato OFX de qualquer banco e PDF do C6 Bank.',
          'Gráficos do mês, relatório em PDF, loja e workspace em família.',
        ] },
        { id: 'study', label: 'Estudos', lead: 'Roteiros de estudo com etapas, prazos e progresso.', points: [
          'Tópicos com área, nível, objetivo e status.',
          'Roteiro em etapas, com pontos de estudo, recursos e quiz opcional (certo ou errado e múltipla escolha).',
          'Data-alvo que distribui os prazos das etapas e destaca o que está atrasado.',
          'Diário, planejamento (fila e metas) e estatísticas de progresso.',
        ] },
      ],
    },
    steps: {
      title: 'Como funciona',
      items: [
        { title: 'Receba um convite', description: 'Peça um código de convite a quem já usa o Akool: ele é gerado em Configurações.' },
        { title: 'Crie sua conta', description: 'Cadastre e-mail e senha com o código, confirme o e-mail e, se quiser, ative a verificação em duas etapas.' },
        { title: 'Monte seu workspace', description: 'Crie páginas, quadros e contas e compartilhe com quem quiser: nas páginas e nos quadros, as alterações salvas chegam para todos na hora.' },
      ],
    },
    highlights: {
      items: [
        { icon: 'users', title: 'Colaboração em tempo real', description: 'Compartilhe páginas como visualizador, editor ou co-proprietário, veja quem está na página e receba na hora as alterações salvas.' },
        { icon: 'fileDown', title: 'Exportação em PDF', description: 'Exporte suas páginas e os relatórios financeiros em PDF.' },
        { icon: 'languages', title: 'Português e inglês', description: 'A interface fala pt-BR e inglês; troque quando quiser, inclusive aqui em cima.' },
        { icon: 'moon', title: 'Tema claro e escuro', description: 'Escolha o tema na sua conta; ele vale em todas as telas.' },
        { icon: 'shield', title: 'Verificação em duas etapas', description: 'Proteja a conta com um app autenticador (TOTP). O login é pedido de novo ao abrir o app num novo dia.' },
        { icon: 'database', title: 'Backups e auditoria', description: 'Backups do banco manuais e automáticos e registro das ações administrativas (para administradores).' },
        { icon: 'wifiOff', title: 'Rascunhos sem conexão', description: 'Sem internet, o que você edita em notas e desenhos fica guardado no aparelho e é enviado quando a conexão voltar.' },
        { icon: 'smartphone', title: 'No celular e no computador', description: 'Feito para o navegador do celular e do computador.' },
      ],
    },
    faq: {
      title: 'Perguntas frequentes',
      items: [
        { q: 'Preciso de convite para criar uma conta?', a: 'Sim. Quem já usa o Akool gera o código em Configurações → Convites. Cada código tem 8 caracteres, vale por 7 dias e serve para um cadastro; cada conta nova ganha 2 convites.' },
        { q: 'Esqueci a senha. E agora?', a: `Em Entrar, use “Esqueci minha senha”: chega por e-mail um link para definir uma senha nova, com pelo menos ${MIN_PASSWORD_LENGTH} caracteres, letra maiúscula, minúscula e número. Com a verificação em duas etapas ligada, o código é pedido antes; ao salvar, você já entra no app.` },
        { q: 'Por que o login é pedido todo dia?', a: 'Por segurança: ao abrir o app num novo dia, a sessão anterior é encerrada e o login é pedido de novo. Se o dia virar com o app aberto, aparece um aviso.' },
        { q: 'Como ligo a verificação em duas etapas?', a: 'Em Configurações → Segurança: leia o QR code (ou digite a chave) num app autenticador e confirme com o código de 6 dígitos. É opcional; ligada, o código é pedido a cada novo login.' },
        { q: 'Funciona no celular?', a: 'Sim, no navegador do celular. O kanban tem uma visão compacta e as finanças, uma navegação própria para telas pequenas.' },
        { q: 'E sem internet?', a: 'Para abrir o app é preciso estar on-line. Se a conexão cair no meio do trabalho, os rascunhos de notas, desenhos e notas rápidas ficam guardados no aparelho e são enviados quando ela voltar.' },
        { q: 'O que dá para compartilhar?', a: 'Páginas (como visualizador, editor ou co-proprietário), quadros de projetos (como leitor ou editor) e as finanças da família, num workspace compartilhado. Os estudos são só seus.' },
        { q: 'Meus dados ficam protegidos?', a: 'O banco só entrega a cada pessoa as linhas que ela pode ver (Row Level Security), imagens e comprovantes ficam em armazenamento privado com links temporários, e sair do app limpa os dados guardados no navegador. Administradores fazem backups do banco.' },
      ],
    },
    cta: {
      title: 'Tem um código de convite?',
      text: 'Crie sua conta em poucos minutos e monte o seu workspace.',
    },
    footer: {
      tagline: 'Notas, desenhos, tarefas, projetos e finanças num lugar só.',
    },
  },
  en: {
    hero: {
      eyebrow: 'Pages · Projects · Finance · Studies',
      title: 'Notes, projects, finances and studies in one place',
      subtitle: 'A personal and collaborative workspace: pages with notes, drawings and tasks, kanban and Gantt projects, finances and studies, in a single app.',
      inviteNote: 'To create an account you need an invite code, generated by someone who already uses Akool (in Settings).',
      facts: ['Two-step verification', 'Portuguese and English', 'On your phone and computer'],
    },
    modules: {
      title: 'Modules',
      subtitle: 'What you find once you sign in',
      items: [
        { id: 'pages', icon: 'fileText', color: MODULE_COLORS.pages, title: 'Pages', description: 'Block notes, Excalidraw drawings, a note and a drawing side by side, and to-do lists, organized in a tree with favorites and search.' },
        { id: 'docs', icon: 'layers', color: MODULE_COLORS.docs, title: 'Documents', description: 'One panel that brings together your pages, your projects and the network of links between them.' },
        { id: 'projects', icon: 'kanban', color: MODULE_COLORS.projects, title: 'Projects', description: 'Kanban boards with an optional WIP limit; cards with priority, due date, checklist and images; list, overview and timeline (Gantt) views; Markdown backlog import.' },
        { id: 'finance', icon: 'wallet', color: MODULE_COLORS.finance, title: 'Finance', description: 'Accounts, transactions with a receipt photo, budgets, goals and recurring bills; OFX statement import (any bank) and C6 Bank PDF import; a store and a family workspace.' },
        { id: 'study', icon: 'graduationCap', color: MODULE_COLORS.study, title: 'Studies', description: 'Topics with step cards, a target date, a diary and statistics.' },
        { id: 'help', icon: 'help', color: MODULE_COLORS.help, title: 'Help', description: 'Step-by-step articles, shortcuts and a guided tour inside the app.' },
      ],
    },
    showcase: {
      title: 'Inside the modules',
      subtitle: 'A taste of what each area does, the way it looks in the app.',
      tabsLabel: 'Pick a module',
      pause: 'Pause automatic switching',
      resume: 'Resume automatic switching',
      items: [
        { id: 'pages', label: 'Pages', lead: 'Notes, drawings and to-do lists, organized in a tree.', points: [
          'Four page types: note, drawing, a note and a drawing side by side, and to-do list.',
          'Notes with a “/” menu, Markdown shortcuts, images and diagrams inside the text.',
          'Autosave while you write or draw.',
          'Favorites, search by title and PDF export of one page or several.',
        ] },
        { id: 'projects', label: 'Projects', lead: 'Boards to run any project, from backlog to delivery.', points: [
          'Five views: Kanban, Timeline (Gantt), List, Overview and Compact.',
          'Cards with priority, dates, assignee, labels, checklist, images and dependencies.',
          'A timeline with day, week and month zoom that can be laid out automatically.',
          'Boards shared as viewer or editor, and Markdown backlog import.',
        ] },
        { id: 'finance', label: 'Finance', lead: 'Accounts, budgets and goals, on your own or as a family.', points: [
          'Checking, savings, credit card and cash accounts, each with an opening balance.',
          'Transactions with a receipt photo, budgets per category and goals with a deadline.',
          'Recurring bills with due dates and installments; OFX statements from any bank and C6 Bank PDF.',
          'Monthly charts, a PDF report, a store and a family workspace.',
        ] },
        { id: 'study', label: 'Studies', lead: 'Study roadmaps with steps, deadlines and progress.', points: [
          'Topics with area, level, goal and status.',
          'A roadmap in steps, with study points, resources and an optional quiz (true-or-false and multiple choice).',
          'A target date that spreads the step deadlines and highlights what is overdue.',
          'A diary, planning (queue and goals) and progress statistics.',
        ] },
      ],
    },
    steps: {
      title: 'How it works',
      items: [
        { title: 'Get an invite', description: 'Ask someone who already uses Akool for an invite code: it is generated in Settings.' },
        { title: 'Create your account', description: 'Sign up with your email, a password and the code, confirm the email and, if you want, turn on two-step verification.' },
        { title: 'Build your workspace', description: 'Create pages, boards and accounts and share them with whoever you want: on pages and boards, saved changes reach everyone right away.' },
      ],
    },
    highlights: {
      items: [
        { icon: 'users', title: 'Real-time collaboration', description: 'Share pages as viewer, editor or co-owner, see who is on the page and get saved changes right away.' },
        { icon: 'fileDown', title: 'PDF export', description: 'Export your pages and finance reports as PDF.' },
        { icon: 'languages', title: 'Portuguese and English', description: 'The interface speaks pt-BR and English; switch whenever you like, including up here.' },
        { icon: 'moon', title: 'Light and dark theme', description: 'Pick the theme in your account; it applies to every screen.' },
        { icon: 'shield', title: 'Two-step verification', description: 'Protect your account with an authenticator app (TOTP). You sign in again when you open the app on a new day.' },
        { icon: 'database', title: 'Backups and audit log', description: 'Manual and automatic database backups and a log of administrative actions (for administrators).' },
        { icon: 'wifiOff', title: 'Drafts without a connection', description: 'Without internet, what you edit in notes and drawings stays on your device and is sent when the connection returns.' },
        { icon: 'smartphone', title: 'On your phone and your computer', description: 'Built for the browser on your phone and your computer.' },
      ],
    },
    faq: {
      title: 'Frequently asked questions',
      items: [
        { q: 'Do I need an invite to create an account?', a: 'Yes. Someone who already uses Akool generates the code in Settings → Invites. Each code has 8 characters, lasts 7 days and works for one sign-up; every new account gets 2 invites.' },
        { q: 'I forgot my password. What now?', a: `On Sign in, use “Forgot my password”: you get an email link to set a new password, with at least ${MIN_PASSWORD_LENGTH} characters, an uppercase letter, a lowercase letter and a number. With two-step verification on, the code is asked first; when you save it, you go straight into the app.` },
        { q: 'Why do I have to sign in every day?', a: 'For security: when you open the app on a new day, the previous session ends and you sign in again. If the day changes while the app is open, you get a warning.' },
        { q: 'How do I turn on two-step verification?', a: 'In Settings → Security: scan the QR code (or type the key) in an authenticator app and confirm with the 6-digit code. It is optional; once on, the code is asked at every new sign-in.' },
        { q: 'Does it work on my phone?', a: 'Yes, in your phone’s browser. The kanban has a compact view and finances have their own navigation for small screens.' },
        { q: 'What about without internet?', a: 'You need to be online to open the app. If the connection drops while you work, drafts of notes, drawings and quick notes stay on your device and are sent when it comes back.' },
        { q: 'What can I share?', a: 'Pages (as viewer, editor or co-owner), project boards (as viewer or editor) and family finances, in a shared workspace. Studies are yours only.' },
        { q: 'Is my data protected?', a: 'The database only gives each person the rows they are allowed to see (Row Level Security), images and receipts sit in private storage behind temporary links, and signing out clears the data kept in the browser. Administrators back up the database.' },
      ],
    },
    cta: {
      title: 'Got an invite code?',
      text: 'Create your account in a few minutes and set up your workspace.',
    },
    footer: {
      tagline: 'Notes, drawings, tasks, projects and finances in one place.',
    },
  },
}
