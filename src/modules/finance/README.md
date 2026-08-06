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
                        FinanceMobileContext e os design tokens (FIN_*, estilos)
  myprojects/         ← aba "Projetos": Resumo + as três abaixo (README próprio)
  projects/           ← submódulo "Obras" (ver README próprio)
  investments/        ← submódulo "Investimentos" (ver README próprio)
  store/              ← submódulo "Loja" (ver README próprio)
  integrations/       ← provedores externos
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

Investimentos é a exceção deliberada a essa regra: o movimento vive em
`finance_investment_movements` (fora de `finance_transactions`, para não inflar
receita/despesa do mês), mas `accountBalance` o subtrai explicitamente via o 3º
parâmetro — senão o dinheiro que sai da conta para aplicar simplesmente some do
saldo. Obras ganhou `transaction_id` para poder dizer quanto do seu total já
está no fluxo de caixa (aba Obras → Conciliar).

Acoplamento com o resto de finanças é só de leitura e numa direção: um gasto de
obra nunca vira `finance_transaction`; o Resumo mostra apenas o total
consolidado, via `useProjectsSummary`.

### Abas

`TAB_IDS` no topo do `FinancePanel.tsx` é a fonte única das abas — o union
`TabId`, o validador do `localStorage` e o whitelist do `CustomEvent`
`finance_tab_change` derivam todos dele. Adicionar uma aba é acrescentar uma
entrada ali e outra em `FINANCE_NAV`.

Obras, Investimentos e Loja **não são mais abas**: viraram sub-abas de
`'myprojects'`. Os ids antigos continuam sendo aceitos por `resolveTabRequest`
(a única função que os conhece), que os traduz para a sub-aba correspondente —
ver `myprojects/README.md`.
