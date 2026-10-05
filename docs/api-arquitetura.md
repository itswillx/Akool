# Arquitetura da API do Akool v1 (multi-IA, permissões por seção)

> Status: aprovada em 04/10/2026 (plano da sessão de avaliação). Execução pelo backlog `docs/imports/backlog-api-v1.md` (API-001…API-063), em lotes de 3 pela `/fila`; cada lote tem o próprio plano aprovado antes do desenvolvimento.
> Inventário das operações do sistema: `docs/api-inventario.json`. Catálogo de permissões: Apêndice A. Riscos em aberto: Apêndice B.

| Decisão do usuário | Valor |
| --- | --- |
| Granularidade | Seção + subseção, sem restrição por item |
| Níveis | Nenhum < Ler < Escrever < Excluir (cada nível inclui os anteriores) |
| Interfaces | MCP remoto + REST/OpenAPI 3.1, gerados de um único registro de ações; `npm run cards` e `/fila` continuam funcionando |
| Administração | Só leitura, só para admin |
| Cliente | Claude Code (e Cursor, VS Code, Gemini CLI, Codex, APIs) com o token no cabeçalho; OAuth para os apps de chat fica como trabalho futuro (API-062) |
| Execução | Backlog API-001…API-063 em BacklogCard v1 |

Base de produção: `infra/staging-baseline` (PR #21, 5451651). Essa base tem as policies de admin com `is_admin()` (17ae797, aplicada em produção) e o retrato do schema com `col_acl` (f94360e). Todo card parte dela, e não do `ux/landing-publica` nem da `main`.

A migration `rel001_backup_stale_alert` está no repo, mas a avaliação indica que não foi aplicada em produção. Conferir isso antes de depender do tipo `backup_stale`.

## 0. Decisões em uma página

- **Uma edge function nova, `api`** (`verify_jwt = false`), com três superfícies geradas de um único registro de ações:
  - REST em `/functions/v1/api/v1/{secao}/{subsecao}/{acao}`;
  - MCP remoto em `/functions/v1/api/mcp` (Streamable HTTP, sem estado, só JSON);
  - OpenAPI 3.1 em `/functions/v1/api/openapi.json`, mais `/functions/v1/api/gemini-functions.json`.
- **Autenticação:** o mesmo token pessoal de hoje.
  - Formato `akool_pat_` + 64 hex; só o sha256 fica em `public.api_tokens`.
  - Vai sempre em `Authorization: Bearer`.
  - Formato e prefixo não mudam, então `.gitleaks.toml` e `_shared/scrub.ts` continuam cobrindo.
  - OAuth fica documentado como trabalho futuro (API-062).
- **Execução como o dono do token:** cada chamada é uma transação Postgres com os claims do usuário e o papel `akool_api`, que herda `authenticated`.
  - RLS, grants por coluna e gatilhos atuais valem sem reimplementação.
  - Não há emissão de JWT.
  - O `service_role` só toca o Storage, e só depois da autorização como o usuário (§2.6).
- **Permissões:** 27 subseções em 7 seções, com os níveis Nenhum < Ler < Escrever < Excluir. A conferência acontece em quatro camadas:
  1. descoberta (`tools/list` e OpenAPI filtrados);
  2. gateway, por ação;
  3. banco: RESTRICTIVE fail-closed por tabela, `api_require` nas funções SECURITY DEFINER e portão de validação em gatilho;
  4. limites por linhas e lixeira de 7 dias com desfazer.
- **Conteúdo de outras pessoas** (compartilhado comigo, workspace, linhas compartilhadas) só com `compartilhamento.pessoas`, no handler e no banco (§2.3). Isso fecha o canal de saída de prompt injection.
- **Produção só depois das guardas:** a function `api` vai para produção no API-031. Antes disso precisam estar prontas:
  - as guardas no banco (007 e 022);
  - a lixeira (025);
  - a matriz E2E (026);
  - a revisão de segurança.

  Até lá, produção recebe só migrations inofensivas (nada conecta como `akool_api_login`) e a `cards-api` com o mapa de escopos (001 e 007).
- **Compatibilidade:** `npm run cards` e `/fila` continuam pela `cards-api` até o API-035, que move a CLI para o REST. A `cards-api` sai no API-061, depois de 30 dias respondendo com `Deprecation`.

## 1. Modelo de execução

### 1.1 Uma requisição

1. `_api/http.ts` (puro) confere o formato do token antes do banco. Formato errado dá 401 e conta no limite por IP.
2. A conexão do gateway roda `api_rt.authorize(sha256, ip_bucket, nivel)` (API-014).
   - A conexão usa `AKOOL_API_DB_URL`: pooler em modo transação, usuário `akool_api_login.<ref>`.
   - Numa ida só, a função resolve o token, aplica os limites e devolve `{user_id, token_id, prefix, email, expires_at, escopos efetivos, veredito}`.
   - Até o API-014 existir, o gateway usa `public.resolve_api_token_v2`.
3. Localiza a ação, valida a entrada (JSON Schema) e confere `requires` e `ctx.can()`.
4. Roda `withUserTx` (`_api/runtime/db.ts`, o único arquivo com SQL de sessão):

```sql
begin;
select set_config('request.jwt.claims', $1, true),  -- {sub, role:'authenticated', email, aal:'aal1', akool_api:{token_id, prefix, surface}}
       set_config('request.headers', $2, true),      -- só o IP visto pela edge, para private.request_ip()
       set_config('role', 'akool_api', true),
       set_config('statement_timeout', '8000', true);
-- api_rt.idem_begin quando a ação é idempotente
-- SQL do handler, sempre parametrizado (template tag do postgres.js)
-- api_rt.audit_write nas escritas (commit junto com a mudança)
-- api_rt.idem_finish
commit;
```

5. Negações e falhas são auditadas fora da transação.

Os escopos que vão nos claims não são fonte de verdade. `private.api_scope_allows` relê `api_tokens` pelo `token_id` (§2.1), então forjar claims com SQL injetado não amplia nada. `claims.ts` recusa montar claims sem `sub` ou sem `token_id`.

### 1.2 Papéis

O API-002 decide entre os planos; o API-004 cria os papéis.

| Papel | Atributos e grants | Para quê |
|---|---|---|
| `akool_api` | NOLOGIN; `grant authenticated to akool_api with inherit true, set false`; `grant akool_api to postgres with inherit false, set true` | Herda as policies `TO authenticated` e os grants por coluna (`has_privs_of_role`), mas ninguém consegue `set role authenticated` através dele. Recebe EXECUTE dos 11 `cq_*` revogados no SEC-012 e, depois, dos `loan_*`. É o alvo das RESTRICTIVE. |
| `akool_api_login` | LOGIN NOINHERIT; `grant akool_api to akool_api_login with inherit false, set true`; `grant akool_api_login to postgres with inherit false, set true` (o ADMIN o postgres já recebe ao criar o papel; ver a sonda abaixo); senha fora do git | Sozinho, só executa `resolve_api_token_v2` e as funções de `api_rt`. Depois de `reset role`, não lê nenhuma tabela pública. |

- O Supavisor aceita papel custom com LOGIN (documentação do Supabase). As credenciais ficam em cache depois de trocar a senha.
- **Plano B**, se o postgres do Supabase não tiver ADMIN OPTION sobre `authenticated`:
  - a transação usa `set_config('role','authenticated',true)`, padrão já provado em `supabase/checks/sec013-finance-consent.sql`;
  - as RESTRICTIVE ficam `TO authenticated`, condicionadas a `auth.jwt() ? 'akool_api'`, com o mesmo `api_scope_allows` fail-closed;
  - os `cq_*` conferem o claim;
  - a conexão usa uma URL do pooler com usuário dedicado, fornecida pelo usuário.

  Nesse plano, `reset role` deixa de ser barreira. A defesa contra SQL arbitrário passa a ser o teste estático `sqlSafety.test.ts`.
- `supabase/checks/schema-snapshot.sql` ganha um bloco `roles` com os atributos de `akool_%` e as linhas de `pg_auth_members` (admin/inherit/set). Assim o drift pega mudança feita pelo painel.

#### Sonda do API-002 (05/10/2026)

**Decisão: plano A**, provisória até a prova pelo pooler (último item da tabela). Se o login pelo Supavisor falhar, vale o plano B.

Evidência (harness `supabase/checks/api002-roles-probe.sql`, rodado no staging em transação desfeita):

| Fato | Resultado |
|---|---|
| `postgres` sobre `authenticated` (staging e produção) | `admin=t inherit=t set=t`: pode conceder `authenticated` a outro papel |
| Papel do caminho do MCP `apply_migration` | `postgres`, sem superusuário, com CREATEROLE (sonda `DO … RAISE`, sem registro no ledger) |
| `grant … to postgres with admin option` | **Falha** com 0LP01 ("ADMIN option cannot be granted back to your own grantor"). No PG 16+, quem cria o papel já recebe ADMIN dele, concedido pelo `supabase_admin` com `inherit=f set=f` (`createrole_self_grant` vazio). O grant do postgres fica só `with inherit false, set true` |
| `akool_api` | herda `authenticated` (USAGE `t`), sem SET em `authenticated` (`f`) |
| Como `akool_api` com os claims de uma pessoa | `auth.uid()` lê os claims; policies `TO authenticated` valem (vê só a própria nota, insere a própria, a de outra pessoa é barrada pelo RLS); grants por coluna de `profiles` valem (`display_name` lê e altera, `role` dá *permission denied* nas duas) |
| `akool_api_login` sozinho (NOINHERIT) | SET `akool_api` `t`; não herda `akool_api`; sem USAGE nem SET em `authenticated`; *permission denied* em `quick_notes` e `profiles`; 0 funções de `public` executáveis |
| `set role authenticated` como `akool_api_login` e login pelo Supavisor (`akool_api_login.<ref>`, porta 6543) | **Pendente.** SET ROLE confere o `session_user`, então só uma sessão real pelo pooler prova. Depende da senha definida pelo usuário |

**Claim `amr`** (documentação do Supabase: *JWT Claims Reference* e *Multi-Factor Authentication*):
- É um array de `{method, timestamp}`, com `timestamp` em segundos Unix. O método mais recente vem primeiro, como em `[{"method":"totp","timestamp":1666086056},{"method":"password","timestamp":1666085924}]`.
- É um claim opcional: só some se um *Custom Access Token Hook* o tirar, e o projeto não tem hook.
- O `timestamp` é o do login com aquele método; renovar o token não o atualiza.
- Regra do API-011: "autenticou há no máximo 10 minutos" é `max(amr[].timestamp) >= extract(epoch from now()) - 600`, lido de `auth.jwt() -> 'amr'`.
- O fallback (MFA obrigatório para token de escrita) não é necessário.

### 1.3 Por que funciona

- `auth.uid()`, `auth.role()`, `auth.email()` e `auth.jwt()` leem `request.jwt.claims`. O e-mail é usado no RLS de convite de workspace.
- SEC-002/005/013, `guard_page_parent`, `finance_guard_workspace` e `prevent_profile_privilege_escalation` valem sem mudança.
- `private.cq_actor` usa `auth.uid()` fora de `service_role`.
- `cq_source()` passa a devolver `api` também com o claim `akool_api`.
- O gatilho do SEC-018 e o carimbo da fila passam a rotular `api:<prefixo>` (API-014).
- Funções SECURITY DEFINER rodam como dono e não sofrem RLS. Para elas existem `api_require` e `api_deny` (§2.4).

### 1.4 `runtime/db.ts`

- Usa `npm:postgres@3.4.x` como especificador inline, sem import map, porque o `staging:reset` só envia arquivos `.ts`.
- Opções: `prepare:false`, `max:2`, `idle_timeout:10`, `connect_timeout:5`, `ssl:'require'`.
- `date` e `timestamptz` chegam como texto.
- `int8` e `numeric` viram Number só quando passam em `Number.isSafeInteger`; senão, erro.
- O cliente cru não é exportado: os handlers recebem `tx`.
- `sqlSafety.test.ts` proíbe `unsafe(`, `set role`, `reset role`, `set_config` e `session_replication_role` fora de `runtime/db.ts`.
- Local: `[db.pooler] enabled=false`, então `AKOOL_API_DB_URL` é conexão direta.

### 1.5 Contextos sem usuário

- `restore_site_backup` (service_role), os jobs do pg_cron e a `cards-api` legada (service_role com `p_actor`) rodam com `auth.uid()` nulo.
- Regra (API-006, `supabase/migrations/README.md`): gatilho que depende do usuário pula só em contexto sem usuário (service_role, postgres, cron), nunca para os papéis `authenticated` e `akool_api`, e valida só as colunas que mudaram (`new.x is distinct from old.x`).
- O API-006 corrige `finance_guard_workspace`, que hoje recusa o INSERT de linhas de workspace durante o restore.

## 2. Guardas no banco

### 2.1 `private.api_scope_allows(p_subs text[], p_level text)` (API-007)

- STABLE, SECURITY DEFINER, `search_path=''`.
- Lê `scopes` de `public.api_tokens` pelo `auth.jwt()->'akool_api'->>'token_id'` e exige:
  - `user_id = auth.uid()`;
  - token não revogado e não expirado;
  - `session_user = 'akool_api_login'` (plano A);
  - `is_admin()` para `admin.*`.
- Sem claim, sem token ou sem casar, devolve false (fail-closed).
- Entra nas policies como `(select private.api_scope_allows(...))`, para virar InitPlan por comando.
- Só tem EXECUTE para `akool_api`, nunca USAGE do schema `private`: policies e CHECKs guardam a função por OID, como `private.card_links_are_safe` (SEC-010).

### 2.2 RESTRICTIVE por tabela (API-022)

A fonte é `supabase/functions/_api/tableScopes.ts`, com as subseções de leitura, as de escrita, o nível de DELETE e a expressão de dono de cada tabela. A migration replica o mapa em `private.api_table_scope`, e um `DO` gera as policies `AS RESTRICTIVE ... TO akool_api`:

- SELECT exige Ler; INSERT e UPDATE exigem Escrever.
- DELETE exige Excluir. A exceção é uma lista explícita de tabelas em que remover linha faz parte de Escrever (`project_card_queue`, `finance_store_sale_items` e as que o levantamento achar).
- Toda tabela pública tem policy para `akool_api`, e o padrão é negar. Um teste de paridade lê as migrations, como `site-backup/tables.test.ts`.

Tabelas negadas ao papel (API-004): `api_tokens`, `profile_secrets`, `study_lookup_cache`, `page_presence`, `mindmap_contents`, `finance_statements`.

Casos especiais:

- `profiles`:
  - a própria linha exige `perfil.dados`;
  - as outras linhas exigem `compartilhamento.pessoas:read`, porque o grant da coluna `email` é herdado e não dá para estreitar;
  - UPDATE e DELETE de `akool_api` exigem `id = auth.uid()`, mesmo para admin (fecha `profiles_update_admin`);
  - nomes e avatares de membros vêm de `private.api_profile_cards(uuid[])`, SECURITY DEFINER, que devolve só id, display_name e avatar_* de perfis relacionados.
- `notifications`: filtro por tipo (§8).
- `invite_codes`: os próprios exigem `perfil.convites`; todos exigem `admin.convites`.
- `audit_log`, `site_backups` e `site_backup_settings`: só leitura, só para admin.
- `pages`: o SELECT também é liberado para quem lê notas, desenhos ou tarefas.

### 2.3 Conteúdo de outras pessoas (regra de propriedade)

- **Escrita.** INSERT, UPDATE e DELETE de `akool_api` exigem também `compartilhamento.pessoas:write` em dois casos:
  - o recurso não é de `auth.uid()`: página, nota, desenho e tarefa pelo dono da página; quadro, coluna e card pelo dono do quadro;
  - a linha financeira tem `workspace_id` ou `shared_with_user_id`.

  A regra fica nas RESTRICTIVE (API-022), então vale mesmo com bug de handler.
- **Leitura.** Listas e buscas excluem o que foi compartilhado comigo, salvo com `incluir_compartilhados=true`, que exige `compartilhamento.pessoas:read`. Conteúdo de outra pessoa volta marcado com `owner_is_me:false` e `untrusted:true`.
- **Motivo.** Quem sabe o e-mail da vítima consegue compartilhar uma página ou um quadro com ela sem aceite (`page_shares_insert`, `project_shares_insert`). Sem essa regra, um token que lê dados privados e escreve conteúdo vira canal de exfiltração.
- **Residual documentado:** escrever num recurso próprio que o usuário já compartilhou de propósito.

### 2.4 Funções SECURITY DEFINER (API-007)

- `private.api_require(sub, level)` levanta 42501 (com `required` no detalhe) quando a sessão é da API e o escopo falta.
- `private.api_deny()` levanta 42501 em qualquer sessão da API.
- `supabase/functions/_api/definerInventory.ts` classifica cada função SECURITY DEFINER e cada gatilho executável por `authenticated` como `require(sub, level)`, `deny` ou predicado puro. As migrations têm 84 ocorrências de `security definer`. Um teste de paridade falha se aparecer função sem classificação.
- Classificadas como `deny`:
  - as escritas `admin_*`;
  - `create_api_token`, `update_api_token_scopes`, `revoke_api_token`, `revoke_all_my_api_tokens` e `delete_api_token`;
  - `set_ai_credentials`.
- Classificadas como `require`:
  - `admin_list_profiles` → `admin.usuarios`;
  - `search_users_for_share` e as RPCs de workspace → `compartilhamento.pessoas`;
  - `generate_invite_code` → `perfil.convites`;
  - `create_project_board` → `projetos.quadros`;
  - bootstraps → `financas.categorias`;
  - cada `cq_*` → a subseção da ação.
- `supabase/checks/api007-grants.sql` confere que nenhuma função de `private` é executável por PUBLIC, `authenticated` ou `akool_api` fora de uma allowlist.

### 2.5 Portão de validação humana (API-007)

O gatilho SECURITY DEFINER `cq_on_card_change` faz duas coisas que hoje passam por cima do portão:

- aprova o item em revisão quando o card vai para a coluna de concluído num quadro com fluxo;
- reenfileira o card bloqueado quando todos os itens `owner='user'` ficam completos.

Em sessão da API, as duas exigem `projetos.validacao:write`:

- a aprovação, por `api_require` dentro do gatilho;
- os itens do usuário, por um gatilho BEFORE UPDATE OF checklist que recusa mudar `completed` de item `owner='user'`.

`cq_check` herda a regra. A `cards-api` legada consulta `cq_card` antes de `check` e recusa itens do usuário quando falta `projetos.validacao`.

`conditionalScopes(input)` não basta, porque olha só a entrada. Os handlers usam `ctx.can()` com consulta ao estado.

### 2.6 Storage (API-018)

`_api/runtime/storage.ts` expõe só `authorizeObject(tx, bucket, name, op)`:

- **Leitura:** `select 1 from storage.objects where bucket_id=$1 and name=$2` dentro da transação do usuário. Isso avalia a policy real do bucket (`page_is_readable`, `user_can_access_board`, `loan_file_is_readable`, dono).
- **Escrita e exclusão:** exige `split_part(name,'/',1) = auth.uid()::text` e o segundo segmento igual ao id do pai autorizado.

Só depois disso o `service_role` age:

- assina a URL (300 s; 1 h em `note-images`);
- envia o arquivo, respeitando MIME e tamanho do bucket;
- ou agenda a exclusão pela lixeira (§9.4).

Nunca assinar nem apagar um caminho lido de uma linha sem essa checagem. As colunas de caminho ganham CHECK de prefixo depois de um levantamento dos dados: `finance_transactions.photo_url` e os anexos de cards e da Loja. Membros de workspace e destinatários de compartilhamento continuam sem abrir os comprovantes e os arquivos da Loja uns dos outros.

### 2.7 Schemas e grants

- As funções chamadas pelo gateway ficam em `api_rt`, com USAGE só para `akool_api` e `akool_api_login`: `authorize`, `audit_write`, `idem_begin` e `idem_finish`.
- Os predicados de policy ficam em `private`, só com EXECUTE.
- Toda função nova leva:
  - `set search_path = ''`;
  - `revoke execute ... from public, anon`, e também de `authenticated` quando for só da API;
  - grants explícitos, porque objetos criados pelo MCP não herdam os privilégios padrão.
- Nunca usar `REVOKE` de tabela em tabela com grants por coluna (`profiles`, `api_tokens`). No ensaio, comparar `attacl` antes e depois.

## 3. Layout de código

```
supabase/functions/
  api/index.ts          cola Deno: Deno.serve, rotas /api/v1, /api/mcp, /api/openapi.json, /api/gemini-functions.json, Sentry
  cards-api/index.ts    legado: mapa de escopos (001, 007); camada fina sobre o registro a partir do 019; sai no 061
  _api/                 PURO (vitest), grupo próprio no coverage-ratchet
    catalog.ts scopes.ts claims.ts types.ts registry.ts schema.ts errors.ts http.ts mcp.ts openapi.ts gemini.ts
    audit.ts idempotency.ts ratelimit.ts tableScopes.ts definerInventory.ts coverage.ts storagePaths.ts
    actions/<secao>/<subsecao>.ts
    runtime/db.ts runtime/storage.ts      únicos com npm:/jsr:
  _domain/              lógica de negócio pura compartilhada com o app (src/lib reexporta)
    blocknote/ study/ i18n.pt-BR.ts pageTree.ts autoSchedule.ts backlogMarkdownParser.ts importPlan.ts cardMarkdown.ts
    projectStats.ts financeCalc.ts money.ts financeCsv.ts statementImport.ts financeGraph.ts financePhase.ts
    unifiedCards.ts financeStoreCalc.ts saleTransitions.ts loanCalc.ts docsGraph.ts excalidraw.ts
```

**Por que `_api` e `_domain`:**

- `scripts/coverage-ratchet.mjs` agrupa a cobertura por pasta de `supabase/functions`.
- Pastas que começam com `_` não são publicadas.
- O bundler do `staging:reset` segue só imports relativos dentro de `supabase/functions`, inclusive `import type`.
- Há precedente: `src/lib/observability.ts` já importa `_shared/scrub`.

**Compilação e fronteira de imports (API-005):**

- `tsconfig.functions.json` (API-005): strict, ES2023 sem DOM, `types: ["node"]` (os testes leem migrations com `node:fs`), `allowImportingTsExtensions`, `noEmit`, `tsBuildInfoFile` em `node_modules/.tmp`. `include: ["supabase/functions/_api", "supabase/functions/_domain"]` (um padrão terminado em `/**` é ignorado pelo TypeScript) e `exclude: ["supabase/functions/**/runtime", "supabase/functions/**/index.ts"]` (relativos ao arquivo). Fica referenciado no `tsconfig.json`, então `npx tsc -b` checa os módulos puros. Opcional: rodar `deno check supabase/functions/api/index.ts` no CI.
- `_api/importBoundary.test.ts` (API-005): fora de `runtime/`, `_api` e `_domain` só importam caminhos relativos com `.ts` dentro de `supabase/functions` (inclusive `import type`, `export … from` e `import()`), e o que importarem de fora (ex.: `_shared`) segue a mesma regra. Ficam proibidos `src/`, `@/`, pacote nu, `npm:`, `jsr:`, import de efeito colateral e importar `runtime/` ou um `index.ts`. Testes podem importar `vitest` e `node:*`. O `exclude` do tsconfig não basta: um arquivo importado é checado do mesmo jeito.

**Porte de módulos de `src/lib`.** Cada card de porte:

- lista o fechamento transitivo dos imports. Exemplos:
  - `autoSchedule` puxa `ganttLayout`, `projectCardFilters`, `projectStats` e `priorities`;
  - `statementImport` puxa `investmentClassifier`;
  - `docsGraph` puxa `avatar` e `graph`;
  - `studySchedule`, `studyProgress` e `studyQuiz` dependem uns dos outros;
- usa tipos locais;
- separa o IO: `importProjectCards` vira `importPlan` puro mais a gravação;
- troca `t(TranslationKey)` por um dicionário pt-BR em `_domain/i18n.pt-BR.ts`;
- roda `node scripts/coverage-ratchet.mjs --allow-moves`.

## 4. Registro de ações (`_api/types.ts`, `_api/registry.ts`)

**Campos de `ActionDef`:**

- `id` no formato `secao.subsecao.acao`, e `title`;
- `description`, com até 300 caracteres e sem instruções ao modelo;
- `requires`: `allOf`/`anyOf` de `{sub, level}`;
- `input` e `output`: JSON Schema 2020-12, no subconjunto de `_api/schema.ts`;
- `annotations`: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint:false`;
- `idempotent`, `tables`, `maxResultChars` e `deprecated`;
- `run(ctx, input)`, com `ctx = {tx, principal, can(sub, level), storage, tz, now, request:{surface, client, ip_bucket}}`.

**Invariantes testadas (API-008):**

- ids únicos, só `[a-z_]`, em 3 segmentos;
- nome MCP = id com `_`, com até 48 caracteres. O Claude Code prefixa `mcp__akool__` e recusa nomes acima de 64;
- leituras com `readOnlyHint` e entrada plana;
- exclusões com `destructiveHint` e nível `delete`;
- `requires` só referencia subseções reais, sem passar do nível máximo de cada uma;
- namespaces compostos (`meta`, `painel`, `documentos.rede`, `financas.relatorios`) declarados no catálogo, sem nível próprio e com `requires.anyOf`;
- ordem determinística;
- toda ação tem um exemplo de entrada válido.

**Convenções:**

- Campos com o nome da coluna.
- Dinheiro sempre em centavos inteiros, com sufixo `_cents`; decimal é recusado. As colunas `numeric` aceitariam 12.50 e gravariam R$ 0,125.
- Datas `YYYY-MM-DD` e mês `YYYY-MM`. Fuso por `tz` ou pelo cabeçalho `X-Akool-Timezone`, com padrão `America/Sao_Paulo`.
- Listas: `limit` de 1 a 100 (padrão 50) mais `cursor`, com resposta `{items, next_cursor}`.
- Concorrência por `expected_updated_at`: versão velha dá 409 `version_conflict`.
- Arrays (checklist, vínculos, checkpoints) só mudam por operação por item.
- Exclusão em cascata exige `confirm_*` e aceita `dry_run`. Zero linhas afetadas dá 404 ou 403, nunca sucesso.
- Anotações: leitura `readOnlyHint:true`; criar `destructiveHint:false`; atualizar, sobrescrever e excluir `destructiveHint:true`.
- Leituras compostas (painel, relatórios, Rede): cada bloco só sai com a leitura da subseção de origem.
- Sempre permitidas: `meta.token.obter` e `meta.acoes.listar`.

**Manifesto de cobertura** (`_api/coverage.ts`, API-008): as 357 operações de `docs/api-inventario.json`, cada uma apontando para um action id, `never:<motivo>` (§13) ou `pending:API-0NN`. O teste falha com action id inexistente, e o API-063 exige zero `pending`. É a prova de que a API cobre todo o sistema.

## 5. Superfícies

**REST**

- GET para leitura, com query plana; POST para escrita e exclusão.
- Sucesso: `{data}`. Erro: `{error:{code, message, required?, details?, retry_after?}}`.
- Sem CORS. `Origin` presente e fora de `ALLOWED_ORIGINS` dá 403.

**MCP** (`_api/mcp.ts`, implementação própria e pura; plano B: `@modelcontextprotocol/server` v2)

- Transporte: POST JSON-RPC com resposta `application/json`, sem SSE, sem sessão e sem `Mcp-Session-Id`. Lote é recusado; GET e DELETE dão 405.
- Era 2025:
  - `initialize` negocia 2025-11-25, 2025-06-18 e 2025-03-26;
  - `notifications/initialized` dá 202;
  - `ping`.
- Era 2026-07-28:
  - `server/discover`, `_meta.protocolVersion` e `resultType`;
  - cabeçalhos `MCP-Protocol-Version`, `Mcp-Method` e `Mcp-Name` conferidos;
  - versão não suportada dá -32022.
- `tools/list` é filtrado pelos escopos efetivos, em ordem determinística, com `?secoes=` opcional.
- `tools/call` passa pelo mesmo pipeline do REST:
  - `surface=mcp`, com o `clientInfo` como cliente;
  - resposta com `structuredContent` mais um bloco `text`;
  - erro de execução com `isError:true` e a permissão que falta;
  - ferramenta inexistente ou não permitida dá -32602;
  - `_meta[\"anthropic/maxResultSizeChars\"]` nas leituras grandes.
- Sem token: 401 com `WWW-Authenticate: Bearer realm=\"akool\"`. Sem `resource_metadata` até existir OAuth.
- Claude Code:
  - `.mcp.json` com o cabeçalho `Authorization: Bearer ${AKOOL_API_TOKEN}` expandido do ambiente, ou `headersHelper`;
  - se a documentação mostrar `claude mcp add`, usar aspas simples, para o shell não gravar o segredo em `~/.claude.json`;
  - nome do servidor: `akool`.

**OpenAPI 3.1** (`_api/openapi.ts`)

- Sem token, devolve o documento completo; com token, só o que ele pode. `?secoes=` filtra.
- Usa `x-openai-isConsequential`, summary com até 300 e parâmetro com até 700 caracteres, e `bearerAuth`.
- `/gemini-functions.json` usa o subconjunto OpenAPI 3.0 do Gemini: sem `additionalProperties`, `const` vira `enum` e não há `oneOf`.

**Legado.** A `cards-api` mapeia `{action,...}` para as ações do registro e devolve exatamente o JSON de hoje (`surface=legacy`).

**Latência.** A edge roda perto de quem chama, e cada chamada faz várias idas ao banco. A documentação manda `x-region: <região do banco>`.

## 6. Token

- **Catálogo:** canônico em `_api/catalog.ts` e replicado em `private.api_scope_catalog`, com teste de paridade lendo a migration. Os rótulos `api_scope_*` existem nas duas línguas, também com teste de paridade.
- **Colunas novas em `api_tokens`:** `scopes jsonb`, com CHECK de forma, e `last_client`.
- **Assinatura:** `create_api_token(p_name, p_expires_in_days, p_scopes jsonb default null)` substitui a versão de 2 argumentos, com drop na mesma migration para evitar PGRST203. `p_scopes` nulo dá o preset legado.
- **Regras de criar e editar** (`update_api_token_scopes`), só a partir de sessão do app (recusa claims com `akool_api`, além do `api_deny`):
  - validade de 7, 30, 90 ou 365 dias;
  - token com Escrever ou Excluir vale no máximo 90 dias;
  - `admin.*` vale no máximo 30 dias, só para `is_admin()`, e gera linha em `audit_log`;
  - quem tem fator MFA verificado precisa de AAL2 (API-001);
  - quem não tem MFA precisa ter se autenticado há no máximo 10 minutos (claim `amr`, confirmado no API-002) para criar token de escrita ou ampliar escopos (API-011);
  - no máximo 20 tokens ativos.
- **Edição e avisos:** editar escopos não troca o segredo. Ampliar gera a notificação `api_token_scopes_widened`; criar gera `api_token_created` (API-011).
- **Revogação** (API-011):
  - botão Revogar todos;
  - a recuperação de senha revoga todos;
  - a troca de senha oferece revogar, já marcado;
  - o admin lista e revoga pela `admin-ops`;
  - rebaixar um admin tira `admin.*`; banir e revogar sessões revogam todos.

  `resolve` e `authorize` tiram `admin.*` de quem deixou de ser admin, a cada chamada.
- **Exclusão** (`delete_api_token(p_id)`, API-001; tela no API-009):
  - só o dono, só a partir de sessão do app, em qualquer estado (ativo, revogado ou expirado);
  - apaga a linha. Um token ativo excluído para de funcionar na hora, porque `resolve` e `authorize` não o acham mais, e `api_scope_allows` falha fechado;
  - o histórico fica: `private.api_calls` guarda `token_prefix` e `token_name` e não tem FK para `api_tokens` (§9.1);
  - a tela também tem "Limpar revogados e expirados".
- **Controle dos tokens ativos (API-009, lote 02):** cada token ativo tem três ações na lista:
  - Editar permissões: o ScopePicker abre preenchido com o nível atual de cada subseção;
  - Revogar;
  - Excluir.

  O token migrado, usado pelo `/fila`, também pode ser editado.
- **Migração dos tokens atuais:** recebem `{projetos.quadros:read, projetos.cards:read, projetos.fila:write}`.
  - Ficam sem `projetos.validacao`, porque o skill diz que quem valida é o usuário. O `validate` responde 403 dizendo como ativar.
  - `board.setup_flow` passa a exigir Quadros: Excluir.
  - `resolve_api_token_v2` convive com a v1 até o API-061.
- **Presets (API-009):**
  - Somente leitura (sem Administração e sem Compartilhamento);
  - Claude Code: fila;
  - Entrada de dados financeiros;
  - Personalizado.

  O padrão de toda subseção é Nenhum.

## 7. Escopos condicionais

| Situação | Exige também |
|---|---|
| Transação, orçamento, recorrente ou item da Loja com `workspace_id` ou `shared_with_user_id` | `compartilhamento.pessoas:write`, no handler e na RESTRICTIVE |
| Ação da Loja que cria, altera ou apaga transação vinculada | `financas.transacoes:write` |
| `marcar_paga` de recorrente | `financas.transacoes:write` |
| Mover card para concluído em quadro com fluxo, ou completar item `owner='user'` | `projetos.validacao:write`, no SQL (§2.5) |
| Bloco de card em nota | `projetos.cards:read` |
| Vínculo em nota rápida | leitura do alvo |
| Vincular página a card | `documentos.paginas:read` |
| Ações de empréstimo entre as partes e vincular tomador | `compartilhamento.pessoas:write` |
| Status de estudo `studying` ou `completed` | `estudos.progresso:write` |
| Gastos por membro, perfis de parceiros ou e-mail de terceiro | `compartilhamento.pessoas:read` |

## 8. Notificações

| Tipo | Exige leitura de |
|---|---|
| `loan_*` | `financas.emprestimos` |
| `workspace_invite`, `invite_accepted`, `invite_declined`, `member_joined`, `member_left` | `compartilhamento.pessoas` |
| `backup_stale` | `admin.backups` |
| `api_token_created`, `api_token_scopes_widened` | `perfil.notificacoes` |
| Tipo desconhecido | fica oculto |

- O filtro vale no handler e na RESTRICTIVE.
- Um teste lista todo literal de tipo nas migrations e falha se algum tipo ficar sem mapa.
- Marcar como lida só muda `read`.
- Aceitar ou recusar convite exige `compartilhamento.pessoas:write`.

## 9. Auditoria, idempotência, limites e lixeira

### 9.1 Auditoria (`private.api_calls`, API-014)

- Campos:
  - `token_id` (sem FK para `api_tokens`), `token_prefix` e `token_name` copiados na chamada, `user_id`, ação, subseção e nível. Assim, excluir um token preserva o histórico dele, e a Atividade mostra essas chamadas como "token excluído";
  - `surface` (rest, mcp ou legacy) e cliente (`clientInfo` ou User-Agent);
  - `ip_bucket` (por `private.ip_bucket_key`);
  - status, `error_code`, `target_ids` e `duration_ms`.
- Nunca guarda argumentos nem conteúdo.
- Retenção de 90 dias pelo cron `api-housekeeping`. A tabela fica em `private`, fora da PostgREST e do backup.
- Nas escritas, a linha de auditoria é gravada dentro da transação do usuário e entra no mesmo commit. Negações e falhas são gravadas fora.
- O dono vê as chamadas em Configurações → API → Atividade (`list_my_api_calls`).

### 9.2 Idempotência (`private.api_idempotency`, retenção de 24 h)

`api_rt.idem_begin` segue esta ordem:

1. Tenta `pg_try_advisory_xact_lock(hashtextextended(token_id||key,0))`. Sem o lock, responde 409 `idempotency_in_progress`.
2. Se a chave já existe com o mesmo hash de corpo, devolve a resposta guardada.
3. Se existe com hash diferente, responde 422 `idempotency_mismatch`.
4. Se não existe, grava.

A chave vem no cabeçalho `Idempotency-Key` (REST) ou no campo `idempotency_key` (MCP). É obrigatória em criações financeiras, importações, `marcar_paga`, aportes e convites.

### 9.3 Limites

| Limite | Valor |
|---|---|
| Por token, total | 120/min |
| Por token, escrita | 60/min |
| Por token, exclusão | 20/min |
| Por usuário, somando os tokens | 240/min |
| Falhas de autenticação por IP | 30/min |
| Linhas apagadas por token por dia | 500 (padrão, em tabela de config, contado no gatilho da lixeira) |

- Acima do limite: 429 com `Retry-After`.
- Se o limitador falhar: segue (fail-open) com log em leitura e escrita; bloqueia (fail-closed) em Excluir.
- Tetos por chamada: lote de transações 100; extrato 500 linhas; backlog 200 cards; estudo 100 cards.

### 9.4 Lixeira (API-025)

- Um gatilho AFTER DELETE genérico em toda tabela classificada, ativo só em sessão da API, copia `OLD` para `private.api_trash` (call_id, token_id, tabela, linha, ordem). Exclusões em cascata também entram.
- Objetos do Storage apagados pela API vão para `private.api_storage_pending` e só saem depois de 7 dias.
- `api_undo_call(p_call_id)`, chamado do app, reinsere as linhas como o usuário, em ordem de dependência. Aparece como Desfazer em Atividade.
- Retenção de 7 dias pelo `api-housekeeping`. Até aqui, o único jeito de desfazer era o restore global do site.

## 10. Erros

Implementação: `supabase/functions/_api/errors.ts` (API-005). Códigos estáveis: `unauthenticated`, `token_invalid`, `insufficient_scope` (com `required`, lista de `secao.subsecao:nivel`), `forbidden`, `not_found`, `conflict`, `version_conflict`, `validation_failed` (com `details` em JSON Pointer), `rate_limited`, `idempotency_in_progress`, `idempotency_mismatch`, `timeout`, `unavailable` e `internal`. `forbidden` e `unavailable` entraram no API-005: a tabela abaixo precisava de nome para o 42501 e para o 503.

| SQLSTATE | HTTP | `code` |
|---|---|---|
| 42501 | 403 | `forbidden` |
| P0002 | 404 | `not_found` |
| 22023, 22P02, 23514, 23503, 23502, 22001, 22003 | 422 | `validation_failed` |
| P0001, 23505 | 409 | `conflict` |
| 40001, 40P01, 55P03 | 503 | `unavailable`, `retry_after` 1 e `Retry-After` |
| 57014 | 504 | `timeout`, `retry_after` 2 e `Retry-After` |
| PGRST com JSON `rate_limited` (`private.raise_rate_limited`) | 429 | `rate_limited`, `retry_after` do hint |
| qualquer outro | 500 | `internal` (vai para o Sentry) |

- 401 leva `WWW-Authenticate: Bearer realm="akool"` (com `error="invalid_token"` em `token_invalid`). `detail`, `details` e o `hint` do Postgres nunca vão no corpo.

- O texto do Postgres só passa adiante quando vem de um RAISE do app: código P0001, ou outro código com `hint = 'akool'` (convenção para as funções novas). Nos demais casos, a resposta leva uma mensagem genérica em pt-BR e o `code`.
- Um 500 chama `captureException` (`_shared/sentry.ts`, com scrub). `scrub.ts` ganha uma regra para `postgres://`.

## 11. Versionamento

- `/v1` no caminho. Mudanças aditivas ficam na v1; uma quebra vira ação nova ou `/v2`.
- `deprecated: true` gera o cabeçalho `Deprecation` e aparece na OpenAPI e no MCP.
- `serverInfo.version` e `info.version` seguem o semver do registro.
- Changelog em `docs/api.md`.

## 12. Lógica que sai do navegador

| Card | O que sai |
|---|---|
| API-003 | `updated_at` de notas rápidas e rascunho offline versionado |
| API-006 | guarda de workspace segura para restore e cron |
| API-012 | aporte atômico; IDOR de `finance_goal_shares`; `goal_id` travado; bootstrap de categorias |
| API-013 | integridade de cards, `updated_at`, `sort_order` e rótulos sem diferença de caixa |
| API-016 | materialização de recorrentes (pg_cron), `marcar_paga` atômico e orçamentos automáticos |
| API-018 | caminhos de anexos e comprovantes |
| API-020 e API-023 | validação, normalização e Markdown de BlockNote |
| API-021 e API-024 | regras de Estudos, RPCs por item e importação atômica |
| API-027 | agenda, importação e Markdown de cards |
| API-028 e API-037 | vendas e compras da Loja |
| API-030 | escrituração e saldo de empréstimos |
| API-045 | `updated_at` de tarefas |

Regra: se o app também precisa da lógica, ela vira SQL (gatilho, ou RPC SECURITY INVOKER concedida a `authenticated` e `akool_api`) ou um módulo em `_domain` que o app reexporta.

## 13. Nunca expostos

- **Conta:** troca de senha, pedido e conclusão de reset, login, cadastro, logout, MFA (listar, cadastrar, remover, verificar) e troca de e-mail. Seriam tomada de conta, e o bearer não tem segundo fator.
- **Login diário:** `last_login.record` e `daily_login.check`, porque furariam o re-login diário (REL-007).
- **`ai_credentials.set`:** legado; o API-032 remove.
- **Gestão de tokens:** só em Configurações → API (`api_deny`); o admin usa a `admin-ops`.
- **Internos do gateway:** resolução de token e limites.
- **`invites.validate`:** fluxo anônimo, com limite por IP.
- **Administração (decisão 4):**
  - papel, banir, desbanir, excluir, revogar sessões e reset de senha;
  - editar ou apagar perfil de terceiros e `last_sign_in`;
  - gerar, revogar e apagar convites, e ajustar cotas;
  - criar, rodar, validar, restaurar e apagar backups, e mudar o automático;
  - observabilidade e cron.
- **Tempo real e estado de tela:** `*.subscribe`, presença, navegação local, modo de workspace, tours, abrir vínculo e ajuda estática.
- **Renderização no cliente:** PDF de notas e de relatórios e exportação local de desenhos. O conteúdo sai pelas leituras e pelo CSV.
- **Legado:** extratos antigos (`bank-statements`), `project-expense-files`, `mindmap_contents` e `study.lookup_cache.prune`.
- **`finance.workspace.delete`:** só por `sair_workspace`.

## 14. Cobertura das operações mapeadas

O API-008 parte de `docs/api-inventario.json` (357 operações, cada uma com o card de destino em `target` ou `never` com o motivo) e grava o manifesto em `_api/coverage.ts`. Cada linha abaixo fica como `pending:API-0NN` até o card correspondente entregar; o resto vira `never:<motivo>` (§13).

| Grupo | Card | Operações |
|---|---|---|
| Documentos | API-038 | `documents.pages.*`, `dashboard.quick_create_page` |
| Documentos | API-044 | `documents.notes.*`, `documents.files.*`, `projects.cards.copy_to_note` |
| Documentos | API-054 | `documents.drawings.*` |
| Documentos | API-045 | `documents.todos.*`, `todos.*` |
| Documentos | API-050 | `documents.shares.*`, `projects.shares.*`, `finance.sharing.search_users` |
| Documentos | API-059 | `documents.graph.get` |
| Pessoal | API-041 | `profile.me.*`, `profile.preferences.*`, `profile.onboarding.mark_seen`, `profile.avatar.*`, `finance.preferences.dashboard_view` |
| Pessoal | API-042 | `notifications.*` (menos responder convite), `invites.mine.list`, `invites.slots.read`, `invites.generate` |
| Pessoal | API-051 | `quick_notes.*`, `links.add`, `links.remove` |
| Pessoal | API-059 | `dashboard.summary.read`, `dashboard.home.get`, `finance.dashboard.widget`, `projects.dashboard.cards` |
| Projetos | API-019 | `projects.boards.list`, `setup_flow`; `projects.cards.list`, `get`; `projects.queue.*`; ações da `cards-api` |
| Projetos | API-039 | `projects.boards.get`, `create`, `update`, `delete`, `stats`, `members.list`; `projects.columns.*` |
| Projetos | API-043 | demais `projects.cards.*` |
| Projetos | API-055 | `projects.cards.auto_schedule`, `projects.import.backlog_markdown` |
| Finanças | API-036 | `finance.accounts.*`, `finance.categories.*` |
| Finanças | API-040 | `finance.transactions.*` |
| Finanças | API-046 | `finance.budgets.*`, `finance.goals.*` (menos shares), `contributions.*` |
| Finanças | API-016 | só servidor: `finance.budgets.auto_from_recurring`, `finance.recurring.entries.materialize` |
| Finanças | API-047 | `finance.recurring.*` |
| Finanças | API-049 | `finance.reports.*`, `finance.projects.summary` |
| Finanças | API-056 | `finance.workspace.*` (menos delete), `notifications.respond_workspace_invite`, `notifications.invite.respond`, `finance.goals.shares.*`, `finance.sharing.partner_profiles` |
| Loja e empréstimos | API-048 | leituras de `finance.store.*`, `finance.suppliers.list` |
| Loja e empréstimos | API-052 | escritas de `finance.store.*`, `finance.suppliers.create` |
| Loja e empréstimos | API-060 | `finance.loans.*` |
| Estudos | API-034 | tópicos, cards, importação, visão geral, estatísticas, planejamento |
| Estudos | API-053 | progresso, quiz, diário, contrato do prompt |
| Administração | API-057 | `admin.users.list`, `search`; `admin.invites.list_all`, `quotas.list`; `admin.audit.list`; `admin.backups.overview`, `list`, `settings.get` |
| API infra | API-008 e API-010 | `api.meta.actions`, que vira `meta.acoes.listar` |

## 15. Definição de pronto e convenções (todo card)

**Migrations**

- Uma por mudança, com o nome `YYYYMMDDHHMMSS_apiNNN_*.sql`. As funções seguem §2.7.
- Tabela nova vai em `private` (fora do backup) ou é classificada em `site-backup/tables.ts` e, a partir do API-022, também em `_api/tableScopes.ts`.
- Ensaio atômico com `DO … RAISE` e harness em `supabase/checks/apiNNN-*.sql`. O harness inclui um INSERT sem claims, imitando restore e cron.
- Produção só via MCP `apply_migration`, com o mesmo nome, depois do ensaio ROLLBACK e com confirmação do usuário item a item.
- Depois de aplicar:
  - get_advisors;
  - `npm run drift -- --write`;
  - `npm run gen:types` (o CI roda `gen:types -- --check`);
  - `npm run staging:reset -- --migrations`;
  - atualizar `docs/matriz-rls.md`.
- O merge na `main` só acontece com a migration já aplicada em produção, porque o drift roda a cada push na main. As migrations da fundação são inofensivas sem a function publicada e podem ir para produção no próprio card.

**Edge functions**

- `[functions.api] verify_jwt=false` e opção da function no `deploy-functions.yml`, com `scripts/workflows.test.ts` e `scripts/staging-reset.test.ts` atualizados.
- Variáveis novas entram vazias em `supabase/functions/.env.example` e são documentadas em `docs/deploy-coolify.md`.
- Grupos de cobertura novos com `node scripts/coverage-ratchet.mjs --update`; porte de módulos com `--allow-moves`.
- Staging: `npm run staging:reset -- --functions --only=api`.
- Produção: workflow Deploy function a partir do ref do PR, antes do merge, com confirmação.
- Até o API-031, `api` fica em `repoOnlyFunctions` do `supabase/drift-allowlist.json` (chave nova, criada no API-010).
- Ao remover a `cards-api`, ela fica em `remoteOnlyFunctions` até o usuário apagá-la no painel.

**Frontend**

- Dados em `src/lib/data/*`.
- i18n nas duas línguas.
- Cores por token e rótulos com `<Field>`.
- Arquivos com até 600 linhas.
- `lint-baseline` e `data-layer-baseline` não crescem.

**Fechamento**

- Todo card: `npm test`, `npm run lint:ci`, `npx tsc -b` e `npm run build`.
- Cards de ação, além disso:
  - linhas preenchidas em `_api/coverage.ts`;
  - matriz E2E (API-026);
  - validação do usuário no staging antes da produção.

## 16. Documentação e onboarding

- `docs/api.md` nasce no API-010 e é completado no API-058. Cobre:
  - conceitos, centavos, datas, fuso, paginação, versões, idempotência, erros e limites;
  - tabela de ações gerada do registro por `npm run api:docs`, com teste que falha se estiver desatualizada;
  - modelo de ameaças (do API-031).
- Snippets por cliente, sempre com o token vindo do ambiente: Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code, Windsurf, LM Studio, Open WebUI, OpenAI Responses, Claude Messages, GPT personalizado e script.
- Painel Como conectar em Configurações → API.
- README, `docs/arquitetura.md`, `docs/matriz-rls.md` e `docs/deploy-coolify.md` atualizados.
- OAuth (claude.ai, ChatGPT, app Gemini) documentado como futuro no API-062.

## 17. Plano de lotes

| Lote | Cards (no máximo um L por lote) |
|---|---|
| 01 | 001 escopos no token (L); 002 sonda de papéis; 003 notas rápidas (correção) |
| 02 | 004 papéis do executor; 005 núcleo puro; 009 tela de tokens (editar permissões, revogar e excluir) |
| 03 | 006 restore e cron sem usuário; 007 guardas no banco (L); 008 registro e cobertura |
| 04 | 010 gateway REST (L); 011 ciclo de vida do token; 012 metas (correção) |
| 05 | 013 regras de cards (L); 014 auditoria, limites e idempotência; 015 MCP |
| 06 | 016 recorrentes no servidor (L); 017 OpenAPI; 018 Storage |
| 07 | 019 prova em Projetos no staging (L); 020 BlockNote validação; 021 Estudos gatilhos |
| 08 | 022 RESTRICTIVE (L); 023 BlockNote Markdown; 024 Estudos RPCs |
| 09 | 025 lixeira (L); 026 matriz E2E; 027 porte de Projetos |
| 10 | 028 vendas da Loja no servidor (L); 029 tela de Estudos; 030 empréstimos no servidor |
| 11 | 031 revisão de segurança e corte para produção (L); 032 legado de IA; 033 importador multilinha |
| 12 | 034 Estudos conteúdo (L); 035 CLI e /fila; 036 contas e categorias |
| 13 | 037 compras da Loja no servidor (L); 038 páginas; 039 quadros |
| 14 | 040 transações (L); 041 perfil; 042 notificações e convites |
| 15 | 043 cards (L); 044 notas; 045 tarefas |
| 16 | 046 orçamentos e metas; 047 recorrentes; 048 Loja leitura |
| 17 | 049 relatórios (L); 050 compartilhamento; 051 notas rápidas |
| 18 | 052 Loja escrita (L); 053 Estudos progresso; 054 desenhos |
| 19 | 055 backlog e cronograma; 056 workspace; 057 admin leitura |
| 20 | 058 documentação; 059 painel e Rede; 060 empréstimos |
| 21 | 061 aposentar a cards-api; 062 OAuth futuro |
| 22 | 063 validação final |

- Nenhum card depende de outro do mesmo lote. Os lotes 21 e 22 são menores de propósito, porque a validação final depende de todo o resto.
- **A fila não segue a ordem da lista.** `cq_insert_queued` ordena por prioridade, depois esforço, coluna e posição. `cq_start` conta só os cards `in_progress`, então cards em Validação ou em Aguardando você não seguram o lote.
- **Como enfileirar:** espere todos os cards do lote anterior chegarem a Concluído (`npm run cards -- queue`). Só então rode `npm run cards -- enqueue --label=lote-NN` e depois `next --count=3`.
- **Dependências:** a primeira subtarefa de todo card com dependência confere que elas estão em Concluído; se não estiverem, `release`.
- **Labels:** todos os cards levam `api-v1` e `lote-NN`.
- **Pré-requisitos:** os cards 003, 006, 012, 013, 016, 020, 021, 023, 024 e 027 a 030 não dependem da API. Eles corrigem o app já e destravam as escritas depois.

## 18. Formato dos cards e importação

- BacklogCard v1 (`src/lib/backlogMarkdownParser.ts`):
  - `## Tópico: X`;
  - `### CARD API-0NN — Título`;
  - tabela Campo|Valor com ID, Prioridade, Esforço, Labels (separadas por vírgula) e Arquivos (em crases).
- O parser lê só a primeira linha de `**Problema:**` e de `**Contexto:**`, porque `CONTEXT_RE` para no primeiro fim de linha. Por isso:
  - Problema cabe numa linha;
  - Contexto também, no formato `Depende de: API-00X, API-00Y. Aceite: … Arquitetura: docs/api-arquitetura.md.`;
  - em `**Subtarefas Kanban:**`, cada item é um `- [ ]` de uma linha, sem bullets aninhados, porque uma linha que não começa com `-` encerra a lista;
  - o que só o usuário faz entra como subtarefa com o prefixo `Você:`.
- As dependências ficam no Contexto e na primeira subtarefa. O importador atual não grava `depends_on`; o API-033 corrige isso para backlogs futuros.
- Antes de importar, rodar `npm run import:cards -- docs/imports/backlog-api-v1.md --dry-run` e conferir, card a card, o número de subtarefas, a presença do Contexto e a ausência de avisos.
- O cabeçalho do arquivo explica os lotes e o enfileiramento por `lote-NN`.
## Apêndice A. Catálogo de permissões

27 subseções. O padrão de todas é Nenhum. A fonte canônica passa a ser `supabase/functions/_api/catalog.ts` (API-001), replicada em `private.api_scope_catalog`.

| Chave | Seção › Subseção | Nível máximo | Cobre | Observações |
| --- | --- | --- | --- | --- |
| `perfil.dados` | Perfil › Dados e preferências | Escrever | profiles, só a própria linha (display_name, language, theme, avatar_emoji, avatar_color, avatar_url, finance_dashboard_view, onboarding); get_my_profile em subconjunto seguro; bucket avatars (próprio). Ações perfil.dados.* | Nunca lê nem escreve role, is_active, last_login_date, invite_slots_remaining e ai_has_key; e-mail é só leitura. Remover a foto conta como Escrever. A RESTRICTIVE trava UPDATE e DELETE em id = auth.uid(), mesmo para admin. |
| `perfil.notificacoes` | Perfil › Notificações | Excluir | notifications: select; update só de read=true; delete. Ações perfil.notificacoes.listar, contar_nao_lidas, marcar_lida, marcar_todas_lidas e excluir | Linhas filtradas por tipo: loan_* exige financas.emprestimos:ler; workspace_invite, invite_accepted, invite_declined, member_joined e member_left exigem compartilhamento.pessoas:ler; backup_stale exige admin.backups:ler; api_token_* ficam aqui; tipo desconhecido fica oculto. Responder convite de workspace não é desta subseção. |
| `perfil.convites` | Perfil › Convites | Escrever | invite_codes com created_by = eu (mesmo para admin), saldo de convites e generate_invite_code (Escrever) | Escrever deixa um terceiro criar conta. Limite de 5 códigos por dia por token, inclusive para admin. |
| `documentos.paginas` | Documentos › Páginas | Excluir | pages: árvore pelo RLS (page_is_readable/page_is_writable), metadados, criar com as linhas de note_contents/drawing_contents, mover e reordenar. Excluir = exclusão com subárvore, via lixeira de 7 dias, e limpeza adiada de note-images | O SELECT em pages também é liberado para quem lê notas, desenhos ou tarefas. Páginas compartilhadas comigo só aparecem com incluir_compartilhados (exige compartilhamento.pessoas:ler); escrever nelas exige compartilhamento.pessoas:escrever. A exclusão pede confirm_subtree e aceita dry_run. |
| `documentos.notas` | Documentos › Conteúdo de notas | Escrever | note_contents (BlockNote validado; Markdown nos dois sentidos; versão), bucket note-images (envio e URL assinada de 1 h), blocos diagram e projectCard | Inserir bloco de card de projeto exige também projetos.cards:ler. Toda escrita leva expected_updated_at ou force explícito. Nota de outra pessoa volta marcada como conteúdo não confiável. |
| `documentos.desenhos` | Documentos › Desenhos | Escrever | drawing_contents: elementos Excalidraw, app_state e files sob demanda | Escrita validada, com limites de tamanho e incremento de version/versionNonce para o canvas aberto perceber a mudança. |
| `documentos.tarefas` | Documentos › Tarefas (listas) | Excluir | todos de páginas do tipo todo: listar por página e as minhas, criar, atualizar, concluir e excluir | Criar a página de tarefas é de documentos.paginas. A API nunca muda user_id nem page_id. |
| `documentos.notas_rapidas` | Documentos › Notas rápidas | Excluir | quick_notes: conteúdo, cor e linked_items por operação de item | Vincular página ou card exige leitura do alvo (documentos.paginas ou projetos.cards). Depende do API-003, que acaba com a sobrescrita offline. |
| `estudos.conteudo` | Estudos › Tópicos e roteiros | Excluir | study_topics e study_cards (título, descrição, prazos, checkpoints como texto, recursos, definição do quiz, blocks), RPCs study_* de conteúdo, importação em Markdown ou JSON, contrato do prompt, visão geral, estatísticas e planejamento | Excluir tópico apaga cards e diário em cascata (com lixeira). Os status planned e paused são daqui; studying e completed são de estudos.progresso. |
| `estudos.progresso` | Estudos › Progresso (checkpoints e quiz) | Escrever | study_checkpoint_toggle, study_quiz_answer e study_quiz_reset, status studying/completed do tópico | Separado para que uma IA que gera roteiros não consiga marcar o aprendizado como feito. |
| `estudos.diario` | Estudos › Diário | Excluir | study_logs: listar por tópico ou global, criar e excluir | Texto livre pessoal. |
| `projetos.quadros` | Projetos › Quadros e colunas | Excluir | project_boards, project_columns, create_project_board, reorder_project_columns, membros (sem e-mail, via api_profile_cards), estatísticas e cq_boards. Excluir = excluir quadro, excluir coluna (apaga os cards) e cq_setup_flow | Renomear coluna pode desligar o fluxo da fila, e a resposta avisa. Quadros compartilhados comigo só aparecem com incluir_compartilhados; escrever neles exige compartilhamento.pessoas:escrever. |
| `projetos.cards` | Projetos › Cards | Excluir | project_cards (todos os campos, itens, relações, responsável, página vinculada), reorder_project_cards, schedule_project_cards, bucket project-card-images, importação de backlog, agenda automática, exportação em Markdown, cq_cards e cq_card | Mover para a coluna de concluído num quadro com fluxo e marcar itens do usuário exigem também projetos.validacao, conferido no banco. |
| `projetos.fila` | Projetos › Fila de desenvolvimento | Escrever | project_card_queue; cq_list, cq_enqueue, cq_move, cq_remove (cancelamento), cq_reprioritize, cq_start, cq_next, cq_note, cq_check, cq_complete, cq_block e cq_release | É o que o /fila usa, junto com projetos.quadros:ler e projetos.cards:ler. Os tokens migrados recebem exatamente esse conjunto. cq_check não marca item owner='user' sem projetos.validacao. |
| `projetos.validacao` | Projetos › Validação (aprovar/reprovar) | Escrever | cq_validate; mover card para a coluna de concluído em quadro com fluxo; marcar ou desmarcar itens owner='user' da checklist | É o portão de aprovação humana, garantido no banco por gatilho. Deixe Nenhum em tokens de IA, a não ser que queira aprovar pelo chat. Os tokens migrados não recebem esta subseção. |
| `financas.transacoes` | Finanças › Transações | Excluir | finance_transactions: listar, histórico, criar, editar, excluir, excluir em lote, importação pré-processada com deduplicação e exportação CSV; bucket transaction-photos (comprovantes, por authorizeObject) | Também é exigida (Escrever) por ações da Loja que mexem em transação vinculada e por marcar_paga de recorrente. Linhas de workspace ou compartilhadas exigem compartilhamento.pessoas. Valores em centavos inteiros; idempotência obrigatória nas criações. |
| `financas.contas` | Finanças › Contas | Excluir | finance_accounts, com saldos calculados no servidor sem o teto de 1000 linhas | Excluir conta tira a conta das transações (dry_run mostra quantas). Contas do workspace exigem compartilhamento.pessoas. |
| `financas.categorias` | Finanças › Categorias | Excluir | finance_categories, com bootstrap das categorias padrão | Excluir categoria apaga os orçamentos de todos os membros do workspace, e a resposta avisa. |
| `financas.orcamentos_metas` | Finanças › Orçamentos e metas | Excluir | finance_budgets (com status do mês), finance_goals e finance_goal_contributions (aporte atômico com conclusão automática) | Compartilhar meta é de compartilhamento.pessoas. Orçamento de workspace exige compartilhamento.pessoas:escrever. |
| `financas.recorrentes` | Finanças › Recorrentes | Excluir | finance_recurring e finance_recurring_entries (a materialização é do servidor, por pg_cron), marcar paga e pular | marcar_paga cria transação e exige também financas.transacoes:escrever. |
| `financas.loja` | Finanças › Loja | Excluir | finance_store_products, finance_store_purchases, finance_store_sales, finance_store_sale_items, finance_store_customers, finance_suppliers, bucket store-files e RPCs store_* (vendas, compras, produtos) | Clientes e fornecedores são dados pessoais de terceiros. Criar, alterar ou apagar receita ou despesa vinculada exige financas.transacoes:escrever; workspace exige compartilhamento.pessoas. |
| `financas.emprestimos` | Finanças › Empréstimos | Excluir | finance_loan_borrowers, finance_loans, finance_loan_payments, finance_loan_collaterals, bucket loan-files, RPCs de escrituração do credor e saldo calculado | Ações entre as partes (solicitar, aprovar, rejeitar, informar, confirmar ou rejeitar pagamento) e vincular tomador exigem compartilhamento.pessoas:escrever. O documento do tomador sai mascarado. Hoje não há tela no repo (cards P3). |
| `compartilhamento.pessoas` | Compartilhamento › Pessoas e conteúdo compartilhado | Excluir | search_users_for_share, page_shares, project_shares, finance_goal_shares, shared_with_user_id/workspace_id em linhas financeiras, finance_workspaces, members e invites (obter, criar, renomear, convidar, aceitar, recusar, sair, remover membro), perfis de outras pessoas (com e-mail), vincular e desvincular tomador; ler (incluir_compartilhados) e escrever em conteúdo de outras pessoas | Transversal e sempre somada à subseção do item. Concede acesso de outra pessoa aos seus dados, devolve e-mails e abre conteúdo não confiável: mantenha Nenhum, salvo necessidade. A regra de propriedade vale no banco. co_owner de página só pela UI. Excluir = remover compartilhamento, sair do workspace e remover membro. |
| `admin.usuarios` | Administração › Usuários (só admin) | Ler | admin_list_profiles projetado (id, e-mail, nome, papel, ativo, criado_em, cotas, avatar), busca e paginação no servidor | Só para admin: token criado com AAL2, validade de até 30 dias e is_admin() conferido a cada chamada. Sem last_sign_in nem last_login_date. |
| `admin.convites` | Administração › Convites e cotas (só admin) | Ler | invite_codes de todos, com status calculado, e cotas dos usuários | Gerar, revogar, apagar e ajustar cotas ficam só na UI. |
| `admin.auditoria` | Administração › Auditoria (só admin) | Ler | audit_log paginado, com filtro por ação e data | Contém PII (e-mails e prefixos de IP): a UI mostra um aviso. |
| `admin.backups` | Administração › Backups (só admin) | Ler | site_backups e site_backup_settings: visão geral, lista e configurações | Criar, validar, restaurar, apagar e mudar o automático ficam só na UI, por retenção e por limite de CPU. |

## Apêndice B. Riscos em aberto

- Plano B do executor: se o postgres do Supabase não tiver ADMIN OPTION sobre authenticated, ou se o Supavisor não aceitar o login custom (o API-002 responde), a transação roda como authenticated. Nesse caso reset role deixa de ser barreira e a defesa contra SQL arbitrário fica no teste estático e no api_scope_allows fail-closed.
- Reautenticação recente depende do claim amr com horário no JWT do Supabase. Se o API-002 não o encontrar, criar token de escrita passa a exigir MFA (AAL2), o que muda a experiência de quem não usa MFA.
- O bearer não tem segundo fator nem re-login diário. As mitigações (AAL2 ou reautenticação para criar e ampliar, até 90 dias para escrita, avisos, revogação na troca de senha, auditoria, lixeira, teto diário de exclusão) reduzem o dano, mas um token de escrita vazado ainda altera dados até ser revogado ou expirar.
- Prompt injection: a regra de propriedade fecha a escrita em conteúdo alheio, mas sobra um canal. Escrever em recurso próprio que o usuário já compartilhou de propósito ainda pode exfiltrar dados, e o modelo pode seguir instruções de conteúdo marcado untrusted. Está documentado no modelo de ameaças (API-031).
- A regra de propriedade e o filtro de compartilhados mudam o que o /fila vê. Quadros de outra pessoa em que o usuário é só membro passam a exigir compartilhamento.pessoas no token.
- As RESTRICTIVE (API-022) e o api_require nas funções SECURITY DEFINER (API-007) podem quebrar leituras e RPCs que cruzam subseções, ou policies com subconsultas. Mitigação: harness, matriz E2E, nova execução da prova de Projetos e E2E do app antes da produção.
- O inventário de funções SECURITY DEFINER (84 ocorrências) precisa ser mantido. Toda função nova sem classificação quebra o CI de propósito, o que adiciona atrito nos cards futuros.
- A lixeira cobre só exclusões feitas pela API e por 7 dias. O desfazer reinsere como o usuário e pode conflitar com dados criados depois; exclusões feitas pelo app continuam sem desfazer.
- O MCP 2026-07-28 é recente e a adoção pelos clientes ainda está em andamento. O servidor próprio é testado nas duas eras, e o plano B é o SDK oficial v2.
- Com mais de 150 ferramentas, os nomes MCP precisam caber em 48 caracteres e clientes sem busca de ferramentas podem degradar. Mitigação: tools/list filtrado por escopo e ?secoes= no MCP e na OpenAPI.
- Latência: cada chamada faz várias idas ao banco a partir da edge mais próxima de quem chama. api_rt.authorize junta resolução e limites, e a documentação recomenda x-region.
- Limites da edge (2 s de CPU, 256 MB): validação de BlockNote e Excalidraw em documentos grandes e relatórios financeiros precisam respeitar os tetos de tamanho, senão dão 504 ou 546.
- Tabelas de Finanças e de Estudos não estão no realtime, então escritas pela API só aparecem na tela depois de recarregar. Formulários abertos da Loja e de Finanças ainda gravam a linha inteira, e o último a gravar vence.
- Os cards de lógica no servidor (003, 006, 012, 013, 016, 018, 021, 024, 028, 029, 037) mudam o comportamento do app. Eles exigem levantamento só leitura antes dos CHECKs e validação no staging, e há decisões pendentes: parcelas puladas, despesas ao excluir produto, dados fora da forma, formato de photo_url.
- Ordem da fila: cq_insert_queued ignora a ordem da lista e cq_start conta só in_progress. Se alguém enfileirar vários lotes de uma vez, ou enfileirar o próximo com cards em Aguardando você, dependências podem rodar antes. Mitigação: enfileirar só por label lote-NN e a primeira subtarefa de cada card confere as dependências.
- O parser de backlog guarda só a primeira linha do Problema e do Contexto e encerra a checklist em bullet aninhado. O renderizador do .md precisa seguir docs/api-arquitetura.md §18, e o dry-run do import:cards deve ser conferido card a card antes de importar.
- O manifesto de cobertura (API-008) depende da lista de 357 operações da avaliação, versionada em `docs/api-inventario.json`.
- Tokens migrados perdem projetos.validacao e o setup-flow: npm run cards -- validate passa a dar 403 até o usuário ativar Validação no token.
- Diferenças de ambiente: rel001_backup_stale_alert pode não estar em produção (backup_stale), o branch atual (ux/landing-publica) não tem as policies de admin com is_admin(), e não foi verificado se as edge functions de IA removidas no SEC-015 ainda estão publicadas no painel. Todo card deve partir de infra/staging-baseline.
- Cronograma longo: são 22 lotes, e os 11 primeiros (fundação e pré-requisitos) precisam ser concluídos antes de qualquer domínio chegar à produção. Os pré-requisitos já corrigem bugs do app nesse período, mas o valor visível da API para o usuário só aparece a partir do lote 12.
- Empréstimos não têm tela no repo e src/lib/loanCalc.ts não existe. A regra de saldo precisa ser confirmada pelo usuário (cards P3).
- A identificação por ID externo ('ABC-123 — Título') não é única e resolve para o card mais antigo. Importações repetidas sem deduplicação poderiam mirar o card errado; o API-055 deduplica.
