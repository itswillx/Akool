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
| `notifications` | SELECT/UPDATE/DELETE | own (user_id) | RLS direta | |
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
linha a linha na migration `20260925191300`). Há também um trigger
`finance_guard_workspace` em 6 delas.

| Tabela | SELECT extra | INSERT | UPDATE extra | DELETE extra | Trigger de integridade |
|---|---|---|---|---|---|
| `finance_accounts` | workspace | own | — | — | `trg_finance_accounts_ws_guard` |
| `finance_categories` | workspace | own | workspace | workspace | `trg_finance_categories_ws_guard` |
| `finance_budgets` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_budgets_ws_guard` |
| `finance_goals` | workspace, via `finance_goal_shares` | own | — | — | `trg_finance_goals_ws_guard` |
| `finance_goal_shares` | invitee (`shared_with_user_id`) | own | — | — | nenhum (goal sharing é pessoa-a-pessoa, sem workspace) |
| `finance_goal_contributions` | owner-da-meta vê tudo, invitee vê o próprio | own; **invitee também pode INSERT** (via `finance_goal_shares`, no `finance_goal_contributions_insert`) | — | — | nenhum |
| `finance_recurring` | workspace | own | — | — | `trg_finance_recurring_ws_guard` |
| `finance_recurring_entries` | via `finance_recurring.workspace_id` (subquery) | own | — | — | nenhum próprio (herda da recorrência pai) |
| `finance_transactions` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_transactions_ws_guard` |

`finance_guard_workspace()` (já versionada em `20260708120000_sec_finance_workspace_integrity.sql`)
valida no INSERT/UPDATE que `workspace_id`, quando preenchido, corresponde a um
workspace do qual o usuário é membro — sem isso um usuário poderia gravar
`workspace_id` de um workspace alheio direto pelo client.

## Finance — workspace / family sharing

| Tabela | Operação | Quem | Observação |
|---|---|---|---|
| `finance_workspaces` | SELECT | owner ou membro (`is_workspace_member`) | |
| `finance_workspaces` | INSERT/UPDATE/DELETE | owner | uma policy por comando desde o PERF-002; todas as policies desta seção são `TO authenticated` |
| `finance_workspace_members` | SELECT | qualquer membro do workspace | |
| `finance_workspace_members` | INSERT | só quem já é `role='owner'` do workspace | |
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
| `quick_notes` | SELECT/INSERT/UPDATE/DELETE | own |
| `study_topics` / `study_cards` / `study_logs` | SELECT/INSERT/UPDATE/DELETE | own |
| `site_backups` / `site_backup_settings` | SELECT | admin apenas |
| `site_backups` / `site_backup_settings` | INSERT/UPDATE/DELETE | **nenhuma policy** | só `service_role` (edge function `site-backup`) escreve |
| `profile_secrets` | qualquer operação | **RLS habilitado, zero policies** | intencional: só `service_role` acessa (chaves de API de IA); ver advisory `rls_enabled_no_policy` — não é um gap, é o desenho |

## Projects module

| Tabela | Operação | Quem | Mecanismo |
|---|---|---|---|
| `project_boards` | SELECT | own ou `user_can_access_board(id,'viewer')` | fn SECURITY DEFINER |
| `project_boards` | INSERT/UPDATE/DELETE | own | RLS direta |
| `project_columns` | SELECT | `user_can_access_board(board_id,'viewer')` | |
| `project_columns` | INSERT/UPDATE/DELETE | `user_can_access_board(board_id,'editor')` | |
| `project_cards` | SELECT | viewer do board | |
| `project_cards` | INSERT/UPDATE/DELETE | editor do board | |
| `project_shares` | SELECT | owner ou share (shared_with_user_id) | |
| `project_shares` | INSERT | owner, e precisa ser dono do board também | |
| `project_shares` | UPDATE | owner, **só a coluna `role`**, e precisa continuar dono do board | **SEC-002:** grant `update (role)` + trigger `project_shares_freeze_target` impedem re-apontar `board_id`. Destinatário não altera o próprio `role` |
| `project_shares` | DELETE | owner | |

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
compartilhamento de página/board — o path hoje só contém o uid do dono, então
um refino "leitura só por quem tem a página/board compartilhado" exigiria
reestruturar o path do objeto (registrado como follow-up em
`20260708140000_sec_private_buckets.sql`, não neste card).

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
| `bootstrap_finance_categories`/`bootstrap_workspace_categories` | seed de categorias padrão no primeiro uso |
| `_notify` | único caminho de escrita em `notifications` (que não tem policy de INSERT) |
| `handle_new_user`/`handle_invite_code_on_signup` | disparam em `auth.users` (trigger), fora do controle de RLS do app |

`validate_invite_code` também é chamável por `anon` (tela de cadastro, antes do
login) — único caso, intencional (validar o código antes de criar a conta).

### Quem pode chamar o quê (SEC-012, 28/09/2026)

Migration `20260928145254_sec012_grants_hardening.sql`. Verificação:
`supabase/checks/sec012-grants.sql` (transação desfeita). Depois dela, o
advisor lista **32** funções `SECURITY DEFINER` para `authenticated` (eram 54)
e só a `validate_invite_code` para `anon`. As 32 são intencionais:

| Grupo | Funções | Por que continuam com EXECUTE para `authenticated` |
|---|---|---|
| Helpers de RLS (10) | `page_is_readable`, `page_is_writable`, `current_user_can_share_page`, `user_can_access_board`, `is_admin`, `is_workspace_member`, `profile_is_related`, `loan_is_owner`, `loan_is_visible`, `loan_file_is_readable` | a política roda como quem consulta: sem o EXECUTE, o RLS quebra. Tirá-las da API exige movê-las para o schema `private` e refazer as políticas (card à parte) |
| RPCs do frontend (22) | convites (`generate_invite_code`, `validate_invite_code`, `admin_add_invite_slots`, `admin_revoke_invite_code`), workspaces (`create_workspace`, `invite_member`, `accept_/decline_workspace_invite`, `remove_workspace_member`, `leave_workspace`, `bootstrap_*_categories`), `create_project_board`, `search_users_for_share`, tokens (`create_api_token`, `revoke_api_token`) e a fila no `QueueModal` (`cq_list`, `cq_enqueue`, `cq_move`, `cq_remove`, `cq_reprioritize`, `cq_validate`) | chamadas com o JWT do usuário; cada uma confere quem chama |

**Só `service_role`** (sem EXECUTE para `anon`/`authenticated`):
- `cq_block`, `cq_boards`, `cq_card`, `cq_cards`, `cq_check`, `cq_complete`, `cq_next`, `cq_note`, `cq_release`, `cq_setup_flow`, `cq_start`: só a `cards-api` usa;
- `admin_revoke_user_sessions`: a `admin-ops`;
- `loan_approve`, `loan_cancel_request`, `loan_confirm_payment`, `loan_link_borrower`, `loan_reject`, `loan_reject_payment`, `loan_report_payment`, `loan_request`: não há tela de empréstimos. Uma tela nova precisa devolver o grant na mesma migration;
- `set_ai_credentials` (não há tela) e `check_auto_site_backup_due` (feita para o `pg_cron`, que roda como `postgres`);
- já eram: `_notify`, `check_rate_limit`, `resolve_api_token`, `list_public_tables`, `restore_site_backup`, `study_lookup_cache_prune`.

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
