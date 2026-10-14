# Matriz de RLS — role × tabela × operação

Levantada em 2026-08-10 (SEC-001) direto do banco remoto (`nhfftophadasiezrzlsv`)
via `pg_policies`/`pg_proc`/`storage.buckets`, não de leitura de código — reflete
o schema **ao vivo**, não o que os arquivos de migração "deveriam" produzir.
Fonte de verdade executável: `supabase/migrations/20260509000000_baseline_remote_schema.sql`
(schema `public`) e `20260509000001_sec_storage_policies_baseline.sql` (schema
`storage`). Se esta tabela divergir do banco, o banco manda — reexecute as
consultas abaixo e atualize este arquivo.

Convenção: `own` = linha pertence ao usuário (`user_id`/`owner_id` = `auth.uid()`);
`ws` = membro do workspace financeiro (`is_workspace_member()`); `admin` =
`profiles.role = 'admin'`; `share` = destinatário de um compartilhamento
(`page_shares`/`project_shares`/`finance_goal_shares`).

## Excalinotion (pages, sharing, presence, conteúdo)

| Tabela | Operação | Quem | Mecanismo | Observação |
|---|---|---|---|---|
| `pages` | SELECT | own, `page_is_readable()` | RLS direta + fn SECURITY DEFINER | fn percorre a árvore de páginas (recursiva) checando dono/compartilhamento em cada ancestral |
| `pages` | INSERT | own; com pai, só onde escreve (`page_is_writable(parent_id)`) | RLS direta + fn SECURITY DEFINER | SEC-005: antes dava para pendurar página no ID de uma página alheia |
| `pages` | UPDATE | own, `page_is_writable()` | RLS direta + fn SECURITY DEFINER | fn exige `role IN ('editor','co_owner')` na cadeia de ancestrais |
| `pages` | DELETE | own | RLS direta | so' o dono apaga, mesmo co_owner nao pode |
| `pages` | trigger | — | `prevent_page_ownership_transfer` | força `user_id` de volta ao valor antigo se a sessão tem `auth.uid()` — impede roubo de página via UPDATE |
| `pages` | trigger | — | `guard_page_parent` (SEC-005) | mudança de `parent_id` pela API: o novo pai tem de ser do mesmo dono (comparado com o `user_id` antigo) e não pode ser a própria página nem uma subpágina dela; ir para a raiz é livre. Verificação: `supabase/checks/sec005-page-parent.sql` |
| `page_shares` | SELECT | own (owner_id) ou share (shared_with_user_id) | RLS direta | |
| `page_shares` | INSERT | own | RLS + `current_user_can_share_page()` | exige ser dono OU co_owner (nomeado pelo dono) da página |
| `page_shares` | UPDATE | own (owner_id), **só a coluna `role`** | grant `update (role)` + RLS (`WITH CHECK` também exige `current_user_can_share_page(page_id)`) + trigger `page_shares_freeze_target` | **SEC-002 (25/09/2026):** antes dava para trocar `page_id` e ganhar acesso à página de outra pessoa. Agora o alvo (`page_id`, `owner_id`, `shared_with_user_id`) é congelado. O destinatário continua sem poder mudar o próprio `role` |
| `page_shares` | DELETE | own (owner_id) | RLS direta | |
| `page_presence` | SELECT/INSERT | `page_is_readable()` | fn SECURITY DEFINER | |
| `page_presence` | UPDATE/DELETE | own (user_id) | RLS direta | |
| `todos` | SELECT | `page_is_readable()` | fn | |
| `todos` | INSERT/UPDATE/DELETE | own + `page_is_writable()` | RLS + fn | |
| `mindmap_contents` / `drawing_contents` / `note_contents` | SELECT | `page_is_readable()` | fn | conteúdo 1:1 com a página, mesma regra para as 3 |
| idem | INSERT/UPDATE | `page_is_writable()` | fn | |
| idem | DELETE | dono da página (subquery direta em `pages`, não via fn) | RLS direta | inconsistente com o padrão acima mas equivalente em efeito |
| `notifications` | SELECT/UPDATE/DELETE | own (user_id) | RLS direta | UPDATE só da coluna `read` (grant por coluna, `notif001`): o dono marca lida/não lida, não reescreve título, corpo nem `data` |
| `notifications` | INSERT | **nenhuma policy** | — | linhas só entram via `_notify()` (SECURITY DEFINER), nunca por INSERT direto do cliente |

## Profiles & Invites

| Tabela | Operação | Quem | Mecanismo | Observação |
|---|---|---|---|---|
| `profiles` | SELECT | própria linha, `is_admin()`, `profile_is_related()` | RLS + 2 fns SECURITY DEFINER | `profile_is_related` evita expor `profiles` inteira para busca de compartilhamento |
| `profiles` | UPDATE | own ou admin | RLS (`profiles_update`, uma policy com `id = auth.uid() OR is_admin()` desde o PERF-002) | **campos `role`/`is_active`/`invite_slots_remaining` são congelados pelo trigger `enforce_profile_privilege_bounds`** mesmo que a policy permita o UPDATE — auto-promoção bloqueada na camada de trigger, não na policy |
| `profiles` | DELETE | admin | RLS | |
| `profiles` | INSERT | — | sem policy de INSERT para authenticated/anon | linha só é criada pelo trigger `on_auth_user_created` → `handle_new_user()` (SECURITY DEFINER) no signup |
| `invite_codes` | SELECT | criador ou admin | RLS direta | |
| `invite_codes` | INSERT | **ninguém** (`with_check = false`) | RLS hard-deny | só entra via RPC `generate_invite_code()` (SECURITY DEFINER) |
| `invite_codes` | UPDATE | **ninguém** (`using = false`) | RLS hard-deny | consumo do código é via `handle_invite_code_on_signup()` (roda como trigger em `auth.users`, bypassa RLS) |
| `invite_codes` | DELETE | admin, só código usado/expirado | RLS direta | revogação de código não-usado é via RPC `admin_revoke_invite_code()` (que também devolve o slot ao criador) |

## Finance — base (contas, categorias, orçamentos, metas, recorrências, transações)

Desde o PERF-002 (25/09/2026), cada tabela tem **uma policy por comando**
(`<tabela>_select|_insert|_update|_delete`, `TO authenticated`). Cada uma é o OR
de "own" com os acessos extras da tabela abaixo (workspace via
`is_workspace_member()`, compartilhamento). Antes eram `owner_all` (ALL) + policies
extras separadas, todas `TO public`; o acesso resultante é o mesmo (conferido
linha a linha na migration `20260925191300`). O trigger
`finance_guard_workspace` está em 16 tabelas: as 6 desta seção que têm
`workspace_id`, as 5 da Loja mais `finance_suppliers` e as 4 de empréstimos.

| Tabela | SELECT extra | INSERT | UPDATE extra | DELETE extra | Trigger de integridade |
|---|---|---|---|---|---|
| `finance_accounts` | workspace | own | — | — | `trg_finance_accounts_ws_guard` |
| `finance_categories` | workspace | own | workspace | workspace | `trg_finance_categories_ws_guard`; `finance_categories_ws_exit` (BEFORE UPDATE OF `workspace_id`, `private.finance_category_ws_exit`, DEFINER, API-064): na ida de um workspace para o privado, se o autor já tem a pessoal com o mesmo nome e tipo, renomeia para "Nome (nome do W)", ou "Nome (workspace)" quando o W já sumiu, com número até ficar único (a UNIQUE NULLS NOT DISTINCT dava 23505). Padrão da linha: vale também sem usuário (cascata de apagar o W, exclusão de conta, restore) |
| `finance_budgets` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_budgets_ws_guard` |
| `finance_goals` | workspace, via `finance_goal_shares` emitido pelo dono da meta (API-012) | own | — | — | `trg_finance_goals_ws_guard` |
| `finance_goal_shares` | invitee (`shared_with_user_id`) | own, e só de meta própria (`finance_goal_owned`, API-012); **sem UPDATE** (sem policy nem grant: outro alvo é outro share) | — | — | nenhum (goal sharing é pessoa-a-pessoa, sem workspace) |
| `finance_goal_contributions` | quem vê a meta vê os aportes: dono da meta, invitee com share válido e membros do workspace (API-012) | own; invitee e membro do workspace também podem INSERT; UPDATE só em `amount`, `note` e `date` (grant por coluna: `goal_id` e `user_id` travados, API-012). Aporte pelo app: `finance_goal_contribute` | — | — | nenhum |
| `finance_recurring` | workspace | own | — | — | `trg_finance_recurring_ws_guard`; `finance_recurring_day_moved` (AFTER UPDATE OF `day_of_month`, API-016): move para o dia novo os pendentes sem transação do mês atual de São Paulo em diante, um por vez, e o que colidiria fica. Vale também sem usuário (é padrão da linha, não validação) |
| `finance_recurring_entries` | via `finance_recurring.workspace_id` (subquery) | own. INSERT, ou troca de `recurring_id`/`user_id`, só em recorrente da própria pessoa: o gatilho fecha a pré-ocupação do mês por outro membro (API-016). UPDATE só em `status`, `amount` e `transaction_id` (grant por coluna: `recurring_id`, `user_id` e `due_date` travados). Passar para `paid` exige `transaction_id` da própria pessoa. Pelo app, pagar e pular vão por `finance_mark_entry_paid` e `finance_skip_entry` (INVOKER), e os lançamentos do mês e do seguinte nascem no servidor (`finance_materialize_recurring` e o cron `finance-recurring-materialize`) | — | — | `finance_recurring_entries_guard` (BEFORE INSERT/UPDATE, `private.finance_recurring_entry_guard`; pula sem usuário: restore e cron) |
| `finance_transactions` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_transactions_ws_guard` |

`finance_guard_workspace()` (versionada em `20260708120000_sec_finance_workspace_integrity.sql`)
valida no INSERT/UPDATE que `workspace_id`, quando preenchido, corresponde a um
workspace do qual o usuário é membro — sem isso um usuário poderia gravar
`workspace_id` de um workspace alheio direto pelo client. Desde o API-006
(`20261005150000_api006_guards_without_user`) ela pula o contexto sem usuário
(restauração pelo service_role, `pg_cron`, migrations); sessão do app
continua conferida, e um JWT de cliente sem `sub` também.

Desde o API-064/065 (`20261014120000_api064_065_workspace_exit`), o UPDATE
compara o autor com `is distinct from` (um JWT de cliente sem `sub` cai na
guarda, não só no RLS) e tem duas saídas estreitas, só para a linha que vai de
um workspace para o privado com o mesmo autor:
- **(a)** o workspace antigo já não existe: o SET NULL de apagá-lo, também
  sobre a sobra de quem saiu antes (a receita ou o item de ex-membro na venda de
  quem ficou). Sem GUC;
- **(b)** o GUC transacional `akool.ws_release` vale o workspace antigo, o autor
  já não é membro dele e quem grava é a dona (filiação com `role = 'owner'`).
  Só `private.finance_workspace_release` liga o GUC (e desliga ao terminar):
  é o caminho do `remove_workspace_member`, que apaga a filiação antes. Nenhum
  cliente liga um GUC `akool.*` pelo PostgREST; o GUC existe porque o RLS de
  `finance_loan_payments` e `finance_loan_collaterals` (`loan_is_owner`) deixa
  o membro atualizar a linha de outra pessoa. Nas outras tabelas o WITH CHECK
  do UPDATE já barraria a dona (prova no harness `api064-workspace-exit.sql`,
  seção 7).

A guarda continua `search_path=public`, sem EXECUTE para clientes, nos mesmos
16 gatilhos (o `create or replace` mantém o OID).

## Finance — workspace / family sharing

| Tabela | Operação | Quem | Observação |
|---|---|---|---|
| `finance_workspaces` | SELECT | owner ou membro (`is_workspace_member`) | |
| `finance_workspaces` | INSERT/UPDATE | owner | uma policy por comando desde o PERF-002; todas as policies desta seção são `TO authenticated` |
| `finance_workspaces` | DELETE | **nenhuma policy** (o API-064 tirou a `finance_workspaces_delete`, sem REVOKE de tabela) | o W só é apagado pelo `leave_workspace` da última pessoa (DEFINER), depois de tirar as linhas dela; o DELETE direto afeta 0 linhas |
| `finance_workspace_members` | SELECT | qualquer membro do workspace | |
| `finance_workspace_members` | INSERT | ninguém direto: só pelas RPCs `create_workspace` e `accept_workspace_invite` (o SEC-013 removeu a policy `wm_owner_insert`) | |
| `finance_workspace_members` | DELETE | **nenhuma policy** (o API-064 tirou a `wm_owner_delete`, sem REVOKE de tabela) | a filiação só sai pelas RPCs `leave_workspace` e `remove_workspace_member` (DEFINER), que levam junto as linhas de quem sai; antes, o DELETE direto deixava tudo no W |
| `finance_workspace_members` | UPDATE | **nenhuma policy** | troca de `role` (member→owner) só acontece dentro das funções `create_workspace`/`leave_workspace` (SECURITY DEFINER), nunca via UPDATE direto do cliente — achado documentado, não é bug |
| `finance_workspace_invites` | SELECT | membro do workspace, ou convidado (por `invited_user_id` ou `auth.email()`) | usa `auth.email()` embutido — corrige bug histórico de policy antiga que fazia join direto em `auth.users` sem permissão |
| `finance_workspace_invites` | INSERT | membro do workspace | |
| `finance_workspace_invites` | UPDATE | convidado (aceitar/recusar) | **sem `WITH CHECK`** — quais campos podem mudar é controlado pelo trigger `finance_guard_invite_update` (já versionado), não pela policy |
| `finance_workspace_invites` | DELETE | **nenhuma policy** | delete efetivo só via `ON DELETE CASCADE` de `finance_workspaces` |

**Sair e ser removido (API-064/065).** `leave_workspace` e
`remove_workspace_member` (DEFINER, `search_path` vazio, só `authenticated`)
começam com `SELECT ... FOR UPDATE` na filiação de quem chama, o que serializa
sair × remover. O remove apaga a filiação primeiro ("User is not a member of
this workspace" quando já não há), e o leave a apaga depois; a última pessoa
apaga o W. Nos dois, `private.finance_workspace_release(pessoa, W)` (INVOKER,
sem EXECUTE para clientes) tira do W o que a pessoa criou (`user_id`):
- as vendas dela, desvinculando a receita de outra pessoa (que fica no W como
  lançamento comum), e os itens dela nessas vendas; o item de outra pessoa na
  venda dela fica com o W antigo e segue a venda;
- os produtos e depois as compras dela (desvinculando a despesa de outra
  pessoa), os clientes e os fornecedores;
- as transações, menos a receita ou despesa ligada a venda ou compra de outra
  pessoa que continua membro (mesmo privada): ela fica no W, seguindo a venda;
- orçamentos, metas e recorrentes, e as contas que nenhuma linha de outra
  pessoa usa (as usadas ficam no W, para o saldo dos outros não mudar);
- as categorias do W não saem (o histórico dos outros não perde categoria);
- `shared_with_user_id` = a pessoa, nas linhas de outras pessoas que ficam no W,
  vira nulo quando as duas não têm outro vínculo (a regra do
  `profile_is_related`, em `private.finance_people_related`).

Empréstimos não saem (API-067). `private.finance_workspace_reconcile()` aplica o
mesmo release às sobras de quem já não é membro (backfill da migration e depois
de um restore antigo).

## Finance — loja (store) e fornecedores

`finance_store_purchases`, `finance_store_sales`, `finance_store_sale_items`,
`finance_store_products`, `finance_store_customers`, `finance_suppliers` — todas
já versionadas (`finance_store_module.sql`/`finance_projects_module.sql`/
`finance_restore_suppliers.sql`), mesmo padrão em todas as 6 (exceto o
SELECT, o UPDATE e o DELETE de `finance_store_sale_items`, que seguem a venda
desde o API-028; ver abaixo):

| Operação | Quem |
|---|---|
| SELECT | own ou workspace (`is_workspace_member`) |
| INSERT | own (`with_check = user_id = auth.uid()`, não aceita workspace-write) |
| UPDATE/DELETE | own ou workspace |

O item segue a venda (API-028). Em `finance_store_sale_items`:
- o SELECT vale para o dono do item ou para quem vê a venda: `exists (select 1 from finance_store_sales s where s.id = sale_id)`, avaliado com o RLS da venda;
- o UPDATE (USING e WITH CHECK) e o DELETE valem só para quem vê a venda.

O termo "membro do workspace do item" saiu das três. Isso fecha dois buracos:
- **Itens invisíveis numa venda visível.** O item que B pôs na venda da A ficava invisível para a A depois que ela saía do workspace ou era removida. Agora quem vê a venda vê todos os itens, e o líquido das RPCs, que são INVOKER, não muda conforme quem chama.
- **Itens de outra pessoa quando a venda sai do workspace.** Isso acontece com o UPDATE de `workspace_id` do dono, que o ws_guard deixa, ou quando o dono sai do workspace ou é removido (API-064, abaixo). O item de outra pessoa fica com o workspace antigo e some para os membros que já não veem a venda: eles não o leem, não mudam o preço (que entraria na receita do dono) e não o apagam.

O autor do item que perdeu acesso à venda ainda o lê, mas não o altera nem o apaga (pela RPC, P0002). No app nada some de uma venda da tela: o `financeStoreCalc` já ignorava item cuja venda não está visível. Quem é de fora e quem é de outro workspace continuam sem ver os itens (harness, seções 8b e 10).

O INSERT continua só em nome próprio. As cascatas de FK e as funções DEFINER (`leave_workspace`, restore) não passam pelo RLS.

Custo: o `auth.uid()` segue em InitPlan, e o EXISTS vira um SubPlan com hash ou usa o índice da chave da venda.

O levantamento do harness conta os itens num workspace diferente do da venda, que são os que mudam de visibilidade. No staging deu 0.

Desde o API-028 (`20261012120000_api028_store_sales_server`), por cima das policies:

- **Dinheiro >= 0** por CHECK (`finance_store_<t>_money_nonneg`) em produtos (`target_price`), compras (`unit_cost`, `other_costs`), vendas (`shipping_charged`, `shipping_cost`, `fees`) e itens (`unit_price`, `unit_cost_at_sale`). Vale também sem usuário (restore).
- **`updated_at` do servidor** (`public.update_updated_at`, só em UPDATE) nas 5 tabelas da Loja; o INSERT do restore guarda o do backup.
- **Venda** (`finance_store_sales_rules` → `private.store_sale_rules`, DEFINER): nasce em `negotiating`, sem datas nem receita; status só nos 10 pares de `_domain/saleTransitions.ts` (fora deles, P0001), com os carimbos (sold guarda ou ganha `sold_on`; só delivered tem `delivered_on`; negociação sem datas; cancelada guarda); negociando ou cancelada com receita: P0001; reabrir uma cancelada confere o estoque global; `sold_on` obrigatório na venda consumida e até amanhã em São Paulo (conferido só quando status ou `sold_on` mudam); `delivered_on` só na venda entregue, finita, até amanhã em São Paulo e não antes do `sold_on` (conferido quando status ou `delivered_on` mudam, e o "não antes do `sold_on`" também quando o `sold_on` muda; 22023); cliente, conta e receita têm de ser visíveis para quem grava e do escopo do DONO da venda (dele ou de um workspace de que ele é membro), com P0002 igual para inexistente e alheio; receita só `income`, sem outro vínculo (venda ou compra) e sem trocar uma receita por outra (P0001).
- **Item** (`finance_store_sale_items_rules` → `private.store_sale_item_rules`, DEFINER): não muda de venda; não sai do workspace da venda (UPDATE de `workspace_id` para outro que não o da venda: 22023; o SET NULL de apagar o workspace passa, na ordem que for entre venda e item); venda e produto visíveis (P0002) e travados (FOR NO KEY UPDATE); no INSERT herda o workspace da venda quando quem grava é membro (senão fica privado); item único com 1 unidade; produto arquivado fora de venda nova; estoque **global** (comprado sem cotação menos os itens de vendas não canceladas, de qualquer dono, também os que quem grava não vê); nome em branco vem do produto. O item segue a venda: SELECT pelo dono do item ou pela venda visível; UPDATE e DELETE só pela venda visível (parágrafo acima da lista).
- Os dois gatilhos pulam sem usuário (restore, cron, SQL pelo MCP) e validam só o que mudou: as cascatas de SET NULL (apagar conta, cliente, transação, produto ou workspace) passam mesmo sobre venda antiga fora da regra.
- **Pelo app**, as vendas vão pelas RPCs SECURITY INVOKER `store_sale_create`, `store_sale_set_status`, `store_sale_update`, `store_sale_items_add`, `store_sale_items_update`, `store_sale_items_remove`, `store_sale_generate_income` e `store_sale_delete` (EXECUTE só de `authenticated`), cada uma numa transação com a receita vinculada. A receita nasce em nome de quem chama, no workspace da venda se ele é membro; a receita de outra pessoa (invisível para quem chama) só barra a chamada que muda o que ela leva (líquido, data ou conta) ou que a apaga (cancelar, reabrir, excluir). Nesses casos dá 42501, e a mensagem diz que quem a lançou a altera ou apaga em Transações. Editar uma nota, ou gravar um item sem mudar o valor, passa com `transaction` nulo. Voltar de enviada para vendida com outra data leva a data da receita junto (`transaction_changed` true). `store_product_figures(uuid[])` (INVOKER) devolve comprado, vendido, reservado, disponível e custo médio sobre as linhas visíveis.
- Compras e produtos continuam gravados direto pelo app (API-037).
- **Saída do workspace (API-064/065).** Quem sai ou é removido leva as linhas da Loja e os fornecedores que criou (seção de workspace acima): produtos, compras, vendas, os itens dele nessas vendas, clientes e fornecedores. A receita ou despesa que ele lançou na venda ou compra de quem fica continua no W, seguindo a venda; a de quem fica na venda ou compra dele é desvinculada. Os gatilhos do API-028 aceitam esse UPDATE (só `workspace_id` e `transaction_id` → nulo). Efeito conhecido: a compra de quem fica de um produto de quem saiu perde o produto na tela, e mudar a quantidade do item com esse produto dá P0002.

## Notas rápidas, estudos, backups

| Tabela | Operação | Quem |
|---|---|---|
| `quick_notes` | SELECT/INSERT/UPDATE/DELETE | own; `updated_at` é do servidor (gatilho `quick_notes_updated_at`, API-003) e serve de versão: o app grava condicionado a ela |
| `study_topics` / `study_cards` / `study_logs` | SELECT/INSERT/UPDATE/DELETE | own. Card e diário só em tópico do mesmo dono: os gatilhos `study_cards_rules` e `study_logs_rules` (API-021) dão P0002 "Tópico não encontrado", igual para tópico alheio e inexistente. A forma dos JSON de `study_cards` é conferida pelo gatilho (só a coluna que mudou) e pelas CHECK `study_cards_resources_safe`/`study_cards_json_arrays`, que valem também sem usuário. `started_at`, `completed_at` e `updated_at` são do servidor (sem usuário, um UPDATE que mude só o `updated_at` guarda o valor: é o conserto à mão de versão no futuro); o app (API-029) não manda nenhum dos três e usa o `updated_at` como versão dos campos escalares (`.eq('updated_at', …)` e releitura com zero linhas). O `sort_order` é do servidor: o app cria e anexa cards só por `study_cards_append` e `study_import_topic`, que põem max+1 com o tópico travado; o gatilho ainda guarda o valor de um INSERT direto (o restore do backup usa isso) e, sem valor, põe max+1 entre os cards do mesmo dono no tópico. A posição antiga pode repetir: a ordem do roteiro desempata por `created_at` e `id`. Pontos, recursos e respostas do quiz o app grava item a item pelas RPCs SECURITY INVOKER do API-024 (parágrafo abaixo), sem regravar a coluna inteira; o UPDATE direto da lista inteira continua aceito pelo gatilho (aba aberta antes do deploy, até recarregar). |
| `site_backups` / `site_backup_settings` | SELECT | admin apenas |
| `site_backups` / `site_backup_settings` | INSERT/UPDATE/DELETE | **nenhuma policy** | só `service_role` (edge function `site-backup`) escreve |
| `profile_secrets` | qualquer operação | **RLS habilitado, zero policies** | intencional: só `service_role` acessa (chaves de API de IA); ver advisory `rls_enabled_no_policy` — não é um gap, é o desenho |

A API v1 foi descontinuada em 14/10/2026. As tabelas `api_tokens` e
`private.api_scope_catalog`, as 7 RPCs de token (`create_api_token`,
`update_api_token_scopes`, `revoke_api_token`, `revoke_all_my_api_tokens`,
`delete_api_token`, `resolve_api_token`, `resolve_api_token_v2`) e as funções
`private.api_*` saíram do banco na migration
`20261015100000_remove_api_and_queue` (prova:
`supabase/checks/remove-api.sql`).

## Projects module

| Tabela | Operação | Quem | Mecanismo |
|---|---|---|---|
| `project_boards` | SELECT | own ou `user_can_access_board(id,'viewer')` | fn SECURITY DEFINER |
| `project_boards` | INSERT/UPDATE/DELETE | own | RLS direta |
| `project_columns` | SELECT | `user_can_access_board(board_id,'viewer')` | |
| `project_columns` | INSERT/UPDATE/DELETE | `user_can_access_board(board_id,'editor')` | |
| `project_cards` | SELECT | viewer do board | |
| `project_cards` | INSERT/UPDATE/DELETE | editor do board | **API-013:** gatilho BEFORE INSERT/UPDATE `project_cards_integrity` (abaixo) |
| `project_shares` | SELECT | owner ou share (shared_with_user_id) | |
| `project_shares` | INSERT | owner, e precisa ser dono do board também | |
| `project_shares` | UPDATE | owner, **só a coluna `role`**, e precisa continuar dono do board | **SEC-002:** grant `update (role)` + trigger `project_shares_freeze_target` impedem re-apontar `board_id`. Destinatário não altera o próprio `role` |
| `project_shares` | DELETE | owner | |

**Regras de card no servidor (API-013, `20261007130000_api013_project_cards_integrity`).**
O RLS diz quem edita o quadro; o gatilho `private.project_card_integrity`
(SECURITY DEFINER, `search_path=''`) diz o que um card pode conter. Ele faz
duas coisas mesmo sem usuário: põe o card sem `sort_order` no fim da coluna (a
coluna não tem mais DEFAULT) e cuida do `updated_at`, que é a versão do
conteúdo. Mudar o conteúdo grava `clock_timestamp()`, e a versão sempre avança
(`greatest` com `old.updated_at` + 1 µs), mesmo duas vezes na mesma transação:
o gatilho da fila `cq_on_card_change` (que saiu com a fila, ver abaixo) mudava o card
depois do RETURNING do app, e com `now()` a versão ficaria igual. Mover (`column_id`/`sort_order`) mantém
a versão, e o valor mandado pelo cliente é ignorado (menos no INSERT sem
usuário: o restore mantém o `updated_at` do backup). Sem usuário
(restore, seed: a regra de "Gatilhos que dependem do usuário" em
`supabase/migrations/README.md`), o resto pula. Com usuário, no INSERT, quem não edita o quadro recebe só a recusa
genérica `42501` "Sem permissão para editar este quadro", antes de qualquer
regra: o gatilho roda antes do WITH CHECK do RLS, e as mensagens abaixo
contariam quem é membro e que cards e colunas existem (no UPDATE, o USING já
esconde a linha). Depois, valida só o que mudou:
- **Quadro e coluna:** a coluna é do mesmo quadro, e `board_id` não muda.
- **Pai:** do mesmo quadro, sem ciclo.
- **Dependências:** só as acrescentadas são conferidas (existem, são do mesmo
  quadro, não são o próprio card e não fecham ciclo), até 100. As antigas e as
  órfãs ficam.
- **Grafo:** mudar pai ou dependência (e criar card) espera a vez numa trava
  do site (`pg_advisory_xact_lock`, gatilho por instrução
  `project_cards_graph_lock`), para duas gravações ao mesmo tempo não fecharem
  um ciclo que nenhuma das duas vê. A trava vem antes de qualquer linha travada,
  então uma instrução de várias linhas (o cronograma) não entra em deadlock com
  outra.
- **Responsável:** tem acesso ao quadro (`private.cq_board_role`).
- **Página vinculada:** legível (`page_is_readable`).
- **Formas:**
  - checklist: até 500 `{id, text, completed, owner?}`;
  - rótulos: até 30, de 1 a 50 caracteres sem espaço nas pontas, sem repetir
    ignorando a caixa;
  - anexos: até 50 `{id, url, name}`. Um anexo novo só aceita caminho sob
    `<quem envia>/<quadro>/`. "Novo" é o par (`id`, `url`) que não estava no
    card: trocar a URL de um id antigo não escapa.

As recusas das regras saem com `hint='akool'`, e o app mostra o motivo (a
recusa genérica de quem não edita o quadro sai sem hint, de propósito, e o app
diz que a pessoa não tem permissão). Sem usuário (restore, seed), as formas
não são conferidas: valem só as CHECK da tabela (links, prioridade,
`estimated_days`). A fila de desenvolvimento
(`project_card_queue`, o gatilho `project_cards_queue_flow`, as RPCs `cq_*` e os
helpers `private.cq_*`) saiu do banco junto com os tokens, na
`20261015100000_remove_api_and_queue`; o `private.cq_board_role` fica, porque
este gatilho o usa. Prova: `supabase/checks/api013-project-cards.sql` (43
checagens no bloco 1; bloco 2, só no staging: o restore).

Achado à parte (fora do escopo de RLS, registrado aqui por ter aparecido na
mesma auditoria): `project_boards`/`project_columns`/`project_cards`/`project_shares`
concedem grants de tabela amplos (INSERT/SELECT/UPDATE/REFERENCES) também para
`anon`, não só `authenticated` — inofensivo na prática porque toda policy
depende de `auth.uid()` (nulo para anon), mas destoa do padrão mais restritivo
usado em `sec_rpc_grants.sql`/`finance_projects_visibility.sql`. **Corrigido no
SEC-012 (28/09/2026):** `anon` ficou só com SELECT em todo o `public`.

## Storage (`storage.objects`)

Padrão em todos os 7 buckets: primeiro segmento do path do objeto = `auth.uid()`
para INSERT/UPDATE/DELETE (dono só mexe na própria pasta).

| Bucket | `public` (flag do bucket) | Leitura | Escrita |
|---|---|---|---|
| `note-images` | false | qualquer `authenticated` | dono |
| `avatars` | false | qualquer `authenticated` | dono |
| `project-card-images` | false | qualquer `authenticated` | dono |
| `bank-statements` | false | dono apenas | dono |
| `transaction-photos` | false | dono apenas | dono |
| `project-expense-files` | false | dono apenas | dono |
| `store-files` | false | dono apenas | dono |

`note-images`/`avatars`/`project-card-images` têm leitura aberta a qualquer
autenticado (não só ao dono) porque são exibidas para quem recebe um
compartilhamento de página/board. O primeiro segmento do path é o uid de quem
enviou o arquivo, não o do dono da página ou do quadro: num quadro
compartilhado, cada editor sobe na própria pasta
(`<quem envia>/<quadro>/<card>/…` em `project-card-images`; o gatilho do
API-013 só aceita anexo novo nesse formato). Um refino "leitura só por quem
tem a página/board compartilhado" exigiria reestruturar o path do objeto
(registrado como follow-up em `20260708140000_sec_private_buckets.sql`, não
neste card).

`transaction-photos`/`bank-statements`/`project-expense-files`/`store-files`
são dado financeiro pessoal — leitura fica owner-only mesmo quando o registro
relacionado (transação/despesa) é compartilhado via workspace.

## Funções `SECURITY DEFINER` (por que existem)

Todas revisadas pelo advisor do Supabase como "callable by authenticated/anon"
— warning genérico do linter, não um achado novo. Listadas aqui com o motivo:

| Função | Motivo de ser SECURITY DEFINER |
|---|---|
| `is_admin()` | evita recursão de RLS (`profiles` policy chamando função que lê `profiles`) — corrigido em `sec_fix_is_admin_recursion.sql` |
| `page_is_readable`/`page_is_writable`/`current_user_can_share_page` | precisam ler `pages`/`page_shares` **sem** aplicar a RLS dessas mesmas tabelas (senão a policy de `pages` dependeria de si mesma). Desde o SEC-002 só honram share emitido pelo dono da página ou por um co_owner que o próprio dono nomeou |
| `user_can_access_board` | mesmo racional para `project_boards`/`project_shares`; desde o SEC-002 só honra share emitido pelo dono do board (`private.cq_board_role`, que o gatilho de cards do API-013 usa, segue a mesma regra) |
| `is_workspace_member` | mesmo racional para `finance_workspace_members` |
| `profile_is_related` | permite que a policy de `profiles` saiba "esse usuário aparece nos meus compartilhamentos" sem expor a tabela inteira |
| `search_users_for_share` | busca limitada (mín. 3 caracteres, limit 6) para o modal de compartilhamento, sem listar todos os perfis |
| `admin_add_invite_slots`/`admin_revoke_invite_code`/`generate_invite_code`/`validate_invite_code` | mutam `invite_codes`/`profiles.invite_slots_remaining`, que têm RLS hard-deny para INSERT/UPDATE direto |
| `create_workspace`/`invite_member`/`accept_workspace_invite`/`decline_workspace_invite`/`remove_workspace_member`/`leave_workspace` | operações multi-tabela com invariantes (ex.: 1 workspace por usuário) que não dá pra expressar só com RLS |
| `bootstrap_finance_categories`/`bootstrap_workspace_categories` | seed de categorias padrão no primeiro uso; rodar de novo não duplica nem recria o que a pessoa apagou (API-012) |
| `finance_goal_contribute` | aporte atômico: grava, soma no servidor e conclui a meta ao atingir o alvo, mesmo quando quem aporta não é o dono (API-012) |
| `finance_materialize_recurring(p_today, p_month)` | API-016: gera, só para os recorrentes de quem chama, os lançamentos do mês e do seguinte e os orçamentos automáticos. O mês vem da data do aparelho, limitada a ±1 dia do hoje de São Paulo (`private.finance_clamp_today`). `p_month`, o mês visto na tela e opcional, soma só os orçamentos automáticos desse mês, a até 12 meses do mês de São Paulo (mais longe é ignorado), e nunca cria lançamento nele. Orçamento automático nasce na janela (o mês do aparelho e o seguinte) nos mesmos meses que a conta. Fora da janela, nunca nasce antes do mês de criação do recorrente (em São Paulo). Em nenhum caso nasce fora das parcelas de um parcelado; sem nenhum lançamento ainda, a 1ª parcela conta no 1º mês da janela, também quando outro membro do workspace chama. No workspace, sai do recorrente mais antigo entre os de todos os membros, em nome do dono dele, como no cron. Devolve todos os lançamentos da pessoa na janela e todos os orçamentos dos meses tratados que ela enxerga (os pessoais e os dos workspaces de que é membro), criados agora ou antes. É DEFINER porque o núcleo `private.finance_materialize_core` não tem EXECUTE para clientes. O cron chama `private.finance_materialize_all()`, que materializa para todos e, quando algo falha, avisa os admins por `_notify` (tipo `finance_recurring_failed`, no máximo 1 por dia) |
| `_notify` | único caminho de escrita em `notifications` (que não tem policy de INSERT). Desde a `notif001`, um gatilho BEFORE INSERT (`private.notification_enrich`) completa a `data` com `actor_name` e `workspace_name`, e três gatilhos chamam `_notify`: compartilhar página (`page_shares`), compartilhar quadro (`project_shares`) e atribuir card (`project_cards.assignee_user_id`), só quando há um usuário autenticado agindo e ele não é o destinatário |
| `handle_new_user`/`handle_invite_code_on_signup` | disparam em `auth.users` (trigger), fora do controle de RLS do app |

`validate_invite_code` também é chamável por `anon` (tela de cadastro, antes do
login) — único caso, intencional (validar o código antes de criar a conta).

### Quem pode chamar o quê (SEC-012, 28/09/2026)

Migration `20260928145254_sec012_grants_hardening.sql`. Verificação:
`supabase/checks/sec012-grants.sql` (transação desfeita). Depois dela, o
advisor passou a listar 34 funções `SECURITY DEFINER` para `authenticated` (eram 54)
e só a `validate_invite_code` para `anon`. Com o API-001 (05/10/2026) eram 37; com o
API-012 (07/10/2026) eram 39; com o API-016 (08/10/2026) eram 40. A
`20261015100000_remove_api_and_queue` tirou as 11 de tokens e da fila: são **29**
(conferido no advisor do staging). Todas são intencionais:

| Grupo | Funções | Por que continuam com EXECUTE para `authenticated` |
|---|---|---|
| Helpers de RLS (11) | `page_is_readable`, `page_is_writable`, `current_user_can_share_page`, `user_can_access_board`, `is_admin`, `is_workspace_member`, `profile_is_related`, `loan_is_owner`, `loan_is_visible`, `loan_file_is_readable`, `finance_goal_owned` (API-012: a policy de share não pode ler `finance_goals` direto, que lê os shares → recursão 42P17) | a política roda como quem consulta: sem o EXECUTE, o RLS quebra. Tirá-las da API exige movê-las para o schema `private` e refazer as políticas (card à parte) |
| RPCs do frontend (18) | convites (`generate_invite_code`, `validate_invite_code`, `admin_add_invite_slots`, `admin_revoke_invite_code`), workspaces (`create_workspace`, `invite_member`, `accept_/decline_workspace_invite`, `remove_workspace_member`, `leave_workspace`, `bootstrap_*_categories`), `create_project_board`, `search_users_for_share`, perfil (`get_my_profile`, `admin_list_profiles`), aporte de meta (`finance_goal_contribute`) e recorrentes (`finance_materialize_recurring`, API-016) | chamadas com o JWT do usuário; cada uma confere quem chama |

**Só `service_role`** (sem EXECUTE para `anon`/`authenticated`):
- `admin_revoke_user_sessions`: a `admin-ops`;
- `loan_approve`, `loan_cancel_request`, `loan_confirm_payment`, `loan_link_borrower`, `loan_reject`, `loan_reject_payment`, `loan_report_payment`, `loan_request`: não há tela de empréstimos. Uma tela nova precisa devolver o grant na mesma migration;
- `set_ai_credentials` (não há tela) e `check_auto_site_backup_due` (feita para o `pg_cron`, que roda como `postgres`);
- já eram: `_notify`, `check_rate_limit`, `list_public_tables`, `restore_site_backup`, `study_lookup_cache_prune`.

As `cq_*` só de `service_role` (eram da function da fila) e as duas `resolve_api_token*` saíram com a API v1, na `20261015100000_remove_api_and_queue`.

**Privilégios de tabela** em `public`:
- `anon` só tem SELECT (o RLS decide as linhas); nenhuma escrita, TRUNCATE, TRIGGER, REFERENCES ou MAINTAIN;
- `authenticated` escreve onde o RLS deixa, mas sem TRUNCATE (que ignora o RLS), TRIGGER, REFERENCES e MAINTAIN, e sem escrita no `audit_log` (só as edge functions gravam, com `service_role`);
- tabelas novas criadas por `postgres` já nascem assim (privilégio padrão). Funções novas de `postgres` nascem sem EXECUTE para `anon`/`authenticated`. O padrão de `supabase_admin` continua aberto, e só ele muda.

**RPCs `SECURITY INVOKER` do kanban (PERF-004, 28/09/2026):** `reorder_project_cards`, `reorder_project_columns` e `schedule_project_cards` gravam a ordem e as datas numa requisição, com um UPDATE só (tudo ou nada). Rodam como quem chama, então o RLS de edição do quadro (`user_can_access_board` editor) vale linha a linha. Recusam coluna de outro quadro e erram se alguma linha não foi gravada. EXECUTE só para `authenticated`. Não entram na conta do advisor, que só lista `SECURITY DEFINER`.

**RPCs `SECURITY INVOKER` de recorrentes (API-016, 08/10/2026):** `finance_mark_entry_paid(p_entry, p_amount_cents, p_date, p_account)` e `finance_skip_entry(p_entry)` valem só para o dono do lançamento e travam o recorrente antes do lançamento. Pagar faz tudo numa transação:
- cria a transação, herdando o `workspace_id` só se o dono ainda for membro;
- marca o lançamento como pago;
- encerra o parcelado quando pagas + puladas ≥ parcelas.

EXECUTE só para `authenticated`. As funções novas em `private` (`finance_materialize_core`, `finance_materialize_all`, `finance_recurring_due_date` e `finance_clamp_today`) não têm EXECUTE para `anon`/`authenticated`. Os gatilhos `finance_recurring_entry_guard` e `finance_recurring_day_moved` também não têm, mas são SECURITY DEFINER e disparam nas gravações de `authenticated`.

**Estudos (API-021, 08/10/2026):**
- `private.study_card_rules` é SECURITY DEFINER: chama as funções de forma e lê o tópico de qualquer dono, para a mensagem não revelar se ele existe;
- `private.study_log_rules` também é SECURITY DEFINER: quem grava diário no próprio tópico não precisa ler `study_topics`. Prova no bloco 2 de `supabase/checks/api021-study.sql`, só no staging: uma RESTRICTIVE de SELECT em `study_topics` (criada e desfeita na transação) deixa o tópico invisível. O dono grava diário no próprio tópico, e o tópico alheio e o inexistente continuam com o mesmo P0002;
- `private.study_topic_rules` é INVOKER;
- as funções de forma (`private.study_checkpoints_problem`, `study_resources_problem`, `study_quiz_problem`, `study_blocks_problem`, `study_json_index` e `study_without_progress`) são imutáveis e sem EXECUTE para clientes.

Nada disso muda a conta do advisor.

**RPCs `SECURITY INVOKER` de Estudos (API-024, 11/10/2026):** `study_checkpoint_add`, `study_checkpoint_edit`, `study_checkpoint_toggle`, `study_checkpoint_remove`, `study_resource_add`, `study_resource_remove`, `study_quiz_answer`, `study_quiz_reset`, `study_cards_append`, `study_import_topic` e `study_reschedule` (migration `20261011120000_api024_study_rpcs.sql`).

- Rodam como quem chama. O RLS de dono de `study_cards` e `study_topics` vale, e o card ou tópico de outra pessoa dá o mesmo P0002 do inexistente.
- A forma dos JSON continua no gatilho DEFINER `study_cards_rules` (API-021). As RPCs não chamam nada de `private`.
- As RPCs por item travam o card (`FOR NO KEY UPDATE`) e gravam só o índice do item. Anexar, importar e reagendar travam o tópico.
- Repetição sem efeito não grava: nem o `updated_at` muda nem nasce tupla nova. O harness compara o `xmin` da linha e, no reagendar, conta os cards com `xmin` novo (0 na repetição, 1 de amanhã para hoje).
- A trava do quiz (segunda resposta diferente, P0001) existe só na `study_quiz_answer`, sem gatilho.
- EXECUTE só para `authenticated`, revogado de PUBLIC e `anon`.

A regra abaixo pede o grant "só se o frontend chamar com o JWT do usuário". Aqui ele veio antes da chamada porque o API-029 troca a tela de Estudos por essas RPCs. Não há grant para outro papel.

Não entram na conta do advisor, que só lista `SECURITY DEFINER`.

Prova: `supabase/checks/api024-study-rpcs.sql`. No staging, em 11/10/2026, com as transações desfeitas e a versão da revisão (R1/R2, `p_today` e data-alvo infinitos): bloco 1 161/161 (pelo MCP, em duas metades: 107 + 54), subtransações 4/4 e bloco 2 8/8. O bloco 2 simula a RESTRICTIVE de SELECT em `study_topics` do API-022:
- toggle, resposta, reset e operações de conteúdo por item continuam, porque só tocam `study_cards`;
- anexar e reagendar falham fechados com P0002;
- importar falha com 42501, no RETURNING do tópico novo.

**Função nova exposta pela API:** dê `grant execute … to authenticated` na própria migration, só se o frontend chamar com o JWT do usuário, e confira quem chama dentro dela com `coalesce(..., false)` ou `public.is_admin()`, nunca com `!= 'admin'` solto (vira NULL sem linha em `profiles`; era o caso da `generate_invite_code`, corrigida no SEC-012).

## Achados desta auditoria (SEC-001)

- ✅ `page_shares`/`project_shares` UPDATE: auto-promoção de role **bloqueada**
  pelo RLS (`owner_id = auth.uid()` em `USING` e `WITH CHECK`).
- ❌→✅ **Corrigido no SEC-002 (25/09/2026):** a conclusão acima estava
  incompleta. O emissor podia re-apontar a própria share (`page_id`/`board_id`)
  para o recurso de outra pessoa, porque `authenticated` tinha UPDATE em todas
  as colunas. Reproduzido no remoto e corrigido em
  `supabase/migrations/*_sec002_shares_lock_target.sql`: UPDATE só de `role`,
  trigger que congela o alvo, `anon` sem grants nessas tabelas e funções de
  acesso que ignoram shares de emissor sem direito.
- ✅ `profiles.invite_slots_remaining`: já congelado pelo trigger
  `enforce_profile_privilege_bounds` — comentário desatualizado no arquivo
  `20260708180000_sec_protect_invite_slots.sql` corrigido nesta mesma tarefa.
- ⚠️→✅ Grants de tabela amplos para `anon` em várias tabelas do módulo de
  projetos (ver seção Projects acima) — inofensivo hoje (RLS cobre), mas fora
  do padrão mais restritivo usado alhures. **Resolvido no SEC-012
  (28/09/2026):** `anon` perdeu toda escrita em `public`, e ninguém da API tem
  mais TRUNCATE/TRIGGER/REFERENCES/MAINTAIN (ver "Quem pode chamar o quê").
- ℹ️ `profile_secrets`/`site_backups`/`site_backup_settings` sem policies de
  escrita para `authenticated`/`anon` — intencional (só `service_role`), não é
  um gap.
