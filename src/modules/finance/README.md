# Módulo Financeiro (`src/modules/finance`)

Módulo **isolado** das finanças do Akool. Vive separado do módulo de projetos
porque vai evoluir bastante de forma independente (integrações de terceiros,
importação bancária, conciliação, etc.).

## Limites do módulo

- **Entrada pública:** `index.ts` (barrel). Importe sempre por `../modules/finance`,
  nunca apontando direto para arquivos internos.
- **Depende apenas de infraestrutura compartilhada** do app: `contexts/AuthContext`,
  `i18n/LanguageContext`, `lib/supabase`, `hooks/useIsMobile`, `hooks/usePdfExport`,
  `components/board` e os tipos `Finance*` de `src/types`.
- **Não importa nada do mundo de projetos** (páginas, ProjectsPanel, Kanban, etc.).
  Essa fronteira deve ser mantida.

> `components/board` **não** é o kanban do ProjectsPanel. É um primitivo neutro
> criado à parte (colunas, cards, DnD, busca, chips de visibilidade) que não
> conhece nenhum tipo de nenhum domínio — infraestrutura compartilhada, como
> `Charts.tsx`. Nenhuma linha de `ProjectsPanel.tsx` é importada; os trechos
> reaproveitados (detecção de colisão, sensores) foram **copiados** com
> comentário citando a origem. A fronteira acima continua valendo.

## RLS / Segurança

Todo acesso a dados passa pelas tabelas `finance_*` no Supabase, **protegidas por
RLS no servidor**. A separação de visões na UI (switch Tudo/Projetos/Financeiro) é
cosmética e **não** é uma fronteira de segurança.

> ⚠️ Ao adicionar novas tabelas/integrações aqui, elas **precisam nascer com RLS**.
> A RLS atual não está versionada no repositório (vive só no projeto remoto), então
> qualquer mudança de schema deve ser feita com cuidado e idealmente versionada.

## Estrutura

```
src/modules/finance/
  index.ts            ← barrel (entrada pública)
  FinancePanel.tsx    ← orquestrador atual
  ui/                 ← primitivos compartilhados: Modal, Drawer, EmojiInput,
                        AttachmentField, FinanceMobileContext e os design
                        tokens (FIN_*, estilos, badgeStyle)
  myprojects/         ← aba "Projetos": Resumo + Loja + Metas (README próprio)
  store/              ← submódulo "Loja" (ver README próprio)
  integrations/       ← provedores externos
  tabs/ modals/ hooks/ utils/   ← split incremental do FinancePanel (a criar)
```

`ui/` foi extraído do `FinancePanel.tsx` para que os submódulos reusem o mesmo
modal/drawer em vez de duplicá-los. O `Modal` depende do
`FinanceMobileContext`, então qualquer coisa que o use precisa renderizar dentro
do provider do `FinancePanel`.

### Submódulos removidos: Obras e Investimentos (2026-08-07)

**Obras** (`projects/`, 6 tabelas `finance_project*`) virou Metas: cada
`finance_projects` foi migrada para `finance_goals` e cada gasto para
`finance_goal_contributions`, pela migration
`20260807120000_finance_drop_works_investments`. Etapas, itens a comprar e
cotações não sobreviveram — só o nome do fornecedor, colado na nota da
contribuição. Backup em `supabase/backups/20260807_obras_investimentos.json`.

Duas coisas de Obras continuam vivas porque a Loja também as usa:
`finance_suppliers` (restaurada em `20260807130000_finance_restore_suppliers`
depois de ter sido dropada por engano) e o `AttachmentField`, que subiu para
`ui/`.

**Investimentos** (`investments/`, `finance_investments` +
`finance_investment_movements`) foi removido inteiro, tabelas incluídas. As duas
estavam vazias, então nada foi migrado e nenhum saldo mudou — o 3º parâmetro de
`accountBalance`, que descontava os aportes, sempre somou zero neste banco e
deixou de existir.

`src/lib/investmentClassifier.ts` **ficou**: não depende das tabelas e é o que
faz `statementImport` marcar um aporte como transferência **interna**, para ele
não virar despesa fantasma na importação de extrato.

### Abas

`TAB_IDS` no topo do `FinancePanel.tsx` é a fonte única das abas — o union
`TabId`, o validador do `localStorage` e o whitelist do `CustomEvent`
`finance_tab_change` derivam todos dele. Adicionar uma aba é acrescentar uma
entrada ali e outra em `FINANCE_NAV`.

Loja e Metas **não são abas**: são sub-abas de `'myprojects'`. Os ids antigos
continuam sendo aceitos por `resolveTabRequest` (a única função que os conhece),
que os traduz para a sub-aba correspondente — ver `myprojects/README.md`.
