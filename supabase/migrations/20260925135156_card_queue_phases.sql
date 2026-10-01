-- Fases da fila de desenvolvimento: Avaliação → Plano → Desenvolvimento.
--
-- Todo card trabalhado pela IA passa pelas três fases, nesta ordem, e o plano
-- precisa da aprovação do usuário antes do desenvolvimento. A fase fica no item
-- da fila (o app mostra "IA avaliando" / "Plano aguardando aprovação" /
-- "IA desenvolvendo") e o texto de cada fase é anexado à descrição do card.

alter table public.project_card_queue
  add column if not exists phase text
  check (phase in ('avaliacao', 'plano', 'desenvolvimento'));

-- Card completo, agora com a fase do item de fila mais recente.
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
    'queue', (select jsonb_build_object('id', q.id, 'status', q.status, 'phase', q.phase, 'position', q.position,
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

-- Próximo card: retoma o que está em andamento (na fase em que parou); senão
-- inicia o primeiro da fila na fase de Avaliação e move o card para "Fazendo".
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
    perform private.cq_move_card(v_q.card_id, private.cq_status_column(p_board, 'doing'));
  end if;

  return private.cq_card_json(v_q.card_id);
end;
$$;

-- Registra a fase do card em andamento e, se houver texto, anexa a seção
-- ("## Avaliação (IA) — dd/mm/aaaa") à descrição do card.
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
  if p_phase is null or p_phase not in ('avaliacao', 'plano', 'desenvolvimento') then
    raise exception 'Fase inválida: % (use avaliacao, plano ou desenvolvimento)', coalesce(p_phase, 'null')
      using errcode = '22023';
  end if;
  v_card := private.cq_resolve_card(p_board, p_card);

  update public.project_card_queue
     set phase = p_phase
   where card_id = v_card and status = 'in_progress';
  if not found then
    raise exception 'O card não está em andamento na fila (rode next antes)' using errcode = 'P0002';
  end if;

  if v_text is not null then
    v_label := case p_phase when 'avaliacao' then 'Avaliação' when 'plano' then 'Plano' else 'Desenvolvimento' end
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

revoke execute on function public.cq_note(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.cq_note(uuid, text, text, text, uuid) to authenticated, service_role;
