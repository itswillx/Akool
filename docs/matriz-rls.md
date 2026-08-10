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
| `pages` | INSERT | own | RLS direta | |
| `pages` | UPDATE | own, `page_is_writable()` | RLS direta + fn SECURITY DEFINER | fn exige `role IN ('editor','co_owner')` na cadeia de ancestrais |
| `pages` | DELETE | own | RLS direta | so' o dono apaga, mesmo co_owner nao pode |
| `pages` | trigger | — | `prevent_page_ownership_transfer` | força `user_id` de volta ao valor antigo se a sessão tem `auth.uid()` — impede roubo de página via UPDATE |
| `page_shares` | SELECT | own (owner_id) ou share (shared_with_user_id) | RLS direta | |
| `page_shares` | INSERT | own | RLS + `current_user_can_share_page()` | exige ser dono OU co_owner da página |
| `page_shares` | UPDATE | own (owner_id) | RLS direta (`USING` e `WITH CHECK` = `owner_id`) | **verificado (checklist SEC-001): destinatário do compartilhamento NÃO pode alterar o próprio `role`** — só o dono edita a linha |
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
| `profiles` | UPDATE (própria linha) | own | RLS (`profiles_update_own`) | **campos `role`/`is_active`/`invite_slots_remaining` são congelados pelo trigger `enforce_profile_privilege_bounds`** mesmo que a policy permita o UPDATE — auto-promoção bloqueada na camada de trigger, não na policy |
| `profiles` | UPDATE (qualquer linha) | admin | RLS (`profiles_update_admin`) | |
| `profiles` | DELETE | admin | RLS | |
| `profiles` | INSERT | — | sem policy de INSERT para authenticated/anon | linha só é criada pelo trigger `on_auth_user_created` → `handle_new_user()` (SECURITY DEFINER) no signup |
| `invite_codes` | SELECT | criador ou admin | RLS direta | |
| `invite_codes` | INSERT | **ninguém** (`with_check = false`) | RLS hard-deny | só entra via RPC `generate_invite_code()` (SECURITY DEFINER) |
| `invite_codes` | UPDATE | **ninguém** (`using = false`) | RLS hard-deny | consumo do código é via `handle_invite_code_on_signup()` (roda como trigger em `auth.users`, bypassa RLS) |
| `invite_codes` | DELETE | admin, só código usado/expirado | RLS direta | revogação de código não-usado é via RPC `admin_revoke_invite_code()` (que também devolve o slot ao criador) |

## Finance — base (contas, categorias, orçamentos, metas, recorrências, transações)

Todas as 9 tabelas seguem o mesmo padrão: **owner_all** (dono tem ALL) + policies
extras de leitura/escrita por `workspace_id` via `is_workspace_member()`, mais um
trigger `finance_guard_workspace` em 6 delas.

| Tabela | SELECT extra | INSERT | UPDATE extra | DELETE extra | Trigger de integridade |
|---|---|---|---|---|---|
| `finance_accounts` | workspace | own | — | — | `trg_finance_accounts_ws_guard` |
| `finance_categories` | workspace | own | workspace | workspace | `trg_finance_categories_ws_guard` |
| `finance_budgets` | workspace, `shared_with_user_id` | own | workspace | workspace | `trg_finance_budgets_ws_guard` |
| `finance_goals` | workspace, via `finance_goal_shares` | own | — | — | `trg_finance_goals_ws_guard` |
| `finance_goal_shares` | invitee (`shared_with_user_id`) | own | — | — | nenhum (goal sharing é pessoa-a-pessoa, sem workspace) |
| `finance_goal_contributions` | owner-da-meta vê tudo, invitee vê o próprio | own; **invitee também pode INSERT** (`shared_insert`, via `finance_goal_shares`) | — | — | nenhum |
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
| `finance_workspaces` | ALL (insert/update/delete) | owner | |
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
| `project_shares` | UPDATE | owner (`USING`/`WITH CHECK` = `owner_id`) | **verificado (checklist SEC-001): destinatário do compartilhamento NÃO pode alterar o próprio `role`**, mesmo padrão de `page_shares` |
| `project_shares` | DELETE | owner | |

Achado à parte (fora do escopo de RLS, registrado aqui por ter aparecido na
mesma auditoria): `project_boards`/`project_columns`/`project_cards`/`project_shares`
concedem grants de tabela amplos (INSERT/SELECT/UPDATE/REFERENCES) também para
`anon`, não só `authenticated` — inofensivo na prática porque toda policy
depende de `auth.uid()` (nulo para anon), mas destoa do padrão mais restritivo
usado em `sec_rpc_grants.sql`/`finance_projects_visibility.sql`. Não corrigido
aqui (fora do escopo do SEC-001); considerar card de hardening à parte.

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
| `page_is_readable`/`page_is_writable`/`current_user_can_share_page` | precisam ler `pages`/`page_shares` **sem** aplicar a RLS dessas mesmas tabelas (senão a policy de `pages` dependeria de si mesma) |
| `user_can_access_board` | mesmo racional para `project_boards`/`project_shares` |
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

## Achados desta auditoria (SEC-001)

- ✅ `page_shares`/`project_shares` UPDATE: auto-promoção de role **bloqueada**
  pelo RLS (`owner_id = auth.uid()` em `USING` e `WITH CHECK`) — item do
  checklist original, confirmado seguro, nenhuma mudança necessária.
- ✅ `profiles.invite_slots_remaining`: já congelado pelo trigger
  `enforce_profile_privilege_bounds` — comentário desatualizado no arquivo
  `20260708180000_sec_protect_invite_slots.sql` corrigido nesta mesma tarefa.
- ⚠️ Grants de tabela amplos para `anon` em várias tabelas do módulo de
  projetos (ver seção Projects acima) — inofensivo hoje (RLS cobre), mas fora
  do padrão mais restritivo usado alhures. Candidato a card de hardening
  separado, não tratado aqui.
- ℹ️ `profile_secrets`/`site_backups`/`site_backup_settings` sem policies de
  escrita para `authenticated`/`anon` — intencional (só `service_role`), não é
  um gap.
