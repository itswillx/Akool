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

## Crescimento futuro (sugestão)

```
src/modules/finance/
  index.ts            ← barrel (entrada pública)
  FinancePanel.tsx    ← orquestrador atual
  integrations/       ← provedores externos (a criar)
  tabs/ modals/ hooks/ utils/   ← split incremental do FinancePanel (a criar)
```
