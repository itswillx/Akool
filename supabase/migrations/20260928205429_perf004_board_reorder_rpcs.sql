-- PERF-004: reordenar o kanban e agendar cards numa requisição, atômica.
--
-- O ProjectsPanel mandava um UPDATE HTTP por card das colunas afetadas (mudado
-- ou não): dezenas de requisições por drag e, numa falha no meio, a ordem
-- ficava metade gravada. Agora o app manda só o que mudou, e cada função faz um
-- único UPDATE: tudo ou nada.
--
-- SECURITY INVOKER: o RLS de UPDATE de project_cards/project_columns
-- (user_can_access_board editor) vale linha a linha, como no update direto.
-- Linha que o RLS recusar não conta, e a função erra (desfazendo o resto)
-- quando o número de linhas atualizadas não bate com o pedido.

-- Cards: [{ "id", "column_id", "sort_order" }]. A coluna de destino precisa ser
-- do mesmo quadro (o update direto não conferia isso).
create or replace function public.reorder_project_cards(p_board uuid, p_moves jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected integer := jsonb_array_length(coalesce(p_moves, '[]'::jsonb));
  v_updated integer;
begin
  if v_expected = 0 then
    return 0;
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_moves) as m(id uuid, column_id uuid, sort_order bigint)
    where not exists (
      select 1 from public.project_columns c where c.id = m.column_id and c.board_id = p_board
    )
  ) then
    raise exception 'reorder_project_cards: coluna fora do quadro' using errcode = '22023';
  end if;

  update public.project_cards pc
  set column_id = m.column_id, sort_order = m.sort_order
  from jsonb_to_recordset(p_moves) as m(id uuid, column_id uuid, sort_order bigint)
  where pc.id = m.id and pc.board_id = p_board;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'reorder_project_cards: % de % cards atualizados', v_updated, v_expected using errcode = '42501';
  end if;
  return v_updated;
end;
$$;

-- Colunas: [{ "id", "sort_order" }].
create or replace function public.reorder_project_columns(p_board uuid, p_columns jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected integer := jsonb_array_length(coalesce(p_columns, '[]'::jsonb));
  v_updated integer;
begin
  if v_expected = 0 then
    return 0;
  end if;

  update public.project_columns pc
  set sort_order = m.sort_order
  from jsonb_to_recordset(p_columns) as m(id uuid, sort_order bigint)
  where pc.id = m.id and pc.board_id = p_board;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'reorder_project_columns: % de % colunas atualizadas', v_updated, v_expected using errcode = '42501';
  end if;
  return v_updated;
end;
$$;

-- Auto-agendamento: [{ "id", "start_date", "due_date", "depends_on" }].
create or replace function public.schedule_project_cards(p_board uuid, p_patches jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected integer := jsonb_array_length(coalesce(p_patches, '[]'::jsonb));
  v_updated integer;
begin
  if v_expected = 0 then
    return 0;
  end if;

  update public.project_cards pc
  set start_date = m.start_date,
      due_date = m.due_date,
      depends_on = coalesce(m.depends_on, '{}'::uuid[]),
      updated_at = now()
  from jsonb_to_recordset(p_patches) as m(id uuid, start_date date, due_date date, depends_on uuid[])
  where pc.id = m.id and pc.board_id = p_board;
  get diagnostics v_updated = row_count;

  if v_updated <> v_expected then
    raise exception 'schedule_project_cards: % de % cards atualizados', v_updated, v_expected using errcode = '42501';
  end if;
  return v_updated;
end;
$$;

-- Só quem está logado; o RLS decide o resto.
revoke execute on function public.reorder_project_cards(uuid, jsonb) from public, anon;
revoke execute on function public.reorder_project_columns(uuid, jsonb) from public, anon;
revoke execute on function public.schedule_project_cards(uuid, jsonb) from public, anon;
grant execute on function public.reorder_project_cards(uuid, jsonb) to authenticated;
grant execute on function public.reorder_project_columns(uuid, jsonb) to authenticated;
grant execute on function public.schedule_project_cards(uuid, jsonb) to authenticated;
