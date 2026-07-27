# Módulo Financeiro (`src/modules/finance`)

Módulo **isolado** das finanças do Akool. Vive separado do módulo de projetos
porque vai evoluir bastante de forma independente (integrações de terceiros,
importação bancária, conciliação, etc.).

## Limites do módulo

- **Entrada pública:** `index.ts` (barrel). Importe sempre por `../modules/finance`,
  nunca apontando direto para arquivos internos.
- **Depende apenas de infraestrutura compartilhada** do app: `contexts/AuthContext`,
  `i18n/LanguageContext`, `lib/supabase`, `hooks/useIsMobile`, `hooks/usePdfExport`
  e os tipos `Finance*` de `src/types`.
- **Não importa nada do mundo de projetos** (páginas, ProjectsPanel, Kanban, etc.).
  Essa fronteira deve ser mantida.

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
                        FinanceMobileContext e os design tokens (FIN_*, estilos)
  projects/           ← submódulo "Obras" (ver README próprio)
  integrations/       ← provedores externos (a criar)
  tabs/ modals/ hooks/ utils/   ← split incremental do FinancePanel (a criar)
```

`ui/` foi extraído do `FinancePanel.tsx` para que o submódulo `projects/` reuse
o mesmo modal/drawer em vez de duplicá-los. O `Modal` depende do
`FinanceMobileContext`, então qualquer coisa que o use precisa renderizar dentro
do provider do `FinancePanel`.

### Aba "Obras" (`projects/`)

Controle de gastos de obra/reforma: etapas com teto de orçamento, lista de itens
a comprar, cotações por fornecedor e gastos realizados com anexos.

> ⚠️ `finance_projects` **não** tem relação com `project_boards`/`project_cards`
> do módulo de Projetos — a fronteira acima continua valendo. Detalhes em
> `projects/README.md`.

Acoplamento com o resto de finanças é só de leitura e numa direção: um gasto de
obra nunca vira `finance_transaction`; o Resumo mostra apenas o total
consolidado, via `useProjectsSummary`.

### Abas

`TAB_IDS` no topo do `FinancePanel.tsx` é a fonte única das abas — o union
`TabId`, o validador do `localStorage` e o whitelist do `CustomEvent`
`finance_tab_change` derivam todos dele. Adicionar uma aba é acrescentar uma
entrada ali e outra em `FINANCE_NAV`.
