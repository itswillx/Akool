-- Baseline do schema remoto (SEC-001).
--
-- Cobre os ~58 dos objetos aplicados via MCP apply_migration entre
-- 2026-05-09 (create_excalinotion_schema) e 2026-06-30 (add_links_to_project_cards)
-- no ledger remoto (supabase_migrations.schema_migrations) que nunca tiveram
-- arquivo neste diretorio. Reconstruido lendo o schema AO VIVO do projeto
-- nhfftophadasiezrzlsv via pg_catalog/pg_policies (somente leitura, nunca um
-- dump aplicado de volta no remoto) e comparado contra os 36 arquivos ja
-- existentes para nao duplicar nada que uma migracao posterior ja recria
-- (ex.: profiles_authenticated_select tem a forma ja endurecida por
-- sec_profiles_search.sql, nao a original).
--
-- Timestamp propositalmente anterior a qualquer arquivo real deste diretorio
-- para que o `supabase db reset` local replay este arquivo primeiro. NUNCA
-- aplicar via MCP apply_migration nem via `supabase db push` — os objetos ja
-- existem no remoto; este arquivo serve só para reproduzir o schema local.
-- Ver README.md.
--
-- Estrutura em 3 passes (CREATE POLICY/CREATE TRIGGER exigem que a funcao
-- referenciada ja exista; algumas funcoes SQL referenciam tabelas de mais de
-- um modulo, entao nao da' para intercalar tabela+RLS por tabela como as
-- migracoes normais fazem):
--   1) todas as tabelas (ordem segura de FK entre modulos)
--   2) todas as funcoes SECURITY DEFINER/trigger
--   3) RLS enable + policies + triggers + grants, por tabela

-- =============================================================================
-- PASSE 1 — TABELAS
-- =============================================================================

-- ---- Profiles & Invites -----------------------------------------------------

-- profiles: extensao 1:1 de auth.users. role/is_active/invite_slots_remaining
-- sao congelados em self-update pelo trigger enforce_profile_privilege_bounds
-- (passe 3). Acesso e' controlado por grants por coluna (passe 3), nao GRANT de
-- tabela — ver nota no README sobre coluna nova quebrar loadProfile sem grant.
create table if not exists public.profiles (
  id uuid not null,
  email text not null,
  display_name text,
  role text not null default 'standard'::text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  language varchar(10) not null default 'pt-BR'::character varying,
  theme text not null default 'light'::text,
  invite_slots_remaining integer not null default 2,
  last_login_date date,
  ai_has_key boolean not null default false,
  avatar_emoji text,
  avatar_color text,
  avatar_url text,
  finance_dashboard_view text not null default 'detailed'::text
);

alter table public.profiles add constraint profiles_pkey primary key (id);
alter table public.profiles add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;
alter table public.profiles add constraint profiles_role_check check (role = any (array['admin'::text, 'standard'::text]));
alter table public.profiles add constraint profiles_theme_check check (theme = any (array['light'::text, 'dark'::text]));
alter table public.profiles add constraint profiles_finance_dashboard_view_check check (finance_dashboard_view = any (array['simple'::text, 'detailed'::text]));

-- invite_codes: codigos de convite administrados por admin; acesso e' 100%
-- via RLS (insert/update sao policy-denied) + RPCs SECURITY DEFINER (passe 2).
create table if not exists public.invite_codes (
  id uuid not null default gen_random_uuid(),
  code text not null,
  created_by uuid not null,
  used_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + '7 days'::interval),
  used_at timestamptz
);

alter table public.invite_codes add constraint invite_codes_pkey primary key (id);
alter table public.invite_codes add constraint invite_codes_code_key unique (code);

create index if not exists idx_invite_codes_code on public.invite_codes using btree (code);
create index if not exists idx_invite_codes_created_by on public.invite_codes using btree (created_by);

-- ---- Excalinotion (pages, sharing, presence, conteudo) ----------------------

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'Untitled',
  icon text default '📄',
  type text not null default 'note',
  parent_id uuid,
  sort_order bigint default 0,
  is_favorite boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.pages add constraint pages_type_check
  check (type = any (array['note'::text, 'drawing'::text, 'both'::text, 'todo'::text]));
alter table public.pages add constraint pages_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.pages add constraint pages_parent_id_fkey
  foreign key (parent_id) references pages(id) on delete cascade;

create index if not exists pages_parent_id_idx on public.pages using btree (parent_id);
create index if not exists pages_user_id_idx on public.pages using btree (user_id);

create table if not exists public.page_shares (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  owner_id uuid not null,
  shared_with_user_id uuid not null,
  role text not null default 'editor',
  created_at timestamptz not null default now()
);

alter table public.page_shares add constraint page_shares_role_check
  check (role = any (array['viewer'::text, 'editor'::text, 'co_owner'::text]));
alter table public.page_shares add constraint page_shares_page_id_fkey
  foreign key (page_id) references pages(id) on delete cascade;
alter table public.page_shares add constraint page_shares_owner_id_fkey
  foreign key (owner_id) references auth.users(id) on delete cascade;
alter table public.page_shares add constraint page_shares_owner_id_profiles_fkey
  foreign key (owner_id) references profiles(id) on delete cascade;
alter table public.page_shares add constraint page_shares_shared_with_user_id_fkey
  foreign key (shared_with_user_id) references auth.users(id) on delete cascade;
alter table public.page_shares add constraint page_shares_shared_with_user_id_profiles_fkey
  foreign key (shared_with_user_id) references profiles(id) on delete cascade;
alter table public.page_shares add constraint page_shares_page_id_shared_with_user_id_key
  unique (page_id, shared_with_user_id);

create index if not exists page_shares_owner_id_idx on public.page_shares using btree (owner_id);
create index if not exists page_shares_shared_with_user_id_idx on public.page_shares using btree (shared_with_user_id);

create table if not exists public.page_presence (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  user_id uuid not null,
  last_seen_at timestamptz not null default now()
);

alter table public.page_presence add constraint page_presence_page_id_fkey
  foreign key (page_id) references pages(id) on delete cascade;
alter table public.page_presence add constraint page_presence_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table public.page_presence add constraint page_presence_user_id_profiles_fkey
  foreign key (user_id) references profiles(id) on delete cascade;
alter table public.page_presence add constraint page_presence_page_id_user_id_key
  unique (page_id, user_id);

create index if not exists page_presence_user_id_idx on public.page_presence using btree (user_id);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  user_id uuid not null,
  text text not null default '',
  completed boolean not null default false,
  due_date date,
  priority text not null default 'medium',
  sort_order bigint not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.todos add constraint todos_priority_check
  check (priority = any (array['low'::text, 'medium'::text, 'high'::text]));
alter table public.todos add constraint todos_page_id_fkey
  foreign key (page_id) references pages(id) on delete cascade;
alter table public.todos add constraint todos_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

create index if not exists todos_page_id_idx on public.todos using btree (page_id);
create index if not exists todos_user_id_idx on public.todos using btree (user_id);

create table if not exists public.mindmap_contents (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  nodes jsonb not null default '[]',
  edges jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table public.mindmap_contents add constraint mindmap_contents_page_id_fkey
  foreign key (page_id) references pages(id) on delete cascade;
alter table public.mindmap_contents add constraint mindmap_contents_page_id_key
  unique (page_id);

-- drawing_contents_page_id_idx duplica o indice unico de
-- drawing_contents_page_id_key; reproduzido como esta no banco ao vivo.
create table if not exists public.drawing_contents (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  elements jsonb default '[]',
  app_state jsonb default '{}',
  files jsonb default '{}',
  updated_at timestamptz default now()
);

alter table public.drawing_contents add constraint drawing_contents_page_id_fkey
  foreign key (page_id) references pages(id) on delete cascade;
alter table public.drawing_contents add constraint drawing_contents_page_id_key
  unique (page_id);

create index if not exists drawing_contents_page_id_idx on public.drawing_contents using btree (page_id);

-- mesmo padrao de indice duplicado que drawing_contents.
create table if not exists public.note_contents (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  content jsonb default '[]',
  updated_at timestamptz default now()
);

alter table public.note_contents add constraint note_contents_page_id_fkey
  foreign key (page_id) references pages(id) on delete cascade;
alter table public.note_contents add constraint note_contents_page_id_key
  unique (page_id);

create index if not exists note_contents_page_id_idx on public.note_contents using btree (page_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications add constraint notifications_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;

-- ---- Finance: workspace / family sharing ------------------------------------

create table if not exists public.finance_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- cada usuario pertence a no maximo um workspace (unique(user_id) global, nao so' por workspace).
create table if not exists public.finance_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.finance_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role = any (array['owner'::text, 'member'::text])),
  joined_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  unique (user_id)
);

create table if not exists public.finance_workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.finance_workspaces(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  invited_email text not null,
  invited_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status = any (array['pending'::text, 'accepted'::text, 'declined'::text])),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- ---- Finance: base (contas, categorias, orcamentos, metas, recorrencias) ---

-- credit_limit foi adicionada depois (20260729130000) e ja nasceu bigint;
-- initial_balance permanece numeric(15,2) — a migracao 20260630130000 que
-- converteria valores para cents/bigint foi neutralizada, o remoto segue numeric.
create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type = any (array['checking'::text, 'savings'::text, 'credit'::text, 'cash'::text])),
  initial_balance numeric(15,2) not null default 0,
  color text not null default '#6366f1',
  icon text not null default '🏦',
  created_at timestamptz not null default now(),
  workspace_id uuid references public.finance_workspaces(id) on delete set null,
  credit_limit bigint
);

create index if not exists idx_finance_accounts_workspace
  on public.finance_accounts (workspace_id) where (workspace_id is not null);

create table if not exists public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text not null default '📦',
  type text not null check (type = any (array['income'::text, 'expense'::text])),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  workspace_id uuid references public.finance_workspaces(id) on delete set null,
  constraint finance_categories_user_name_type_ws_unique unique nulls not distinct (user_id, name, type, workspace_id)
);

create unique index if not exists finance_categories_ws_name_type_unique
  on public.finance_categories (workspace_id, name, type) where (workspace_id is not null);
create index if not exists idx_finance_categories_workspace
  on public.finance_categories (workspace_id) where (workspace_id is not null);

create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.finance_categories(id) on delete cascade,
  month text not null,
  amount_limit numeric(15,2) not null check (amount_limit > 0::numeric),
  created_at timestamptz not null default now(),
  shared_with_user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.finance_workspaces(id) on delete set null,
  constraint finance_budgets_user_id_category_id_month_key unique (user_id, category_id, month)
);

create index if not exists finance_budgets_user_month on public.finance_budgets (user_id, month);
create index if not exists idx_finance_budgets_shared_with on public.finance_budgets (shared_with_user_id) where (shared_with_user_id is not null);
create index if not exists idx_finance_budgets_workspace on public.finance_budgets (workspace_id) where (workspace_id is not null);

create table if not exists public.finance_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text not null default '🎯',
  color text not null default '#6366f1',
  target_amount numeric(15,2) not null check (target_amount > 0::numeric),
  deadline date not null,
  account_id uuid references public.finance_accounts(id) on delete set null,
  status text not null default 'active' check (status = any (array['active'::text, 'completed'::text, 'cancelled'::text])),
  created_at timestamptz not null default now(),
  workspace_id uuid references public.finance_workspaces(id) on delete set null
);

create index if not exists finance_goals_user on public.finance_goals (user_id);

-- compartilhamento pessoa-a-pessoa de metas (sem workspace_id proprio).
create table if not exists public.finance_goal_shares (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.finance_goals(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  shared_with_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  constraint finance_goal_shares_goal_id_shared_with_user_id_key unique (goal_id, shared_with_user_id)
);

create index if not exists idx_finance_goal_shares_goal_id on public.finance_goal_shares (goal_id);
create index if not exists idx_finance_goal_shares_owner_id on public.finance_goal_shares (owner_id);
create index if not exists idx_finance_goal_shares_shared_with on public.finance_goal_shares (shared_with_user_id);

create table if not exists public.finance_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.finance_goals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(15,2) not null check (amount > 0::numeric),
  note text not null default '',
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists finance_goal_contributions_goal on public.finance_goal_contributions (goal_id);
create index if not exists finance_goal_contributions_user on public.finance_goal_contributions (user_id);

create table if not exists public.finance_recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type = any (array['expense'::text, 'income'::text])),
  description text not null default '',
  amount numeric(14,2),
  is_variable boolean not null default false,
  category_id uuid references public.finance_categories(id) on delete set null,
  account_id uuid references public.finance_accounts(id) on delete set null,
  day_of_month integer not null check (day_of_month >= 1 and day_of_month <= 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  total_installments integer,
  workspace_id uuid references public.finance_workspaces(id) on delete set null
);

create index if not exists idx_finance_recurring_user on public.finance_recurring (user_id);

-- transaction_id nao tem FK inline: finance_transactions e' criada logo abaixo
-- neste mesmo arquivo (dependencia para frente resolvida no final do bloco de
-- financas com um ALTER TABLE).
create table if not exists public.finance_recurring_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  recurring_id uuid not null references public.finance_recurring(id) on delete cascade,
  due_date date not null,
  status text not null default 'pending' check (status = any (array['pending'::text, 'paid'::text, 'skipped'::text])),
  amount numeric(14,2),
  transaction_id uuid,
  created_at timestamptz not null default now(),
  constraint finance_recurring_entries_recurring_id_due_date_key unique (recurring_id, due_date)
);

create index if not exists idx_finance_recurring_entries_due on public.finance_recurring_entries (user_id, due_date);
create index if not exists idx_finance_recurring_entries_recurring on public.finance_recurring_entries (recurring_id);
create index if not exists idx_finance_recurring_entries_user on public.finance_recurring_entries (user_id);

-- statement_id NAO tem FK inline para finance_statements: essa tabela so' e'
-- criada por 20260710005226_finance_statements.sql, que ordena DEPOIS deste
-- baseline. O FK e' adicionado por aquele proprio arquivo (ja existe la'),
-- nao aqui — senao o replay local quebraria por dependencia para frente entre
-- arquivos de migracao diferentes.
create table if not exists public.finance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.finance_accounts(id) on delete set null,
  category_id uuid references public.finance_categories(id) on delete set null,
  type text not null check (type = any (array['income'::text, 'expense'::text])),
  amount numeric(15,2) not null check (amount > 0::numeric),
  description text not null default '',
  date date not null default current_date,
  created_at timestamptz not null default now(),
  shared_with_user_id uuid references auth.users(id) on delete set null,
  photo_url text,
  workspace_id uuid references public.finance_workspaces(id) on delete set null,
  statement_id uuid
);

create index if not exists finance_transactions_account on public.finance_transactions (account_id);
create index if not exists finance_transactions_category on public.finance_transactions (category_id);
create index if not exists finance_transactions_statement_id_idx on public.finance_transactions (statement_id);
create index if not exists finance_transactions_user_date on public.finance_transactions (user_id, date desc);
create index if not exists idx_finance_transactions_shared_with on public.finance_transactions (shared_with_user_id) where (shared_with_user_id is not null);
create index if not exists idx_finance_transactions_workspace on public.finance_transactions (workspace_id) where (workspace_id is not null);

-- dependencia para frente resolvida: finance_recurring_entries.transaction_id -> finance_transactions.id
alter table public.finance_recurring_entries
  drop constraint if exists finance_recurring_entries_transaction_id_fkey;
alter table public.finance_recurring_entries
  add constraint finance_recurring_entries_transaction_id_fkey
  foreign key (transaction_id) references public.finance_transactions(id) on delete set null;

-- ---- Projects module ---------------------------------------------------------

create table if not exists public.project_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Novo projeto',
  icon text not null default '📋',
  color text not null default '#6366f1',
  description text not null default '',
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_boards_user on public.project_boards (user_id);

create table if not exists public.project_columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.project_boards(id) on delete cascade,
  name text not null default 'Nova coluna',
  color text not null default '#94a3b8',
  wip_limit integer,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_columns_board on public.project_columns (board_id);

-- inclui todas as colunas aditivas de migracoes posteriores (gantt, links,
-- checklist, attachments, estimated_days), ja que reflete o estado atual da
-- tabela ao vivo — os arquivos que adicionaram cada coluna (ja versionados)
-- viram no-op de coluna-ja-existe se replayados (todos usam IF NOT EXISTS).
create table if not exists public.project_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.project_boards(id) on delete cascade,
  column_id uuid not null references public.project_columns(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  priority text not null default 'medium' check (priority = any (array['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])),
  due_date date,
  assignee_user_id uuid references public.profiles(id) on delete set null,
  labels jsonb not null default '[]'::jsonb,
  linked_page_id uuid references public.pages(id) on delete set null,
  completed boolean not null default false,
  sort_order bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checklist jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  start_date date,
  parent_card_id uuid references public.project_cards(id) on delete set null,
  depends_on uuid[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  estimated_days integer not null default 1 check (estimated_days > 0)
);

create index if not exists idx_project_cards_board on public.project_cards (board_id);
create index if not exists idx_project_cards_column on public.project_cards (column_id);
create index if not exists idx_project_cards_assignee on public.project_cards (assignee_user_id);
create index if not exists idx_project_cards_linked_page on public.project_cards (linked_page_id);
create index if not exists project_cards_parent_idx on public.project_cards (parent_card_id);

create table if not exists public.project_shares (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.project_boards(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  shared_with_user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'editor' check (role = any (array['viewer'::text, 'editor'::text])),
  created_at timestamptz not null default now(),
  constraint project_shares_board_id_shared_with_user_id_key unique (board_id, shared_with_user_id)
);

create index if not exists idx_project_shares_board on public.project_shares (board_id);
create index if not exists idx_project_shares_owner on public.project_shares (owner_id);
create index if not exists idx_project_shares_shared_with on public.project_shares (shared_with_user_id);

-- =============================================================================
-- PASSE 2 — FUNCOES (SECURITY DEFINER / triggers)
-- =============================================================================

-- notifications helper
create or replace function public._notify(p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into notifications (user_id, type, title, body, data)
  values (p_user_id, p_type, p_title, p_body, p_data);
end;
$function$;

-- workspace membership check (LANGUAGE sql: validado na criacao, por isso so'
-- pode ser criada depois de finance_workspace_members existir, passe 1 acima).
create or replace function public.is_workspace_member(p_workspace_id uuid)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from finance_workspace_members m
    where m.workspace_id = p_workspace_id and m.user_id = auth.uid()
  );
$function$;

create or replace function public.create_workspace(p_name text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if exists (select 1 from finance_workspace_members where user_id = v_uid) then
    raise exception 'User already belongs to a workspace';
  end if;
  insert into finance_workspaces (name, owner_id)
  values (p_name, v_uid)
  returning id into v_ws_id;
  insert into finance_workspace_members (workspace_id, user_id, role)
  values (v_ws_id, v_uid, 'owner');

  insert into finance_categories (user_id, name, color, icon, type, is_default, workspace_id) values
    (v_uid, 'Alimentação',    '#f97316', '🍔', 'expense', true, v_ws_id),
    (v_uid, 'Transporte',     '#3b82f6', '🚗', 'expense', true, v_ws_id),
    (v_uid, 'Moradia',        '#8b5cf6', '🏠', 'expense', true, v_ws_id),
    (v_uid, 'Saúde',          '#ef4444', '❤️', 'expense', true, v_ws_id),
    (v_uid, 'Lazer',          '#ec4899', '🎮', 'expense', true, v_ws_id),
    (v_uid, 'Educação',       '#06b6d4', '📚', 'expense', true, v_ws_id),
    (v_uid, 'Vestuário',      '#a855f7', '👕', 'expense', true, v_ws_id),
    (v_uid, 'Outros gastos',  '#6b7280', '📦', 'expense', true, v_ws_id),
    (v_uid, 'Salário',        '#22c55e', '💼', 'income',  true, v_ws_id),
    (v_uid, 'Freelance',      '#84cc16', '💻', 'income',  true, v_ws_id),
    (v_uid, 'Investimentos',  '#f59e0b', '📈', 'income',  true, v_ws_id),
    (v_uid, 'Outras receitas','#10b981', '💰', 'income',  true, v_ws_id)
  on conflict (user_id, name, type, workspace_id) do nothing;

  return v_ws_id;
end;
$function$;

create or replace function public.invite_member(p_workspace_id uuid, p_email text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_invite_id uuid;
  v_invited_uid uuid;
  v_ws_name text;
  v_inviter_name text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from finance_workspace_members where workspace_id = p_workspace_id and user_id = v_uid) then
    raise exception 'Not a member of this workspace';
  end if;
  select id into v_invited_uid from auth.users where email = lower(trim(p_email));
  if v_invited_uid is not null and exists (select 1 from finance_workspace_members where user_id = v_invited_uid) then
    raise exception 'User already belongs to a workspace';
  end if;
  if exists (select 1 from finance_workspace_invites where workspace_id = p_workspace_id and invited_email = lower(trim(p_email)) and status = 'pending') then
    raise exception 'Invite already pending for this email';
  end if;
  select name into v_ws_name from finance_workspaces where id = p_workspace_id;
  select coalesce(display_name, email) into v_inviter_name from profiles where id = v_uid;
  insert into finance_workspace_invites (workspace_id, invited_by, invited_email, invited_user_id, status)
  values (p_workspace_id, v_uid, lower(trim(p_email)), v_invited_uid, 'pending')
  returning id into v_invite_id;
  if v_invited_uid is not null then
    perform _notify(
      v_invited_uid,
      'workspace_invite',
      coalesce(v_inviter_name, 'Alguém') || ' convidou você para "' || coalesce(v_ws_name, 'Família') || '"',
      'Você recebeu um convite para compartilhar finanças.',
      jsonb_build_object('workspace_id', p_workspace_id, 'invite_id', v_invite_id, 'actor_id', v_uid)
    );
  end if;
  return v_invite_id;
end;
$function$;

create or replace function public.accept_workspace_invite(p_invite_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_invite finance_workspace_invites%rowtype;
  v_ws_name text;
  v_accepter_name text;
  v_member record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_invite from finance_workspace_invites where id = p_invite_id;
  if v_invite.id is null then raise exception 'Invite not found'; end if;
  if v_invite.status <> 'pending' then raise exception 'Invite is no longer pending'; end if;
  if v_invite.invited_user_id is not null and v_invite.invited_user_id <> v_uid then
    raise exception 'This invite is not for you';
  end if;
  if v_invite.invited_user_id is null then
    if not exists (select 1 from auth.users where id = v_uid and email = v_invite.invited_email) then
      raise exception 'This invite is not for you';
    end if;
  end if;
  if exists (select 1 from finance_workspace_members where user_id = v_uid) then
    raise exception 'You already belong to a workspace';
  end if;
  insert into finance_workspace_members (workspace_id, user_id, role)
  values (v_invite.workspace_id, v_uid, 'member');
  update finance_workspace_invites set status = 'accepted', responded_at = now(), invited_user_id = v_uid where id = p_invite_id;
  select name into v_ws_name from finance_workspaces where id = v_invite.workspace_id;
  select coalesce(display_name, email) into v_accepter_name from profiles where id = v_uid;
  perform _notify(
    v_invite.invited_by,
    'invite_accepted',
    coalesce(v_accepter_name, 'Alguém') || ' aceitou seu convite para "' || coalesce(v_ws_name, 'Família') || '"',
    'Um novo membro entrou no workspace.',
    jsonb_build_object('workspace_id', v_invite.workspace_id, 'invite_id', p_invite_id, 'actor_id', v_uid)
  );
  for v_member in select user_id from finance_workspace_members where workspace_id = v_invite.workspace_id and user_id <> v_uid and user_id <> v_invite.invited_by
  loop
    perform _notify(
      v_member.user_id,
      'member_joined',
      coalesce(v_accepter_name, 'Alguém') || ' entrou em "' || coalesce(v_ws_name, 'Família') || '"',
      'Novo membro no workspace.',
      jsonb_build_object('workspace_id', v_invite.workspace_id, 'actor_id', v_uid)
    );
  end loop;
end;
$function$;

create or replace function public.decline_workspace_invite(p_invite_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_invite finance_workspace_invites%rowtype;
  v_decliner_name text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_invite from finance_workspace_invites where id = p_invite_id;
  if v_invite.id is null then raise exception 'Invite not found'; end if;
  if v_invite.status <> 'pending' then raise exception 'Invite is no longer pending'; end if;
  if v_invite.invited_user_id is not null and v_invite.invited_user_id <> v_uid then
    raise exception 'This invite is not for you';
  end if;
  if v_invite.invited_user_id is null then
    if not exists (select 1 from auth.users where id = v_uid and email = v_invite.invited_email) then
      raise exception 'This invite is not for you';
    end if;
  end if;
  update finance_workspace_invites set status = 'declined', responded_at = now(), invited_user_id = v_uid where id = p_invite_id;
  select coalesce(display_name, email) into v_decliner_name from profiles where id = v_uid;
  perform _notify(
    v_invite.invited_by,
    'invite_declined',
    coalesce(v_decliner_name, 'Alguém') || ' recusou seu convite',
    'O convite para o workspace foi recusado.',
    jsonb_build_object('workspace_id', v_invite.workspace_id, 'invite_id', p_invite_id, 'actor_id', v_uid)
  );
end;
$function$;

create or replace function public.remove_workspace_member(p_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_my_membership finance_workspace_members%rowtype;
  v_ws_name text;
  v_remover_name text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_my_membership from finance_workspace_members where user_id = v_uid;
  if v_my_membership.id is null then raise exception 'Not in a workspace'; end if;
  if v_my_membership.role <> 'owner' then raise exception 'Only the owner can remove members'; end if;
  if p_user_id = v_uid then raise exception 'Cannot remove yourself'; end if;
  if not exists (select 1 from finance_workspace_members where workspace_id = v_my_membership.workspace_id and user_id = p_user_id) then
    raise exception 'User is not a member of this workspace';
  end if;
  select name into v_ws_name from finance_workspaces where id = v_my_membership.workspace_id;
  select coalesce(display_name, email) into v_remover_name from profiles where id = v_uid;
  update finance_transactions set workspace_id = null where user_id = p_user_id and workspace_id = v_my_membership.workspace_id;
  update finance_budgets set workspace_id = null where user_id = p_user_id and workspace_id = v_my_membership.workspace_id;
  update finance_accounts set workspace_id = null where user_id = p_user_id and workspace_id = v_my_membership.workspace_id;
  update finance_categories set workspace_id = null where user_id = p_user_id and workspace_id = v_my_membership.workspace_id;
  update finance_goals set workspace_id = null where user_id = p_user_id and workspace_id = v_my_membership.workspace_id;
  update finance_recurring set workspace_id = null where user_id = p_user_id and workspace_id = v_my_membership.workspace_id;
  delete from finance_workspace_members where workspace_id = v_my_membership.workspace_id and user_id = p_user_id;
  perform _notify(
    p_user_id,
    'member_left',
    coalesce(v_remover_name, 'O administrador') || ' removeu você de "' || coalesce(v_ws_name, 'Família') || '"',
    'Você foi removido do workspace.',
    jsonb_build_object('workspace_id', v_my_membership.workspace_id, 'actor_id', v_uid)
  );
end;
$function$;

create or replace function public.leave_workspace()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_membership finance_workspace_members%rowtype;
  v_ws_name text;
  v_leaver_name text;
  v_member record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_membership from finance_workspace_members where user_id = v_uid;
  if v_membership.id is null then raise exception 'Not in a workspace'; end if;
  if v_membership.role = 'owner' then
    if exists (select 1 from finance_workspace_members where workspace_id = v_membership.workspace_id and user_id <> v_uid) then
      update finance_workspace_members
        set role = 'owner'
        where id = (
          select id from finance_workspace_members
          where workspace_id = v_membership.workspace_id and user_id <> v_uid
          order by joined_at asc limit 1
        );
      update finance_workspaces set owner_id = (
        select user_id from finance_workspace_members
        where workspace_id = v_membership.workspace_id and role = 'owner' and user_id <> v_uid
        limit 1
      ) where id = v_membership.workspace_id;
    else
      delete from finance_workspaces where id = v_membership.workspace_id;
      return;
    end if;
  end if;
  select name into v_ws_name from finance_workspaces where id = v_membership.workspace_id;
  select coalesce(display_name, email) into v_leaver_name from profiles where id = v_uid;
  update finance_transactions set workspace_id = null where user_id = v_uid and workspace_id = v_membership.workspace_id;
  update finance_budgets set workspace_id = null where user_id = v_uid and workspace_id = v_membership.workspace_id;
  update finance_accounts set workspace_id = null where user_id = v_uid and workspace_id = v_membership.workspace_id;
  update finance_categories set workspace_id = null where user_id = v_uid and workspace_id = v_membership.workspace_id;
  update finance_goals set workspace_id = null where user_id = v_uid and workspace_id = v_membership.workspace_id;
  update finance_recurring set workspace_id = null where user_id = v_uid and workspace_id = v_membership.workspace_id;
  delete from finance_workspace_members where id = v_membership.id;
  for v_member in select user_id from finance_workspace_members where workspace_id = v_membership.workspace_id and user_id <> v_uid
  loop
    perform _notify(
      v_member.user_id,
      'member_left',
      coalesce(v_leaver_name, 'Alguém') || ' saiu de "' || coalesce(v_ws_name, 'Família') || '"',
      'Um membro saiu do workspace.',
      jsonb_build_object('workspace_id', v_membership.workspace_id, 'actor_id', v_uid)
    );
  end loop;
end;
$function$;

create or replace function public.bootstrap_finance_categories(p_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or auth.uid() != p_user_id then
    raise exception 'unauthorized';
  end if;

  insert into finance_categories (user_id, name, color, icon, type, is_default) values
    (p_user_id, 'Alimentação',    '#f97316', '🍔', 'expense', true),
    (p_user_id, 'Transporte',     '#3b82f6', '🚗', 'expense', true),
    (p_user_id, 'Moradia',        '#8b5cf6', '🏠', 'expense', true),
    (p_user_id, 'Saúde',          '#ef4444', '❤️', 'expense', true),
    (p_user_id, 'Lazer',          '#ec4899', '🎮', 'expense', true),
    (p_user_id, 'Educação',       '#06b6d4', '📚', 'expense', true),
    (p_user_id, 'Vestuário',      '#a855f7', '👕', 'expense', true),
    (p_user_id, 'Outros gastos',  '#6b7280', '📦', 'expense', true),
    (p_user_id, 'Salário',        '#22c55e', '💼', 'income',  true),
    (p_user_id, 'Freelance',      '#84cc16', '💻', 'income',  true),
    (p_user_id, 'Investimentos',  '#f59e0b', '📈', 'income',  true),
    (p_user_id, 'Outras receitas','#10b981', '💰', 'income',  true)
  on conflict (user_id, name, type, workspace_id) do nothing;
end;
$function$;

create or replace function public.bootstrap_workspace_categories(p_workspace_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not is_workspace_member(p_workspace_id) then
    raise exception 'unauthorized';
  end if;

  -- Se o workspace já tem categorias, não semear de novo (evita duplicar por membro)
  if exists (select 1 from finance_categories where workspace_id = p_workspace_id) then
    return;
  end if;

  insert into finance_categories (user_id, name, color, icon, type, is_default, workspace_id) values
    (auth.uid(), 'Alimentação',    '#f97316', '🍔', 'expense', true, p_workspace_id),
    (auth.uid(), 'Transporte',     '#3b82f6', '🚗', 'expense', true, p_workspace_id),
    (auth.uid(), 'Moradia',        '#8b5cf6', '🏠', 'expense', true, p_workspace_id),
    (auth.uid(), 'Saúde',          '#ef4444', '❤️', 'expense', true, p_workspace_id),
    (auth.uid(), 'Lazer',          '#ec4899', '🎮', 'expense', true, p_workspace_id),
    (auth.uid(), 'Educação',       '#06b6d4', '📚', 'expense', true, p_workspace_id),
    (auth.uid(), 'Vestuário',      '#a855f7', '👕', 'expense', true, p_workspace_id),
    (auth.uid(), 'Outros gastos',  '#6b7280', '📦', 'expense', true, p_workspace_id),
    (auth.uid(), 'Salário',        '#22c55e', '💼', 'income',  true, p_workspace_id),
    (auth.uid(), 'Freelance',      '#84cc16', '💻', 'income',  true, p_workspace_id),
    (auth.uid(), 'Investimentos',  '#f59e0b', '📈', 'income',  true, p_workspace_id),
    (auth.uid(), 'Outras receitas','#10b981', '💰', 'income',  true, p_workspace_id)
  on conflict (workspace_id, name, type) where workspace_id is not null do nothing;
end;
$function$;

-- LANGUAGE sql: validado na criacao, exige project_boards/project_shares (passe 1).
create or replace function public.user_can_access_board(p_board_id uuid, p_min_role text default 'viewer'::text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.project_boards b
    where b.id = p_board_id and b.user_id = auth.uid()
  ) or exists (
    select 1 from public.project_shares s
    where s.board_id = p_board_id
      and s.shared_with_user_id = auth.uid()
      and (p_min_role = 'viewer' or s.role = 'editor')
  );
$function$;

create or replace function public.create_project_board(p_name text default 'Novo projeto'::text, p_icon text default '📋'::text, p_color text default '#6366f1'::text, p_description text default ''::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_board_id uuid;
  v_order bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(max(sort_order) + 1, 0) into v_order
  from public.project_boards where user_id = auth.uid();

  insert into public.project_boards (user_id, name, icon, color, description, sort_order)
  values (auth.uid(), coalesce(nullif(p_name, ''), 'Novo projeto'), p_icon, p_color, coalesce(p_description, ''), v_order)
  returning id into v_board_id;

  insert into public.project_columns (board_id, name, color, sort_order) values
    (v_board_id, 'A Fazer', '#94a3b8', 0),
    (v_board_id, 'Fazendo', '#3b82f6', 1),
    (v_board_id, 'Concluído', '#22c55e', 2);

  return v_board_id;
end;
$function$;

-- LANGUAGE sql: validado na criacao, exige pages/page_shares (passe 1).
create or replace function public.current_user_can_share_page(p_page_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- Owner check (queries pages WITHOUT RLS)
  select exists (
    select 1 from pages p
    where p.id = p_page_id
      and p.user_id = (select auth.uid())
  )
  or
  -- Co-owner check (queries page_shares WITHOUT RLS)
  exists (
    select 1 from page_shares ps
    where ps.page_id = p_page_id
      and ps.shared_with_user_id = (select auth.uid())
      and ps.role = 'co_owner'
  )
$function$;

create or replace function public.page_is_readable(p_page_id uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return false; end if;
  return exists (
    with recursive ancestors as (
      select id, parent_id, user_id
        from pages
       where id = p_page_id
      union all
      select p.id, p.parent_id, p.user_id
        from pages p
       inner join ancestors a on p.id = a.parent_id
    )
    select 1 from ancestors a
     where a.user_id = v_uid
        or exists (
             select 1 from page_shares ps
              where ps.page_id = a.id
                and ps.shared_with_user_id = v_uid
           )
  );
end;
$function$;

create or replace function public.page_is_writable(p_page_id uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return false; end if;
  return exists (
    with recursive ancestors as (
      select id, parent_id, user_id
        from pages
       where id = p_page_id
      union all
      select p.id, p.parent_id, p.user_id
        from pages p
       inner join ancestors a on p.id = a.parent_id
    )
    select 1 from ancestors a
     where a.user_id = v_uid
        or exists (
             select 1 from page_shares ps
              where ps.page_id = a.id
                and ps.shared_with_user_id = v_uid
                and ps.role = any(array['editor','co_owner'])
           )
  );
end;
$function$;

create or replace function public.prevent_page_ownership_transfer()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if auth.uid() is not null then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$function$;

-- trigger generico de updated_at, usado por varias tabelas.
create or replace function public.update_updated_at()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.generate_invite_code()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_role    text;
  v_slots   int;
  v_code    text;
  v_attempt int := 0;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select role, invite_slots_remaining
    into v_role, v_slots
    from public.profiles
    where id = v_user_id;

  if v_role != 'admin' then
    if v_slots <= 0 then
      raise exception 'no_slots_remaining';
    end if;
    update public.profiles
      set invite_slots_remaining = invite_slots_remaining - 1
      where id = v_user_id;
  end if;

  loop
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 8));
    exit when not exists (select 1 from public.invite_codes where code = v_code);
    v_attempt := v_attempt + 1;
    if v_attempt > 10 then raise exception 'code_generation_failed'; end if;
  end loop;

  insert into public.invite_codes (code, created_by, expires_at)
    values (v_code, v_user_id, now() + interval '7 days');

  return jsonb_build_object('code', v_code);
end;
$function$;

create or replace function public.validate_invite_code(p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row public.invite_codes%rowtype;
begin
  select * into v_row
  from public.invite_codes
  where code = trim(p_code)
    and used_at is null
    and expires_at > now();

  if v_row.id is null then
    return jsonb_build_object('valid', false, 'error', 'invite_invalid');
  end if;

  return jsonb_build_object('valid', true);
end;
$function$;

create or replace function public.admin_add_invite_slots(p_user_id uuid, p_slots integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (select role = 'admin' from profiles where id = auth.uid()) then
    raise exception 'admin_only';
  end if;
  update profiles
  set invite_slots_remaining = greatest(invite_slots_remaining + p_slots, 0)
  where id = p_user_id;
end;
$function$;

create or replace function public.admin_revoke_invite_code(p_code_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_creator uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'admin_required';
  end if;

  select created_by into v_creator
    from public.invite_codes
    where id = p_code_id
      and used_at is null;

  if v_creator is null then
    raise exception 'code_not_found_or_already_used';
  end if;

  delete from public.invite_codes where id = p_code_id;

  update public.profiles
    set invite_slots_remaining = invite_slots_remaining + 1
    where id = v_creator
      and role != 'admin';
end;
$function$;

-- dispara em auth.users (tabela gerenciada pelo Supabase): bootstrap de
-- profile + validacao/consumo do codigo de convite no signup.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  insert into public.profiles (id, email, display_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    'standard',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

create or replace function public.handle_invite_code_on_signup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_invite_code text;
  v_code_id     uuid;
begin
  v_invite_code := trim(new.raw_user_meta_data->>'invite_code');

  if v_invite_code is null or v_invite_code = '' then
    raise exception 'invite_required: An invitation code is required to create an account.';
  end if;

  select id into v_code_id
  from public.invite_codes
  where code = v_invite_code
    and used_at is null
    and expires_at > now()
  for update nowait;

  if v_code_id is null then
    raise exception 'invite_invalid: This invitation code is invalid or has expired.';
  end if;

  update public.invite_codes
    set used_at = now(),
        used_by = new.id
    where id = v_code_id;

  return new;
end;
$function$;

-- =============================================================================
-- PASSE 3 — RLS enable + policies + triggers + grants
-- =============================================================================

-- ---- profiles ----------------------------------------------------------------

alter table public.profiles enable row level security;

create policy profiles_authenticated_select on public.profiles for select to authenticated
  using (((id = ( select auth.uid() as uid)) or is_admin() or profile_is_related(id)));
create policy profiles_update_own on public.profiles for update to authenticated
  using ((id = ( select auth.uid() as uid)))
  with check ((id = ( select auth.uid() as uid)));
create policy profiles_update_admin on public.profiles for update to authenticated
  using (is_admin())
  with check (is_admin());
create policy profiles_delete_admin on public.profiles for delete to authenticated
  using (is_admin());

create trigger enforce_profile_privilege_bounds before update on public.profiles
  for each row execute function prevent_profile_privilege_escalation();

-- grants de tabela (so' os privilegios que nao sao restritos por coluna abaixo).
grant insert, delete, references, trigger, truncate on public.profiles to anon;
grant insert, delete on public.profiles to authenticated;

-- grants por coluna (critico: profiles nao tem GRANT de tabela para select/update;
-- coluna nova sem grant explicito aqui quebra loadProfile com 42501 para todo mundo).
grant select (
  ai_has_key,created_at,display_name,email,id,invite_slots_remaining,is_active,language,last_login_date,role,theme
) on public.profiles to anon;

grant
  select (
    ai_has_key,avatar_color,avatar_emoji,avatar_url,created_at,display_name,email,finance_dashboard_view,id,invite_slots_remaining,is_active,language,last_login_date,role,theme
  ),
  update (
    ai_has_key,avatar_color,avatar_emoji,avatar_url,display_name,finance_dashboard_view,invite_slots_remaining,is_active,language,last_login_date,role,theme
  ),
  references (
    ai_has_key,created_at,display_name,email,id,invite_slots_remaining,is_active,language,last_login_date,role,theme
  )
  on public.profiles to authenticated;

-- ---- invite_codes --------------------------------------------------------------

alter table public.invite_codes enable row level security;

create policy invite_codes_select on public.invite_codes for select to public
  using (((created_by = auth.uid()) or (exists ( select 1
   from profiles
  where ((profiles.id = auth.uid()) and (profiles.role = 'admin'::text))))));
create policy invite_codes_insert_deny on public.invite_codes for insert to public
  with check (false);
create policy invite_codes_update_deny on public.invite_codes for update to public
  using (false);
create policy invite_codes_delete_admin on public.invite_codes for delete to public
  using (((exists ( select 1
   from profiles
  where ((profiles.id = auth.uid()) and (profiles.role = 'admin'::text)))) and ((used_at is not null) or (expires_at < now()))));

grant all on public.invite_codes to anon, authenticated;

-- ---- pages ---------------------------------------------------------------------

alter table public.pages enable row level security;

create policy "pages_select" on public.pages for select to public
  using ((user_id = (select auth.uid() as uid)) or page_is_readable(id));
create policy "pages_insert" on public.pages for insert to public
  with check ((select auth.uid() as uid) = user_id);
create policy "pages_update" on public.pages for update to public
  using ((user_id = (select auth.uid() as uid)) or page_is_writable(id))
  with check ((user_id = (select auth.uid() as uid)) or page_is_writable(id));
create policy "pages_delete" on public.pages for delete to public
  using (user_id = (select auth.uid() as uid));

create trigger pages_updated_at before update on public.pages
  for each row execute function update_updated_at();
create trigger prevent_page_ownership_transfer before update on public.pages
  for each row execute function prevent_page_ownership_transfer();

-- ---- page_shares -----------------------------------------------------------

alter table public.page_shares enable row level security;

create policy "page_shares_select" on public.page_shares for select to authenticated
  using ((owner_id = (select auth.uid() as uid)) or (shared_with_user_id = (select auth.uid() as uid)));
create policy "page_shares_insert" on public.page_shares for insert to public
  with check ((owner_id = (select auth.uid() as uid)) and current_user_can_share_page(page_id));
create policy "page_shares_update" on public.page_shares for update to authenticated
  using (owner_id = (select auth.uid() as uid))
  with check (owner_id = (select auth.uid() as uid));
create policy "page_shares_delete" on public.page_shares for delete to authenticated
  using (owner_id = (select auth.uid() as uid));

-- ---- page_presence -----------------------------------------------------------

alter table public.page_presence enable row level security;

create policy "page_presence_select" on public.page_presence for select to public
  using (page_is_readable(page_id));
create policy "page_presence_insert" on public.page_presence for insert to public
  with check ((user_id = (select auth.uid() as uid)) and page_is_readable(page_id));
create policy "page_presence_update" on public.page_presence for update to authenticated
  using (user_id = (select auth.uid() as uid))
  with check (user_id = (select auth.uid() as uid));
create policy "page_presence_delete" on public.page_presence for delete to authenticated
  using (user_id = (select auth.uid() as uid));

-- ---- todos -----------------------------------------------------------------

alter table public.todos enable row level security;

create policy "todos_select" on public.todos for select to public
  using (page_is_readable(page_id));
create policy "todos_insert" on public.todos for insert to public
  with check (((select auth.uid() as uid) = user_id) and page_is_writable(page_id));
create policy "todos_update" on public.todos for update to public
  using (page_is_writable(page_id))
  with check (page_is_writable(page_id));
create policy "todos_delete" on public.todos for delete to public
  using (page_is_writable(page_id));

-- ---- mindmap_contents -----------------------------------------------------------

alter table public.mindmap_contents enable row level security;

create policy "mindmap_contents_select" on public.mindmap_contents for select to public
  using (page_is_readable(page_id));
create policy "mindmap_contents_insert" on public.mindmap_contents for insert to public
  with check (page_is_writable(page_id));
create policy "mindmap_contents_update" on public.mindmap_contents for update to public
  using (page_is_writable(page_id))
  with check (page_is_writable(page_id));
create policy "mindmap_contents_delete" on public.mindmap_contents for delete to authenticated
  using (exists (select 1 from pages where ((pages.id = mindmap_contents.page_id) and (pages.user_id = (select auth.uid() as uid)))));

-- ---- drawing_contents -----------------------------------------------------------

alter table public.drawing_contents enable row level security;

create policy "drawing_contents_select" on public.drawing_contents for select to public
  using (page_is_readable(page_id));
create policy "drawing_contents_insert" on public.drawing_contents for insert to public
  with check (page_is_writable(page_id));
create policy "drawing_contents_update" on public.drawing_contents for update to public
  using (page_is_writable(page_id))
  with check (page_is_writable(page_id));
create policy "drawing_contents_delete" on public.drawing_contents for delete to authenticated
  using (exists (select 1 from pages where ((pages.id = drawing_contents.page_id) and (pages.user_id = (select auth.uid() as uid)))));

create trigger drawing_contents_updated_at before update on public.drawing_contents
  for each row execute function update_updated_at();

-- ---- note_contents -----------------------------------------------------------

alter table public.note_contents enable row level security;

create policy "note_contents_select" on public.note_contents for select to public
  using (page_is_readable(page_id));
create policy "note_contents_insert" on public.note_contents for insert to public
  with check (page_is_writable(page_id));
create policy "note_contents_update" on public.note_contents for update to public
  using (page_is_writable(page_id))
  with check (page_is_writable(page_id));
create policy "note_contents_delete" on public.note_contents for delete to authenticated
  using (exists (select 1 from pages where ((pages.id = note_contents.page_id) and (pages.user_id = (select auth.uid() as uid)))));

create trigger note_contents_updated_at before update on public.note_contents
  for each row execute function update_updated_at();

-- ---- notifications -----------------------------------------------------------

alter table public.notifications enable row level security;

-- sem policy de INSERT: linhas so' entram via _notify() (SECURITY DEFINER,
-- passe 2), que roda como o dono da funcao e ignora RLS.
create policy "notif_owner_select" on public.notifications for select to public
  using (user_id = auth.uid());
create policy "notif_owner_update" on public.notifications for update to public
  using (user_id = auth.uid());
create policy "notif_owner_delete" on public.notifications for delete to public
  using (user_id = auth.uid());

-- ---- finance_workspaces -----------------------------------------------------------

alter table public.finance_workspaces enable row level security;

create policy ws_owner_all on public.finance_workspaces
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
create policy ws_member_select on public.finance_workspaces
  for select using (is_workspace_member(id));

-- ---- finance_workspace_members -----------------------------------------------------------

alter table public.finance_workspace_members enable row level security;

create policy wm_member_select on public.finance_workspace_members
  for select using (is_workspace_member(workspace_id));

create policy wm_owner_insert on public.finance_workspace_members
  for insert with check (
    exists (
      select 1 from public.finance_workspace_members m
      where m.workspace_id = finance_workspace_members.workspace_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create policy wm_owner_delete on public.finance_workspace_members
  for delete using (
    exists (
      select 1 from public.finance_workspace_members m
      where m.workspace_id = finance_workspace_members.workspace_id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
    or user_id = auth.uid()
  );

-- nota: nao existe policy de UPDATE em finance_workspace_members no banco ao
-- vivo; troca de role (member -> owner) so' acontece dentro das funcoes
-- SECURITY DEFINER create_workspace/leave_workspace (passe 2), nunca via
-- UPDATE direto pelo cliente.

-- ---- finance_workspace_invites -----------------------------------------------------------

alter table public.finance_workspace_invites enable row level security;

create policy wi_member_select on public.finance_workspace_invites
  for select using (is_workspace_member(workspace_id));

-- usa auth.email() (funcao embutida, sem select em auth.users) — corrige o bug
-- historico "fix_workspace_invites_rls_auth_users_permission".
create policy wi_invitee_select on public.finance_workspace_invites
  for select using (invited_user_id = auth.uid() or invited_email = auth.email());

create policy wi_member_insert on public.finance_workspace_invites
  for insert with check (is_workspace_member(workspace_id));

-- sem WITH CHECK: quais campos podem mudar (so' status) e' responsabilidade
-- do trigger trg_wi_invitee_guard / finance_guard_invite_update, ja versionado
-- em 20260708120000_sec_finance_workspace_integrity.sql.
create policy wi_invitee_update on public.finance_workspace_invites
  for update using (invited_user_id = auth.uid() or invited_email = auth.email());

create trigger trg_wi_invitee_guard
  before update on public.finance_workspace_invites
  for each row execute function finance_guard_invite_update();

-- ---- finance_accounts -----------------------------------------------------------

alter table public.finance_accounts enable row level security;

create policy finance_accounts_owner_all on public.finance_accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workspace_read on public.finance_accounts
  for select using (workspace_id is not null and is_workspace_member(workspace_id));

create trigger trg_finance_accounts_ws_guard
  before insert or update on public.finance_accounts
  for each row execute function finance_guard_workspace();

-- ---- finance_categories -----------------------------------------------------------

alter table public.finance_categories enable row level security;

create policy finance_categories_owner_all on public.finance_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workspace_delete on public.finance_categories
  for delete using (workspace_id is not null and is_workspace_member(workspace_id));
create policy workspace_read on public.finance_categories
  for select using (workspace_id is not null and is_workspace_member(workspace_id));
create policy workspace_write on public.finance_categories
  for update
  using (workspace_id is not null and is_workspace_member(workspace_id))
  with check (workspace_id is not null and is_workspace_member(workspace_id));

create trigger trg_finance_categories_ws_guard
  before insert or update on public.finance_categories
  for each row execute function finance_guard_workspace();

-- ---- finance_budgets -----------------------------------------------------------

alter table public.finance_budgets enable row level security;

create policy finance_budgets_owner_all on public.finance_budgets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workspace_delete on public.finance_budgets
  for delete using (workspace_id is not null and is_workspace_member(workspace_id));
create policy shared_read on public.finance_budgets
  for select using (shared_with_user_id = auth.uid());
create policy workspace_read on public.finance_budgets
  for select using (workspace_id is not null and is_workspace_member(workspace_id));
create policy workspace_write on public.finance_budgets
  for update
  using (workspace_id is not null and is_workspace_member(workspace_id))
  with check (workspace_id is not null and is_workspace_member(workspace_id));

create trigger trg_finance_budgets_ws_guard
  before insert or update on public.finance_budgets
  for each row execute function finance_guard_workspace();

-- ---- finance_goals -----------------------------------------------------------

alter table public.finance_goals enable row level security;

create policy finance_goals_owner_all on public.finance_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shared_read on public.finance_goals
  for select using (exists (
    select 1 from public.finance_goal_shares fgs
    where fgs.goal_id = finance_goals.id and fgs.shared_with_user_id = auth.uid()
  ));
create policy workspace_read on public.finance_goals
  for select using (workspace_id is not null and is_workspace_member(workspace_id));

create trigger trg_finance_goals_ws_guard
  before insert or update on public.finance_goals
  for each row execute function finance_guard_workspace();

-- ---- finance_goal_shares -----------------------------------------------------------

alter table public.finance_goal_shares enable row level security;

create policy owner_all on public.finance_goal_shares
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy invitee_select on public.finance_goal_shares
  for select using (shared_with_user_id = auth.uid());

-- ---- finance_goal_contributions -----------------------------------------------------------

alter table public.finance_goal_contributions enable row level security;

create policy finance_goal_contributions_owner_all on public.finance_goal_contributions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shared_insert on public.finance_goal_contributions
  for insert with check (exists (
    select 1 from public.finance_goal_shares fgs
    where fgs.goal_id = finance_goal_contributions.goal_id and fgs.shared_with_user_id = auth.uid()
  ));
create policy owner_sees_all_contributions_to_shared_goals on public.finance_goal_contributions
  for select using (exists (
    select 1 from public.finance_goal_shares fgs
    where fgs.goal_id = finance_goal_contributions.goal_id and fgs.owner_id = auth.uid()
  ));
create policy shared_read on public.finance_goal_contributions
  for select using (exists (
    select 1 from public.finance_goal_shares fgs
    where fgs.goal_id = finance_goal_contributions.goal_id and fgs.shared_with_user_id = auth.uid()
  ));

-- ---- finance_recurring -----------------------------------------------------------

alter table public.finance_recurring enable row level security;

create policy recurring_owner_all on public.finance_recurring
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workspace_read on public.finance_recurring
  for select using (workspace_id is not null and is_workspace_member(workspace_id));

create trigger trg_finance_recurring_ws_guard
  before insert or update on public.finance_recurring
  for each row execute function finance_guard_workspace();

-- ---- finance_recurring_entries -----------------------------------------------------------

alter table public.finance_recurring_entries enable row level security;

create policy recurring_entries_owner_all on public.finance_recurring_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workspace_read on public.finance_recurring_entries
  for select using (exists (
    select 1 from public.finance_recurring r
    where r.id = finance_recurring_entries.recurring_id
      and r.workspace_id is not null
      and is_workspace_member(r.workspace_id)
  ));

-- ---- finance_transactions -----------------------------------------------------------

alter table public.finance_transactions enable row level security;

create policy finance_transactions_owner_all on public.finance_transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy workspace_delete on public.finance_transactions
  for delete using (workspace_id is not null and is_workspace_member(workspace_id));
create policy shared_read on public.finance_transactions
  for select using (shared_with_user_id = auth.uid());
create policy workspace_read on public.finance_transactions
  for select using (workspace_id is not null and is_workspace_member(workspace_id));
create policy workspace_write on public.finance_transactions
  for update
  using (workspace_id is not null and is_workspace_member(workspace_id))
  with check (workspace_id is not null and is_workspace_member(workspace_id));

create trigger trg_finance_transactions_ws_guard
  before insert or update on public.finance_transactions
  for each row execute function finance_guard_workspace();

-- ---- project_boards -----------------------------------------------------------

alter table public.project_boards enable row level security;

create policy project_boards_select on public.project_boards
  for select using (user_id = auth.uid() or user_can_access_board(id, 'viewer'::text));
create policy project_boards_insert on public.project_boards
  for insert with check (user_id = auth.uid());
create policy project_boards_update on public.project_boards
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy project_boards_delete on public.project_boards
  for delete using (user_id = auth.uid());

-- ---- project_columns -----------------------------------------------------------

alter table public.project_columns enable row level security;

create policy project_columns_select on public.project_columns
  for select using (user_can_access_board(board_id, 'viewer'::text));
create policy project_columns_insert on public.project_columns
  for insert with check (user_can_access_board(board_id, 'editor'::text));
create policy project_columns_update on public.project_columns
  for update
  using (user_can_access_board(board_id, 'editor'::text))
  with check (user_can_access_board(board_id, 'editor'::text));
create policy project_columns_delete on public.project_columns
  for delete using (user_can_access_board(board_id, 'editor'::text));

-- ---- project_cards -----------------------------------------------------------

alter table public.project_cards enable row level security;

create policy project_cards_select on public.project_cards
  for select using (user_can_access_board(board_id, 'viewer'::text));
create policy project_cards_insert on public.project_cards
  for insert with check (user_can_access_board(board_id, 'editor'::text));
create policy project_cards_update on public.project_cards
  for update
  using (user_can_access_board(board_id, 'editor'::text))
  with check (user_can_access_board(board_id, 'editor'::text));
create policy project_cards_delete on public.project_cards
  for delete using (user_can_access_board(board_id, 'editor'::text));

-- ---- project_shares -----------------------------------------------------------
-- Verificado (SEC-001): qual E with_check restringem a owner_id = auth.uid(),
-- entao o destinatario do compartilhamento (shared_with_user_id) NAO consegue
-- alterar o proprio role via UPDATE — auto-promocao ja bloqueada pelo RLS.

alter table public.project_shares enable row level security;

create policy project_shares_select on public.project_shares
  for select using (owner_id = auth.uid() or shared_with_user_id = auth.uid());
create policy project_shares_insert on public.project_shares
  for insert with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.project_boards b
      where b.id = project_shares.board_id and b.user_id = auth.uid()
    )
  );
create policy project_shares_update on public.project_shares
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy project_shares_delete on public.project_shares
  for delete using (owner_id = auth.uid());

-- ---- auth.users triggers -----------------------------------------------------------
-- Disparam no signup: primeiro valida/consome o codigo de convite, depois cria
-- o profile. Ordem importa (BEFORE INSERT nega a linha antes que o AFTER rode).

drop trigger if exists on_auth_user_signup_invite_check on auth.users;
create trigger on_auth_user_signup_invite_check before insert on auth.users for each row execute function handle_invite_code_on_signup();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
