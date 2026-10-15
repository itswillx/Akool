# Módulo de Projetos

Mini-app de quadros kanban montado dentro da visão Documentos
(`DocumentsPanel` → seção "Projetos", lazy-loaded via o barrel `index.ts`).
Era um painel irmão de Documentos (`activePanel: 'projects'` + modo
`'projects'` na barra superior); a migração das chaves legadas vive em
`src/lib/docsNavigation.ts` e roda uma vez no boot (`main.tsx`).

## Estrutura

- `ProjectsPanel.tsx` — orquestrador: quadros, colunas, cards, os cinco modos de
  visualização e todos os modais. Grande de propósito por enquanto — a divisão é
  o card PERF-005, fora do escopo da migração de navegação.
- `ProjectsNav.tsx` — a faixa lateral (desktop) / chips de visualização (mobile),
  no padrão do `modules/study/StudyNav.tsx`.
- `CardFilterBar.tsx`, `GanttView.tsx`, `ImportCardsModal.tsx` — usados só pelo
  painel. `ModalShell.tsx` é a casca comum dos modais do módulo.

## Edição do card (API-013)

- O servidor guarda as regras do card: o gatilho `project_cards_integrity` (veja
  `docs/matriz-rls.md`) põe o card novo no fim da coluna e cuida do
  `updated_at`, que é a versão do conteúdo (mover não muda). O app nunca manda
  `updated_at`, nem `sort_order` de card novo — exceto a importação
  (`lib/importProjectCards.ts`, com o plano em `_domain/importPlan.ts`), que
  manda o max+1 da coluna por lote para os importados ficarem na ordem do
  arquivo.
- Cada abertura do modal é um editor (`card/useCardEditor.ts`), com uma
  gravação em voo por vez. Cada gravação lê o formulário mais novo e manda pelo
  `saveCardVersioned` (`lib/data/projects.ts`) só o que mudou desde a base
  (versão + campos). As decisões puras ficam em `card/cardSession.ts`; o
  `useBoardActions` só faz a E/S (inserir, subir imagens, gravar com versão,
  atualizar a lista).
- Se outra pessoa gravou no meio:
  - **em outros campos:** a gravação é refeita por cima da versão dela, e o
    modal adota o que ela mudou;
  - **nos mesmos campos:** nada é gravado, e o `CardConflictBanner` pergunta.
    "Carregar a versão salva" pega a versão salva só nos campos em conflito;
    "Manter a minha" sobrepõe tudo o que a pessoa mudou.
- O rascunho do sessionStorage (`akool:projects.card-draft:<quadro>:<card>:`, ou
  `…:new:<coluna>` para card novo) guarda também a base
  de onde partiu: retomado, ele grava só o que mudou e cai no mesmo conflito.
- Perdeu a permissão de editar o quadro no meio: o editor para de gravar e
  avisa.
- Rótulo não diferencia caixa (`_domain/cardLabels.ts`, reexportado por
  `lib/cardLabels.ts`: filtro, modal e importação), como no gatilho
  `project_cards_integrity`.

## Regras puras em `_domain` (API-027)

A agenda, as estatísticas, o parser de backlog, o plano da importação, o
Markdown do card e os limites do API-013 moram em `supabase/functions/_domain/`
(`autoSchedule`, `projectStats`, `backlogMarkdownParser`, `importPlan`,
`cardMarkdown`, `cardLimits`, `cardLabels`, `cardLinks`, `isoDate`, `text` e
`projectTypes`): puras, sem relógio, DOM nem o i18n do app, e as mesmas na tela
e na CLI `import:cards`. Os arquivos de `src/lib` com o mesmo nome reexportam;
o módulo continua importando de `src/lib`.

- **Sem relógio em `_domain`:** `today` é obrigatório lá. Os padrões ficam nos
  wrappers de `src/lib` (`autoSchedule`, `projectStats`, `projectCardFilters`),
  com o dia do aparelho. O `createdPerWeek` recebe o dia de criação de cada card
  (`dayOf`): o app passa o dia local do `created_at` (`createdDayLocal`), e o
  servidor vai passar o dia no fuso da pessoa, calculado no SQL.
- **Textos:** o Markdown do card, os avisos da importação e o que a impede
  (`importIssueText`) recebem um `t`. O app passa o seu; a CLI `import:cards`
  passa o `tPtBR` de `_domain/i18n.pt-BR.ts`, que tem os mesmos textos
  (`src/lib/projectDomain.test.ts` confere).
- **Imports:** `_domain` só importa caminhos relativos `.ts` dentro de
  `supabase/functions` (`_domain/importBoundary.test.ts`), e o eslint barra
  relógio, hora local, `localStorage` e DOM lá.

## Regras

- **Entrada pública:** `index.ts`. Importe por `../modules/projects`.
- Depende apenas de infraestrutura compartilhada (`contexts/`, `i18n/`, `lib/`,
  `hooks/`, `components/` neutros). Nada do módulo financeiro importa daqui e
  vice-versa — a fronteira do `modules/finance/README.md` vale nos dois sentidos.
- Navegar para uma página vinculada a um card passa pela prop `onOpenPage`
  quando o host fornece (DocumentsPanel resolve dentro da própria visão);
  `setActivePage` é só o fallback autônomo.
- **Não renomear chaves de storage** (`projects_view`, `projects_active_board`,
  `projects_open_card`, `projects_compact_column:*`, `projects_card_draft:*`,
  `projects_card_modal_state`, `projects_gantt_zoom:*`) — é estado vivo de
  usuário; deep links do Dashboard/QuickNotes gravam essas chaves antes de
  trocar a seleção de Documentos.
- Strings novas sempre em pt-BR **e** en (`src/i18n/translations.ts` tem teste
  de paridade).
