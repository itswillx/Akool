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
| `finance_categories` | workspace | own | workspace | workspace | `trg_finance_categories_ws_guard` |
| `finance_budgets` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_budgets_ws_guard` |
| `finance_goals` | workspace, via `finance_goal_shares` emitido pelo dono da meta (API-012) | own | — | — | `trg_finance_goals_ws_guard` |
| `finance_goal_shares` | invitee (`shared_with_user_id`) | own, e só de meta própria (`finance_goal_owned`, API-012); **sem UPDATE** (sem policy nem grant: outro alvo é outro share) | — | — | nenhum (goal sharing é pessoa-a-pessoa, sem workspace) |
| `finance_goal_contributions` | quem vê a meta vê os aportes: dono da meta, invitee com share válido e membros do workspace (API-012) | own; invitee e membro do workspace também podem INSERT; UPDATE só em `amount`, `note` e `date` (grant por coluna: `goal_id` e `user_id` travados, API-012). Aporte pelo app: `finance_goal_contribute` | — | — | nenhum |
| `finance_recurring` | workspace | own | — | — | `trg_finance_recurring_ws_guard` |
| `finance_recurring_entries` | via `finance_recurring.workspace_id` (subquery) | own | — | — | nenhum próprio (herda da recorrência pai) |
| `finance_transactions` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_transactions_ws_guard` |

`finance_guard_workspace()` (versionada em `20260708120000_sec_finance_workspace_integrity.sql`)
valida no INSERT/UPDATE que `workspace_id`, quando preenchido, corresponde a um
workspace do qual o usuário é membro — sem isso um usuário poderia gravar
`workspace_id` de um workspace alheio direto pelo client. Desde o API-006
(`20261005150000_api006_guards_without_user`) ela pula o contexto sem usuário
(restauração pelo service_role, `pg_cron`, migrations); sessão do app ou da API
continua conferida, e um JWT de cliente sem `sub` também.

## Finance — workspace / family sharing

| Tabela | Operação | Quem | Observação |
|---|---|---|---|
| `finance_workspaces` | SELECT | owner ou membro (`is_workspace_member`) | |
| `finance_workspaces` | INSERT/UPDATE/DELETE | owner | uma policy por comando desde o PERF-002; todas as policies desta seção são `TO authenticated` |
| `finance_workspace_members` | SELECT | qualquer membro do workspace | |
| `finance_workspace_members` | INSERT | ninguém direto: só pelas RPCs `create_workspace` e `accept_workspace_invite` (o SEC-013 removeu a policy `wm_owner_insert`) | |
| `finance_workspace_members` | DELETE | owner (remove qualquer um) ou o próprio membro (sai sozinho) | |
| `finance_workspace_members` | UPDATE | **nenhuma policy** | troca de `role` (member→owner) só acontece dentro das funções `create_workspace`/`leave_workspace` (SECURITY DEFINER), nunca via UPDATE direto do cliente — achado documentado, não é bug |
| `finance_workspace_invites` | SELECT | membro do workspace, ou convidado (por `invited_user_id` ou `auth.email()`) | usa `auth.email()` embutido — corrige bug histórico de policy antiga que fazia join direto em `auth.users` sem permissão |
| `finance_workspace_invites` | INSERT | membro do workspace | |
| `finance_workspace_invites` | UPDATE | convidado (aceitar/recusar) | **sem `WITH CHECK`** — quais campos podem mudar é controlado pelo trigger `finance_guard_invite_update` (já versionado), não pela policy |
| `finance_workspace_invites` | DELETE | **nenhuma policy** | delete efetivo só via `ON DELETE CASCADE` de `finance_workspaces` |

## Finance — loja (store) e fornecedores

`finance_store_purchases`, `finance_store_sales`, `finance_store_sale_items`,
`finance_store_products`, `finance_store_customers`, `finance_suppliers` — todas
já versionadas (`finance_store_module.sql`/`finance_projects_module.sql`/
`finance_restore_suppliers.sql`), mesmo padrão em todas as 6:

| Operação | Quem |
|---|---|
| SELECT | own ou workspace (`is_workspace_member`) |
| INSERT | own (`with_check = user_id = auth.uid()`, não aceita workspace-write) |
| UPDATE/DELETE | own ou workspace |

## Notas rápidas, estudos, backups

| Tabela | Operação | Quem |
|---|---|---|
| `quick_notes` | SELECT/INSERT/UPDATE/DELETE | own; `updated_at` é do servidor (gatilho `quick_notes_updated_at`, API-003) e serve de versão: o app grava condicionado a ela |
| `study_topics` / `study_cards` / `study_logs` | SELECT/INSERT/UPDATE/DELETE | own |
| `site_backups` / `site_backup_settings` | SELECT | admin apenas |
| `site_backups` / `site_backup_settings` | INSERT/UPDATE/DELETE | **nenhuma policy** | só `service_role` (edge function `site-backup`) escreve |
| `profile_secrets` | qualquer operação | **RLS habilitado, zero policies** | intencional: só `service_role` acessa (chaves de API de IA); ver advisory `rls_enabled_no_policy` — não é um gap, é o desenho |
| `api_tokens` | SELECT | own (`api_tokens_select_own`), **grant por coluna** sem `user_id` e `token_hash` | escrita só pelas RPCs SECURITY DEFINER (`create_api_token`, `update_api_token_scopes`, `revoke_api_token`, `revoke_all_my_api_tokens`, `delete_api_token`), que recusam chamada feita com claims de token da API (API-001). `scopes` e `last_client` entraram com `grant select (coluna)`; nunca REVOKE de tabela |
| `private.api_scope_catalog` | qualquer operação | **RLS habilitado, zero policies**, fora da Data API | catálogo de permissões da API (API-001), lido só pelas funções SECURITY DEFINER; mesmo desenho do `private.rate_limits` |

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
conteúdo. Mudar o conteúdo grava `now()`. Mover (`column_id`/`sort_order`) mantém
a versão, e o valor mandado pelo cliente é sempre ignorado. Sem usuário
(restore, `cards-api`, seed: regra do §1.5 do `api-arquitetura.md`), o resto
pula. Com usuário, valida só o que mudou:
- **Quadro e coluna:** a coluna é do mesmo quadro, e `board_id` não muda.
- **Pai:** do mesmo quadro, sem ciclo.
- **Dependências:** só as acrescentadas são conferidas (existem, são do mesmo
  quadro, não são o próprio card e não fecham ciclo), até 100. As antigas e as
  órfãs ficam.
- **Responsável:** tem acesso ao quadro (`private.cq_board_role`).
- **Página vinculada:** legível (`page_is_readable`).
- **Formas:**
  - checklist: até 500 `{id, text, completed, owner?}`;
  - rótulos: até 30, de 1 a 50 caracteres sem espaço nas pontas, sem repetir
    ignorando a caixa;
  - anexos: até 50 `{id, url, name}`. Um anexo novo só aceita caminho sob
    `<quem envia>/<quadro>/`.

As recusas saem com `hint='akool'`, e o app mostra o motivo. `cq_cards` e
`cq_enqueue` comparam rótulo sem caixa (`private.cq_labels_match`). Prova:
`supabase/checks/api013-project-cards.sql` (bloco 2, só no staging: o restore).

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
| `user_can_access_board` | mesmo racional para `project_boards`/`project_shares`; desde o SEC-002 só honra share emitido pelo dono do board (`private.cq_board_role`, da fila de desenvolvimento, segue a mesma regra) |
| `is_workspace_member` | mesmo racional para `finance_workspace_members` |
| `profile_is_related` | permite que a policy de `profiles` saiba "esse usuário aparece nos meus compartilhamentos" sem expor a tabela inteira |
| `search_users_for_share` | busca limitada (mín. 3 caracteres, limit 6) para o modal de compartilhamento, sem listar todos os perfis |
| `admin_add_invite_slots`/`admin_revoke_invite_code`/`generate_invite_code`/`validate_invite_code` | mutam `invite_codes`/`profiles.invite_slots_remaining`, que têm RLS hard-deny para INSERT/UPDATE direto |
| `create_workspace`/`invite_member`/`accept_workspace_invite`/`decline_workspace_invite`/`remove_workspace_member`/`leave_workspace` | operações multi-tabela com invariantes (ex.: 1 workspace por usuário) que não dá pra expressar só com RLS |
| `bootstrap_finance_categories`/`bootstrap_workspace_categories` | seed de categorias padrão no primeiro uso; rodar de novo não duplica nem recria o que a pessoa apagou (API-012) |
| `finance_goal_contribute` | aporte atômico: grava, soma no servidor e conclui a meta ao atingir o alvo, mesmo quando quem aporta não é o dono (API-012) |
| `_notify` | único caminho de escrita em `notifications` (que não tem policy de INSERT). Desde a `notif001`, um gatilho BEFORE INSERT (`private.notification_enrich`) completa a `data` com `actor_name` e `workspace_name`, e três gatilhos chamam `_notify`: compartilhar página (`page_shares`), compartilhar quadro (`project_shares`) e atribuir card (`project_cards.assignee_user_id`), só quando há um usuário autenticado agindo e ele não é o destinatário |
| `handle_new_user`/`handle_invite_code_on_signup` | disparam em `auth.users` (trigger), fora do controle de RLS do app |

`validate_invite_code` também é chamável por `anon` (tela de cadastro, antes do
login) — único caso, intencional (validar o código antes de criar a conta).

### Quem pode chamar o quê (SEC-012, 28/09/2026)

Migration `20260928145254_sec012_grants_hardening.sql`. Verificação:
`supabase/checks/sec012-grants.sql` (transação desfeita). Depois dela, o
advisor passou a listar 34 funções `SECURITY DEFINER` para `authenticated` (eram 54)
e só a `validate_invite_code` para `anon`. Com o API-001 (05/10/2026) eram 37; com o
API-012 (07/10/2026) são **39**, todas intencionais:

| Grupo | Funções | Por que continuam com EXECUTE para `authenticated` |
|---|---|---|
| Helpers de RLS (11) | `page_is_readable`, `page_is_writable`, `current_user_can_share_page`, `user_can_access_board`, `is_admin`, `is_workspace_member`, `profile_is_related`, `loan_is_owner`, `loan_is_visible`, `loan_file_is_readable`, `finance_goal_owned` (API-012: a policy de share não pode ler `finance_goals` direto, que lê os shares → recursão 42P17) | a política roda como quem consulta: sem o EXECUTE, o RLS quebra. Tirá-las da API exige movê-las para o schema `private` e refazer as políticas (card à parte) |
| RPCs do frontend (28) | convites (`generate_invite_code`, `validate_invite_code`, `admin_add_invite_slots`, `admin_revoke_invite_code`), workspaces (`create_workspace`, `invite_member`, `accept_/decline_workspace_invite`, `remove_workspace_member`, `leave_workspace`, `bootstrap_*_categories`), `create_project_board`, `search_users_for_share`, perfil (`get_my_profile`, `admin_list_profiles`), tokens (`create_api_token`, `revoke_api_token`, `update_api_token_scopes`, `revoke_all_my_api_tokens`, `delete_api_token`), aporte de meta (`finance_goal_contribute`) e a fila no `QueueModal` (`cq_list`, `cq_enqueue`, `cq_move`, `cq_remove`, `cq_reprioritize`, `cq_validate`) | chamadas com o JWT do usuário; cada uma confere quem chama. As de token recusam claims de token da API (API-001) |

**Só `service_role`** (sem EXECUTE para `anon`/`authenticated`):
- `cq_block`, `cq_boards`, `cq_card`, `cq_cards`, `cq_check`, `cq_complete`, `cq_next`, `cq_note`, `cq_release`, `cq_setup_flow`, `cq_start`: só a `cards-api` usa;
- `admin_revoke_user_sessions`: a `admin-ops`;
- `loan_approve`, `loan_cancel_request`, `loan_confirm_payment`, `loan_link_borrower`, `loan_reject`, `loan_reject_payment`, `loan_report_payment`, `loan_request`: não há tela de empréstimos. Uma tela nova precisa devolver o grant na mesma migration;
- `set_ai_credentials` (não há tela) e `check_auto_site_backup_due` (feita para o `pg_cron`, que roda como `postgres`);
- já eram: `_notify`, `check_rate_limit`, `resolve_api_token`, `list_public_tables`, `restore_site_backup`, `study_lookup_cache_prune`;
- `resolve_api_token_v2` (API-001): a `cards-api` resolve o token com escopos efetivos. A v1 fica até o API-061.

**Privilégios de tabela** em `public`:
- `anon` só tem SELECT (o RLS decide as linhas); nenhuma escrita, TRUNCATE, TRIGGER, REFERENCES ou MAINTAIN;
- `authenticated` escreve onde o RLS deixa, mas sem TRUNCATE (que ignora o RLS), TRIGGER, REFERENCES e MAINTAIN, e sem escrita no `audit_log` (só as edge functions gravam, com `service_role`);
- tabelas novas criadas por `postgres` já nascem assim (privilégio padrão). Funções novas de `postgres` nascem sem EXECUTE para `anon`/`authenticated`. O padrão de `supabase_admin` continua aberto, e só ele muda.

**RPCs `SECURITY INVOKER` do kanban (PERF-004, 28/09/2026):** `reorder_project_cards`, `reorder_project_columns` e `schedule_project_cards` gravam a ordem e as datas numa requisição, com um UPDATE só (tudo ou nada). Rodam como quem chama, então o RLS de edição do quadro (`user_can_access_board` editor) vale linha a linha. Recusam coluna de outro quadro e erram se alguma linha não foi gravada. EXECUTE só para `authenticated`. Não entram na conta do advisor, que só lista `SECURITY DEFINER`.

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
