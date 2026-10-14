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
- O API-006 (`20261005150000_api006_guards_without_user`, 05/10/2026) corrigiu `finance_guard_workspace`, que recusava com 42501 todo INSERT de linha de workspace sem usuário: nenhum backup com linha de workspace restaurava. A condição exata, que vale para gatilho novo: `auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon')` → `return new`. Prova: `supabase/checks/api006-restore.sql` (bloco 2 falha antes da migration e conclui depois, no staging).
- O API-013 (`project_cards_integrity`) segue a regra e mostra a exceção: o que é padrão da linha, e não validação, vale também sem usuário. O card sem `sort_order` vai para o fim da coluna, e o `updated_at` é a versão do conteúdo (mover não muda). Só as validações pulam. Prova: `supabase/checks/api013-project-cards.sql` (bloco 2, restore no staging).
- O API-016 (`api016_finance_recurring_server`) segue a regra:
  - o gatilho `finance_recurring_entries_guard` pula sem usuário, então o restore e o cron `finance-recurring-materialize` (00:05 de São Paulo, `private.finance_materialize_all()`) passam;
  - o `finance_recurring_day_moved` é padrão da linha e vale também sem usuário;
  - prova: `supabase/checks/api016-recurring.sql`. O bloco 2, só no staging, restaura uma fixture com lançamento pré-ocupado, dois lançamentos no mesmo mês e um pago sem transação, e roda a materialização global de verdade.
- O API-021 (`api021_study_rules`) segue a mesma regra em Estudos:
  - sem usuário, o gatilho `study_cards_rules` só trata a posição (max + 1 entre os cards do mesmo dono no tópico) e a versão, guarda os valores que vieram e completa os nulos (`'[]'` nas colunas jsonb, `''` no `rationale`);
  - isso conserta o restore de backup anterior a `quiz` (20260721120000) ou a `blocks` (20260830150627), que falhava com 23502, porque o `jsonb_populate_recordset` põe NULL na chave ausente;
  - `study_topics_rules` guarda as datas do backup;
  - sem usuário, um UPDATE que mude só o `updated_at` (cards e tópicos) guarda o valor que veio. É o conserto à mão de versão no futuro: `update public.study_cards set updated_at = least(updated_at, now()) where updated_at > now();`, e o mesmo em `study_topics`. Com usuário, ou com qualquer outra coluna mudando (inclusive `sort_order`), a versão continua do servidor. Prova: `supabase/checks/api021-study.sql`, bloco 1;
  - as CHECK `study_cards_resources_safe` (url http(s), `private.card_links_are_safe`) e `study_cards_json_arrays` valem também sem usuário;
  - prova: `supabase/checks/api021-study.sql` (bloco 2, restore no staging com backup sem a chave `blocks`).
- O API-028 (`api028_store_sales_server`) segue a regra na Loja:
  - os gatilhos `private.store_sale_rules` e `private.store_sale_item_rules` pulam sem usuário: o restore guarda vendas e itens como vieram (status, datas, receita, item acima do estoque), e o `updated_at` só é carimbado em UPDATE, então o INSERT do restore mantém o do backup;
  - com usuário, validam só o que mudou:
    - as regras "sempre" (`sold_on` obrigatório na venda consumida, até amanhã em São Paulo, negociação sem data) só disparam quando status ou `sold_on` mudam;
    - as da data de entrega (só na entregue, até amanhã, não antes da venda) só disparam quando status ou `delivered_on` mudam. A de não ser antes da venda dispara também quando o `sold_on` muda;
    - as cascatas de SET NULL disparam os gatilhos com o `auth.uid()` de quem apagou e não podem travar numa venda antiga fora da regra;
    - o UPDATE de `workspace_id` do card "Sair do workspace leva as linhas da Loja" passa numa ordem: primeiro as vendas de quem sai, depois só os itens dele nelas (`where user_id = quem sai`). Com o `auth.uid()` de quem sai, o ws_guard recusa realocar a linha de outra pessoa (42501);
    - o item de outra pessoa na venda de quem sai fica com o workspace antigo, mas segue a venda: só quem a vê o lê, altera e apaga, e o autor dele ainda o lê;
    - o item de quem sai que está na venda de outra pessoa fica no workspace da venda (o gatilho do item recusa tirá-lo, 22023), e quem vê a venda continua vendo o item;
  - os CHECKs de dinheiro >= 0 valem também sem usuário: um backup com valor negativo deixa de restaurar;
  - prova: `supabase/checks/api028-store-sales.sql` (bloco 1, seções 10 e 11; bloco 2, restore no staging com uma venda antiga fora da regra).

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
- Estudos (API-024): remover ponto (`study_checkpoint_remove`) ou recurso (`study_resource_remove`) é UPDATE em `study_cards`, não DELETE. Por isso nem a regra "DELETE exige Excluir" nem a lixeira do API-025 (AFTER DELETE) alcançam a remoção de item, e desfazer pela API é regravar o item.

  O API-022/034 precisa de regra própria de Excluir. A RPC INVOKER não pode chamar `private.api_require`, porque a API nunca tem USAGE de `private` (§2.1). Há duas opções:
  - exigir `estudos.conteudo:delete` no handler da ação que remove item;
  - criar um gatilho DEFINER, ativo só em sessão da API, que detecte a lista encolhendo.

  Remover item ausente dá P0002, o 404 da §4. O app (API-029) trata como já removido em outra aba.

  Nas RPCs do tópico (`study_cards_append`, `study_reschedule`), o P0002 é o tópico excluído (em outra aba ou pela API): o app o tira da tela com cards e diário, e o tópico aberto vira o aviso "excluído em outra aba". O P0001 do `study_reschedule` (tópico sem data-alvo) faz o app reler o tópico e explicar que falta a meta. O app também marca esses ids como removidos no registro de escritas, como na exclusão feita por ele mesmo. Assim, o refetch que leu antes da exclusão não traz de volta o tópico, os cards nem o diário, nem os cards e o diário desse tópico que o app ainda não tinha visto. O card que some numa releitura (P0002 de um item, ou a gravação de campo sem linha) segue a mesma regra.

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
- Do lote 04 (API-016 e API-021), entram no inventário:
  - `public.finance_materialize_recurring(p_today, p_month)`, que só materializa os recorrentes de quem chama (`p_month`, o mês visto na tela, cria só os orçamentos automáticos desse mês, a até 12 meses do atual, e nunca lançamento);
  - o gatilho `private.study_card_rules`, que é DEFINER porque chama as funções de forma em `private` e lê o tópico de qualquer dono, para a mensagem não revelar se ele existe.

  - os gatilhos `private.finance_recurring_entry_guard`, BEFORE INSERT/UPDATE em `finance_recurring_entries`, classificado como predicado puro (lê recorrente e transação de qualquer dono para a recusa genérica e só levanta erro);
  - `private.finance_recurring_day_moved`, AFTER UPDATE OF `day_of_month` em `finance_recurring`, classificado como cascata de padrão da linha (grava `due_date`, que está fora do grant de coluna, só nos lançamentos do recorrente que quem chama pôde alterar);
  - `private.study_log_rules`, predicado puro (dono do tópico, lido por cima do RLS para que um token só com `estudos.diario` grave no próprio tópico).

  Ficam de fora, por serem INVOKER: `finance_mark_entry_paid`, `finance_skip_entry` e `private.study_topic_rules`. Gatilho DEFINER entra no inventário mesmo sem EXECUTE para clientes, porque dispara nas gravações de `authenticated`. As funções de forma e o núcleo dos recorrentes (`private.finance_materialize_core`, `finance_materialize_all` e `finance_clamp_today`) não têm EXECUTE para clientes e não disparam sozinhos.
- Do lote 05 (API-024), ficam fora do inventário, por serem INVOKER e não chamarem nada de `private`, as 11 RPCs de Estudos:
  - `study_checkpoint_add`, `study_checkpoint_edit`, `study_checkpoint_toggle` e `study_checkpoint_remove`;
  - `study_resource_add` e `study_resource_remove`;
  - `study_quiz_answer` e `study_quiz_reset`;
  - `study_cards_append`, `study_import_topic` e `study_reschedule`.

  O card não cria gatilho nem função em `private`: a trava do quiz ficou só na RPC, por decisão do usuário. A forma dos JSON continua no gatilho DEFINER `private.study_card_rules`, que já está no inventário. Como são INVOKER, as RESTRICTIVE do API-022 valem dentro delas. Anexar, importar e reagendar exigem ler e atualizar `study_topics`. Toggle, resposta e reset só tocam `study_cards` (prova no bloco 2 de `supabase/checks/api024-study-rpcs.sql`).

  Datas do API-024: o `p_today` de `study_reschedule` e de `study_import_topic` é conferido por comparação (`not between` o hoje de São Paulo ± 1), então `'infinity'` e `'-infinity'` dão 22023 com hint akool, nunca o 22008 sem hint da subtração de datas infinitas. A data-alvo infinita, gravada pelo UPDATE direto de `study_topics`, também dá 22023 no reagendar. Na importação, a `target_date` do payload só aceita AAAA-MM-DD.

  O app (API-029) manda `p_today` só no reagendar e na importação com data-alvo: sem meta ele não serve, e o servidor o conferiria à toa. O aparelho não tem como saber que o próprio relógio está errado, porque o dia de São Paulo que ele calcula sai do mesmo relógio. Então, quando o servidor recusa o dia (22023 "Data de hoje …", hint akool), o app refaz a chamada uma vez sem `p_today`, e vale o hoje de São Paulo do servidor. Um cliente da API v1 pode fazer o mesmo.
- Do lote 06 (API-028), entram no inventário os dois gatilhos DEFINER da Loja, como predicado puro com trava:
  - `private.store_sale_rules` (BEFORE INSERT/UPDATE em `finance_store_sales`): lê cliente, conta, transação, itens e produtos de qualquer dono com o predicado explícito do RLS (`private.store_visible`: dono ou membro do workspace) e o escopo do dono da venda (`private.store_ref_ok`), para a recusa genérica (P0002) e para o estoque global ao reabrir; grava só os carimbos de data da própria linha;
  - `private.store_sale_item_rules` (BEFORE INSERT/UPDATE em `finance_store_sale_items`): trava venda e produto com o mesmo predicado e confere o estoque global (`private.store_product_available`, todas as linhas do produto); grava só `workspace_id` e `product_name` da própria linha; no UPDATE, lê o `workspace_id` da venda e se o workspace antigo ainda existe, para manter o item no workspace da venda.

  São DEFINER porque o estoque é global: um INVOKER só somaria as linhas visíveis, e B (membro) que vende o produto do workspace numa venda privada deixaria a mesma unidade "disponível" para A. Os ajudantes `private.store_visible`, `private.store_ref_ok` e `private.store_product_available` são INVOKER, sem EXECUTE para clientes, e só rodam dentro dos gatilhos.
- Ficam fora do inventário, por serem INVOKER e não chamarem nada de `private`, as 9 funções da Loja: `store_product_figures` e as RPCs `store_sale_create`, `store_sale_set_status`, `store_sale_update`, `store_sale_items_add`, `store_sale_items_update`, `store_sale_items_remove`, `store_sale_generate_income` e `store_sale_delete`. O `sec012-grants.sql` continua com 40. O líquido das RPCs soma todos os itens da venda sem DEFINER novo:
  - o item segue a venda: as policies de `finance_store_sale_items` deixam ler o item a quem é dono dele ou vê a venda, e alterá-lo e apagá-lo só a quem vê a venda (`docs/matriz-rls.md`);
  - as RPCs só chegam aos itens depois de travar a venda com o RLS de quem chama.

  Como são INVOKER, as RESTRICTIVE do API-022 valem dentro delas: lançar a receita exige ler e escrever `finance_transactions` e ler `finance_accounts` e `finance_categories`; cancelar, reabrir e excluir apagam a receita (Apêndice B).

  Datas do API-028: o `p_today` de `store_sale_set_status` é conferido por comparação, a até 1 dia do hoje de São Paulo (fora, inclusive ±infinity, dá 22023 com hint akool). `sold_on` futuro (depois de amanhã em São Paulo) ou infinito é recusado pelo gatilho com 22023. `delivered_on` fora da entregue, infinito, depois de amanhã em São Paulo ou antes do `sold_on` também é recusado pelo gatilho com 22023.
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
    blocknote/ study/ fixtures/ i18n.pt-BR.ts pageTree.ts projectTypes.ts isoDate.ts cardLimits.ts cardLabels.ts cardLinks.ts text.ts
    autoSchedule.ts backlogMarkdownParser.ts importPlan.ts cardMarkdown.ts projectStats.ts financeCalc.ts money.ts financeCsv.ts
    statementImport.ts financeGraph.ts financePhase.ts unifiedCards.ts financeStoreCalc.ts saleTransitions.ts storeTypes.ts loanCalc.ts docsGraph.ts excalidraw.ts
```

**`_domain/blocknote/` (API-020):** validador e normalizador das notas (BlockNote 0.50), puros, sem `@blocknote/core`.

- **`spec.ts`:**
  - `BLOCKNOTE_VERSION`;
  - os 16 tipos de bloco com o `propSchema` de cada um;
  - os 7 estilos, `text`/`link` e os padrões de `tableCell`;
  - `LIMITS`: 2 MiB sobre o JSON compacto da forma canônica (a que é gravada), 5000 blocos, profundidade 10 com a raiz contando 1. O validador mede a entrada, e o `normalize` mede de novo a saída, que ganha id, props e children em cada bloco e props em cada célula;
  - `HARD_MAX_DEPTH` (64) e `TABLE_LIMITS`:
    - fatais: span de 1 a 50, 100 colunas e 10 mil células;
    - de contrato: 2.500 células por tabela e, para a nota inteira, Σ células² até 2 × 2.500² (`noteCellCost`). A montagem da tabela no BlockNote é quadrática: 100x100 leva cerca de 11 s, e sem o teto da nota caberiam 260 tabelas 25x100 em 2 MiB;
  - `MAX_INLINE_NODES` (30 mil):
    - o BlockNote empilha os nós de um item em linha num só `push(...nós)`, e cada \n fora do bloco de código vira um hardBreak;
    - com uns 110 mil nós o V8 estoura a pilha no `create`, e 30 mil deixa folga para o Safari;
    - acima disso por item é fatal (o link soma as partes);
    - a soma da lista inteira acima disso é contrato, porque o editor junta os trechos vizinhos ao ler de volta;
  - `isAllowedHref`, porte do `isAllowedUri`.
- **`schema.ts`:**
  - `validateNoteContent(value, { form: 'partial' | 'full', stored, fatalOnly, reservedIds, bytes })` devolve `BlockIssue { path, keyword, message, fatal }` em JSON Pointer, no máximo 20 e com os fatais primeiro;
  - as partes planas (props de cada tipo e de `tableCell`) usam o `compileSchema` do `_api/schema.ts`;
  - `findFatalNoteIssue` é a guarda do NoteEditor;
  - `toSchemaIssues` é o que vai para o `validationFailed`.
- **`table.ts`:** emula a grade de ocupação das tabelas, como o BlockNote faz.
- **`projectCard.ts`:**
  - `ProjectCardSnapshot`, que o `src/lib/projectImport.ts` importa daqui;
  - `snapshotIssues`;
  - `newProjectCardIds(before, after)`.
- **`diagram.ts`:**
  - lista branca dos elementos que o app cria;
  - `appState` com 4 chaves e `zoom.value` em (0, 30];
  - delega ao `_domain/excalidraw.ts` quando o API-054 existir.
- **`normalize.ts`:** `normalizeNoteContent(value, { newId, renameDuplicateIds, reservedIds })` leva à forma canônica do editor, que é ponto fixo do BlockNote, e é idempotente. Também recusa quando só a saída estoura os limites:
  - `maxBytes` (não fatal) quando a forma canônica passa de 2 MiB. Uma estimativa corrente para antes de montar dezenas de MB, e a medida exata fica para o fim;
  - `maxCells` quando os tetos de células estouram com a largura completa.

  Garantia: normalize ok ⇒ a saída passa em `form: 'full'`, e normalizá-la de novo não muda nada. Card de projeto sem snapshot é contrato (`required` em `/n/props/snapshot`); senão o normalize gravaria o padrão `{}`, que o contrato do snapshot recusa.
- **`blocknote.test.ts`** (vitest, `node:fs`) e **`fixtures/`:** só fixtures sintéticas, geradas uma vez pelo próprio BlockNote, nas pastas `valid/`, `partial/` e `fatal/`.
- **O teste com o editor de verdade** fica em `src/components/noteSchema.test.ts`, com `import.meta.glob` e sem `node:fs`. Ele cobre:
  - paridade do spec com o schema;
  - `create`, `mount`, render do card e PDF de cada fixture;
  - mutação com semente fixa.
- **Fatal × contrato:**
  - **Fatal** é o que:
    - faz o `create` lançar;
    - quebra o render no navegador (inclusive os blocos React);
    - quebra o PDF;
    - ou corrompe outro bloco.
  - Exemplos de fatal:
    - tipo, estilo ou item em linha desconhecido;
    - content incompatível;
    - id que não é texto, vazio ou repetido;
    - `href` que não é texto;
    - `heading.level` fora de 1..6;
    - valor de prop ou de estilo que não é simples, e `props.id`;
    - tipos dos campos do snapshot que o bloco desenha;
    - tabela fora da grade ou dos tetos;
    - mais de 64 níveis;
    - item em linha que vira mais de 30 mil nós no editor (quebras de linha; o link soma as partes; vale também para célula em texto e para o content em texto da `tableCell`);
    - tabela cuja grade não fecha na forma completa: uma célula com props e sem content passa a contar o colspan no `editor.document`.
  - O resto é **contrato**: a API recusa, mas o conteúdo gravado continua abrindo no app.
- **Dependência `_domain → _api`:** `_domain` só pode importar `_api/schema.ts`, que é folha. O `_api/importBoundary.test.ts` confere três coisas:
  - todo import direto de um arquivo de `_domain` (fora dos testes) que cai em `_api` é exatamente `_api/schema.ts`;
  - o fecho do que `_domain` importa não alcança nenhum outro arquivo de `_api`. O fecho é seguido por `_shared`, pelas pastas das functions e por `import type`/`export … from`, e para no `schema.ts`; `domainClosureProblems` mostra a cadeia, por exemplo `_domain/… → _shared/ponte.ts → _api/registry.ts`;
  - o `schema.ts` não importa nada.

  O `blocknote.test.ts` repete a conferência da folha.
- **Subir o BlockNote:** o `package.json` aceita 0.50.x. Mudar a versão instalada, ou um bloco do `src/components/noteSchema.ts`, exige no mesmo PR atualizar o `spec.ts` (os dois testes falham até isso) e republicar a function `api`.

**`_domain/blocknote/`, Markdown (API-023):** Markdown ↔ blocos sem DOM, para o API-044. O conversor oficial do BlockNote precisa de DOM e perde informação, e o marked e o micromark são quadráticos com entrada adversária. Por isso o parser é próprio e linear.

- **`markdown.ts`:**
  - `markdownToNote(md, { existing, images: { userId, pageId }, mode: 'replace' | 'append', reservedIds, newId, limits })` devolve `{ ok: true, blocks, warnings, newImagePaths, losses }` ou `{ ok: false, issues, warnings }`. Nunca lança.
    - `existing` é o `content` atual, que pode ser `null`.
    - Em `append`, `blocks` traz só os blocos a anexar, com ids fora da nota e de `reservedIds`.
  - Cada issue leva `line` (0 quando o problema é da nota inteira) e o ponteiro na nota final, quando há.
  - `toMarkdownSchemaIssues(issues, '/markdown')` monta o `details` do `validation_failed` (§10).
  - O parser de blocos é um porte do commonmark.js: pilha de contêineres e uma passada por linha. O parser em linha fica em `markdownInline.ts`.
  - Os cortes de espaço e tab são por laço de índice, em `spaceTab.ts`: `trimEndSpaceTab`, `trimSpaceTab` e `stripClosingHashes`, este para o fecho do título ATX. Não há regex ancorada só no fim: `/[ \t]+$/` é quadrática numa corrida de espaços no meio do texto. Também não há `trim()` do JS, que tira NBSP. O autolink literal memoriza o fim da corrida sem espaço, o domínio com os dois últimos segmentos e o começo da pontuação final. Assim, o gatilho recusado custa O(1) amortizado, e os parênteses finais são contados uma vez.
- **Subconjunto (CommonMark 0.31 + GFM):**
  - títulos ATX e setext;
  - parágrafo: a quebra suave vira espaço, com um aviso por chamada; a quebra dura (dois espaços, `\` ou `<br>`) vira `\n`;
  - listas `-`/`+`/`*`/`N.`/`N)` aninhadas até a profundidade do contrato. O `start` sai quando o 1º número não é 1 ou quando a lista vem logo depois de outra numerada, inclusive com `start: 1`;
  - checklist, inclusive numerada e vazia;
  - citação preguiçosa, achatada em linhas, com aviso quando tinha lista, código, título ou tabela;
  - código cercado ou indentado, com a 1ª palavra da info como linguagem;
  - tabela GFM, com alinhamento nas células, `\|` (inclusive dentro do código) e `<br>`;
  - divisor;
  - imagem;
  - definições de referência;
  - em linha: negrito, itálico, tachado (`~~` e `~`), código, links inline e de referência, autolinks `<…>` e literais do GFM (URL, `www.`, e-mail), escapes e entidades numéricas e nomeadas comuns, inclusive as letras acentuadas.
  - O escape bloqueia o autolink literal: `https\://` fica texto.
  - HTML em linha some e o texto fica, com aviso. Comentário some. Nota de rodapé fica como texto, com aviso.
  - Linha em branco é só espaço e tab, como no CommonMark e no micromark. NBSP, U+3000, U+2003, `\f` e `\v` são conteúdo: o item só com eles interrompe o parágrafo do pai, é linha de tabela e fica no fim do código indentado.
- **Limites da leitura:**
  - 512 KiB de Markdown em bytes UTF-8 (`MARKDOWN_LIMITS.maxBytes`, decisão 3). Acima disso, `maxBytes` com a linha em que o limite estoura.
  - A leitura para cedo, com a linha, quando há:
    - lista além da profundidade do contrato;
    - citação além de 32 níveis;
    - mais de 5000 blocos;
    - tabela com mais de 100 colunas ou de 10 mil células.
  - Os demais limites (2 MiB, nós em linha e células) vêm do normalize, com a linha do bloco.
  - Markdown denso de 512 KiB pode passar dos 2 MiB da forma canônica: tabelas e listas crescem até 4× no JSON gravado.
- **Imagem:**
  - Só é aceito o caminho `${userId}/${pageId}/arquivo.(jpe?g|png|webp|gif|heic|heif)` de quem grava.
  - Também vale a url exata que já está na nota. A 1ª ocorrência herda o id; todas herdam largura, prévia, alinhamento e cor; nome e legenda vêm do Markdown.
  - Externa, `data:` ou outra pasta é recusada com a linha. Sem `images`, só passa imagem conhecida.
  - `newImagePaths` lista os caminhos novos, para o handler conferir que o objeto existe (`authorizeObject`, §2.6).
  - Imagem no meio do texto divide o parágrafo. No item de lista vira filha do item, no título e na citação vem logo depois, e na célula fica o texto alternativo (com aviso).
- **Marcador (blocos sem Markdown, decisão 2):**
  - diagram, projectCard, file, video e audio saem como `<!-- akool:bloco id="<encodeURIComponent(id)>" tipo="<tipo>" -->`, numa linha só.
    - Arquivo, vídeo e áudio levam também `nome="…"`. O card leva `titulo="…"` só com `cards: 'label'`, que exige `projetos.cards:read`.
  - A leitura restaura o bloco da nota atual com `children: []`. Os filhos vêm do Markdown, sem duplicar.
  - É erro com a linha:
    - id desconhecido ou repetido;
    - id de bloco que tem Markdown;
    - tipo errado;
    - marcador malformado;
    - marcador dentro de citação ou no meio do texto;
    - qualquer marcador no modo `append`.
  - Texto do usuário não forja marcador: o render escapa `<`, e o código cercado é literal.
  - Nota com ids repetidos: `withUniqueIds` dá ao repetido um id determinístico (`<id>-<n>`), o mesmo na leitura e na escrita.
- **Reconciliação (`reconcile.ts`, decisão 1, só em `replace`):**
  - Cada bloco raiz da nota atual tem a sua projeção: os blocos que o render dele vira ao ser lido de volta.
  - Um diff "patience" (prefixo e sufixo comuns, âncoras únicas e extensão) compara essas projeções com os blocos do Markdown novo. É linear, fora o log. A chave é o bloco lido, então formas equivalentes (`*a*` e `_a_`) batem.
  - Projeção igual e seguida: o bloco volta intacto, com id, cores, alinhamento, recolhível, filhos e larguras.
  - Só a cabeça igual: o bloco volta com `children: []`.
  - Bloco sem projeção só volta se passa sozinho no fatal (`keepIfHidden`, como o parágrafo vazio), e só entre dois vizinhos intactos e seguidos. O ilegível que a IA não vê no Markdown (null, tipo desconhecido, tabela sem linhas) sai, com a perda `unreadable`, e não trava a regravação.
  - O resto entra como bloco novo.
  - `losses` lista as perdas do render dos blocos antigos que não voltaram intactos (editados ou removidos), menos as props que voltaram pelo marcador ou pela imagem conhecida.
  - Tetos da reconciliação (`RECONCILE_LIMITS`, `markdown.ts`): o `plan` relê o render inteiro da nota atual. Essa leitura custa de 1 a 1,5 µs por linha e por célula de tabela, e cerca de 60 ns por linha × nível de lista. A regravação segue sem reconciliar quando o render passa de 4 × 512 KiB, de 2^18 linhas mais `|`, ou de 2^22 linhas × níveis (a profundidade vem do mapa do render). Nesse caso todo bloco entra como novo e as perdas do render vão inteiras. O resultado é o mesmo; só os ids e as props dos blocos que não mudaram deixam de voltar. No pior caso abaixo dos tetos, a releitura leva de 0,3 a 0,4 s (Apple M2). Uma nota válida (até 10 níveis) só passa do teto de linhas × níveis depois de passar do teto de linhas. Sem os tetos, uma nota gravada pequena levava de 2 a 34 s para regravar.
- **Validação em duas fases:**
  1. `normalizeNoteContent` só nos blocos novos, com os ids herdados reservados e `skipNoteCellCost: true`. Essa opção tira o teto de células da nota inteira (Σ células²) do validador e da forma completa e deixa só o de cada tabela. A tabela editada conta como nova, e o teto da nota é conferido na fase 2 contra o custo da nota atual. Assim, numa nota antiga acima do teto, editar uma célula em cada uma de três tabelas 50×50, ou encolher as três, passa. Por padrão a opção fica desligada, e o caminho JSON e o editor seguem iguais. Herdado aninhado em bloco novo entra no lugar de um bloco provisório.
  2. Os herdados entram como estão, e a nota final (ou a juntada, em `append`) passa por `validateNoteContent({ stored: true, fatalOnly: true })` e por `noteLimitIssues`. O `noteLimitIssues` (`schema.ts`) confere ids únicos, blocos, profundidade e bytes. Confere também o teto de células da nota inteira, Σ (linhas × largura)², contra a base `baseline`, que é a nota atual. O `maxCells` só sai quando a nota juntada passa do teto e custa mais que a base, então a nota antiga já acima do teto pode ser regravada sem somar tabela. `noteTableCost(nota)` dá a base já calculada para o anexar do API-044.

  O mesmo par serve ao anexar do API-044. Nota antiga com desvio de contrato não trava a regravação.
- **`render.ts`:**
  - `blocksToMarkdown(blocks, { markers, cards })` devolve `{ markdown, losses, blocks: [{ id, path, startLine, endLine }] }`.
  - `blocksToText(blocks, { cards })`: um bloco por linha, com prefixos, filhos recuados, tabela em `a | b` e os rótulos `note_text_*` do `_domain/i18n.pt-BR.ts`.
  - Os dois aceitam `content` nulo e nunca lançam, como o `extractBlocks` do PDF.
  - `markers: false` troca o marcador pelo rótulo do texto puro (só leitura).
  - **Estilo:**
    - `**negrito**`, `_itálico_` e `~~tachado~~`, um caractere por estilo, para um abridor nunca fechar o estilo de fora;
    - código em linha com crases a mais, partido em cada quebra;
    - quebra dura com `\` no fim da linha, e `<br>` no fim do bloco, em título e em célula;
    - `<!-- -->` antes de lista numerada que recomeça;
    - cerca do código maior que as crases de dentro.
  - **Escapes:**
    - `\` antes da pontuação que vira sintaxe;
    - no começo de cada linha, também depois de cada quebra dura: `#`, `-`, `+`, `=`, `:` e `N.`/`N)`;
    - espaço e tab nas bordas da linha como `&#32;`/`&#9;`;
    - `\r` sempre como `&#13;`, e o BOM no começo da linha como `&#65279;`: a saída nunca tem `\r`, e as linhas do mapa são as que o parser lê;
    - `:` de `https://`, `.` de `www.` e `@` de e-mail;
    - `&` antes do que pareceria entidade.
  - Espaço na borda de um trecho com estilo fica fora dos delimitadores. Quando o flanqueamento falharia, o caractere vizinho sai como entidade (`**a.**&#98;`).
  - Tabela acima dos tetos fatais (`TABLE_LIMITS`: 100 colunas ou 10 mil células, com a largura sem corte) sai ilegível, sem montar a grade. A linha que não é objeto com `cells` e a célula que não cabe na grade ficam de fora, com a perda.
  - Teto de saída `RENDER_BUDGET`: 16 × 512 KiB, em unidades UTF-16 (com as quebras de linha). Ele protege a memória da leitura e vale dentro do bloco. A linha que passaria do teto tira inteiro o bloco que está sendo escrito (as linhas, o mapa e as perdas dele), e esse bloco e os seguintes saem com a perda `truncated`. A saída nunca passa do teto. O recuo das listas conta: cada linha de um item fundo leva até ~100 colunas no contrato (10 níveis de `999999999. `), ou ~700 na profundidade gravada (64 níveis). Uma quebra de 2 bytes no JSON vira uma linha inteira. Por isso o teto pode cortar nota válida com listas fundas e muitas linhas curtas: 296 KiB de JSON com 6 itens de 25 mil quebras no 10º nível perdem os itens 3 a 6 e o parágrafo do fim. A nota válida rasa de 2 MiB fica bem abaixo.
  - `withUniqueIds` é linear: guarda o próximo `n` de cada base, e os ids são os mesmos de antes.
- **Perdas (`MARKDOWN_LOSSES`, com o ponteiro):**
  - cor do texto ou de fundo;
  - sublinhado;
  - alinhamento;
  - larguras das colunas;
  - células mescladas;
  - `headerRows` ≠ 1 e `headerCols`;
  - recolhível;
  - filho de bloco que não é lista (vira bloco seguinte);
  - parágrafo vazio do meio (o do fim é do TrailingNode e não conta);
  - estilo ou link no bloco de código;
  - linguagem vazia ou com espaço;
  - linha só de espaços no código dentro de item;
  - `\r` no bloco de código (`codeLineEnding`), que vira `\n`;
  - link inseguro ou sem destino;
  - `start` que o Markdown não representa;
  - largura, prévia ou quebra de linha no nome, na legenda ou no endereço da imagem;
  - código em linha sem forma (com `\r`, com `\` antes de `|` na célula, ou com `]:` no 1º link do parágrafo), que sai como texto;
  - bloco ilegível, linha de tabela que não é objeto com `cells`, célula que não cabe na grade e tabela acima dos tetos (`unreadable`);
  - bloco cortado pelo teto de saída do render, e os que vêm depois dele (`truncated`). A nota pode estar dentro do contrato;
  - bloco sem Markdown com `markers: false`.
- **Divergências da colagem do app (`tryParseMarkdownToBlocks`), de propósito:**
  - `<br>` vira quebra;
  - o alinhamento da tabela fica;
  - checklist numerada e checklist vazio;
  - a imagem no meio do texto fica;
  - o título da imagem vira legenda;
  - `start: 1` em lista logo depois de outra;
  - título dentro de item vira filho;
  - o escape bloqueia o autolink;
  - o destino do link não é codificado;
  - não há bloco HTML nem nota de rodapé;
  - as entidades nomeadas raras ficam literais.

  A lista completa, com o motivo de cada caso, está em `DIVERGENCIAS` (src/components/noteMarkdown.test.ts).
- **Testes:**
  - `markdown.test.ts`:
    - subconjunto bloco a bloco;
    - imagens, marcadores e limites com a linha;
    - reconciliação;
    - render;
    - propriedades com semente fixa:
      - (a) subconjunto sem perdas com alfabeto hostil, em ida e volta exata. O alfabeto inclui NBSP, U+3000, U+2003, `\f`, `\v`, `\r`, `\r\n` e o BOM no começo do documento;
      - (b) idempotência;
      - (c) leitura que nunca lança;
    - bateria patológica a 512 KiB (Apêndice B);
    - revisão do lote 05 (`render-023`): `\r` e BOM, linha em branco, tetos da tabela, ids e reconciliação. Tem teto de tempo para 20 mil blocos sem id ou com o mesmo id e para 80 mil grupos sem projeção.
    - revisão 2 (`render-023`):
      - o teto de saída dentro do bloco: o código de 20 mil linhas no 64º nível sai com a perda nele, e o erro que não é o teto sobe como antes;
      - a regravação sobre notas fundas abaixo do teto de tempo;
      - a memória do `findNextNonspace`: a razão entre o render fundo e o raso do mesmo tamanho fica abaixo de 10 (a menor de até 5 pares);
      - os três tetos da reconciliação nas bordas;
      - a nota válida funda cortada com `truncated`, e a rasa de ~2 MiB inteira;
      - no R11, editar ou encolher as três tabelas da nota acima do teto passa, e `skipNoteCellCost` tira só o teto da nota inteira.
  - `src/components/noteMarkdown.test.ts`, com o editor real:
    - exemplo → create, mount, card, diagrama e PDF;
    - paridade do corpus (`fixtures/markdown/corpus`);
    - a colagem lê o nosso Markdown;
    - fuzz.
  - Fixtures em `fixtures/markdown/`:
    - `note-markdown.md`, render byte a byte de `valid/note-markdown.json`;
    - `exemplo.json`/`exemplo.md`;
    - `corpus/`;
    - `generator.ts`, o gerador com semente.

**Projetos em `_domain` (API-027):** a agenda, as estatísticas, o parser e o plano da importação de backlog, o Markdown do card e as regras do API-013 ficam puros em `_domain`. Os arquivos de mesmo nome em `src/lib` reexportam esses módulos, ou os embrulham quando há um "hoje" padrão, e o app continua importando de `src/lib`.

- **`projectTypes.ts`:** `ProjectCardPriority`, `PROJECT_PRIORITIES` (da mais urgente para a menos), `isProjectPriority` e os itens de checklist, link e anexo. O `src/lib/projectDomain.test.ts` confere pelo `tsc` duas coisas: que esses tipos são iguais aos de `src/types`, e que o `ProjectCard` do app satisfaz `ScheduleCard`, `StatsCard` e `CardMarkdownSource`.
- **`isoDate.ts`:** `toUTC`, `isoFromUTC`, `addDays`, `diffDays`, `mondayOf` e `isOverdue(card, today)`, em UTC e sem relógio.
- **`cardLimits.ts` e `cardLabels.ts`:** os números e as regras de rótulo do gatilho `project_cards_integrity`. O `cardLimits.test.ts` lê a migration do API-013 com `node:fs` e confere 500, 2000, 30, 50, 50 e 100. O `blocknote/projectCard.ts` monta o `SNAPSHOT_LIMITS` a partir deles.
- **`cardLinks.ts`** (`normalizeLinkUrl`, `linkDisplay`) e **`text.ts`** (`normalizeSearch`).
- **`autoSchedule.ts`:** `buildAutoSchedule(cards, columns, today, targetDeadline?)`.
- **`projectStats.ts`:**
  - `overviewSummary(cards, today)`, `dueBuckets(cards, today)` e `countBy*`;
  - `createdPerWeek(cards, weeks, today, dayOf)`: `dayOf` dá o dia de calendário do `created_at` no fuso de quem vê. O app passa `createdDayLocal`, que é o `localDateKey` do instante; o handler passa `(created_at at time zone $tz)::date`, do SQL;
  - a semana sai de `diffDays/7`, sem a hora a menos do horário de verão;
  - `weeks` tem de ser ≥ 1, porque com 0 a função lança; o schema da ação limita.
- **`backlogMarkdownParser.ts`:** `parseBacklogMarkdown(source, { newId })`. Sem `newId`, os ids saem de `crypto.randomUUID`, e `warnings` continua o texto da CLI. API-033:
  - leitura linear: `tableRow`, `listMeta` e `checklistItem` por índice, com a mesma semântica das regex de antes, conferida por um teste diferencial;
  - Problema e Contexto multilinha, respeitando cerca de código;
  - CRLF normalizado;
  - `dependsOn` (sempre presente) a partir de `Depende de`.

  A bateria de tempo mede a razão t(n)/t(n/4) em pares a 512 KiB, como a do API-023.
- **`importPlan.ts`:**
  - `planTopicColumns`;
  - `planCardRows({ …, existing, newId })`: as linhas na ordem do arquivo, com o `sort_order` max+1 por coluna e os cards pulados por "ID —". Cada linha nova tem `id` (de `newId`) e `depends_on`. `existing` vem do mais antigo para o mais novo, e o 1º de cada ID externo vale;
  - `oldestFirst(cards)`: a cópia nessa ordem (created_at, id, texto comparado com < e >, sem `Date.parse` nem `localeCompare`), usada pela prévia e pela gravação;
  - as `issues` do plano impedem gravar: sem coluna, limites de subtarefas, `dependency_cycle` (com o caminho) e `depends_on_too_many`. Os `warnings` (`dependency_not_found`, `dependency_not_applied`) não impedem;
  - `insertBatches(rows, size)`: lotes por nível de dependência, na ordem do arquivo dentro do nível. Sem dependências, os mesmos pedaços de antes. Lança com id repetido ou ciclo;
  - `importIssueText(issue, t)` (chaves `projects_import_error_*`, com o limite em `{max}`) e `importLabels`;
  - `backlogIssueText(issue, t)` e `importWarningText(warning, t)`, com o texto da tela de importação. O dry_run do API-055 usa esses.

  `ImportCardRow` é contrato do API-055. No `ctx.tx`, o handler pode gravar com `insertBatches` ou inserir tudo com `depends_on` vazio e fazer um único UPDATE depois, porque o plano já recusou ciclo.
- **`cardMarkdown.ts`:** `formatCardAsMarkdown(card, ctx, t)`.
- **`i18n.pt-BR.ts`:** além dos rótulos do API-023, as 20 chaves do Markdown do card, as 10 `projects_import_issue_*`, as 2 `projects_import_warning_*` e as 5 `projects_import_error_*`, com o mesmo texto do app (o `projectDomain.test.ts` confere). `DomainTFor<K>` é o `t` de quem só usa as chaves `K`: o `tPtBR` serve, e o `t` do app também.
- **Sem relógio em `_domain`:** `today` é obrigatório em todas as funções. Os padrões ficam nos wrappers de `src/lib` (`autoSchedule`, `projectStats` e `projectCardFilters`), com o dia do aparelho. No Deno o fuso é UTC, então o handler pega o dia no fuso da pessoa pelo SQL: `select (now() at time zone $1)::date` no `ctx.tx`. Um fuso inválido dá 22023, que vira `validationFailed` do `X-Akool-Timezone` (sondado no staging em 11/10). O `todayInTimeZone` com `Intl` foi adiado.
- **Testes que dependem do fuso:** o CI roda em UTC e o dev em São Paulo, e nenhum dos dois tem horário de verão. Por isso os testes fixam o fuso no próprio teste, com `vi.stubEnv('TZ', …)` e `vi.unstubAllEnvs()` (o Node relê o TZ, e o pool do vitest é forks), e cada um tem uma pré-condição que falha se o fuso não pegar. O `createdPerWeek` de `_domain` e o `distributeDueDates` (`src/lib/studySchedule.test.ts`) fixam America/New_York no `beforeAll`, onde 09/03/2025 tem 23 h. Os wrappers do app (`createdDayLocal` e o "hoje" do Gerar cronograma) rodam cada caso em America/Sao_Paulo, America/Manaus e Asia/Tokyo (`it.each`, com o `stubEnv` dentro do caso e o `unstubAllEnvs` no `afterEach`). Os instantes são montados em hora local dos dois lados da meia-noite (23:30 e 00:30), e a pré-condição confere o `getTimezoneOffset()` de cada fuso. O dia UTC ou um offset fixo (o UTC−3 de Brasília) só acertam os dois lados num fuso a menos de meia hora do seu, então algum dos três os pega. A trava REL-007 do `repo-hygiene` também barra `isoFromUTC(Date.now())` como "hoje".
- **Linha do banco → domínio:** na linha de `project_cards`, `priority` vem em texto e `labels`, `checklist` e `links` em JSON. Antes de chamar `autoSchedule`, `projectStats` e `cardMarkdown`, o handler estreita esses campos e recusa prioridade fora das quatro (`isProjectPriority`). Uma prioridade desconhecida ordenaria primeiro na agenda, sem aviso, e criaria uma chave nova no `countByPriority`.

**`_domain` da Loja (API-028):**
- `storeTypes.ts`: status, funil e tipo de produto, mais os `*Like` que os cálculos leem;
- `financeStoreCalc.ts`: estoque derivado, custo médio, dinheiro da venda, capital parado, resultado do mês, histórico e estatísticas do cliente. O `customerHistory` recebe o dia de criação de quem chama, sem relógio;
- `saleTransitions.ts`: os 10 pares do pipeline (`SALE_TRANSITIONS`), `canTransition` e `confirmActionFor`.

O app reexporta por `src/lib/financeStoreCalc.ts` (o dia de criação no fuso do aparelho) e por `src/modules/finance/store/saleTransitions.ts`.

O SQL tem a mesma conta: `store_product_figures`, o líquido das RPCs e os pares do gatilho. `_domain/fixtures/storeParity.json` prende os dois lados:
- `storeParity.test.ts` confere o JS, o JSON do harness (entre `parity:begin` e `parity:end`), a lista de pares, os CHECKs da migration e a forma do líquido nas 5 RPCs (itens + frete cobrado − taxa, sem o frete pago);
- o harness confere o SQL: `store_product_figures` contra o JSON, e o líquido das RPCs no fluxo da seção 8, numa venda com frete pago. O mutante que desconta o frete pago derruba 6 linhas.

**Por que `_api` e `_domain`:**

- `scripts/coverage-ratchet.mjs` agrupa a cobertura por pasta de `supabase/functions`.
- Pastas que começam com `_` não são publicadas.
- O bundler do `staging:reset` segue só imports relativos dentro de `supabase/functions`, inclusive `import type`.
- Há precedente: `src/lib/observability.ts` já importa `_shared/scrub`.

**Compilação e fronteira de imports (API-005):**

- `tsconfig.functions.json` (API-005): strict, ES2023 sem DOM, `types: ["node"]` (os testes leem migrations com `node:fs`), `allowImportingTsExtensions`, `noEmit`, `tsBuildInfoFile` em `node_modules/.tmp`. `include: ["supabase/functions/_api", "supabase/functions/_domain"]` (um padrão terminado em `/**` é ignorado pelo TypeScript) e `exclude: ["supabase/functions/**/runtime", "supabase/functions/**/index.ts"]` (relativos ao arquivo). Fica referenciado no `tsconfig.json`, então `npx tsc -b` checa os módulos puros. Opcional: rodar `deno check supabase/functions/api/index.ts` no CI.
- `_api/importBoundary.test.ts` (API-005): fora de `runtime/`, `_api` e `_domain` só importam caminhos relativos com `.ts` dentro de `supabase/functions` (inclusive `import type`, `export … from` e `import()`), e o que importarem de fora (ex.: `_shared`) segue a mesma regra. Ficam proibidos `src/`, `@/`, pacote nu, `npm:`, `jsr:`, import de efeito colateral e importar `runtime/` ou um `index.ts`. Testes podem importar `vitest` e `node:*`. O `exclude` do tsconfig não basta: um arquivo importado é checado do mesmo jeito.
- Em `_api` e `_domain`, fora dos testes, a regra `no-restricted-globals` do `eslint.config.js` proíbe os globais do Node (`process`, `Buffer`, `require`, `__dirname`…) e os do navegador (`localStorage`, `sessionStorage`, `navigator`, `window` e `document`). O `types: ["node"]` do `tsconfig.functions.json` existe só por causa dos testes, e o `@types/node` também declara `localStorage` e `sessionStorage`: o `tsc` sozinho deixaria passar.
- A regra `no-restricted-syntax` do mesmo bloco barra relógio e hora local (API-027). Do relógio, ela barra `new Date()` sem argumento, `Date()` sem `new` e `Date.now()`. Da hora local, barra `new Date` com mais de um argumento (data por partes), `Date.parse`, os getters e setters locais (`getHours`, `getYear`, `setDate`…), `toDateString`, `toTimeString` e `toLocale*String`, e `new Date` com texto literal, template ou concatenação com cauda literal (`dia + 'T00:00:00'`) que não tem `Z` nem offset logo depois da hora. O `Z` ou o offset vêm depois dos minutos ou dos segundos (`'…T01:30Z'`, `'…00.123456+00:00'`, `'…00-0300'`): o `-2025` de `'03-10-2025'` não é offset, e o V8 lê esse texto em hora local. O `z` minúsculo também é barrado, porque no Safari dá Invalid Date. Na cauda de template ou de concatenação basta o `Z` ou um offset com dois-pontos (`` `${dia}T${hora}Z` ``), porque a hora pode estar na parte variável. A data sem hora (`'2025-03-10'`) é meia-noite UTC pela especificação, não hora local, mas também é barrada, com mensagem própria: por convenção, o dia passa por `toUTC`. Barra também o navegador e o relógio por `globalThis` ou `self` (`globalThis.localStorage`, `(globalThis as X).Date`…), que o `no-restricted-globals` não vê, e parâmetro com padrão `today…()`. Ela não vê `new Date(variavel)`, a concatenação com cauda variável (`dia + hora`), `String(data)` nem um apelido de `Date`, e deixa `toString()` de fora: sem os tipos, barraria o `n.toString(16)` dos números. Por isso o dia `'YYYY-MM-DD'` passa sempre por `toUTC`. O `scripts/eslint-domain-clock.test.ts` prova cada padrão com o `lintText` e confere que o código atual de `_domain` e `_api` passa.
- As travas REL-007, UX-011 e QA-006 do `scripts/repo-hygiene.test.ts` também varrem `_domain` e `_api`, inclusive os arquivos que ainda não estão no índice do git.

**Porte de módulos de `src/lib`.** Cada card de porte:

- lista o fechamento transitivo dos imports. Exemplos:
  - `autoSchedule` puxa `ganttLayout`, `projectCardFilters`, `projectStats` e `priorities`;
  - `statementImport` puxa `investmentClassifier`;
  - `docsGraph` puxa `avatar` e `graph`;
  - `studySchedule`, `studyProgress` e `studyQuiz` dependem uns dos outros;
- usa tipos locais;
- separa o IO: `importProjectCards` vira `importPlan` puro mais a gravação;
- troca `t(TranslationKey)` por um dicionário pt-BR em `_domain/i18n.pt-BR.ts`;
- tira o relógio: `today` (e o "agora") vêm de quem chama, e o padrão fica no wrapper de `src/lib`;
- trava o resultado com testes que ficam no repo (golden, paridade de tipos pelo `tsc` e de textos com `src/i18n`), não com uma comparação contra o original, que some depois do porte;
- roda `node scripts/coverage-ratchet.mjs --allow-moves`.

## 4. Registro de ações (`_api/types.ts`, `_api/registry.ts`)

**Campos de `ActionDef`:**

- `id` no formato `secao.subsecao.acao`, e `title`;
- `kind`: `read`, `create`, `update` ou `delete` (as invariantes de anotação dependem dele);
- `description`, com até 300 caracteres e sem instruções ao modelo;
- `requires`: `allOf`/`anyOf` de `{sub, level}`;
- `input` e `output`: JSON Schema 2020-12, no subconjunto de `_api/schema.ts`;
- `annotations`: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint:false`;
- `idempotent`, `tables`, `maxResultChars` e `deprecated`;
- `examples: {input[], output[]}`, validados contra os schemas;
- `run(ctx, input)`, com `ctx = {tx, principal, can(sub, level), storage, tz, now, request:{surface, client, ip_bucket}, hooks, actions}`. Os `hooks` de auditoria, limites e idempotência ficam vazios até o API-014; `actions` é o registro, que o `meta.acoes.listar` lista.

**Invariantes testadas (API-008):**

- ids únicos, só `[a-z_]`, em 3 segmentos;
- nome MCP = id com `_`, com até 48 caracteres. O Claude Code prefixa `mcp__akool__` e recusa nomes acima de 64;
- nome MCP único: ids diferentes que dão o mesmo nome (`documentos.notas.rapidas_listar` e `documentos.notas_rapidas.listar`) são recusados;
- título de até 120 caracteres (`MAX_TITLE`), o limite da saída do `meta.acoes.listar`;
- leituras com `readOnlyHint`, sem `destructiveHint`, só exigindo Ler e com entrada plana (objeto só com propriedades escalares, para virar query de GET);
- criações sem `destructiveHint`; atualizações e exclusões com `destructiveHint`; exclusões com nível `delete`; `openWorldHint` sempre `false`;
- `requires` só referencia subseções reais, sem passar do nível máximo de cada uma;
- namespaces compostos (`meta`, `painel`, `documentos.rede`, `financas.relatorios`) declarados no catálogo, sem nível próprio e com `requires.anyOf`;
- namespace composto só tem leitura: criar, atualizar ou excluir ali é recusado;
- a ação comum exige a própria subseção (`secao.subsecao` do id) no `allOf` (ou num `anyOf` de um item), no nível do tipo: leitura em Ler, criação e atualização em Escrever ou Excluir, exclusão em Excluir. Num `anyOf` com outras subseções não vale, porque outra delas bastaria para chamar a ação;
- descrição de até 300 caracteres, sem frase dirigida ao modelo (lista `MODEL_DIRECTED` em `registry.ts`: "você deve", "sempre chame", "ignore", "IMPORTANT"…);
- ordem determinística (o registro é ordenado por id);
- toda ação tem ao menos um exemplo de entrada e um de saída, válidos nos schemas.

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

Estudos (API-022/034): o progresso, que é o `completed` dos pontos e o `userAnswer` do quiz, vive nos mesmos arrays do conteúdo. `private.study_without_progress(jsonb)` (API-021) devolve a lista sem essas duas chaves. Um gatilho de sessão da API compara a projeção do OLD com a do NEW para saber se a gravação mudou conteúdo (`estudos.conteudo`) ou só progresso (`estudos.progresso`).

As RPCs do API-024 já separam as duas subseções pelo nome:
- `estudos.progresso:write`: `study_checkpoint_toggle`, `study_quiz_answer` e `study_quiz_reset`;
- `estudos.conteudo:write`: `study_checkpoint_add`, `study_checkpoint_edit`, `study_checkpoint_remove`, `study_resource_add`, `study_resource_remove`, `study_cards_append`, `study_import_topic` e `study_reschedule`.

Anexar e importar gravam o `completed` que vier (o "- [x]" do parser) e sempre `userAnswer: null`. O API-022/034 decide se criar card com ponto já marcado exige também `estudos.progresso:write`, por exemplo uma linha nesta tabela: "Anexar ou importar card com ponto marcado → `estudos.progresso:write`".

## 8. Notificações

| Tipo | Exige leitura de |
|---|---|
| `loan_*` | `financas.emprestimos` |
| `workspace_invite`, `invite_accepted`, `invite_declined`, `member_joined`, `member_left` | `compartilhamento.pessoas` |
| `backup_stale` | `admin.backups` |
| `finance_recurring_failed` (API-016: o cron de recorrentes teve falha) | `admin.backups` (aviso de operação para admins, como o `backup_stale`) |
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
- Tetos por chamada: lote de transações 100; extrato 500 linhas; backlog 200 cards; estudo 100 cards. O de estudo vale em `study_cards_append` e `study_import_topic` (API-024: de 1 a 100 cards e até 4 MiB; `STUDY_IMPORT_CARDS_MAX` e `STUDY_IMPORT_MAX_BYTES` em `src/lib/studyLimits.ts`, conferidos contra a migration). A importação é tudo ou nada: o parser corta antes (API-029: `fitImportCards` em `src/lib/studyMarkdownParser.ts`, pura e linear, mede o payload inteiro como o servidor, `{topic, cards}` em texto de jsonb, e diz no `dropped` o que ficou de fora; o API-034 a porta para `_domain`).

### 9.4 Lixeira (API-025)

- Um gatilho AFTER DELETE genérico em toda tabela classificada, ativo só em sessão da API, copia `OLD` para `private.api_trash` (call_id, token_id, tabela, linha, ordem). Exclusões em cascata também entram.
- Objetos do Storage apagados pela API vão para `private.api_storage_pending` e só saem depois de 7 dias.
- `api_undo_call(p_call_id)`, chamado do app, reinsere as linhas como o usuário, em ordem de dependência. Aparece como Desfazer em Atividade.
- Retenção de 7 dias pelo `api-housekeeping`. Até aqui, o único jeito de desfazer era o restore global do site.
- **Interação com o API-021.** O `api_undo_call` reinsere como o usuário, e os gatilhos de Estudos tratam isso como gravação nova:
  - `study_topics_rules` recalcula `started_at`, `completed_at` e `updated_at`, e as datas originais se perdem;
  - `study_cards_rules` valida a forma inteira no INSERT (card antigo fora da forma não volta) e põe a versão em agora.

  O undo precisa entrar como restore, por exemplo com um GUC ligado só por ele e conferido pelos gatilhos junto da condição sem usuário. Isso está registrado no cabeçalho da migration 20261008130000.

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

**Erros de validação de nota (API-020).** Os issues passam por `toSchemaIssues(issues)` antes do `validationFailed`: o campo `fatal` não vaza no corpo, e os fatais vêm primeiro. Nas props com JSON em texto (`snapshot`, `elements`, `appState`), o ponteiro aponta para a prop (`/3/props/snapshot`) e a palavra-chave é o nome dela. O caminho interno vai na mensagem: `/labels/2: Deve ter no máximo 50 caractere(s)`.

**Erros de Markdown (API-023).** O `markdownToNote` devolve cada problema com a linha do Markdown (`line`). A linha vale 0 quando o problema é da nota inteira, como os 2 MiB da forma canônica. `toMarkdownSchemaIssues(issues)` monta o `details` do `validation_failed`:
- o `path` é o campo da ação (`/markdown`);
- a linha vai na mensagem, por exemplo `linha 12: Caminho de imagem fora da pasta da nota (…)`;
- os fatais vêm primeiro, no máximo 20.

O formato do `SchemaIssue` não muda: `line` não vai no corpo como campo próprio. Os avisos (`warnings`: HTML descartado, citação achatada, imagem dividida, quebra suave, link inseguro, nota de rodapé) não são erro; o API-044 os devolve na resposta de sucesso.

As RPCs de lote de Estudos (API-024) prefixam a mensagem com `cards/N: ` (N a partir de 0) e mantêm o SQLSTATE de origem: 22023 da validação, 23514 da forma pelo gatilho do API-021. O handler do API-034 pode transformar o prefixo em `details` com o pointer `/cards/N`.

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
| API-028 | vendas da Loja: máquina de estados, estoque global, referências do dono e receita atômica (gatilhos + 8 RPCs) |
| API-029 | a tela de Estudos sobre as RPCs do API-024: listas item a item, campos escalares com versão e conflito por campo, posição, datas e versão do servidor, importação e reagendamento numa chamada, teto de 100 cards e 4 MiB no parser |
| API-030 | escrituração e saldo de empréstimos |
| API-037 | compras e produtos da Loja |
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
| Finanças | API-016 | entregue: `finance.budgets.auto_from_recurring` e `finance.recurring.entries.materialize` viraram `never: cron e rotinas internas do servidor` (só servidor; `_api/coverage.ts` e `docs/api-inventario.json`) |
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
- Subir o `@blocknote/*` (core, react e mantine) exige, no mesmo PR, atualizar `supabase/functions/_domain/blocknote/spec.ts`, rodar `src/components/noteSchema.test.ts` e republicar a function `api` (API-020).

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
| 02 | 005 núcleo puro; 006 restore e cron sem usuário (veio do 03); 009 tela de tokens (editar permissões, revogar e excluir) |
| 03 | 004 papéis do executor (veio do 02); 007 guardas no banco (L); 008 registro e cobertura. Remontado quando o 002 fechar |
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
- **Ajuste de 05/10/2026:**
  - o lote 02 rodou com 005, 006 e 009;
  - o 006 subiu do lote 03 porque a avaliação mostrou que nenhum backup com linhas de workspace restaurava (corrigido em produção);
  - o 004 saiu do 02 porque depende do 002, que espera os papéis no staging;
  - as labels `lote-NN` dos cards continuam as originais;
  - o lote 03 é remontado quando o 002 fechar, porque o 007 depende do 004 e os dois não podem ficar no mesmo lote.
- **Ajuste de 07/10/2026:**
  - o lote 03 rodou com 008 (do 03), 012 (do 04) e 013 (do 05), que não dependem do 002;
  - continua um L por lote (o 013), e nenhum dos três depende de outro do lote;
  - o 004, o 007, o 010 e o 011 esperam o 002;
  - as migrations do 012 e do 013 passaram no staging e no ensaio desfeito em produção. O apply em produção espera o OK do dono, e o app só sai no merge, depois dele.
- **A fila não segue a ordem da lista.** `cq_insert_queued` ordena por prioridade, depois esforço, coluna e posição. `cq_start` conta só os cards `in_progress`, então cards em Validação ou em Aguardando você não seguram o lote.
- **Como enfileirar:** espere todos os cards do lote anterior chegarem a Concluído (`npm run cards -- queue`). Só então rode `npm run cards -- enqueue --label=lote-NN` e depois `next --count=3`.
- **Dependências:** a primeira subtarefa de todo card com dependência confere que elas estão em Concluído; se não estiverem, `release`.
- **Labels:** todos os cards levam `api-v1` e `lote-NN`.
- **Pré-requisitos:** os cards 003, 006, 012, 013, 016, 020, 021, 023, 024 e 027 a 030 não dependem da API. Eles corrigem o app já e destravam as escritas depois.

## 18. Formato dos cards e importação

- BacklogCard v1 (`supabase/functions/_domain/backlogMarkdownParser.ts`, reexportado por `src/lib/backlogMarkdownParser.ts`, API-027):
  - `## Tópico: X`;
  - `### CARD API-0NN — Título`;
  - tabela Campo|Valor (ou lista `- **Campo:** valor`) com ID, Prioridade, Esforço, Labels (separadas por vírgula), Arquivos (em crases) e Depende de;
  - `**Problema:**` e `**Contexto:**`, depois da tabela;
  - `**Subtarefas Kanban:**`.
- Leitura (API-033):
  - CRLF e CR viram LF antes de tudo;
  - tudo é linear, sem regex com retrocesso, porque a tela reparseia a cada tecla e a API roda na edge;
  - Problema e Contexto vão do rótulo até o próximo marcador: `**Subtarefas`, `**Problema:**`, `**Contexto:**`, linha que começa com `---`, `### CARD`, `# ` ou `## `. Um `### Critérios` fica dentro;
  - dentro de cerca de código (```` ``` ```` ou `~~~`, inclusive a aberta na linha do rótulo), os marcadores não contam. A cerca que não fecha vai até o fim do card, e nela só os rótulos do card (`**Subtarefas`, `**Problema:**`, `**Contexto:**`) encerram a seção;
  - o texto pode começar na linha do rótulo ou na de baixo. O rótulo fica numa linha própria na descrição só quando o texto começa na linha de baixo com um bloco (lista, lista numerada, citação, título, cerca, tabela), para o bloco renderizar, ou quando a linha do rótulo abre uma cerca (`**Contexto:** ```bash`). Na linha do rótulo, `> 2 s`, `2. fase`, `- nada a declarar` ou `# 1 da lista` é parágrafo: continua depois do rótulo, separado por um espaço, como no parser de antes do API-033. Com o rótulo em linha própria, isso viraria citação (lendo "2 s") ou lista numerada a partir de 1;
  - os metadados são lidos fora das faixas de Problema e Contexto, da lista de subtarefas e das cercas que fecham. Uma tabela ou um `- Prioridade: P0` no Contexto não passa por cima dos do card. Por isso a tabela de metadados vem antes do Problema: o que vem depois dele, até o próximo marcador, é Problema;
  - em `**Subtarefas Kanban:**`, cada item é um `- [ ]` de uma linha, sem bullets aninhados, porque uma linha que não começa com `-` encerra a lista;
  - o que só o usuário faz entra como subtarefa com o prefixo `Você:`.
- Depende de (API-033): `| **Depende de** | API-001, API-002 |` ou `- **Depende de:** API-001, API-002`.
  - Os IDs saem de `/\b[A-Z]{2,5}-\d{3}\b/gi`, em maiúsculas, separados por vírgula, ponto e vírgula, espaço ou "e". `—`, `-`, `nenhum`, `nenhuma` e vazio são sem dependência.
  - O que sobra num trecho e não é ID vira `invalid_dependency` (o ID do mesmo trecho entra), e o próprio card vira `self_dependency`.
  - Só esse nome de campo vale, e só com IDs. O `- **Dependências:**` do Markdown do card, que tem títulos, não é lido. O "Depende de: …" no texto do Contexto (o formato antigo) também não: os 56 cards da API v1 só ganham `depends_on` com um backfill à parte, que escreve em produção e precisa do OK do usuário.
  - Resolução (`planCardRows`): primeiro o card novo do mesmo arquivo. Depois, o do quadro pelo "ID —" ou "ID -", o mais antigo, como o `cq_resolve_card`. Senão, o aviso `dependency_not_found`, sem a aresta. A ordem sai do `oldestFirst` (`_domain/importPlan.ts`): `created_at` e, no empate, `id`, comparando o texto com < e >, como o `order by created_at, id` do Postgres. O `Date.parse` perderia os microssegundos, e todos os cards de uma importação têm o mesmo `created_at`; o `localeCompare` segue o idioma, não os bytes.
  - Ciclo entre os cards novos (com o caminho) e mais de 100 dependências bloqueiam a importação inteira, como os limites de subtarefas. O ciclo que passa por um card pulado não conta.
  - O card que já está no quadro é pulado e não muda. O aviso `dependency_not_applied` cita as dependências que faltam nele. Atualizar o `depends_on` de card existente fica para o API-055.
  - A gravação é por níveis (`insertBatches`), porque o gatilho do API-013 recusa a dependência que ainda não existe, inclusive a que vem depois no mesmo INSERT. Se um lote falha, os anteriores ficam com as dependências completas, e a nova tentativa com "pular duplicados" grava o resto.
- A prévia da tela (`ImportCardsModal`) roda o mesmo `planCardRows` contra os cards do quadro em memória. Ela mostra ciclo, limites e dependências não encontradas antes de gravar, e um problema que bloqueia desliga o botão. Depois de importar, os avisos são os da gravação, e com aviso o modal não fecha sozinho. A prévia põe os cards em memória, que vêm na ordem do quadro (`sort_order`), no mesmo `oldestFirst` da gravação. Assim, com dois cards do mesmo ID externo, as duas escolhem o mesmo card para pular, para resolver a dependência e para o aviso `dependency_not_applied`.
- Antes de importar, rodar `npm run import:cards -- docs/imports/backlog-api-v1.md --dry-run` e conferir, card a card, o número de subtarefas, a presença do Contexto e a ausência de avisos. O dry-run lista as dependências, as que ficam fora do arquivo (procuradas no quadro só na importação) e os problemas que bloqueiam; com algum, sai com 1.
- O cabeçalho do arquivo explica os lotes e o enfileiramento por `lote-NN`.
- O golden `supabase/functions/_domain/fixtures/backlogs.golden.json` guarda o resultado do parser em cada backlog de `docs/imports`. Por card, ele tem ID, prioridade, esforço, tópico, rótulos, número de arquivos, subtarefas feitas/total e o sha256 do card sem o `dependsOn`, que pega título, descrição e o texto das subtarefas.
  - O `dependsOn` entra no fim da linha só quando existe, e assim os backlogs de antes do campo saem iguais.
  - Quem muda um backlog de `docs/imports` (ou o parser, de propósito) regrava com `npx vitest run supabase/functions/_domain/backlogMarkdownParser.test.ts -u` e confere o diff do golden no PR.
  - O `-u` vai depois do arquivo: no vitest 4 ele aceita um valor, e `-u <arquivo>` engole o arquivo e roda a suíte inteira.
- Os avisos do parser saem de dois jeitos: `warnings`, com o texto da CLI, e `issues`, com o código. A tela e a API traduzem as `issues` com `backlogIssueText` e os avisos do plano com `importWarningText` (`_domain/importPlan.ts`), e a API usa o `tPtBR`. Os problemas do plano que impedem a importação saem com `importIssueText(issue, t)`, nas chaves `projects_import_error_*` (`{id}`, `{detail}` e o limite em `{max}`). A tela passa o seu `t`, inclusive para os `errors` do `importParsedCards` (opção `t`); a CLI e a API passam o `tPtBR`.

## Apêndice A. Catálogo de permissões

27 subseções. O padrão de todas é Nenhum. A fonte canônica passa a ser `supabase/functions/_api/catalog.ts` (API-001), replicada em `private.api_scope_catalog`.

| Chave | Seção › Subseção | Nível máximo | Cobre | Observações |
| --- | --- | --- | --- | --- |
| `perfil.dados` | Perfil › Dados e preferências | Escrever | profiles, só a própria linha (display_name, language, theme, avatar_emoji, avatar_color, avatar_url, finance_dashboard_view, onboarding); get_my_profile em subconjunto seguro; bucket avatars (próprio). Ações perfil.dados.* | Nunca lê nem escreve role, is_active, last_login_date, invite_slots_remaining e ai_has_key; e-mail é só leitura. Remover a foto conta como Escrever. A RESTRICTIVE trava UPDATE e DELETE em id = auth.uid(), mesmo para admin. |
| `perfil.notificacoes` | Perfil › Notificações | Excluir | notifications: select; update só de read=true; delete. Ações perfil.notificacoes.listar, contar_nao_lidas, marcar_lida, marcar_todas_lidas e excluir | Linhas filtradas por tipo: loan_* exige financas.emprestimos:ler; workspace_invite, invite_accepted, invite_declined, member_joined e member_left exigem compartilhamento.pessoas:ler; backup_stale e finance_recurring_failed exigem admin.backups:ler; api_token_* ficam aqui; tipo desconhecido fica oculto. O mapa completo por tipo é o do §8, que vale sobre esta lista. Responder convite de workspace não é desta subseção. |
| `perfil.convites` | Perfil › Convites | Escrever | invite_codes com created_by = eu (mesmo para admin), saldo de convites e generate_invite_code (Escrever) | Escrever deixa um terceiro criar conta. Limite de 5 códigos por dia por token, inclusive para admin. |
| `documentos.paginas` | Documentos › Páginas | Excluir | pages: árvore pelo RLS (page_is_readable/page_is_writable), metadados, criar com as linhas de note_contents/drawing_contents, mover e reordenar. Excluir = exclusão com subárvore, via lixeira de 7 dias, e limpeza adiada de note-images | O SELECT em pages também é liberado para quem lê notas, desenhos ou tarefas. Páginas compartilhadas comigo só aparecem com incluir_compartilhados (exige compartilhamento.pessoas:ler); escrever nelas exige compartilhamento.pessoas:escrever. A exclusão pede confirm_subtree e aceita dry_run. |
| `documentos.notas` | Documentos › Conteúdo de notas | Escrever | note_contents (BlockNote validado; Markdown nos dois sentidos; versão), bucket note-images (envio e URL assinada de 1 h), blocos diagram e projectCard | Inserir bloco de card de projeto exige também projetos.cards:ler, e o snapshot é montado no servidor a partir do card lido (API-044): `newProjectCardIds(antes, depois)` (`_domain/blocknote/projectCard.ts`) aponta os blocos projectCard novos ou alterados. Anexar valida o documento já juntado: ids únicos, 5000 blocos e 2 MiB valem sobre a nota final na forma canônica (a saída do `normalizeNoteContent`, que é a gravada), e o teto de células da nota inteira (Σ células²) vale contra o custo da nota atual (`noteLimitIssues` com `baseline`). O snapshot do card é montado, ou o bloco recusado, antes da validação, porque card sem snapshot é contrato. Toda escrita leva expected_updated_at ou force explícito. Nota de outra pessoa volta marcada como conteúdo não confiável. |
| `documentos.desenhos` | Documentos › Desenhos | Escrever | drawing_contents: elementos Excalidraw, app_state e files sob demanda | Escrita validada, com limites de tamanho e incremento de version/versionNonce para o canvas aberto perceber a mudança. |
| `documentos.tarefas` | Documentos › Tarefas (listas) | Excluir | todos de páginas do tipo todo: listar por página e as minhas, criar, atualizar, concluir e excluir | Criar a página de tarefas é de documentos.paginas. A API nunca muda user_id nem page_id. |
| `documentos.notas_rapidas` | Documentos › Notas rápidas | Excluir | quick_notes: conteúdo, cor e linked_items por operação de item | Vincular página ou card exige leitura do alvo (documentos.paginas ou projetos.cards). Depende do API-003, que acaba com a sobrescrita offline. |
| `estudos.conteudo` | Estudos › Tópicos e roteiros | Excluir | study_topics e study_cards (título, descrição, prazos, checkpoints como texto, recursos, definição do quiz, blocks), RPCs de conteúdo do API-024 (study_checkpoint_add, study_checkpoint_edit, study_checkpoint_remove, study_resource_add, study_resource_remove, study_cards_append, study_import_topic e study_reschedule; até 100 cards e 4 MiB por chamada), importação em Markdown ou JSON, contrato do prompt, visão geral, estatísticas e planejamento | Excluir tópico apaga cards e diário em cascata (com lixeira). Os status planned e paused são daqui; studying e completed são de estudos.progresso. |
| `estudos.progresso` | Estudos › Progresso (checkpoints e quiz) | Escrever | study_checkpoint_toggle, study_quiz_answer e study_quiz_reset (RPCs do API-024), status studying/completed do tópico | Separado para que uma IA que gera roteiros não consiga marcar o aprendizado como feito. |
| `estudos.diario` | Estudos › Diário | Excluir | study_logs: listar por tópico ou global, criar e excluir | Texto livre pessoal. |
| `projetos.quadros` | Projetos › Quadros e colunas | Excluir | project_boards, project_columns, create_project_board, reorder_project_columns, membros (sem e-mail, via api_profile_cards), estatísticas e cq_boards. Excluir = excluir quadro, excluir coluna (apaga os cards) e cq_setup_flow | Renomear coluna pode desligar o fluxo da fila, e a resposta avisa. Quadros compartilhados comigo só aparecem com incluir_compartilhados; escrever neles exige compartilhamento.pessoas:escrever. |
| `projetos.cards` | Projetos › Cards | Excluir | project_cards (todos os campos, itens, relações, responsável, página vinculada), reorder_project_cards, schedule_project_cards, bucket project-card-images, importação de backlog, agenda automática, exportação em Markdown, cq_cards e cq_card | Mover para a coluna de concluído num quadro com fluxo e marcar itens do usuário exigem também projetos.validacao, conferido no banco. |
| `projetos.fila` | Projetos › Fila de desenvolvimento | Escrever | project_card_queue; cq_list, cq_enqueue, cq_move, cq_remove (cancelamento), cq_reprioritize, cq_start, cq_next, cq_note, cq_check, cq_complete, cq_block e cq_release | É o que o /fila usa, junto com projetos.quadros:ler e projetos.cards:ler. Os tokens migrados recebem exatamente esse conjunto. cq_check não marca item owner='user' sem projetos.validacao. |
| `projetos.validacao` | Projetos › Validação (aprovar/reprovar) | Escrever | cq_validate; mover card para a coluna de concluído em quadro com fluxo; marcar ou desmarcar itens owner='user' da checklist | É o portão de aprovação humana, garantido no banco por gatilho. Deixe Nenhum em tokens de IA, a não ser que queira aprovar pelo chat. Os tokens migrados não recebem esta subseção. |
| `financas.transacoes` | Finanças › Transações | Excluir | finance_transactions: listar, histórico, criar, editar, excluir, excluir em lote, importação pré-processada com deduplicação e exportação CSV; bucket transaction-photos (comprovantes, por authorizeObject) | Também é exigida (Escrever) por ações da Loja que mexem em transação vinculada e por marcar_paga de recorrente. Linhas de workspace ou compartilhadas exigem compartilhamento.pessoas. Valores em centavos inteiros; idempotência obrigatória nas criações. |
| `financas.contas` | Finanças › Contas | Excluir | finance_accounts, com saldos calculados no servidor sem o teto de 1000 linhas | Excluir conta tira a conta das transações (dry_run mostra quantas). Contas do workspace exigem compartilhamento.pessoas. |
| `financas.categorias` | Finanças › Categorias | Excluir | finance_categories, com bootstrap das categorias padrão | Excluir categoria apaga os orçamentos de todos os membros do workspace, e a resposta avisa. |
| `financas.orcamentos_metas` | Finanças › Orçamentos e metas | Excluir | finance_budgets (com status do mês), finance_goals e finance_goal_contributions (aporte atômico com conclusão automática) | Compartilhar meta é de compartilhamento.pessoas. Orçamento de workspace exige compartilhamento.pessoas:escrever. |
| `financas.recorrentes` | Finanças › Recorrentes | Excluir | finance_recurring e finance_recurring_entries (a materialização é do servidor, por pg_cron), marcar paga e pular | marcar_paga cria transação e exige também financas.transacoes:escrever. Em recorrente de workspace, a transação leva o `workspace_id` e exige também compartilhamento.pessoas:escrever. Criar recorrente pela API materializa na mesma transação (`finance_materialize_recurring` ou o núcleo `private.finance_materialize_core`); senão o primeiro lançamento só nasce às 00:05 de São Paulo (API-016). |
| `financas.loja` | Finanças › Loja | Excluir | finance_store_products, finance_store_purchases, finance_store_sales, finance_store_sale_items, finance_store_customers, finance_suppliers, bucket store-files, `store_product_figures` e as RPCs de venda do API-028 (`store_sale_create`, `store_sale_set_status`, `store_sale_update`, `store_sale_items_add`, `store_sale_items_update`, `store_sale_items_remove`, `store_sale_generate_income` e `store_sale_delete`: até 100 itens por chamada, dinheiro em centavos inteiros de 0 a 1e12, quantidade de 1 a 1e6); as de compras e produtos são do API-037. | Clientes e fornecedores são dados pessoais de terceiros. Criar, alterar ou apagar receita ou despesa vinculada exige financas.transacoes:escrever; workspace exige compartilhamento.pessoas. As regras de venda e de estoque valem também para a escrita direta nas tabelas (gatilhos do API-028). Excluir venda é Excluir; tirar item é Escrever (lista de exceções do §2.2). |
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
- O parser de backlog encerra a checklist em bullet aninhado. Fora de cerca de código, uma linha que começa com `---`, `# ` ou `## ` encerra o Problema e o Contexto. O renderizador do .md precisa seguir docs/api-arquitetura.md §18, e o dry-run do import:cards deve ser conferido card a card antes de importar.
- O manifesto de cobertura (API-008) depende da lista de 357 operações da avaliação, versionada em `docs/api-inventario.json`.
- Tokens migrados perdem projetos.validacao e o setup-flow: npm run cards -- validate passa a dar 403 até o usuário ativar Validação no token.
- Diferenças de ambiente: rel001_backup_stale_alert pode não estar em produção (backup_stale), o branch atual (ux/landing-publica) não tem as policies de admin com is_admin(), e não foi verificado se as edge functions de IA removidas no SEC-015 ainda estão publicadas no painel. Todo card deve partir de infra/staging-baseline.
- Cronograma longo: são 22 lotes, e os 11 primeiros (fundação e pré-requisitos) precisam ser concluídos antes de qualquer domínio chegar à produção. Os pré-requisitos já corrigem bugs do app nesse período, mas o valor visível da API para o usuário só aparece a partir do lote 12.
- Empréstimos não têm tela no repo e src/lib/loanCalc.ts não existe. A regra de saldo precisa ser confirmada pelo usuário (cards P3).
- A identificação por ID externo ('ABC-123 — Título') não é única e resolve para o card mais antigo. O `Depende de` da importação (API-033) usa a mesma regra, com o quadro lido por created_at e id. Importações repetidas sem deduplicação poderiam mirar o card errado; o API-055 deduplica.
- **CPU do Markdown (API-023).**
  - **Por que um parser próprio:** o marked e o micromark (o motor do BlockNote) são quadráticos com entrada adversária, com mais de 20 s com 16 a 64 KiB. Por isso o parser é próprio e linear, com limite de 512 KiB de Markdown por chamada.
  - **Medido (Apple M-series, Node 22, mínimo de 3 execuções):**
    - pior caso da bateria patológica a 512 KiB, agora com 64 casos: os 43 do cmark, do cmark-gfm e da avaliação, mais 21 da revisão do lote 05 (autolink literal recusado na mesma corrida, parênteses e `;` no fim do autolink, corrida de espaços ou tabs no meio de parágrafo, título e célula, texto e imagem, imagem seguida de quebras duras, crase depois da cerca e definição sozinha na citação). Dá de 150 a 190 ms, ou 582 ms com o coverage do V8 (linkParenteses), sempre num caso antigo. Os 21 novos ficam em até 116 ms, ou 226 ms com coverage. Medido em 11/10, com a máquina carregada (load 4 a 5). Em 12/10, com o macOS ocupando ~2 núcleos, tudo ficou ~3× mais lento: de 280 a 770 ms sem coverage (linkSemFecharB, sozinho ou com a suíte em paralelo) e até 1.864 ms com coverage (linkParenteses). Com isso o teto de 3 s fica só 1,6× acima;
    - razão de escala t(n)/t(n/4), medida em pares: o pequeno e logo depois o grande, até 6 pares. A razão é o menor grande dividido pelo menor pequeno, e a decisão sai do 3º ao 6º par, com até 2 retentativas por caso. Antes, os dois mínimos saíam de janelas separadas (3 grandes, depois 3 pequenos), e a suíte inteira dava falso vermelho (3 em 3 execuções na revisão 2). Linear, em 12/10 no M2 com o macOS ocupando ~2 núcleos: até 7,8 com o arquivo sozinho e 7,2 na suíte inteira com coverage. Com carga, a 1ª tentativa passou de 8 em 7 de 839 medidas (até 14), e o retry refez todas com 4,2 a 6,4. Quadrático: de 10 a 44 nos mutantes da 1ª rodada a 64 KiB. O indexOf do finalize, o único que fica abaixo do teto de 3 s a 512 KiB, dá de 9,5 a 12,7 nas três tentativas;
    - antes da revisão, os 21 casos novos eram quadráticos. A 512 KiB: `(http://` repetido levava cerca de 270 s; `a`, 512 Ki espaços e `b`, cerca de 177 s; a imagem seguida de 262 mil quebras duras, 42 s; a linha de crases com uma crase no fim, 41 s; `&` seguido de ` http://a;` repetido, 8,1 s. Com 32 KiB: `_www.` repetido, 2,5 s; `http://a.co/` com `)` até o fim, 1,1 s. A regravação de `x` sobre uma nota com 64 Ki espaços no meio de um parágrafo e de um título caiu de 7,6 s para 3 ms;
    - nota realista de 512 KiB (2.511 blocos, 2,07 MB canônicos): cerca de 55 ms;
    - regravação com reconciliação sobre uma nota de 1,8 MB: de 85 a 120 ms;
    - render de 5000 blocos: cerca de 40 ms;
    - render e regravação de nota com 20 mil blocos sem id ou com o mesmo id: de 8,5 a 9,7 s antes (o `withUniqueIds` era quadrático), de 54 a 125 ms depois;
    - reconcile com 80 mil grupos sem projeção entre dois com projeção: 5,3 s antes, 19 ms depois;
    - tabela gravada com largura 1000 (20 células com colspan 50) e 40 mil linhas, 600 KB de JSON: passava de 1 GB de memória no render. Agora sai ilegível em 5 ms, sem montar a grade;
    - regravação (`markdownToNote('# Nota refeita', { existing })`) sobre notas gravadas fundas, antes e depois da revisão 2 (M2 com a máquina carregada):
      - 64 níveis numerados com start 999999999 e código `a\n` × 5 mil (23 KiB): de 1.256 ms para 9 ms;
      - a mesma nota com × 20 mil (67 KiB): de 5.031 ms para 10 ms;
      - 64 níveis de marcadores com 20 mil linhas: de 1.086 ms para 7 ms;
      - nota válida de 880 KiB com 10 níveis: de 2.976 ms para 21 ms;
      - nota válida de 296 KiB: de 967 ms para 130 ms;
      - as 300 tabelas do R9: de 4.310 ms para 80 ms;
    - o render do código de 200 mil linhas no 64º nível (594 KiB) dava 139 Mi unidades e agora para no teto em 11 ms;
    - memória do `findNextNonspace`: o render de 63 itens numerados com 2.900 linhas de código (1,94 Mi unidades) é relido em 1.364 ms sem ela e em 42 a 60 ms com ela. O raso do mesmo tamanho leva de 27 a 41 ms;
    - pior caso logo abaixo dos tetos da reconciliação:
      - 24 tabelas 100×100 mescladas (245 mil `|`): de 290 a 370 ms;
      - 65 mil linhas em branco no 64º nível: 180 ms;
      - 255 mil quebras duras na raiz: de 155 a 260 ms no plan, mais de 0,6 a 0,9 s de render.
  - **O que o teste prende:** em `markdown.test.ts`, o teto absoluto de 3 s e a razão abaixo de 8 em cada um dos 64 casos, medidos em pares na mesma janela e com até 2 retentativas. O quadrático fica acima de 8, ou do teto, nas três. Cada caso confere também o tamanho exato (512 e 128 KiB) na geração que já faz. Com o mesmo teto, prende também a regravação sobre uma nota com 64 Ki espaços e tabs no meio de um parágrafo e de um título, os 20 mil blocos sem id ou com o mesmo id e os 80 mil grupos sem projeção. A equivalência com a conta antiga dos cortes por laço, do `splitRow` e do autolink literal memorizado fica presa por propriedades com semente fixa.
  - **O que o teste prende (revisão 2):** com o teto de 3 s, a regravação sobre as notas fundas. Prende também a razão abaixo de 10 entre a releitura funda e a rasa do mesmo tamanho, e os tetos da reconciliação nas bordas. A memória não muda o resultado: num diferencial com semente fixa (39 mil entradas, no rascunho do lote), o parser saiu igual ao de antes, e a memória errada derruba 26 testes antigos.
  - **Risco que fica:** a edge é mais lenta que o Mac e tem 2 s de CPU, e o tempo real lá só vai ser medido no API-044. O render de nota com muitas quebras duras custa de 2,5 a 3 µs por linha. A nota válida de 2 MiB com 700 mil quebras na raiz leva ~2 s só no render; o plan, os tetos já cortam. O `blocksToText` não tem teto de saída: o código de 200 mil linhas no 64º nível (594 KiB de JSON) vira 24 Mi caracteres de texto, e numa nota de 2 MiB seriam ~85 Mi. A margem da razão é pequena: o linear chega a 7,8 com o arquivo sozinho (macOS ocupando ~2 núcleos) (cache: 512 KiB não cabem onde 128 KiB cabem), e quem segura o falso vermelho com carga é o retry. Uma regressão quadrática forte leva minutos para falhar: o timeout de 60 s não interrompe código síncrono, e o retry repete as 3 tentativas. A regex de volta no Converter.inline levou 18,6 min.
  - **Fora do card:** a colagem do NoteEditor ainda passa pelo micromark (1,5 s com 512 KiB realistas, 16 s com 64 KiB adversários), e o copiar do editor ainda grava o Markdown com perdas do BlockNote. Os dois cards propostos no plano trocam isso pelo `render.ts` e pelo `markdownToNote`.
- **CPU do parser de backlog (API-033).**
  - **Antes:** as regex eram quadráticas com uma linha longa. Com 32 KiB, levavam 5,1 s na linha de tabela sem `|` no fim, 2,1 s no Contexto com espaços, 0,6 s na subtarefa terminada em U+2028 e 0,3 s no `-` seguido de espaços. Na avaliação, com 64 KiB: 20 s, 8,2 s e 1,3 s.
  - **Agora:** o parser lê tudo em tempo linear e fica entre 1 e 35 ms por caso a 512 KiB (M2, Node 22).
  - **Tópicos:** a deduplicação dos `## Tópico:` usa um Set. Com o `includes` num array, o custo era quadrático: 1,5 s a 512 KiB com 37 mil tópicos distintos, contra 6 ms agora. A bateria tem o caso `muitosTopicos`.
  - **O que o teste prende:** a bateria mede a razão em pares, como a do API-023. Um diferencial com 60 mil linhas aleatórias confere a mesma semântica das regex antigas.
  - **Fora do card:** o backfill do `depends_on` dos 56 cards da API v1, que têm "Depende de" só no Contexto. Ele escreve em produção e precisa do OK do usuário.
- **Loja (API-028).**
  - **API-022:** as RPCs de venda são INVOKER e apagam uma linha de `finance_transactions` ao cancelar, reabrir e excluir. Com "DELETE exige Excluir", o token precisaria de `financas.transacoes` com Excluir, mas a §7 pede Escrever. A exceção para a receita vinculada a uma venda é decisão do API-022. Apontar a conta e a categoria da receita exige ler `financas.contas` e `financas.categorias`.
  - **API-025:** o `api_undo_call` reinsere como o usuário, e as regras de INSERT recusam venda fora de negociação ou com data ou receita; o item passa de novo pelo estoque. Desfazer a exclusão de uma venda consumida não é suportado. Desfazer uma chamada que apagou a receita a reinsere desvinculada, e a venda continua cancelada ou reaberta. O API-025 decide, por exemplo com um GUC ligado só por ele, como no API-021.
  - **API-048:** `store_product_figures` é a base dos números (sobre as linhas visíveis, como a tela); o líquido e o lucro da venda ficam nos testes de `_domain` e no harness.
  - **API-052:** a versão otimista na venda (`p_expected_updated_at`) fica para lá. A cascata SET NULL de uma receita apagada em Transações também muda o `updated_at` da venda, e as RPCs de item não mexem nele.
  - **Janela entre o apply e o merge:** o front antigo continua compatível, mas um `createSale` seguido de `addSaleItems` acima do estoque deixa uma venda vazia no quadro. O valor negativo digitado em venda passa a ser recusado (23514). Em compras e produtos, gravados direto pelo app até o API-037, a recusa vale também depois do merge. O front do API-028 desliga o Salvar com valor negativo, desfaz a despesa lançada quando a compra é recusada e traduz o erro. A compra com a despesa numa transação só fica para o API-037.
  - **Card "Sair do workspace leva as linhas da Loja":**
    - só o `leave_workspace` de hoje torna privadas as transações de quem sai, inclusive a receita que ele lançou na venda de outra pessoa do workspace;
    - a dona passa a ver a venda sem a receita. Editar a nota passa, mas mudar o dinheiro, cancelar ou excluir dá 42501 até quem lançou apagar a receita em Transações;
    - o `remove_workspace_member` nem chega a esse ponto: é recusado com 42501 ("Somente o autor pode realocar o lancamento") para quem tem qualquer linha financeira no workspace (transação, conta, categoria, orçamento, meta ou recorrente). Ele anula o `workspace_id` dessas linhas com o `auth.uid()` da dona, e o ws_guard só deixa o autor realocar. Há um card próprio, abaixo; o harness prende o 42501 de hoje na seção 8b;
    - o card decide entre manter essas receitas no workspace ou desvinculá-las no mesmo passo;
    - o card faz o UPDATE de `workspace_id` da Loja na ordem vendas → só os itens de quem sai nelas. O item de outra pessoa na venda de quem sai fica com o workspace antigo e segue a venda: os membros deixam de vê-lo, e o autor só o lê.
  - **Card "remove_workspace_member falha para membro com linhas financeiras":** problema anterior ao lote (baseline). A dona não consegue remover um membro que tenha qualquer linha financeira no workspace, e no app "Remover membro" no WorkspaceModal dá erro. Fica fora do lote 06; o texto do card está no relatório desta correção.
  - **Compras pelo app (até o API-037):** a despesa vinculada tem valor > 0 (CHECK `amount > 0` de `finance_transactions`). Com o total zero, "Gerar despesa" desliga e desmarca nos três modais; `createPurchase` e `markPurchased` não lançam despesa de total zero; a compra com despesa não vai a zero (`updatePurchase` recusa antes de gravar, com `finance_store_error_expense_not_positive`); a trava vale só para a edição que leva o total a zero: a compra antiga que já está com total zero e despesa (gravada antes da trava ou por escrita direta) ainda muda de fase, notas e data, e a despesa recebe só a data, nunca o valor zero que o banco recusaria. A recusa da despesa conta como falha traduzida: a compra nova não grava sem ela, e na edição a compra fica gravada e salvar de novo regrava a despesa. "Marcar como comprado" no kanban grava pelo `markPurchased`: a despesa nasce da compra que abriu o modal, e status e vínculo vão num update só; recusada a compra, a despesa recém-lançada é apagada.
