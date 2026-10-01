-- Fluxo novo da fila (v2): colunas por fase, Validação, "Aguardando você" e
-- planos em lote.
--
--   A fazer → Avaliação → Plano → Desenvolvimento → Validação → Concluído
--                                   ↘ Aguardando você ↗
--
-- * Um quadro "usa o fluxo" quando tem as 7 colunas acima (nomes sem
--   acento/caixa; cq_setup_flow cria e converte). Sem elas, tudo segue como
--   antes: "Fazendo" ao iniciar, "Concluído" ao concluir, bloqueio sem mover.
-- * Status novo `review` (em validação): o `complete` da IA manda para
--   Validação; o usuário aprova (botão ou arrastando para Concluído) ou reprova
--   (motivo obrigatório; volta ao topo da fila).
-- * Fase nova `aprovado`: plano aprovado esperando a vez (lote).
-- * Itens da checklist com `owner: "user"` são do usuário. Card bloqueado volta
--   sozinho para a fila quando todos os itens dele estão marcados (gatilho).
-- * cq_start(board, n): lote, completa até n cards em andamento.

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------

alter table public.project_card_queue drop constraint project_card_queue_status_check;
alter table public.project_card_queue add constraint project_card_queue_status_check
  check (status in ('queued', 'in_progress', 'review', 'done', 'blocked', 'cancelled'));

alter table public.project_card_queue drop constraint project_card_queue_phase_check;
alter table public.project_card_queue add constraint project_card_queue_phase_check
  check (phase in ('avaliacao', 'plano', 'aprovado', 'desenvolvimento'));

-- Card em validação também conta como ativo (não entra de novo na fila).
drop index public.project_card_queue_active_card_uidx;
create unique index project_card_queue_active_card_uidx
  on public.project_card_queue (card_id) where status in ('queued', 'in_progress', 'review');

-- Última passagem do card pela fila (gatilho, enqueue, setup).
create index project_card_queue_card_latest_idx on public.project_card_queue (card_id, created_at desc);

-- Duas passagens do mesmo card podem nascer na mesma transação (reprovar,
-- retomar): clock_timestamp() mantém a ordem entre elas; now() empataria.
alter table public.project_card_queue alter column created_at set default clock_timestamp();

-- ---------------------------------------------------------------------------
-- 2. Estágios (colunas do fluxo)
-- ---------------------------------------------------------------------------

-- Nomes aceitos por estágio (já normalizados por cq_norm). 'doing' é o legado.
create or replace function private.cq_stage_names(p_kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'todo'            then array['a fazer']
    when 'avaliacao'       then array['avaliacao']
    when 'plano'           then array['plano']
    when 'desenvolvimento' then array['desenvolvimento']
    when 'validacao'       then array['validacao']
    when 'waiting'         then array['aguardando voce']
    when 'doing'           then array['fazendo', 'em andamento', 'em progresso', 'doing', 'in progress']
    when 'done'            then array['concluido', 'feito', 'done']
    else array[]::text[]
  end
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
     and private.cq_norm(c.name) = any (private.cq_stage_names(p_kind))
   order by c.sort_order
   limit 1
$$;

-- Estágio do fluxo pelo nome da coluna (null = coluna fora do fluxo, inclusive "Fazendo").
create or replace function private.cq_stage_kind(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select k
    from unnest(array['todo', 'avaliacao', 'plano', 'desenvolvimento', 'validacao', 'waiting', 'done']) with ordinality as s(k, n)
   where private.cq_norm(p_name) = any (private.cq_stage_names(k))
   order by n
   limit 1
$$;

create or replace function private.cq_flow_enabled(p_board uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(distinct private.cq_stage_kind(c.name)) = 7
    from public.project_columns c
   where c.board_id = p_board and private.cq_stage_kind(c.name) is not null
$$;

-- Coluna da fase do card em andamento; sem o fluxo, o legado "Fazendo".
create or replace function private.cq_phase_column(p_board uuid, p_phase text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when private.cq_flow_enabled(p_board)
              then private.cq_status_column(p_board, case p_phase when 'aprovado' then 'plano' else coalesce(p_phase, 'avaliacao') end)
              else private.cq_status_column(p_board, 'doing') end
$$;

-- "A fazer" na ordem da fila: os cards "queued" primeiro, pela posição; o
-- resto da coluna depois, na ordem em que estava. Só em quadro com o fluxo.
create or replace function private.cq_sync_todo_order(p_board uuid)
returns void
language sql
set search_path = ''
as $$
  with todo as (
    select case when private.cq_flow_enabled(p_board) then private.cq_status_column(p_board, 'todo') end as id
  ), o as (
    select c.id,
           row_number() over (order by (q.position is null), q.position, c.sort_order, c.created_at) as rn
      from public.project_cards c
      left join public.project_card_queue q on q.card_id = c.id and q.status = 'queued'
     where c.column_id = (select id from todo)
  )
  update public.project_cards c
     set sort_order = o.rn
    from o
   where c.id = o.id and c.sort_order is distinct from o.rn
$$;

-- ---------------------------------------------------------------------------
-- 3. Inserção na fila (usada por enqueue, reprovação, retorno e release)
-- ---------------------------------------------------------------------------

-- Insere os cards como "queued": ordem prioridade → esforço → coluna → card;
-- cada um logo depois do último item da fila com prioridade igual ou maior
-- (p_top: antes de todos). A passagem bloqueada anterior vira "Retomado" e,
-- com o fluxo, o card vai para "A fazer". Quem chama já validou permissão.
create or replace function private.cq_insert_queued(p_board uuid, p_cards uuid[], p_actor uuid, p_top boolean default false)
returns uuid[]
language plpgsql
set search_path = ''
as $$
declare
  c_step  constant integer := 100000;
  v_ids   uuid[];
  v_cards uuid[];
  v_todo  uuid := case when private.cq_flow_enabled(p_board) then private.cq_status_column(p_board, 'todo') end;
begin
  if coalesce(cardinality(p_cards), 0) = 0 then
    return '{}';
  end if;

  perform pg_advisory_xact_lock(hashtext('cq:' || p_board::text));
  -- Abre espaço entre os itens da fila (1·step, 2·step, …) para encaixar os novos.
  perform private.cq_renumber(p_board, c_step);

  with picked as (
    select c.id,
           private.cq_priority_rank(c.priority) as rk,
           row_number() over (order by
             private.cq_priority_rank(c.priority), private.cq_effort_rank(c.labels),
             col.sort_order, c.sort_order, c.created_at) as rn
      from public.project_cards c
      join public.project_columns col on col.id = c.column_id
     where c.board_id = p_board and c.id = any (p_cards)
  ), ins as (
    -- Âncora = posição do último item da fila com prioridade igual ou maior
    -- (o SELECT vê a fila de antes deste INSERT).
    insert into public.project_card_queue (board_id, card_id, position, source, requested_by)
    select p_board, p.id,
           case when p_top then 0
                else coalesce((select max(q.position)
                                 from public.project_card_queue q
                                 join public.project_cards qc on qc.id = q.card_id
                                where q.board_id = p_board and q.status = 'queued'
                                  and private.cq_priority_rank(qc.priority) <= p.rk), 0) end + p.rn,
           private.cq_source(), p_actor
      from picked p
    returning id, card_id
  )
  select coalesce(array_agg(ins.id), '{}'), coalesce(array_agg(ins.card_id), '{}')
    into v_ids, v_cards
    from ins;

  perform private.cq_renumber(p_board, 1);

  -- Card recolocado na fila: a passagem bloqueada anterior sai da lista.
  update public.project_card_queue q
     set status = 'cancelled',
         note = coalesce(q.note || E'\n\n', '') || 'Retomado: card recolocado na fila em '
                || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.'
   where q.status = 'blocked' and q.card_id = any (v_cards);

  if v_todo is not null then
    perform private.cq_move_card(x.id, v_todo) from unnest(v_cards) as x(id);
    perform private.cq_sync_todo_order(p_board);
  end if;

  return v_ids;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. API
-- ---------------------------------------------------------------------------

create or replace function public.cq_enqueue(
  p_board      uuid,
  p_cards      text[] default null,
  p_columns    text[] default null,
  p_priorities text[] default null,
  p_labels     text[] default null,
  p_actor      uuid default null
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
  v_ref      text;
  v_pick     uuid[];
  v_new_ids  uuid[];
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

  select coalesce(array_agg(c.id), '{}') into v_pick
    from public.project_cards c
   where c.board_id = p_board
     and not c.completed
     and not exists (select 1 from public.project_card_queue q
                      where q.card_id = c.id and q.status in ('queued', 'in_progress', 'review'))
     and (
       c.id = any (v_card_ids)
       or (v_filtered
           and (cardinality(v_cols) = 0 or c.column_id = any (v_cols))
           and (cardinality(v_prios) = 0 or c.priority = any (v_prios))
           and (coalesce(cardinality(p_labels), 0) = 0 or c.labels ?| p_labels)
           -- Bloqueado espera ação do usuário: só volta à fila por id.
           and not exists (
             select 1 from public.project_card_queue b
              where b.card_id = c.id and b.status = 'blocked'
                and not exists (select 1 from public.project_card_queue n
                                 where n.card_id = c.id and n.created_at > b.created_at)))
     );

  v_new_ids := private.cq_insert_queued(p_board, v_pick, v_actor, false);

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'card_id', q.card_id, 'position', q.position, 'status', q.status)
                     order by q.position)
      from public.project_card_queue q
     where q.id = any (v_new_ids)
  ), '[]'::jsonb);
end;
$$;

-- Reordena todos os "queued" por prioridade → esforço → posição atual.
create or replace function public.cq_reprioritize(p_board uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  perform pg_advisory_xact_lock(hashtext('cq:' || p_board::text));

  with o as (
    select q.id,
           row_number() over (order by
             private.cq_priority_rank(c.priority), private.cq_effort_rank(c.labels),
             q.position, q.created_at) as rn
      from public.project_card_queue q
      join public.project_cards c on c.id = q.card_id
     where q.board_id = p_board and q.status = 'queued'
  )
  update public.project_card_queue q
     set position = o.rn
    from o
   where q.id = o.id;

  perform private.cq_sync_todo_order(p_board);
  return public.cq_list(p_board, array['in_progress', 'queued'], p_actor);
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
  perform private.cq_sync_todo_order(v_board);
end;
$$;

-- Lote: completa até p_count cards em andamento (fase Avaliação) e devolve
-- todos os que estão em andamento, na ordem em que começaram.
create or replace function public.cq_start(p_board uuid, p_count integer default 3, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_count integer := least(greatest(coalesce(p_count, 3), 1), 10);
  v_have  integer;
  v_q     record;
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  perform pg_advisory_xact_lock(hashtext('cq:' || p_board::text));

  select count(*) into v_have
    from public.project_card_queue q where q.board_id = p_board and q.status = 'in_progress';

  for v_q in
    select q.id, q.card_id
      from public.project_card_queue q
     where q.board_id = p_board and q.status = 'queued'
     order by q.position, q.created_at
     limit greatest(v_count - v_have, 0)
  loop
    update public.project_card_queue
       set status = 'in_progress', started_at = now(), phase = 'avaliacao'
     where id = v_q.id;
    perform private.cq_move_card(v_q.card_id, private.cq_phase_column(p_board, 'avaliacao'));
  end loop;

  perform private.cq_renumber(p_board, 1);
  perform private.cq_sync_todo_order(p_board);

  return coalesce((
    select jsonb_agg(private.cq_card_json(q.card_id) order by q.started_at, q.position)
      from public.project_card_queue q
     where q.board_id = p_board and q.status = 'in_progress'
  ), '[]'::jsonb);
end;
$$;

-- Próximo card: retoma o que está em andamento (na fase em que parou); senão
-- inicia o primeiro da fila na fase de Avaliação.
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
    update public.project_card_queue
       set status = 'in_progress', started_at = now(), phase = 'avaliacao'
     where id = v_q.id;
    perform private.cq_move_card(v_q.card_id, private.cq_phase_column(p_board, 'avaliacao'));
    perform private.cq_sync_todo_order(p_board);
  end if;

  return private.cq_card_json(v_q.card_id);
end;
$$;

-- Registra a fase do card em andamento (e, com o fluxo, move para a coluna da
-- fase); com texto, anexa a seção ("## Avaliação (IA) — dd/mm/aaaa").
create or replace function public.cq_note(
  p_board uuid,
  p_card  text,
  p_phase text,
  p_text  text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_card  uuid;
  v_text  text := nullif(trim(coalesce(p_text, '')), '');
  v_label text;
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  if p_phase is null or p_phase not in ('avaliacao', 'plano', 'aprovado', 'desenvolvimento') then
    raise exception 'Fase inválida: % (use avaliacao, plano, aprovado ou desenvolvimento)', coalesce(p_phase, 'null')
      using errcode = '22023';
  end if;
  v_card := private.cq_resolve_card(p_board, p_card);

  update public.project_card_queue
     set phase = p_phase
   where card_id = v_card and status = 'in_progress';
  if not found then
    raise exception 'O card não está em andamento na fila (rode next antes)' using errcode = 'P0002';
  end if;

  perform private.cq_move_card(v_card, private.cq_phase_column(p_board, p_phase));

  if v_text is not null then
    v_label := case p_phase when 'avaliacao' then 'Avaliação' when 'plano' then 'Plano'
                            when 'aprovado' then 'Plano aprovado' else 'Desenvolvimento' end
            || case when private.cq_source() = 'api' then ' (IA)' else '' end;
    update public.project_cards c
       set description = c.description || E'\n\n---\n## ' || v_label || ' — '
                         || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || E'\n\n' || v_text,
           updated_at = now()
     where c.id = v_card;
  end if;

  return private.cq_card_json(v_card);
end;
$$;

-- Conclui a parte da IA. Com o fluxo: checklist 100%, card em Validação e item
-- como "review" (o usuário aprova ou reprova). Sem o fluxo: conclui direto.
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
  v_flow  boolean := private.cq_flow_enabled(p_board);
  v_label text;
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  v_card := private.cq_resolve_card(p_board, p_card);

  v_label := case when v_flow then 'Enviado para validação' else 'Concluído' end
          || case when private.cq_source() = 'api' then ' pela IA' else '' end;

  update public.project_cards c
     set checklist = (
           select coalesce(jsonb_agg(jsonb_set(t.item, '{completed}', 'true'::jsonb) order by t.ord), '[]'::jsonb)
             from jsonb_array_elements(c.checklist) with ordinality as t(item, ord)),
         completed = not v_flow,
         description = c.description || case when v_note is null then '' else private.cq_stamp(v_label, v_note) end,
         updated_at = now()
   where c.id = v_card;

  if v_flow then
    update public.project_card_queue
       set status = 'review', finished_at = now(), note = v_note, started_at = coalesce(started_at, now())
     where card_id = v_card and status in ('queued', 'in_progress');
    if not found and not exists (select 1 from public.project_card_queue q where q.card_id = v_card and q.status = 'review') then
      insert into public.project_card_queue (board_id, card_id, status, started_at, finished_at, note, source, requested_by)
      values (p_board, v_card, 'review', now(), now(), v_note, private.cq_source(), v_actor);
    end if;
    perform private.cq_move_card(v_card, private.cq_status_column(p_board, 'validacao'));
  else
    perform private.cq_move_card(v_card, private.cq_status_column(p_board, 'done'));
    update public.project_card_queue
       set status = 'done', finished_at = now(), note = v_note, started_at = coalesce(started_at, now())
     where card_id = v_card and status in ('queued', 'in_progress');
  end if;

  return private.cq_card_json(v_card);
end;
$$;

-- Validação do usuário: aprovar conclui (Concluído); reprovar exige o motivo e
-- devolve o card ao topo da fila ("A fazer").
create or replace function public.cq_validate(
  p_board   uuid,
  p_card    text,
  p_approve boolean,
  p_note    text default null,
  p_actor   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_card  uuid;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_row   uuid;
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  v_card := private.cq_resolve_card(p_board, p_card);

  select q.id into v_row from public.project_card_queue q
   where q.card_id = v_card and q.status = 'review'
   order by q.created_at desc
   limit 1;
  if v_row is null then
    raise exception 'O card não está em validação' using errcode = 'P0002';
  end if;

  if coalesce(p_approve, false) then
    -- Status antes de mover: o gatilho vê "done" e não faz nada.
    update public.project_card_queue set status = 'done', finished_at = now() where id = v_row;
    update public.project_cards c
       set completed = true,
           description = c.description || private.cq_stamp('Validado', coalesce(v_note, 'aprovado.')),
           updated_at = now()
     where c.id = v_card;
    perform private.cq_move_card(v_card, private.cq_status_column(p_board, 'done'));
  else
    if v_note is null then
      raise exception 'Informe o motivo da reprovação' using errcode = '22023';
    end if;
    update public.project_card_queue
       set status = 'cancelled', finished_at = now(), note = 'Reprovado na validação: ' || v_note
     where id = v_row;
    update public.project_cards c
       set completed = false,
           description = c.description || private.cq_stamp('Reprovado na validação', v_note),
           updated_at = now()
     where c.id = v_card;
    perform private.cq_insert_queued(p_board, array[v_card], v_actor, true);
  end if;

  return private.cq_card_json(v_card);
end;
$$;

-- Aguardando o usuário: tira da fila ativa com o motivo e marca os itens dele
-- (novos em p_user_items; existentes por id ou posição em p_user_refs). Card
-- já bloqueado: atualiza as pendências. Com o fluxo, vai para "Aguardando você".
drop function public.cq_block(uuid, text, text, uuid);
create function public.cq_block(
  p_board      uuid,
  p_card       text,
  p_note       text,
  p_user_items text[] default null,
  p_user_refs  text[] default null,
  p_actor      uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.cq_actor(p_actor);
  v_card  uuid;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_flow  boolean := private.cq_flow_enabled(p_board);
  v_ref   text;
  v_last  uuid;
begin
  perform private.cq_require(v_actor, p_board, 'editor');
  if v_note is null then
    raise exception 'Informe o motivo do bloqueio' using errcode = '22023';
  end if;
  v_card := private.cq_resolve_card(p_board, p_card);

  foreach v_ref in array coalesce(p_user_refs, '{}') loop
    if not exists (select 1
                     from public.project_cards c,
                          jsonb_array_elements(c.checklist) with ordinality as t(item, ord)
                    where c.id = v_card and ((t.item ->> 'id') = v_ref or t.ord::text = v_ref)) then
      raise exception 'Subtarefa "%" não encontrada no card', v_ref using errcode = 'P0002';
    end if;
  end loop;

  update public.project_card_queue
     set status = 'blocked', finished_at = now(), note = v_note
   where card_id = v_card and status in ('queued', 'in_progress');
  if not found then
    select q.id into v_last from public.project_card_queue q
     where q.card_id = v_card
     order by q.created_at desc
     limit 1;
    if v_last is null or not exists (select 1 from public.project_card_queue q where q.id = v_last and q.status = 'blocked') then
      raise exception 'O card não está na fila ativa nem aguardando o usuário' using errcode = 'P0002';
    end if;
    update public.project_card_queue set note = v_note where id = v_last;
  end if;

  update public.project_cards c
     set checklist = coalesce((
           select jsonb_agg(case when (t.item ->> 'id') = any (coalesce(p_user_refs, '{}')) or t.ord::text = any (coalesce(p_user_refs, '{}'))
                                 then t.item || '{"owner": "user"}'::jsonb
                                 else t.item end
                            order by t.ord)
             from jsonb_array_elements(c.checklist) with ordinality as t(item, ord)), '[]'::jsonb)
         || coalesce((
           select jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'text', trim(u.x), 'completed', false, 'owner', 'user')
                            order by u.n)
             from unnest(p_user_items) with ordinality as u(x, n)
            where nullif(trim(u.x), '') is not null), '[]'::jsonb),
         description = c.description || private.cq_stamp(case when v_flow then 'Aguardando você' else 'Bloqueado' end, v_note),
         updated_at = now()
   where c.id = v_card;

  -- Itens informados, mas todos já marcados: o card voltaria na hora.
  if (coalesce(cardinality(p_user_items), 0) > 0 or coalesce(cardinality(p_user_refs), 0) > 0)
     and not exists (select 1 from public.project_cards c, jsonb_array_elements(c.checklist) as t(item)
                      where c.id = v_card and t.item ->> 'owner' = 'user'
                        and not coalesce((t.item ->> 'completed')::boolean, false)) then
    raise exception 'Os itens do usuário já estão todos marcados' using errcode = '22023';
  end if;

  if v_flow then
    perform private.cq_move_card(v_card, private.cq_status_column(p_board, 'waiting'));
  end if;

  return private.cq_card_json(v_card);
end;
$$;

-- Devolve um card em andamento à fila (ex.: plano não aprovado no lote).
create or replace function public.cq_release(p_board uuid, p_card text, p_note text default null, p_actor uuid default null)
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

  update public.project_card_queue
     set status = 'cancelled', finished_at = now(),
         note = 'Devolvido à fila' || coalesce(': ' || v_note, '.')
   where card_id = v_card and status = 'in_progress';
  if not found then
    raise exception 'O card não está em andamento' using errcode = 'P0002';
  end if;

  perform private.cq_insert_queued(p_board, array[v_card], v_actor, false);
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
   where id = p_queue_id and status in ('queued', 'in_progress', 'review', 'blocked');
  perform private.cq_sync_todo_order(v_board);
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
      'phase', q.phase,
      'source', q.source,
      'created_at', q.created_at,
      'started_at', q.started_at,
      'finished_at', q.finished_at,
      'note', q.note,
      'external_id', substring(c.title from '^([A-Z]{2,5}-[0-9]{3})'),
      'title', c.title,
      'priority', c.priority,
      'column', col.name,
      'labels', c.labels,
      'user_pending', (select count(*) from jsonb_array_elements(c.checklist) as t(item)
                        where t.item ->> 'owner' = 'user' and not coalesce((t.item ->> 'completed')::boolean, false)))
      order by case q.status when 'in_progress' then 0 when 'queued' then 1 when 'review' then 2 when 'blocked' then 3 else 4 end,
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
      'flow', private.cq_flow_enabled(b.id),
      'columns', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', col.id, 'name', col.name,
                 'open_cards', (select count(*) from public.project_cards c where c.column_id = col.id and not c.completed))
                 order by col.sort_order)
          from public.project_columns col where col.board_id = b.id), '[]'::jsonb),
      'queue', (select jsonb_build_object(
                  'queued', count(*) filter (where q.status = 'queued'),
                  'in_progress', count(*) filter (where q.status = 'in_progress'),
                  'review', count(*) filter (where q.status = 'review'),
                  'blocked', count(*) filter (where q.status = 'blocked'))
                  from public.project_card_queue q where q.board_id = b.id))
      order by b.sort_order, b.created_at)
    from public.project_boards b
    where private.cq_board_role(v_actor, b.id) is not null
  ), '[]'::jsonb);
end;
$$;

-- Converte um quadro para o fluxo: cria as colunas que faltam, leva cada card
-- das outras colunas para o estágio certo (o nome da coluna antiga vira label,
-- menos "Fazendo") e apaga as colunas antigas. Apagar coluna apaga os cards
-- dela (on delete cascade), então só apaga coluna vazia; se sobrar card, aborta.
create or replace function public.cq_setup_flow(p_board uuid, p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := private.cq_actor(p_actor);
  v_stage   record;
  v_col     uuid;
  v_card    record;
  v_status  text;
  v_phase   text;
  v_target  uuid;
  v_label   text;
  v_created text[] := '{}';
  v_deleted text[] := '{}';
  v_moved   jsonb := '{}'::jsonb;
  v_labels  integer := 0;
  v_old     record;
begin
  if private.cq_board_role(v_actor, p_board) is distinct from 'owner' then
    raise exception 'Só o dono do quadro pode converter as colunas' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('cq:' || p_board::text));

  -- 1. Colunas do fluxo, na ordem (as antigas vão para o fim até serem apagadas).
  update public.project_columns set sort_order = sort_order + 1000 where board_id = p_board;
  for v_stage in
    select * from (values
      (0, 'todo', 'A fazer', '#94a3b8'),
      (1, 'avaliacao', 'Avaliação', '#f59e0b'),
      (2, 'plano', 'Plano', '#8b5cf6'),
      (3, 'desenvolvimento', 'Desenvolvimento', '#3b82f6'),
      (4, 'validacao', 'Validação', '#06b6d4'),
      (5, 'waiting', 'Aguardando você', '#ef4444'),
      (6, 'done', 'Concluído', '#22c55e')) as s(ord, kind, name, color)
    order by ord
  loop
    v_col := private.cq_status_column(p_board, v_stage.kind);
    if v_col is null then
      insert into public.project_columns (board_id, name, color, sort_order)
      values (p_board, v_stage.name, v_stage.color, v_stage.ord)
      returning id into v_col;
      v_created := v_created || v_stage.name::text;
    else
      update public.project_columns set sort_order = v_stage.ord where id = v_col;
    end if;
  end loop;

  -- 2. Cards das colunas fora do fluxo vão para o estágio da fila.
  for v_card in
    select c.id, c.completed, c.labels, col.name as col_name
      from public.project_cards c
      join public.project_columns col on col.id = c.column_id
     where c.board_id = p_board and private.cq_stage_kind(col.name) is null
     order by col.sort_order, c.sort_order
  loop
    v_status := null;
    v_phase := null;
    select q.status, q.phase into v_status, v_phase
      from public.project_card_queue q
     where q.card_id = v_card.id
     order by q.created_at desc
     limit 1;

    v_target := case
      when v_card.completed then private.cq_status_column(p_board, 'done')
      when v_status = 'in_progress' then private.cq_phase_column(p_board, v_phase)
      when v_status = 'review' then private.cq_status_column(p_board, 'validacao')
      when v_status = 'blocked' then private.cq_status_column(p_board, 'waiting')
      else private.cq_status_column(p_board, 'todo')
    end;

    -- Tema: a coluna antiga vira label (as de status, como "Fazendo", não).
    v_label := lower(trim(v_card.col_name));
    if not (private.cq_norm(v_card.col_name) = any (private.cq_stage_names('doing')))
       and not (coalesce(v_card.labels, '[]'::jsonb) ? v_label) then
      update public.project_cards set labels = coalesce(labels, '[]'::jsonb) || to_jsonb(v_label) where id = v_card.id;
      v_labels := v_labels + 1;
    end if;

    perform private.cq_move_card(v_card.id, v_target);
    v_moved := v_moved || jsonb_build_object(v_card.col_name, coalesce((v_moved ->> v_card.col_name)::integer, 0) + 1);
  end loop;

  -- 3. Colunas antigas, agora vazias.
  for v_old in
    select col.id, col.name from public.project_columns col
     where col.board_id = p_board and private.cq_stage_kind(col.name) is null
     order by col.sort_order
  loop
    if exists (select 1 from public.project_cards c where c.column_id = v_old.id) then
      raise exception 'A coluna "%" ainda tem cards; nada foi apagado', v_old.name using errcode = 'P0001';
    end if;
    delete from public.project_columns where id = v_old.id;
    v_deleted := v_deleted || v_old.name;
  end loop;

  perform private.cq_sync_todo_order(p_board);

  return jsonb_build_object(
    'created', to_jsonb(v_created),
    'moved', v_moved,
    'labels_added', v_labels,
    'deleted', to_jsonb(v_deleted),
    'columns', (select jsonb_agg(jsonb_build_object(
                         'name', col.name,
                         'open', (select count(*) from public.project_cards c where c.column_id = col.id and not c.completed),
                         'done', (select count(*) from public.project_cards c where c.column_id = col.id and c.completed))
                       order by col.sort_order)
                  from public.project_columns col where col.board_id = p_board));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Gatilho: o quadro também move a fila
-- ---------------------------------------------------------------------------

-- (a) Card aguardando o usuário com todos os itens dele marcados → volta para
--     a fila, na posição da prioridade.
-- (b) Quadro com o fluxo, card arrastado para Concluído: em validação → aprovado;
--     na fila ou em andamento → sai da fila.
-- Mudanças feitas pelo próprio gatilho (profundidade > 1) são ignoradas.
create or replace function private.cq_on_card_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last public.project_card_queue%rowtype;
  v_done uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  select * into v_last from public.project_card_queue q
   where q.card_id = new.id
   order by q.created_at desc
   limit 1;
  if not found then
    return null;
  end if;

  if new.column_id is distinct from old.column_id and private.cq_flow_enabled(new.board_id) then
    v_done := private.cq_status_column(new.board_id, 'done');
    if new.column_id = v_done then
      if v_last.status = 'review' then
        update public.project_card_queue set status = 'done', finished_at = now() where id = v_last.id;
        update public.project_cards c
           set completed = true,
               description = c.description || private.cq_stamp('Validado', 'card movido para Concluído.'),
               updated_at = now()
         where c.id = new.id;
      elsif v_last.status in ('queued', 'in_progress') then
        update public.project_card_queue
           set status = 'cancelled', finished_at = now(),
               note = coalesce(note || E'\n\n', '') || 'Saiu da fila: card movido para Concluído em '
                      || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.'
         where id = v_last.id;
      end if;
    end if;
  end if;

  if new.checklist is distinct from old.checklist
     and v_last.status = 'blocked'
     and exists (select 1 from jsonb_array_elements(new.checklist) as t(item) where t.item ->> 'owner' = 'user')
     and not exists (select 1 from jsonb_array_elements(new.checklist) as t(item)
                      where t.item ->> 'owner' = 'user' and not coalesce((t.item ->> 'completed')::boolean, false)) then
    update public.project_cards c
       set description = c.description || private.cq_stamp('Pendências concluídas', 'os itens do usuário foram marcados e o card voltou para a fila.'),
           updated_at = now()
     where c.id = new.id;
    perform private.cq_insert_queued(new.board_id, array[new.id], auth.uid(), false);
  end if;

  return null;
end;
$$;

create trigger project_cards_queue_flow
  after update of checklist, column_id on public.project_cards
  for each row
  when (old.checklist is distinct from new.checklist or old.column_id is distinct from new.column_id)
  execute function private.cq_on_card_change();

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'private.cq_stage_names(text)',
    'private.cq_stage_kind(text)',
    'private.cq_flow_enabled(uuid)',
    'private.cq_phase_column(uuid, text)',
    'private.cq_sync_todo_order(uuid)',
    'private.cq_insert_queued(uuid, uuid[], uuid, boolean)',
    'private.cq_on_card_change()'
  ] loop
    execute format('revoke execute on function %s from public', fn);
  end loop;

  foreach fn in array array[
    'public.cq_start(uuid, integer, uuid)',
    'public.cq_validate(uuid, text, boolean, text, uuid)',
    'public.cq_block(uuid, text, text, text[], text[], uuid)',
    'public.cq_release(uuid, text, text, uuid)',
    'public.cq_setup_flow(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;
