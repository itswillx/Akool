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

## Pendências conhecidas de versionamento

- **Baseline ausente.** As ~55 migrações mais antigas (excalinotion/pages, profiles,
  convites, financeiro-base) foram aplicadas via MCP e nunca tiveram arquivo no repo.
  Enquanto o baseline não existir, **não é possível recriar o banco do zero a partir
  deste diretório**. Para gerar: `npx supabase login` e depois
  `npx supabase db dump --linked -f supabase/migrations/20260509000000_baseline_remote_schema.sql`.
  Buckets e policies de storage não entram no dump (schema `storage`).
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
