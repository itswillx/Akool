-- Fila priorizada: a fila de desenvolvimento passa a respeitar a prioridade
-- também entre lotes.
--
-- Antes: cq_enqueue ordenava por prioridade só dentro do lote e punha o lote
-- no fim da fila; um card urgente enfileirado depois ficava atrás de todos os
-- médios. E o enqueue por filtro reenfileirava cards bloqueados (duplicados).
--
-- Depois:
--   * Lote ordenado por prioridade → esforço (label esforço:s/m/l, S primeiro)
--     → coluna → ordem do card.
--   * Cada card novo entra logo depois do último item da fila com prioridade
--     igual ou maior. A ordem relativa do que já está na fila não muda, então
--     um ajuste manual (cq_move) continua valendo.
--   * Enqueue por filtro pula cards cuja última passagem pela fila terminou
--     bloqueada; por id (recolocar na fila) continua permitido, e a linha
--     bloqueada antiga vira "cancelled" com a nota "Retomado".
--   * cq_reprioritize reordena todos os "queued" por prioridade e esforço
--     (desfaz ajustes manuais) — botão "Reordenar por prioridade".

create or replace function private.cq_priority_rank(p text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end
$$;

create or replace function private.cq_effort_rank(p_labels jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_labels, '[]'::jsonb) ? 'esforço:s' then 0
    when coalesce(p_labels, '[]'::jsonb) ? 'esforço:l' then 2
    else 1
  end
$$;

-- Renumera os "queued" de um quadro 1..n na ordem atual de position.
create or replace function private.cq_renumber(p_board uuid, p_step integer)
returns void
language sql
set search_path = ''
as $$
  with o as (
    select q.id, row_number() over (order by q.position, q.created_at) as rn
      from public.project_card_queue q
     where q.board_id = p_board and q.status = 'queued'
  )
  update public.project_card_queue q
     set position = o.rn * p_step
    from o
   where q.id = o.id
$$;

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
  -- Espaço entre itens existentes durante a inserção: cabem até 99.999 cards
  -- novos entre dois vizinhos antes da renumeração final.
  c_step     constant integer := 100000;
  v_actor    uuid := private.cq_actor(p_actor);
  v_card_ids uuid[] := '{}';
  v_cols     uuid[];
  v_prios    text[];
  v_filtered boolean;
  v_ref      text;
  v_new_ids  uuid[];
  v_new_card uuid[];
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
     where c.board_id = p_board
       and not c.completed
       and not exists (select 1 from public.project_card_queue q
                        where q.card_id = c.id and q.status in ('queued', 'in_progress'))
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
       )
  ), ins as (
    -- Âncora = posição do último item da fila com prioridade igual ou maior
    -- (o SELECT vê a fila de antes deste INSERT).
    insert into public.project_card_queue (board_id, card_id, position, source, requested_by)
    select p_board, p.id,
           coalesce((select max(q.position)
                       from public.project_card_queue q
                       join public.project_cards qc on qc.id = q.card_id
                      where q.board_id = p_board and q.status = 'queued'
                        and private.cq_priority_rank(qc.priority) <= p.rk), 0) + p.rn,
           private.cq_source(), v_actor
      from picked p
    returning id, card_id
  )
  select coalesce(array_agg(ins.id), '{}'), coalesce(array_agg(ins.card_id), '{}')
    into v_new_ids, v_new_card
    from ins;

  perform private.cq_renumber(p_board, 1);

  -- Card recolocado na fila: a passagem bloqueada anterior sai da lista.
  update public.project_card_queue q
     set status = 'cancelled',
         note = coalesce(q.note || E'\n\n', '') || 'Retomado: card recolocado na fila em '
                || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || '.'
   where q.status = 'blocked' and q.card_id = any (v_new_card);

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

  return public.cq_list(p_board, array['in_progress', 'queued'], p_actor);
end;
$$;

revoke execute on function private.cq_priority_rank(text) from public;
revoke execute on function private.cq_effort_rank(jsonb) from public;
revoke execute on function private.cq_renumber(uuid, integer) from public;

revoke execute on function public.cq_enqueue(uuid, text[], text[], text[], text[], uuid) from public, anon;
grant execute on function public.cq_enqueue(uuid, text[], text[], text[], text[], uuid) to authenticated, service_role;
revoke execute on function public.cq_reprioritize(uuid, uuid) from public, anon;
grant execute on function public.cq_reprioritize(uuid, uuid) to authenticated, service_role;
