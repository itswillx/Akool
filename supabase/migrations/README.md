# Migrações — como este projeto funciona

**Regra número 1: NUNCA rode `supabase db push` contra o projeto remoto.**

## Fluxo adotado (MCP-only)

Todo schema é aplicado no remoto (projeto `nhfftophadasiezrzlsv`) **uma migração por
vez via MCP do Supabase (`apply_migration`)**, nunca pelo CLI. O MCP registra cada
aplicação em `supabase_migrations.schema_migrations` com um timestamp gerado na hora
da aplicação — por isso **as versões registradas no remoto não batem com os nomes dos
arquivos deste diretório** (ex.: `site_backups` é `20250622120000_...sql` aqui e
`20260622161805` no ledger remoto). Os *nomes* batem; as *versões*, não.

Consequência: para o `supabase db push`, praticamente nenhum arquivo deste diretório
consta como aplicado. Um push tentaria reaplicar tudo — na melhor hipótese falharia em
"already exists"; na pior, re-executaria transformações de dados. Não use.

## Casos especiais

- `20260630130000_finance_amounts_to_cents.sql` — **neutralizada (no-op)** em
  2026-07-29. O corpo original convertia colunas financeiras para bigint multiplicando
  por 100, mas nunca rodou no remoto e o app já grava centavos em colunas `numeric`.
  A versão foi registrada manualmente no ledger remoto sem executar o corpo. Detalhes
  no próprio arquivo. Não restaure o corpo original.
- `20260710005226_finance_statements.sql` e `20260710022712_profile_secrets_fallback_ai.sql`
  — **reconstruídas a partir do banco** em 2026-07-29. Já estavam aplicadas no remoto,
  mas nunca tiveram arquivo aqui. Foram escritas de forma idempotente e o nome do
  arquivo usa a **mesma versão do ledger remoto**, então o CLI as considera aplicadas.

- `20260805120000_finance_store_purchase_status.sql` — aplicada no remoto em
  2026-08-05 via MCP (`finance_store_purchase_status`). Adiciona
  `finance_store_purchases.status` (`quoting|purchased|received`, default
  `received`) para o funil de compra da Loja. **Additiva e reversível**
  (`DROP COLUMN status`). RLS e trigger não precisaram de mudança: as policies
  são por linha, não por coluna. Atenção: `quoting` é excluído do estoque
  derivado e do custo médio em `src/lib/financeStoreCalc.ts` — mexer no default
  reescreveria o saldo histórico de estoque.

## Pendências conhecidas de versionamento

- ~~**Baseline ausente.**~~ Resolvido em 2026-08-10 (SEC-001):
  `20260509000000_baseline_remote_schema.sql` reconstrói os ~58 objetos do gap
  (excalinotion/pages, profiles, convites, financeiro-base, workspace/family
  sharing, projects module) lendo o schema ao vivo via `pg_catalog`/`pg_policies`
  (não é um `supabase db dump` bruto — foi curado à mão para não duplicar o que
  os arquivos já existentes redefinem). Nunca aplicar este arquivo via MCP
  `apply_migration` nem `db push`: os objetos já existem no remoto, o arquivo só
  serve para o `supabase db reset` local funcionar. Policies de storage ficam em
  `20260811120000_sec_storage_policies_baseline.sql` (schema `storage` não entra
  no dump/reconstrução do schema `public`). Auto-promoção de role em
  `page_shares`/`project_shares` foi auditada e está bloqueada pelo RLS (ver
  comentário na policy `project_shares_update`/`page_shares_update` no baseline
  e `docs/matriz-rls.md`).
- **Edge functions defasadas.** `supabase/functions/` tem 4 funções, mas o projeto
  remoto roda **6** — `admin-ops` e `categorize-transactions` não têm fonte aqui. Além
  disso, ao menos `ai-chat` está **atrás** da versão publicada (a v9 no remoto lê
  `profile_secrets.ai_fallback_*`, colunas que não aparecem em nenhum arquivo do repo).
  Antes de editar/redeployar qualquer função, ressincronize com
  `npx supabase functions download <slug>` — senão um deploy a partir daqui **regride
  produção**.

## Para criar uma migração nova

1. Escreva o arquivo aqui (`YYYYMMDDHHMMSS_nome_em_snake_case.sql`).
2. Aplique no remoto via MCP `apply_migration` com o mesmo `nome_em_snake_case`.
3. Commite o arquivo. (O ledger remoto ganhará um timestamp próprio — esperado.)
