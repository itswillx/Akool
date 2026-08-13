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

- `20260812140000_sec_admin_revoke_sessions.sql` — aplicada em 2026-08-12 em **duas
  passagens** no ledger remoto (`sec_admin_revoke_sessions` criou a função;
  `sec_admin_revoke_sessions_grants` corrigiu os grants em seguida). O arquivo aqui é
  o estado final e é idempotente. Detalhe importante: o `alter default privileges` de
  `20260708110000_sec_rpc_grants.sql` **não** pegou nesta função — ela nasceu com
  EXECUTE para PUBLIC e foi preciso revogar explicitamente. Toda RPC nova criada via
  MCP precisa do `revoke ... from anon, public` escrito à mão.

- `20260812170000_sec_rate_limit_core.sql` — aplicada em 2026-08-12 via MCP
  (`sec_rate_limit_core`). Cria o schema `private` (não exposto na Data API) com
  `private.rate_limits` e reescreve `validate_invite_code` e
  `search_users_for_share` para consultarem o contador. Três coisas a saber
  antes de mexer:
  1. **O `raise` que produz o 429 desfaz o próprio INSERT do contador** — o
     PostgREST roda cada RPC numa transação e não há autonomous transaction
     (sem `pg_cron`/`pg_net`/`dblink` neste projeto). O desenho depende do
     contador de janela fixa ser *auto-saturante*; o cabeçalho do arquivo
     explica em detalhe. Não "conserte" isso sem ler.
  2. **`public.check_rate_limit` (usada pelas edge functions) não dá raise de
     propósito** — devolve `jsonb` e o 429 é montado em TypeScript.
  3. **Sem `pg_cron`, a limpeza é oportunística** dentro de
     `rate_limit_touch` (duas varreduras deliberadamente *disjuntas*, senão dão
     deadlock entre si).
  Verificado por HTTP real em 2026-08-12: o 429 chega com corpo
  `{code:'rate_limited', hint:'retry_after_seconds=N'}`. O header `Retry-After`
  é enviado mas **o browser não o expõe ao JS** (não está em
  `Access-Control-Expose-Headers`), por isso os segundos vão também no `hint` —
  é o que `src/lib/rateLimit.ts` lê. A resolução de IP funciona no ambiente do
  Supabase (`cf-connecting-ip`, com fallback para o **último** hop do
  `x-forwarded-for`; o primeiro hop é escrito pelo cliente e seria spoofável).

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
- **Edge functions defasadas.** Antes de editar/redeployar qualquer função,
  ressincronize com `npx supabase functions download <slug>` (ou o MCP
  `get_edge_function`) — senão um deploy a partir daqui **regride produção**.
  - ~~`ai-chat` está atrás da publicada (a v9 lê `profile_secrets.ai_fallback_*`).~~
    **Falso alarme, corrigido em 2026-08-12 (SEC-012).** O fonte da v9 publicada
    foi baixado e comparado byte a byte com o do repo: **nem a v9 nem o arquivo
    local leem `ai_fallback_*`** — as duas selecionam apenas
    `ai_provider, ai_api_key`. A única diferença era uma linha, o default de
    `ALLOWED_ORIGINS`, onde o **local era superconjunto** (incluía
    `https://www.slinkysalsichinha.com.br`). O aviso original estava errado e
    bloqueava deploys sem motivo.
  - `admin-ops` **já tem fonte aqui e está em dia**: em 2026-08-12 o
    `supabase/functions/admin-ops/index.ts` local foi conferido byte a byte contra a
    v4 publicada (idênticos) antes de subir a v5 com a revogação de sessões. A v6
    (SEC-007, mesmo dia) adicionou a action `set_role` e a gravação em `audit_log`;
    o arquivo daqui é o fonte da v6. Deploy a partir do repo é seguro para essa
    função. `categorize-transactions` continua sem fonte no repo.
  - `ai-chat` e `analyze-transaction-photo` **estão em dia desde 2026-08-12**: o
    arquivo daqui é o fonte da **v10** de cada uma (SEC-012 acrescentou o teto de
    60/hora e 30/hora por usuário via `check_rate_limit`). Deploy a partir do repo
    é seguro para as duas. Continuam **sem consumidor no frontend** — zero
    referências em `src/` —, o que é o próprio card ARCH-008 (integrar ou remover);
    o rate limit foi aplicado porque elas seguem callable por qualquer usuário
    autenticado com o JWT dele.

## Para criar uma migração nova

1. Escreva o arquivo aqui (`YYYYMMDDHHMMSS_nome_em_snake_case.sql`).
2. Aplique no remoto via MCP `apply_migration` com o mesmo `nome_em_snake_case`.
3. Commite o arquivo. (O ledger remoto ganhará um timestamp próprio — esperado.)
