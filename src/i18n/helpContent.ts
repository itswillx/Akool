import type { Lang } from './translations'

/**
 * Structured, bilingual content for the Help Center and Welcome Tour.
 * Kept separate from translations.ts to avoid bloating it with hundreds of keys.
 * Icons are stored as string names and mapped to lucide-react icons in the UI.
 */

export type HelpIcon =
  | 'rocket'
  | 'fileText'
  | 'pencil'
  | 'layers'
  | 'checkSquare'
  | 'wallet'
  | 'kanban'
  | 'share'
  | 'fileDown'
  | 'settings'
  | 'sparkles'
  | 'help'

export type HelpMock =
  | 'sidebarCreate'
  | 'slashMenu'
  | 'todoRow'
  | 'excalidrawToolbar'
  | 'splitView'
  | 'shareRoles'
  | 'kanban'
  | 'financeOverview'
  | 'pdfExport'

export interface HelpStep {
  text: string
  tip?: string
  shortcut?: string
}

export interface HelpArticle {
  id: string
  title: string
  summary: string
  mock?: HelpMock
  steps: HelpStep[]
  keywords: string
}

export interface HelpCategory {
  id: string
  icon: HelpIcon
  color: string
  label: string
  description: string
  articles: HelpArticle[]
}

export interface ShortcutItem {
  keys: string
  action: string
}

export interface ShortcutGroup {
  title: string
  note?: string
  docsLabel?: string
  docsUrl?: string
  items: ShortcutItem[]
}

export interface TourStep {
  icon: HelpIcon
  color: string
  title: string
  description: string
}

export interface HelpContent {
  heroTitle: string
  heroSubtitle: string
  startTour: string
  searchPlaceholder: string
  searchEmptyTitle: string
  searchEmptyDesc: string
  allCategories: string
  stepLabel: string
  tipLabel: string
  shortcutsTitle: string
  shortcutsSubtitle: string
  categories: HelpCategory[]
  shortcutGroups: ShortcutGroup[]
  tourBadge: string
  tourSkip: string
  tourBack: string
  tourNext: string
  tourFinish: string
  tourStepOf: string
  tour: TourStep[]
}

const pt: HelpContent = {
  heroTitle: 'Central de Ajuda',
  heroSubtitle: 'Aprenda a usar tudo o que o Akool oferece, com exemplos passo a passo.',
  startTour: 'Iniciar tour guiado',
  searchPlaceholder: 'Buscar na ajuda (ex.: tarefa, atalho, exportar)...',
  searchEmptyTitle: 'Nenhum resultado encontrado',
  searchEmptyDesc: 'Tente outro termo ou navegue pelas categorias acima.',
  allCategories: 'Tudo',
  stepLabel: 'Passo',
  tipLabel: 'Dica',
  shortcutsTitle: 'Atalhos de teclado',
  shortcutsSubtitle: 'Acelere seu fluxo com os atalhos abaixo.',
  tourBadge: 'Bem-vindo',
  tourSkip: 'Pular',
  tourBack: 'Voltar',
  tourNext: 'Próximo',
  tourFinish: 'Começar a usar',
  tourStepOf: 'de',
  categories: [
    {
      id: 'getting-started',
      icon: 'rocket',
      color: '#6366f1',
      label: 'Primeiros passos',
      description: 'O essencial para começar a usar o Akool em minutos.',
      articles: [
        {
          id: 'first-page',
          title: 'Crie sua primeira página',
          summary: 'Tudo no Akool vive em páginas. Você escolhe o tipo ao criar.',
          mock: 'sidebarCreate',
          keywords: 'criar pagina nova nota desenho tarefa começar inicio sidebar menu',
          steps: [
            { text: 'Abra a barra lateral pelo botão de menu no canto superior esquerdo.' },
            { text: 'Na seção "Criar", escolha entre Nova nota, Novo desenho, Nota + desenho ou Lista de tarefas.' },
            { text: 'A página abre pronta para edição e é salva automaticamente.', tip: 'Notas salvam ~1s após você parar de digitar; desenhos ~2s.' },
          ],
        },
        {
          id: 'page-types',
          title: 'Entenda os 4 tipos de página',
          summary: 'Cada tipo é otimizado para uma forma de trabalho.',
          keywords: 'tipos pagina nota desenho both split todo tarefa',
          steps: [
            { text: 'Nota: editor de blocos rico, ideal para documentos e anotações.' },
            { text: 'Desenho: quadro Excalidraw completo para diagramas e wireframes.' },
            { text: 'Nota + desenho: tela dividida com os dois lado a lado.' },
            { text: 'Lista de tarefas: checklist com prioridade e prazos.' },
            { text: 'Você pode trocar o tipo a qualquer momento pelo seletor no topo da página.', tip: 'Use o ícone/emoji da página para identificá-la rapidamente na barra lateral.' },
          ],
        },
        {
          id: 'organize',
          title: 'Organize seu workspace',
          summary: 'Use páginas aninhadas, favoritos e busca para achar tudo.',
          keywords: 'organizar favoritos aninhar subpagina arvore buscar pesquisar renomear icone emoji',
          steps: [
            { text: 'Crie subpáginas passando o mouse sobre uma página e clicando em "+".' },
            { text: 'Marque páginas importantes com a estrela para vê-las em Favoritos.' },
            { text: 'Use a busca na barra lateral para encontrar páginas pelo título.' },
            { text: 'Clique duas vezes no título para renomear e escolha um emoji como ícone.' },
          ],
        },
      ],
    },
    {
      id: 'notes',
      icon: 'fileText',
      color: '#3b82f6',
      label: 'Notas e blocos',
      description: 'Documentos ricos com blocos, Markdown e diagramas embutidos.',
      articles: [
        {
          id: 'blocks',
          title: 'Escreva com blocos',
          summary: 'O menu de comandos transforma texto em qualquer tipo de bloco.',
          mock: 'slashMenu',
          keywords: 'blocos editor blocknote menu comandos slash titulo lista codigo tabela',
          steps: [
            { text: 'Digite "/" em uma linha vazia para abrir o menu de comandos.', shortcut: '/' },
            { text: 'Escolha títulos, listas, checklists, citações, blocos de código e mais.' },
            { text: 'Arraste blocos pela alça à esquerda para reordenar.' },
          ],
        },
        {
          id: 'markdown',
          title: 'Atalhos de Markdown',
          summary: 'Formate enquanto digita, sem tirar as mãos do teclado.',
          keywords: 'markdown atalho titulo heading lista negrito italico',
          steps: [
            { text: 'Comece a linha com "# " para um título.', shortcut: '# ' },
            { text: 'Use "- " ou "* " para listas com marcadores.', shortcut: '- ' },
            { text: 'Use "1. " para listas numeradas e "[] " para checklist.', shortcut: '[] ' },
          ],
        },
        {
          id: 'images-diagram',
          title: 'Imagens e diagramas embutidos',
          summary: 'Adicione imagens e até um mini-Excalidraw dentro da nota.',
          keywords: 'imagem upload diagrama embutido excalidraw bloco diagram',
          steps: [
            { text: 'Pelo menu "/", insira uma imagem (enviada para o armazenamento do Akool).' },
            { text: 'Insira um bloco "Diagrama" para desenhar sem sair da nota.' },
            { text: 'O diagrama embutido pode ser recolhido/expandido e salva sozinho.' },
          ],
        },
      ],
    },
    {
      id: 'drawings',
      icon: 'pencil',
      color: '#8b5cf6',
      label: 'Desenhos e diagramas',
      description: 'Quadro Excalidraw completo, com nota vinculada e exportação.',
      articles: [
        {
          id: 'excalidraw',
          title: 'Use o quadro Excalidraw',
          summary: 'Formas, setas, texto e desenho livre com uma barra de ferramentas completa.',
          mock: 'excalidrawToolbar',
          keywords: 'excalidraw desenho forma retangulo seta texto ferramenta quadro',
          steps: [
            { text: 'Selecione uma ferramenta na barra superior ou use o atalho.', shortcut: 'V R D A T' },
            { text: 'Clique e arraste na tela para criar formas; segure para mover (pan).' },
            { text: 'Desfaça e refaça livremente enquanto experimenta.', shortcut: 'Ctrl+Z' },
          ],
        },
        {
          id: 'linked-note',
          title: 'Nota vinculada ao desenho',
          summary: 'Mantenha anotações ao lado do quadro sem trocar de página.',
          keywords: 'nota vinculada linked note desenho lateral painel',
          steps: [
            { text: 'Em uma página de desenho, abra a aba de nota na borda do quadro.' },
            { text: 'A nota compartilha a mesma página, então tudo fica junto.' },
          ],
        },
        {
          id: 'export-image',
          title: 'Exporte o desenho',
          summary: 'Salve como imagem ou arquivo direto pelo menu do Excalidraw.',
          keywords: 'exportar imagem png salvar arquivo desenho',
          steps: [
            { text: 'Abra o menu do Excalidraw e escolha "Salvar como imagem" ou exportar para o disco.' },
          ],
        },
      ],
    },
    {
      id: 'split',
      icon: 'layers',
      color: '#ec4899',
      label: 'Nota + Desenho',
      description: 'Trabalhe com anotações e desenho lado a lado.',
      articles: [
        {
          id: 'split-view',
          title: 'Trabalhe em tela dividida',
          summary: 'Anote de um lado e desenhe do outro, na mesma página.',
          mock: 'splitView',
          keywords: 'split view tela dividida nota desenho lado a lado divisor',
          steps: [
            { text: 'Crie uma página do tipo "Nota + desenho".' },
            { text: 'Arraste o divisor central para ajustar o espaço (entre 20% e 80%).' },
            { text: 'No celular, a divisão fica na vertical (nota em cima, desenho embaixo).' },
          ],
        },
      ],
    },
    {
      id: 'todo',
      icon: 'checkSquare',
      color: '#f59e0b',
      label: 'Listas de tarefas',
      description: 'Checklists com prioridade, prazos e filtros.',
      articles: [
        {
          id: 'manage-tasks',
          title: 'Gerencie suas tarefas',
          summary: 'Adicione, conclua e filtre tarefas com indicadores de atraso.',
          mock: 'todoRow',
          keywords: 'tarefa todo lista prioridade prazo filtro concluir atraso',
          steps: [
            { text: 'Digite a tarefa e pressione Enter para adicioná-la.', shortcut: 'Enter' },
            { text: 'Defina prioridade (baixa, média, alta) e uma data de entrega.' },
            { text: 'Clique para concluir; tarefas atrasadas ficam destacadas.' },
            { text: 'Use os filtros Todas / Abertas / Concluídas para focar.' },
            { text: 'Edite o texto com duplo clique.', tip: 'Pressione Esc para cancelar a edição.', shortcut: 'Esc' },
          ],
        },
      ],
    },
    {
      id: 'finance',
      icon: 'wallet',
      color: '#10b981',
      label: 'Finanças',
      description: 'Contas, transações, orçamentos, metas e contas recorrentes.',
      articles: [
        {
          id: 'overview',
          title: 'Visão geral financeira',
          summary: 'Acompanhe receitas, despesas e saldo do mês num painel só.',
          mock: 'financeOverview',
          keywords: 'financas visao geral receita despesa saldo grafico mes',
          steps: [
            { text: 'Abra "Finanças" na barra lateral.' },
            { text: 'Veja cards de receita, despesa e saldo, além do gráfico por categoria.' },
            { text: 'Navegue entre os meses pelas setas no topo.' },
          ],
        },
        {
          id: 'transactions',
          title: 'Transações e recibos',
          summary: 'Registre entradas e saídas e anexe a foto do comprovante.',
          keywords: 'transacao receita despesa recibo foto comprovante conta categoria',
          steps: [
            { text: 'Na aba Transações, adicione uma receita ou despesa.' },
            { text: 'Vincule a uma conta e categoria.' },
            { text: 'Anexe a foto do recibo, que fica disponível para download.' },
            { text: 'Compartilhe uma transação com um parceiro ou com o workspace da família.' },
          ],
        },
        {
          id: 'accounts-budgets-goals',
          title: 'Contas, orçamentos e metas',
          summary: 'Estruture suas finanças e acompanhe limites e objetivos.',
          keywords: 'conta orcamento budget meta goal limite saldo poupanca',
          steps: [
            { text: 'Crie contas (corrente, poupança, crédito, dinheiro) com saldo inicial.' },
            { text: 'Defina orçamentos por categoria e veja alertas de estouro.' },
            { text: 'Crie metas com valor e prazo e registre contribuições.' },
          ],
        },
        {
          id: 'recurring-family',
          title: 'Recorrentes e workspace família',
          summary: 'Automatize contas fixas e compartilhe finanças com a família.',
          keywords: 'recorrente conta fixa parcela vencimento familia workspace compartilhar',
          steps: [
            { text: 'Cadastre contas recorrentes (valor fixo ou variável) com dia de vencimento.' },
            { text: 'Marque como paga (gera uma transação) ou pule um lançamento.' },
            { text: 'Crie um workspace família, convide membros e alterne entre visão individual e familiar.' },
          ],
        },
      ],
    },
    {
      id: 'projects',
      icon: 'kanban',
      color: '#0ea5e9',
      label: 'Projetos (Kanban)',
      description: 'Quadros Kanban com colunas, cards e visões alternativas.',
      articles: [
        {
          id: 'boards',
          title: 'Quadros e colunas',
          summary: 'Organize o trabalho em colunas com limite de WIP opcional.',
          mock: 'kanban',
          keywords: 'projeto kanban quadro board coluna wip limite arrastar',
          steps: [
            { text: 'Abra Documentos → "Projetos" e crie um quadro com ícone e cor.' },
            { text: 'Adicione colunas e, se quiser, defina um limite de WIP.' },
            { text: 'Arraste cards entre colunas para mudar o status.' },
          ],
        },
        {
          id: 'cards',
          title: 'Cards, prioridades e links',
          summary: 'Detalhe tarefas e conecte-as às suas páginas do Akool.',
          keywords: 'card prioridade etiqueta label responsavel prazo vincular pagina',
          steps: [
            { text: 'Crie um card com título, descrição, prioridade e prazo.' },
            { text: 'Adicione etiquetas pressionando Enter.', shortcut: 'Enter' },
            { text: 'Vincule o card a uma página do Akool para abrir o contexto rapidamente.' },
          ],
        },
        {
          id: 'views',
          title: 'Visões Lista e Overview',
          summary: 'Veja o mesmo quadro como tabela ou como resumo de progresso.',
          keywords: 'visao lista overview progresso estatistica resumo',
          steps: [
            { text: 'Alterne entre Kanban, Lista e Overview no topo do quadro.' },
            { text: 'O Overview mostra progresso por prioridade, por coluna e atrasos.' },
          ],
        },
      ],
    },
    {
      id: 'sharing',
      icon: 'share',
      color: '#14b8a6',
      label: 'Compartilhamento',
      description: 'Convide pessoas, defina papéis e colabore em tempo real.',
      articles: [
        {
          id: 'share-page',
          title: 'Compartilhe páginas e defina papéis',
          summary: 'Escolha entre visualizador, editor ou co-proprietário.',
          mock: 'shareRoles',
          keywords: 'compartilhar pagina papel role visualizador editor co-proprietario convidar',
          steps: [
            { text: 'No topo da página, clique em Compartilhar.' },
            { text: 'Busque a pessoa por email ou nome e defina o papel.' },
            { text: 'Visualizador só lê; Editor edita; Co-proprietário tem controle total.' },
          ],
        },
        {
          id: 'presence',
          title: 'Presença em tempo real',
          summary: 'Veja quem mais está na página e edite em conjunto.',
          keywords: 'presenca tempo real colaboracao avatar quem online sincronizar',
          steps: [
            { text: 'Avatares no topo mostram quem está na página.' },
            { text: 'Alterações em notas, desenhos e tarefas sincronizam ao vivo.' },
          ],
        },
      ],
    },
    {
      id: 'export',
      icon: 'fileDown',
      color: '#ef4444',
      label: 'Exportação PDF',
      description: 'Leve suas páginas e relatórios financeiros para PDF.',
      articles: [
        {
          id: 'export-pdf',
          title: 'Exporte para PDF',
          summary: 'Gere PDFs de páginas e de relatórios financeiros completos.',
          mock: 'pdfExport',
          keywords: 'exportar pdf pagina relatorio financeiro imprimir offline',
          steps: [
            { text: 'No topo de uma página, use Exportar PDF para a página atual.' },
            { text: 'Pela barra lateral, selecione várias páginas de uma vez.' },
            { text: 'No painel de Finanças, exporte o relatório do mês com gráficos.' },
          ],
        },
      ],
    },
    {
      id: 'settings',
      icon: 'settings',
      color: '#64748b',
      label: 'Configurações',
      description: 'Tema, idioma, senha e convites.',
      articles: [
        {
          id: 'theme-lang',
          title: 'Tema e idioma',
          summary: 'Personalize a aparência e o idioma da interface.',
          keywords: 'configuracao tema claro escuro idioma lingua portugues ingles aparencia',
          steps: [
            { text: 'Abra Configurações na barra lateral.' },
            { text: 'Escolha o tema claro ou escuro e o idioma (Português ou Inglês).' },
          ],
        },
        {
          id: 'invites-password',
          title: 'Convites e senha',
          summary: 'Gere códigos de convite e altere sua senha com segurança.',
          keywords: 'convite codigo invite senha password seguranca alterar',
          steps: [
            { text: 'Na aba Convites, gere e copie códigos conforme suas vagas.' },
            { text: 'Na aba Senha, troque sua senha com indicador de força.' },
          ],
        },
      ],
    },
  ],
  shortcutGroups: [
    {
      title: 'Geral (Akool)',
      items: [
        { keys: 'Enter', action: 'Salvar título / adicionar tarefa ou etiqueta' },
        { keys: 'Esc', action: 'Cancelar edição ou fechar confirmação' },
        { keys: 'Duplo clique', action: 'Renomear página ou editar tarefa' },
      ],
    },
    {
      title: 'Notas (editor de blocos)',
      note: 'Atalhos fornecidos pelo BlockNote.',
      docsLabel: 'Ver documentação do BlockNote',
      docsUrl: 'https://www.blocknotejs.org/',
      items: [
        { keys: '/', action: 'Abrir menu de comandos' },
        { keys: '# ', action: 'Título' },
        { keys: '- ', action: 'Lista com marcadores' },
        { keys: 'Ctrl/Cmd + B', action: 'Negrito' },
        { keys: 'Ctrl/Cmd + I', action: 'Itálico' },
      ],
    },
    {
      title: 'Desenho (Excalidraw)',
      note: 'Atalhos fornecidos pelo Excalidraw.',
      docsLabel: 'Ver atalhos do Excalidraw',
      docsUrl: 'https://github.com/excalidraw/excalidraw',
      items: [
        { keys: 'V', action: 'Selecionar' },
        { keys: 'R', action: 'Retângulo' },
        { keys: 'D', action: 'Losango' },
        { keys: 'A', action: 'Seta' },
        { keys: 'T', action: 'Texto' },
        { keys: 'Ctrl/Cmd + Z', action: 'Desfazer' },
      ],
    },
  ],
  tour: [
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
}

const en: HelpContent = {
  heroTitle: 'Help Center',
  heroSubtitle: 'Learn everything Akool can do, with step-by-step examples.',
  startTour: 'Start guided tour',
  searchPlaceholder: 'Search help (e.g. task, shortcut, export)...',
  searchEmptyTitle: 'No results found',
  searchEmptyDesc: 'Try another term or browse the categories above.',
  allCategories: 'All',
  stepLabel: 'Step',
  tipLabel: 'Tip',
  shortcutsTitle: 'Keyboard shortcuts',
  shortcutsSubtitle: 'Speed up your workflow with the shortcuts below.',
  tourBadge: 'Welcome',
  tourSkip: 'Skip',
  tourBack: 'Back',
  tourNext: 'Next',
  tourFinish: 'Get started',
  tourStepOf: 'of',
  categories: [
    {
      id: 'getting-started',
      icon: 'rocket',
      color: '#6366f1',
      label: 'Getting started',
      description: 'The essentials to start using Akool in minutes.',
      articles: [
        {
          id: 'first-page',
          title: 'Create your first page',
          summary: 'Everything in Akool lives in pages. You pick the type when creating.',
          mock: 'sidebarCreate',
          keywords: 'create page new note drawing task start begin sidebar menu',
          steps: [
            { text: 'Open the sidebar using the menu button at the top left.' },
            { text: 'Under "Create", choose New note, New drawing, Note + drawing or To-do list.' },
            { text: 'The page opens ready to edit and is saved automatically.', tip: 'Notes save ~1s after you stop typing; drawings ~2s.' },
          ],
        },
        {
          id: 'page-types',
          title: 'Understand the 4 page types',
          summary: 'Each type is optimized for a way of working.',
          keywords: 'types page note drawing both split todo task',
          steps: [
            { text: 'Note: rich block editor, great for documents and notes.' },
            { text: 'Drawing: full Excalidraw canvas for diagrams and wireframes.' },
            { text: 'Note + drawing: split view with both side by side.' },
            { text: 'To-do list: checklist with priority and due dates.' },
            { text: 'You can switch the type anytime from the selector at the top of the page.', tip: 'Use the page icon/emoji to spot it quickly in the sidebar.' },
          ],
        },
        {
          id: 'organize',
          title: 'Organize your workspace',
          summary: 'Use nested pages, favorites and search to find everything.',
          keywords: 'organize favorites nest subpage tree search rename icon emoji',
          steps: [
            { text: 'Create subpages by hovering a page and clicking "+".' },
            { text: 'Star important pages to see them under Favorites.' },
            { text: 'Use the sidebar search to find pages by title.' },
            { text: 'Double-click the title to rename and pick an emoji as the icon.' },
          ],
        },
      ],
    },
    {
      id: 'notes',
      icon: 'fileText',
      color: '#3b82f6',
      label: 'Notes and blocks',
      description: 'Rich documents with blocks, Markdown and embedded diagrams.',
      articles: [
        {
          id: 'blocks',
          title: 'Write with blocks',
          summary: 'The command menu turns text into any kind of block.',
          mock: 'slashMenu',
          keywords: 'blocks editor blocknote command menu slash heading list code table',
          steps: [
            { text: 'Type "/" on an empty line to open the command menu.', shortcut: '/' },
            { text: 'Pick headings, lists, checklists, quotes, code blocks and more.' },
            { text: 'Drag blocks by the left handle to reorder them.' },
          ],
        },
        {
          id: 'markdown',
          title: 'Markdown shortcuts',
          summary: 'Format as you type, without leaving the keyboard.',
          keywords: 'markdown shortcut heading list bold italic',
          steps: [
            { text: 'Start a line with "# " for a heading.', shortcut: '# ' },
            { text: 'Use "- " or "* " for bulleted lists.', shortcut: '- ' },
            { text: 'Use "1. " for numbered lists and "[] " for a checklist.', shortcut: '[] ' },
          ],
        },
        {
          id: 'images-diagram',
          title: 'Images and embedded diagrams',
          summary: 'Add images and even a mini-Excalidraw inside the note.',
          keywords: 'image upload diagram embedded excalidraw block',
          steps: [
            { text: 'From the "/" menu, insert an image (uploaded to Akool storage).' },
            { text: 'Insert a "Diagram" block to draw without leaving the note.' },
            { text: 'The embedded diagram can be collapsed/expanded and saves itself.' },
          ],
        },
      ],
    },
    {
      id: 'drawings',
      icon: 'pencil',
      color: '#8b5cf6',
      label: 'Drawings and diagrams',
      description: 'Full Excalidraw canvas, with a linked note and export.',
      articles: [
        {
          id: 'excalidraw',
          title: 'Use the Excalidraw canvas',
          summary: 'Shapes, arrows, text and freehand with a complete toolbar.',
          mock: 'excalidrawToolbar',
          keywords: 'excalidraw drawing shape rectangle arrow text tool canvas',
          steps: [
            { text: 'Select a tool in the top bar or use its shortcut.', shortcut: 'V R D A T' },
            { text: 'Click and drag on the canvas to create shapes; hold to pan.' },
            { text: 'Undo and redo freely while you experiment.', shortcut: 'Ctrl+Z' },
          ],
        },
        {
          id: 'linked-note',
          title: 'Note linked to the drawing',
          summary: 'Keep notes next to the canvas without switching pages.',
          keywords: 'linked note drawing side panel',
          steps: [
            { text: 'On a drawing page, open the note tab on the edge of the canvas.' },
            { text: 'The note shares the same page, so everything stays together.' },
          ],
        },
        {
          id: 'export-image',
          title: 'Export the drawing',
          summary: 'Save as an image or file straight from the Excalidraw menu.',
          keywords: 'export image png save file drawing',
          steps: [
            { text: 'Open the Excalidraw menu and choose "Save as image" or export to disk.' },
          ],
        },
      ],
    },
    {
      id: 'split',
      icon: 'layers',
      color: '#ec4899',
      label: 'Note + Drawing',
      description: 'Work with notes and drawing side by side.',
      articles: [
        {
          id: 'split-view',
          title: 'Work in split view',
          summary: 'Take notes on one side and draw on the other, same page.',
          mock: 'splitView',
          keywords: 'split view note drawing side by side divider',
          steps: [
            { text: 'Create a "Note + drawing" page.' },
            { text: 'Drag the center divider to adjust the space (between 20% and 80%).' },
            { text: 'On mobile the split is vertical (note on top, drawing below).' },
          ],
        },
      ],
    },
    {
      id: 'todo',
      icon: 'checkSquare',
      color: '#f59e0b',
      label: 'To-do lists',
      description: 'Checklists with priority, due dates and filters.',
      articles: [
        {
          id: 'manage-tasks',
          title: 'Manage your tasks',
          summary: 'Add, complete and filter tasks with overdue indicators.',
          mock: 'todoRow',
          keywords: 'task todo list priority due date filter complete overdue',
          steps: [
            { text: 'Type the task and press Enter to add it.', shortcut: 'Enter' },
            { text: 'Set priority (low, medium, high) and a due date.' },
            { text: 'Click to complete; overdue tasks are highlighted.' },
            { text: 'Use the All / Open / Done filters to focus.' },
            { text: 'Edit the text with a double click.', tip: 'Press Esc to cancel editing.', shortcut: 'Esc' },
          ],
        },
      ],
    },
    {
      id: 'finance',
      icon: 'wallet',
      color: '#10b981',
      label: 'Finance',
      description: 'Accounts, transactions, budgets, goals and recurring bills.',
      articles: [
        {
          id: 'overview',
          title: 'Finance overview',
          summary: 'Track income, expenses and balance for the month in one panel.',
          mock: 'financeOverview',
          keywords: 'finance overview income expense balance chart month',
          steps: [
            { text: 'Open "Finance" in the sidebar.' },
            { text: 'See income, expense and balance cards, plus the category chart.' },
            { text: 'Move between months with the arrows at the top.' },
          ],
        },
        {
          id: 'transactions',
          title: 'Transactions and receipts',
          summary: 'Record income and expenses and attach a receipt photo.',
          keywords: 'transaction income expense receipt photo account category',
          steps: [
            { text: 'On the Transactions tab, add an income or expense.' },
            { text: 'Link it to an account and a category.' },
            { text: 'Attach a receipt photo, available for download later.' },
            { text: 'Share a transaction with a partner or with the family workspace.' },
          ],
        },
        {
          id: 'accounts-budgets-goals',
          title: 'Accounts, budgets and goals',
          summary: 'Structure your finances and track limits and objectives.',
          keywords: 'account budget goal limit balance savings',
          steps: [
            { text: 'Create accounts (checking, savings, credit, cash) with a starting balance.' },
            { text: 'Set budgets per category and see over-budget alerts.' },
            { text: 'Create goals with amount and deadline and log contributions.' },
          ],
        },
        {
          id: 'recurring-family',
          title: 'Recurring and family workspace',
          summary: 'Automate fixed bills and share finances with your family.',
          keywords: 'recurring fixed bill installment due family workspace share',
          steps: [
            { text: 'Add recurring bills (fixed or variable) with a due day.' },
            { text: 'Mark as paid (creates a transaction) or skip an entry.' },
            { text: 'Create a family workspace, invite members and toggle individual vs family view.' },
          ],
        },
      ],
    },
    {
      id: 'projects',
      icon: 'kanban',
      color: '#0ea5e9',
      label: 'Projects (Kanban)',
      description: 'Kanban boards with columns, cards and alternative views.',
      articles: [
        {
          id: 'boards',
          title: 'Boards and columns',
          summary: 'Organize work in columns with an optional WIP limit.',
          mock: 'kanban',
          keywords: 'project kanban board column wip limit drag',
          steps: [
            { text: 'Open Documents → "Projects" and create a board with icon and color.' },
            { text: 'Add columns and, if you want, set a WIP limit.' },
            { text: 'Drag cards between columns to change their status.' },
          ],
        },
        {
          id: 'cards',
          title: 'Cards, priorities and links',
          summary: 'Detail tasks and connect them to your Akool pages.',
          keywords: 'card priority label assignee due link page',
          steps: [
            { text: 'Create a card with title, description, priority and due date.' },
            { text: 'Add labels by pressing Enter.', shortcut: 'Enter' },
            { text: 'Link the card to an Akool page to open the context quickly.' },
          ],
        },
        {
          id: 'views',
          title: 'List and Overview views',
          summary: 'See the same board as a table or as a progress summary.',
          keywords: 'view list overview progress stats summary',
          steps: [
            { text: 'Switch between Kanban, List and Overview at the top of the board.' },
            { text: 'Overview shows progress by priority, by column and overdue counts.' },
          ],
        },
      ],
    },
    {
      id: 'sharing',
      icon: 'share',
      color: '#14b8a6',
      label: 'Sharing',
      description: 'Invite people, set roles and collaborate in real time.',
      articles: [
        {
          id: 'share-page',
          title: 'Share pages and set roles',
          summary: 'Choose between viewer, editor or co-owner.',
          mock: 'shareRoles',
          keywords: 'share page role viewer editor co-owner invite',
          steps: [
            { text: 'At the top of the page, click Share.' },
            { text: 'Search the person by email or name and set the role.' },
            { text: 'Viewer reads only; Editor edits; Co-owner has full control.' },
          ],
        },
        {
          id: 'presence',
          title: 'Real-time presence',
          summary: 'See who else is on the page and edit together.',
          keywords: 'presence real time collaboration avatar who online sync',
          steps: [
            { text: 'Avatars at the top show who is on the page.' },
            { text: 'Changes to notes, drawings and tasks sync live.' },
          ],
        },
      ],
    },
    {
      id: 'export',
      icon: 'fileDown',
      color: '#ef4444',
      label: 'PDF export',
      description: 'Take your pages and finance reports to PDF.',
      articles: [
        {
          id: 'export-pdf',
          title: 'Export to PDF',
          summary: 'Generate PDFs of pages and complete finance reports.',
          mock: 'pdfExport',
          keywords: 'export pdf page report finance print offline',
          steps: [
            { text: 'At the top of a page, use Export PDF for the current page.' },
            { text: 'From the sidebar, select multiple pages at once.' },
            { text: 'In the Finance panel, export the monthly report with charts.' },
          ],
        },
      ],
    },
    {
      id: 'settings',
      icon: 'settings',
      color: '#64748b',
      label: 'Settings',
      description: 'Theme, language, password and invites.',
      articles: [
        {
          id: 'theme-lang',
          title: 'Theme and language',
          summary: 'Customize the appearance and the interface language.',
          keywords: 'settings theme light dark language portuguese english appearance',
          steps: [
            { text: 'Open Settings in the sidebar.' },
            { text: 'Choose the light or dark theme and the language (Portuguese or English).' },
          ],
        },
        {
          id: 'invites-password',
          title: 'Invites and password',
          summary: 'Generate invite codes and change your password securely.',
          keywords: 'invite code password security change',
          steps: [
            { text: 'On the Invites tab, generate and copy codes based on your slots.' },
            { text: 'On the Password tab, change your password with a strength meter.' },
          ],
        },
      ],
    },
  ],
  shortcutGroups: [
    {
      title: 'General (Akool)',
      items: [
        { keys: 'Enter', action: 'Save title / add task or label' },
        { keys: 'Esc', action: 'Cancel editing or close confirmation' },
        { keys: 'Double click', action: 'Rename page or edit task' },
      ],
    },
    {
      title: 'Notes (block editor)',
      note: 'Shortcuts provided by BlockNote.',
      docsLabel: 'See BlockNote documentation',
      docsUrl: 'https://www.blocknotejs.org/',
      items: [
        { keys: '/', action: 'Open command menu' },
        { keys: '# ', action: 'Heading' },
        { keys: '- ', action: 'Bulleted list' },
        { keys: 'Ctrl/Cmd + B', action: 'Bold' },
        { keys: 'Ctrl/Cmd + I', action: 'Italic' },
      ],
    },
    {
      title: 'Drawing (Excalidraw)',
      note: 'Shortcuts provided by Excalidraw.',
      docsLabel: 'See Excalidraw shortcuts',
      docsUrl: 'https://github.com/excalidraw/excalidraw',
      items: [
        { keys: 'V', action: 'Select' },
        { keys: 'R', action: 'Rectangle' },
        { keys: 'D', action: 'Diamond' },
        { keys: 'A', action: 'Arrow' },
        { keys: 'T', action: 'Text' },
        { keys: 'Ctrl/Cmd + Z', action: 'Undo' },
      ],
    },
  ],
  tour: [
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

export const helpContent: Record<Lang, HelpContent> = {
  'pt-BR': pt,
  en,
}
