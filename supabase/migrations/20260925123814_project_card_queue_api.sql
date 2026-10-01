-- API de cards para a IA + fila de desenvolvimento.
--
-- Uma lógica só: as funções public.cq_* atendem o app (ator = auth.uid()) e a
-- edge function cards-api (chamada como service_role, ator = p_actor resolvido
-- do token pessoal). Toda escrita em project_card_queue passa por elas; o
-- cliente só tem SELECT (RLS) para os selos do kanban e o realtime.
--
-- Acesso ao quadro: mesma regra de public.user_can_access_board (dono do
-- quadro ou share; escrita exige share 'editor'). A correção do SEC-002 precisa
-- atualizar private.cq_board_role junto.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- 1. Tokens pessoais de API
-- ---------------------------------------------------------------------------

create table public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Token',
  token_hash   text not null unique,
  prefix       text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at   timestamptz not null default (now() + interval '90 days'),
  revoked_at   timestamptz
);

create index api_tokens_user_idx on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;
revoke all on public.api_tokens from anon, authenticated;
-- Sem token_hash: o hash nunca sai do banco.
grant select (id, name, prefix, created_at, last_used_at, expires_at, revoked_at)
  on public.api_tokens to authenticated;

create policy api_tokens_select_own on public.api_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.create_api_token(p_name text default 'Token', p_expires_in_days integer default 90)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_token   text;
  v_id      uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if (select count(*) from public.api_tokens t
       where t.user_id = v_uid and t.revoked_at is null and t.expires_at > now()) >= 10 then
    raise exception 'Limite de 10 tokens ativos. Revogue um antes de gerar outro.' using errcode = 'P0001';
  end if;

  -- gen_random_uuid usa pg_strong_random: 2 UUIDs v4 = 244 bits aleatórios.
  v_token := 'akool_pat_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_expires := now() + make_interval(days => greatest(1, least(coalesce(p_expires_in_days, 90), 365)));

  insert into public.api_tokens (user_id, name, token_hash, prefix, expires_at)
  values (
    v_uid,
    left(coalesce(nullif(trim(p_name), ''), 'Token'), 80),
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    left(v_token, 14),
    v_expires
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', left(v_token, 14), 'expires_at', v_expires);
end;
$$;

create or replace function public.revoke_api_token(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.api_tokens
     set revoked_at = now()
   where id = p_id and user_id = auth.uid() and revoked_at is null;
  if not found then
    raise exception 'Token não encontrado ou já revogado' using errcode = 'P0002';
  end if;
end;
$$;

-- Só a edge (service_role). Devolve o dono de um token válido, ou null.
create or replace function public.resolve_api_token(p_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  update public.api_tokens t
     set last_used_at = now()
   where t.token_hash = p_hash
     and t.revoked_at is null
     and t.expires_at > now()
     and not exists (
       select 1 from auth.users u
        where u.id = t.user_id and u.banned_until is not null and u.banned_until > now()
     )
  returning t.user_id into v_uid;
  return v_uid;
end;
$$;

revoke execute on function public.create_api_token(text, integer) from public, anon;
grant execute on function public.create_api_token(text, integer) to authenticated;
revoke execute on function public.revoke_api_token(uuid) from public, anon;
grant execute on function public.revoke_api_token(uuid) to authenticated;
revoke execute on function public.resolve_api_token(text) from public, anon, authenticated;
grant execute on function public.resolve_api_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Fila de desenvolvimento
-- ---------------------------------------------------------------------------

create table public.project_card_queue (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.project_boards(id) on delete cascade,
  card_id      uuid not null references public.project_cards(id) on delete cascade,
  position     integer not null default 0,
  status       text not null default 'queued'
               check (status in ('queued', 'in_progress', 'done', 'blocked', 'cancelled')),
  source       text not null default 'app' check (source in ('app', 'api')),
  requested_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  note         text
);

-- Um card aparece no máximo uma vez na fila ativa.
create unique index project_card_queue_active_card_uidx
  on public.project_card_queue (card_id) where status in ('queued', 'in_progress');
create index project_card_queue_board_idx on public.project_card_queue (board_id, status, position);
create index project_card_queue_requested_by_idx on public.project_card_queue (requested_by);

alter table public.project_card_queue enable row level security;
revoke all on public.project_card_queue from anon, authenticated;
grant select on public.project_card_queue to authenticated;

create policy project_card_queue_select on public.project_card_queue
  for select to authenticated
  using (public.user_can_access_board(board_id, 'viewer'));

alter publication supabase_realtime add table public.project_card_queue;

-- ---------------------------------------------------------------------------
-- 3. Helpers privados
-- ---------------------------------------------------------------------------

-- Ator da chamada: p_actor só vale para service_role (edge cards-api).
create or replace function private.cq_actor(p_actor uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := case when auth.role() = 'service_role' then p_actor else auth.uid() end;
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return v;
end;
$$;

create or replace function private.cq_source()
returns text
language sql
stable
set search_path = ''
as $$
  select case when auth.role() = 'service_role' then 'api' else 'app' end
$$;

-- Mesma regra de public.user_can_access_board, com o usuário como parâmetro.
create or replace function private.cq_board_role(p_user uuid, p_board uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from public.project_boards b where b.id = p_board and b.user_id = p_user) then 'owner'
    else (select s.role from public.project_shares s
           where s.board_id = p_board and s.shared_with_user_id = p_user limit 1)
  end
$$;

create or replace function private.cq_require(p_user uuid, p_board uuid, p_min text)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_role text := private.cq_board_role(p_user, p_board);
begin
  if p_board is null or v_role is null or (p_min = 'editor' and v_role = 'viewer') then
    raise exception 'Sem permissão neste quadro' using errcode = '42501';
  end if;
end;
$$;

-- Minúsculas e sem acento, para casar nomes de coluna digitados à mão.
create or replace function private.cq_norm(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(lower(trim(coalesce(p, ''))),
                   'áàâãäéèêëíìîïóòôõöúùûüç',
                   'aaaaaeeeeiiiiooooouuuuc')
$$;

create or replace function private.cq_is_uuid(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- Card por uuid ou pelo ID externo do backlog ("SEC-002" → título "SEC-002 — …").
create or replace function private.cq_resolve_card(p_board uuid, p_ref text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v   uuid;
  ref text := upper(trim(coalesce(p_ref, '')));
begin
  if private.cq_is_uuid(ref) then
    select c.id into v from public.project_cards c where c.id = ref::uuid and c.board_id = p_board;
  elsif ref ~ '^[A-Z]{2,5}-[0-9]{3}$' then
    select c.id into v from public.project_cards c
     where c.board_id = p_board and (c.title like ref || ' —%' or c.title like ref || ' -%')
     order by c.created_at
     limit 1;
  end if;
  if v is null then
    raise exception 'Card "%" não encontrado neste quadro', p_ref using errcode = 'P0002';
  end if;
  return v;
end;
$$;

-- Colunas por uuid ou nome (sem acento/caixa).
create or replace function private.cq_resolve_columns(p_board uuid, p_refs text[])
returns uuid[]
language plpgsql
stable
set search_path = ''
as $$
declare
  ref    text;
  v      uuid;
  result uuid[] := '{}';
begin
  foreach ref in array coalesce(p_refs, '{}') loop
    v := null;
    if private.cq_is_uuid(trim(ref)) then
      select c.id into v from public.project_columns c where c.id = trim(ref)::uuid and c.board_id = p_board;
    else
      select c.id into v from public.project_columns c
       where c.board_id = p_board and private.cq_norm(c.name) = private.cq_norm(ref)
       order by c.sort_order
       limit 1;
    end if;
    if v is null then
      raise exception 'Coluna "%" não encontrada neste quadro', ref using errcode = 'P0002';
    end if;
    result := result || v;
  end loop;
  return result;
end;
$$;

-- P0..P3 ou urgent/high/medium/low.
create or replace function private.cq_priorities(p text[])
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  x      text;
  v      text;
  result text[] := '{}';
begin
  foreach x in array coalesce(p, '{}') loop
    v := case upper(trim(x))
      when 'P0' then 'urgent' when 'P1' then 'high' when 'P2' then 'medium' when 'P3' then 'low'
      else lower(trim(x)) end;
    if v not in ('urgent', 'high', 'medium', 'low') then
      raise exception 'Prioridade inválida: %', x using errcode = '22023';
    end if;
    result := result || v;
  end loop;
  return result;
end;
$$;

create or replace function private.cq_status_column(p_board uuid, p_kind text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
    from public.project_columns c
   where c.board_id = p_board
     and private.cq_norm(c.name) = any (case p_kind
           when 'doing' then array['fazendo', 'em andamento', 'em progresso', 'doing', 'in progress']
           when 'done'  then array['concluido', 'feito', 'done']
         end)
   order by c.sort_order
   limit 1
$$;

create or replace function private.cq_move_card(p_card uuid, p_column uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_column is null then
    return;
  end if;
  update public.project_cards c
     set column_id  = p_column,
         sort_order = coalesce((select max(o.sort_order) + 1 from public.project_cards o
                                 where o.column_id = p_column and o.id <> p_card), 0),
         updated_at = now()
   where c.id = p_card and c.column_id <> p_column;
end;
$$;

create or replace function private.cq_card_json(p_card uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',          c.id,
    'board_id',    c.board_id,
    'external_id', substring(c.title from '^([A-Z]{2,5}-[0-9]{3})'),
    'title',       c.title,
    'column_id',   c.column_id,
    'column',      col.name,
    'priority',    c.priority,
    'labels',      c.labels,
    'completed',   c.completed,
    'description', c.description,
    'checklist',   c.checklist,
    'queue', (select jsonb_build_object('id', q.id, 'status', q.status, 'position', q.position,
                                        'started_at', q.started_at, 'finished_at', q.finished_at, 'note', q.note)
                from public.project_card_queue q
               where q.card_id = c.id
               order by q.created_at desc
               limit 1)
  )
  from public.project_cards c
  join public.project_columns col on col.id = c.column_id
  where c.id = p_card
$$;

create or replace function private.cq_stamp(p_label text, p_note text)
returns text
language sql
stable
set search_path = ''
as $$
  select E'\n\n---\n**' || p_label || ' (' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '):** ' || p_note
$$;

-- ---------------------------------------------------------------------------
-- 4. API pública (app via auth.uid(); edge via service_role + p_actor)
-- ---------------------------------------------------------------------------

create or replace function public.cq_boards(p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id,
      'name', b.name,
      'role', private.cq_board_role(v_actor, b.id),
      'columns', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', col.id, 'name', col.name,
                 'open_cards', (select count(*) from public.project_cards c where c.column_id = col.id and not c.completed))
                 order by col.sort_order)
          from public.project_columns col where col.board_id = b.id), '[]'::jsonb),
      'queue', (select jsonb_build_object(
                  'queued', count(*) filter (where q.status = 'queued'),
                  'in_progress', count(*) filter (where q.status = 'in_progress'),
                  'blocked', count(*) filter (where q.status = 'blocked'))
                  from public.project_card_queue q where q.board_id = b.id))
      order by b.sort_order, b.created_at)
    from public.project_boards b
    where private.cq_board_role(v_actor, b.id) is not null
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cq_cards(
  p_board      uuid,
  p_columns    text[]  default null,
  p_priorities text[]  default null,
  p_labels     text[]  default null,
  p_completed  boolean default false,
  p_actor      uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_cols  uuid[];
  v_prios text[];
begin
  perform private.cq_require(v_actor, p_board, 'viewer');
  v_cols := private.cq_resolve_columns(p_board, p_columns);
  v_prios := private.cq_priorities(p_priorities);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'external_id', substring(c.title from '^([A-Z]{2,5}-[0-9]{3})'),
      'title', c.title,
      'column', col.name,
      'priority', c.priority,
      'labels', c.labels,
      'completed', c.completed,
      'checklist_done', (select count(*) from jsonb_array_elements(c.checklist) as t(item) where (t.item ->> 'completed')::boolean),
      'checklist_total', jsonb_array_length(c.checklist))
      order by case c.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
               col.sort_order, c.sort_order)
    from public.project_cards c
    join public.project_columns col on col.id = c.column_id
    where c.board_id = p_board
      and (p_completed is null or c.completed = p_completed)
      and (cardinality(v_cols) = 0 or c.column_id = any (v_cols))
      and (cardinality(v_prios) = 0 or c.priority = any (v_prios))
      and (coalesce(cardinality(p_labels), 0) = 0 or c.labels ?| p_labels)
  ), '[]'::jsonb);
end;
$$;

create or replace function public.cq_card(p_board uuid, p_card text, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
begin
  perform private.cq_require(v_actor, p_board, 'viewer');
  return private.cq_card_json(private.cq_resolve_card(p_board, p_card));
end;
$$;

-- Monta a fila: cards explícitos (OU) cards que batem com todos os filtros
-- informados (colunas E prioridades E labels). Ordem: prioridade, coluna, card.
create or replace function public.cq_enqueue(
  p_board      uuid,
  p_cards      text[] default null,
  p_columns    text[] default null,
  p_priorities text[] default null,
  p_labels     text[] default null,
  p_actor      uuid   default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := private.cq_actor(p_actor);
  v_card_ids uuid[] := '{}';
  v_cols     uuid[];
  v_prios    text[];
  v_filtered boolean;
  v_base     integer;
  v_ref      text;
  v_rows     jsonb;
begin
  perform private.cq_require(v_actor, p_board, 'editor');

  foreach v_ref in array coalesce(p_cards, '{}') loop
    v_card_ids := v_card_ids || private.cq_resolve_card(p_board, v_ref);
  end loop;
  v_cols := private.cq_resolve_columns(p_board, p_columns);
  v_prios := private.cq_priorities(p_priorities);
  v_filtered := cardinality(v_cols) > 0 or cardinality(v_prios) > 0 or coalesce(cardinality(p_labels), 0) > 0;

  if cardinality(v_card_ids) = 0 and not v_filtered then
    raise exception 'Informe cards, colunas, prioridades ou labels' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('cq:' || p_board::text));

  select coalesce(max(q.position), 0) into v_base
    from public.project_card_queue q
   where q.board_id = p_board and q.status in ('queued', 'in_progress');

  with picked as (
    select c.id,
           row_number() over (order by
             case c.priority when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
             col.sort_order, c.sort_order, c.created_at) as rn
      from public.project_cards c
      join public.project_columns col on col.id = c.column_id
     where c.board_id = p_board
       and not c.completed
       and not exists (select 1 from public.project_card_queue q
                        where q.card_id = c.id and q.status in ('queued', 'in_progress'))
       and (
         c.id = any (v_card_ids)
         or (v_filtered
             and (cardinality(v_cols) = 0 or c.column_id = any (v_cols))
             and (cardinality(v_prios) = 0 or c.priority = any (v_prios))
             and (coalesce(cardinality(p_labels), 0) = 0 or c.labels ?| p_labels))
       )
  ), ins as (
    insert into public.project_card_queue (board_id, card_id, position, source, requested_by)
    select p_board, picked.id, v_base + picked.rn, private.cq_source(), v_actor
      from picked
    returning id, card_id, position, status
  )
  select coalesce(jsonb_agg(to_jsonb(ins) order by ins.position), '[]'::jsonb) into v_rows from ins;

  return v_rows;
end;
$$;

create or replace function public.cq_list(p_board uuid, p_statuses text[] default null, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
begin
  perform private.cq_require(v_actor, p_board, 'viewer');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id,
      'card_id', q.card_id,
      'position', q.position,
      'status', q.status,
      'source', q.source,
      'created_at', q.created_at,
      'started_at', q.started_at,
      'finished_at', q.finished_at,
      'note', q.note,
      'external_id', substring(c.title from '^([A-Z]{2,5}-[0-9]{3})'),
      'title', c.title,
      'priority', c.priority,
      'column', col.name,
      'labels', c.labels)
      order by case q.status when 'in_progress' then 0 when 'queued' then 1 when 'blocked' then 2 else 3 end,
               case when q.status in ('queued', 'in_progress') then q.position end,
               q.finished_at desc nulls last)
    from public.project_card_queue q
    join public.project_cards c on c.id = q.card_id
    join public.project_columns col on col.id = c.column_id
    where q.board_id = p_board
      and (coalesce(cardinality(p_statuses), 0) = 0 or q.status = any (p_statuses))
  ), '[]'::jsonb);
end;
$$;

-- Próximo card: retoma o que está em andamento; senão inicia o primeiro da fila
-- e move o card para a coluna "Fazendo" (se existir).
create or replace function public.cq_next(p_board uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_q     public.project_card_queue%rowtype;
begin
  perform private.cq_require(v_actor, p_board, 'editor');

  select * into v_q from public.project_card_queue q
   where q.board_id = p_board and q.status = 'in_progress'
   order by q.started_at
   limit 1;

  if not found then
    select * into v_q from public.project_card_queue q
     where q.board_id = p_board and q.status = 'queued'
     order by q.position, q.created_at
     limit 1
     for update skip locked;
    if not found then
      return null;
    end if;
    update public.project_card_queue set status = 'in_progress', started_at = now() where id = v_q.id;
    perform private.cq_move_card(v_q.card_id, private.cq_status_column(p_board, 'doing'));
  end if;

  return private.cq_card_json(v_q.card_id);
end;
$$;

-- Marca/desmarca subtarefas por id ou por posição (1, 2, 3…).
create or replace function public.cq_check(
  p_board uuid,
  p_card  text,
  p_items text[],
  p_done  boolean default true,
  p_actor uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_card  uuid;
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  v_card := private.cq_resolve_card(p_board, p_card);

  update public.project_cards c
     set checklist = (
           select coalesce(jsonb_agg(
                    case when (t.item ->> 'id') = any (p_items) or t.ord::text = any (p_items)
                         then jsonb_set(t.item, '{completed}', to_jsonb(coalesce(p_done, true)))
                         else t.item end
                    order by t.ord), '[]'::jsonb)
             from jsonb_array_elements(c.checklist) with ordinality as t(item, ord)),
         updated_at = now()
   where c.id = v_card;

  return private.cq_card_json(v_card);
end;
$$;

-- Conclui: checklist 100%, completed, coluna "Concluído" (se existir), nota na
-- descrição e item da fila como done.
create or replace function public.cq_complete(p_board uuid, p_card text, p_note text default null, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_card  uuid;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  v_card := private.cq_resolve_card(p_board, p_card);

  update public.project_cards c
     set checklist = (
           select coalesce(jsonb_agg(jsonb_set(t.item, '{completed}', 'true'::jsonb) order by t.ord), '[]'::jsonb)
             from jsonb_array_elements(c.checklist) with ordinality as t(item, ord)),
         completed = true,
         description = c.description || case when v_note is null then ''
           else private.cq_stamp(case when private.cq_source() = 'api' then 'Concluído pela IA' else 'Concluído' end, v_note) end,
         updated_at = now()
   where c.id = v_card;

  perform private.cq_move_card(v_card, private.cq_status_column(p_board, 'done'));

  update public.project_card_queue
     set status = 'done', finished_at = now(), note = v_note, started_at = coalesce(started_at, now())
   where card_id = v_card and status in ('queued', 'in_progress');

  return private.cq_card_json(v_card);
end;
$$;

-- Bloqueia: sai da fila ativa com o motivo; o card fica onde está.
create or replace function public.cq_block(p_board uuid, p_card text, p_note text, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_card  uuid;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  if v_note is null then
    raise exception 'Informe o motivo do bloqueio' using errcode = '22023';
  end if;
  v_card := private.cq_resolve_card(p_board, p_card);

  update public.project_card_queue
     set status = 'blocked', finished_at = now(), note = v_note
   where card_id = v_card and status in ('queued', 'in_progress');
  if not found then
    raise exception 'O card não está na fila ativa' using errcode = 'P0002';
  end if;

  update public.project_cards c
     set description = c.description || private.cq_stamp('Bloqueado', v_note), updated_at = now()
   where c.id = v_card;

  return private.cq_card_json(v_card);
end;
$$;

create or replace function public.cq_remove(p_queue_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_board uuid;
begin
  select q.board_id into v_board from public.project_card_queue q where q.id = p_queue_id;
  perform private.cq_require(v_actor, v_board, 'editor');
  update public.project_card_queue
     set status = 'cancelled', finished_at = now()
   where id = p_queue_id and status in ('queued', 'in_progress', 'blocked');
end;
$$;

-- Reordena um item "queued" para a posição p_position (1 = próximo).
create or replace function public.cq_move(p_queue_id uuid, p_position integer, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_board uuid;
  v_pos   integer;
begin
  select q.board_id into v_board from public.project_card_queue q where q.id = p_queue_id and q.status = 'queued';
  perform private.cq_require(v_actor, v_board, 'editor');
  perform pg_advisory_xact_lock(hashtext('cq:' || v_board::text));

  select greatest(1, least(coalesce(p_position, 1), count(*))) into v_pos
    from public.project_card_queue q where q.board_id = v_board and q.status = 'queued';

  with ordered as (
    select q.id, row_number() over (order by q.position, q.created_at) as rn
      from public.project_card_queue q
     where q.board_id = v_board and q.status = 'queued' and q.id <> p_queue_id
  )
  update public.project_card_queue q
     set position = case when o.rn >= v_pos then o.rn + 1 else o.rn end
    from ordered o
   where q.id = o.id;

  update public.project_card_queue set position = v_pos where id = p_queue_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

-- Os helpers private.* ficam inalcançáveis: o schema não dá USAGE a ninguém
-- além do dono, e eles só rodam de dentro das funções SECURITY DEFINER acima.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.cq_boards(uuid)',
    'public.cq_cards(uuid, text[], text[], text[], boolean, uuid)',
    'public.cq_card(uuid, text, uuid)',
    'public.cq_enqueue(uuid, text[], text[], text[], text[], uuid)',
    'public.cq_list(uuid, text[], uuid)',
    'public.cq_next(uuid, uuid)',
    'public.cq_check(uuid, text, text[], boolean, uuid)',
    'public.cq_complete(uuid, text, text, uuid)',
    'public.cq_block(uuid, text, text, uuid)',
    'public.cq_remove(uuid, uuid)',
    'public.cq_move(uuid, integer, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
