# Submódulo Obras (`src/modules/finance/projects`)

Controle de gastos de obra/reforma: quanto já foi gasto, o que ainda falta
comprar, em qual loja, e previsto × realizado por etapa.

> ⚠️ **`finance_projects` não tem nenhuma relação com `project_boards` /
> `project_cards`** (o kanban do módulo de Projetos do app). São entidades
> **financeiras próprias** — a fronteira do `src/modules/finance/README.md`
> ("não importa nada do mundo de projetos") continua valendo. O rótulo na UI é
> **"Obras"** justamente para evitar a confusão.

## Entrada e montagem

- Entrada pública: `index.ts` (barrel). O `FinancePanel` monta como a aba
  `TabId === 'projects'`, via `lazy(() => import('./projects'))`.
- Precisa renderizar **dentro** do `FinanceMobileContext.Provider` do
  `FinancePanel`: o `Modal` compartilhado lê esse contexto e, fora dele, cairia
  silenciosamente no layout de desktop no celular.

## Estrutura

```
index.ts                 barrel
FinanceProjectsTab.tsx   orquestrador (lista ↔ detalhe, modais de obra e compra)
ProjectList.tsx          cards das obras com barra de orçamento
ProjectDetail.tsx        cabeçalho + sub-nav (Resumo/Itens/Gastos/Etapas/Fornecedores)
ProjectOverview.tsx      previsto × realizado, donut por etapa, top fornecedores
ItemsView.tsx            lista de compras + filtro por status
ItemModal.tsx            form do item, com QuotesPanel embutido
QuotesPanel.tsx          N cotações por item, destaque da mais barata
ExpensesView.tsx         gastos agrupados por dia
ExpenseModal.tsx         form do gasto, com prévia do parcelamento
StagesView.tsx           etapas com teto de orçamento
SuppliersView.tsx        fornecedores + ranking de gasto (atravessa obras)
AttachmentField.tsx      upload N arquivos para bucket privado
useFinanceProjects.ts    hook de dados otimista
projectsUi.ts            mapas de label e helpers de estilo (sem JSX)
```

Lógica pura vive fora do módulo, em `src/lib/financeProjectCalc.ts`
(+ `.test.ts`): totais, comparação de cotações e cronograma de parcelas.

## Dados

Tabelas (migration `20260727120000_finance_projects_module.sql`):
`finance_projects`, `finance_project_stages`, `finance_suppliers`,
`finance_project_items`, `finance_project_quotes`, `finance_project_expenses`.

- **Dinheiro em `bigint` de centavos.** Entra com `toCents()`, sai com
  `formatBRL()`. `quantity` é o único decimal do domínio — todo produto
  `quantity × preço` é arredondado para centavos numa única operação.
- **Item ≠ gasto.** Item é planejamento, gasto é dinheiro que saiu. Ligados por
  `expenses.item_id` (nullable, `ON DELETE SET NULL`), porque um item vira várias
  compras parciais e muitos gastos não têm item (frete, diária, taxa).
- **Cotação escolhida** é um ponteiro em `items.chosen_quote_id`, não um booleano
  na cotação — não existe "duas escolhidas".
- **Parcelamento** é a coluna `installments` + cronograma derivado
  (`installmentSchedule`); não há tabela de parcelas.
- **Anexos** são `jsonb` em `items`/`expenses`, apontando para o bucket privado
  `project-expense-files`. Leitura sempre por `resolveSignedUrl` — nunca
  `getPublicUrl`. O Storage **não tem cascade**: o hook remove os objetos antes
  de apagar a linha.

## RLS

Toda tabela nasce com RLS e 4 policies (`_select/_insert/_update/_delete`):
dono (`user_id = auth.uid()`) **ou** membro do workspace da linha
(`is_workspace_member(workspace_id)`), reusando o helper e o trigger
`finance_guard_workspace()` já existentes no módulo financeiro.

As leituras do hook **não** filtram por `user_id` de propósito — a RLS já
restringe, e filtrar esconderia a obra de quem foi convidado pelo workspace.
Os filhos herdam o `workspace_id` da obra, nunca do modo de visualização atual.

## Integração com o resto de finanças

Isolada: um gasto de obra **não** vira `finance_transactions`. O fluxo de caixa
geral só enxerga o total consolidado (`activeProjectsSpent`).
