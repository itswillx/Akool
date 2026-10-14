-- API-013: regras de cards no servidor. Antes de a API escrever cards, o banco
-- passa a garantir o que só o CardModal conferia (e nem tudo):
--   * coluna, pai e dependências do mesmo quadro; card não muda de quadro;
--   * pai e dependências sem ciclo (o app só barrava ciclo no pai, e o
--     auto-agendamento podia fechar ciclo de dependência);
--   * responsável com acesso ao quadro; página vinculada legível;
--   * forma do checklist, dos rótulos e dos anexos; anexo novo sob
--     <quem envia>/<quadro>/ no bucket;
--   * sort_order vazio vai para o fim da coluna; updated_at é do servidor e só
--     muda quando muda o conteúdo (mover não gera conflito de edição), sempre
--     para frente, mesmo duas vezes na mesma transação;
--   * só quem edita o quadro passa das primeiras linhas (as mensagens das regras
--     não contam a quem está de fora o que existe no quadro);
--   * cq_cards e cq_enqueue comparam rótulos sem diferença de caixa; cq_setup_flow
--     e cq_block, que gravam sem usuário, ficam dentro das mesmas formas.
--
-- Regra dos gatilhos (docs/api-arquitetura.md §1.5): sem usuário (restore,
-- cards-api como service_role, seed) só a posição e a versão são tratadas; as
-- validações pulam. Valida só o que mudou: dado antigo fora da regra não trava
-- quem edita outra coisa. Levantamento na produção (07/10/2026): 298 cards e
-- nenhuma violação.

-- ---------------------------------------------------------------------------
-- 1. Forma dos campos JSON (reaproveitadas pela API, API-043)
-- ---------------------------------------------------------------------------

-- Item de checklist: {id, text, completed, owner?: 'user'}, sem outras chaves.
create function private.card_checklist_ok(p_items jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    return false;
  end if;
  -- A ordem dentro de um OR não é garantida: o tipo é conferido antes, sozinho.
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string' or length(v_item ->> 'id') not between 1 and 100
       or jsonb_typeof(v_item -> 'text') is distinct from 'string' or length(v_item ->> 'text') > 2000
       or jsonb_typeof(v_item -> 'completed') is distinct from 'boolean'
       or (v_item ? 'owner' and v_item ->> 'owner' is distinct from 'user')
       or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'text', 'completed', 'owner')) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Rótulos: até 30 textos de 1 a 50 caracteres, sem espaço nas pontas e sem
-- repetir ignorando a caixa (o que a pessoa digitou fica como está).
create function private.card_labels_ok(p_labels jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_label jsonb;
begin
  if jsonb_typeof(p_labels) is distinct from 'array' or jsonb_array_length(p_labels) > 30 then
    return false;
  end if;
  for v_label in select e from jsonb_array_elements(p_labels) e loop
    if jsonb_typeof(v_label) <> 'string' then
      return false;
    end if;
    if length(v_label #>> '{}') not between 1 and 50
       or (v_label #>> '{}') <> btrim(v_label #>> '{}') then
      return false;
    end if;
  end loop;
  return (select count(distinct lower(e)) from jsonb_array_elements_text(p_labels) e) = jsonb_array_length(p_labels);
end;
$$;

-- Anexo: {id, url, name}, sem outras chaves. url é o caminho no bucket
-- project-card-images (ou a URL pública antiga, que continua valendo).
create function private.card_attachments_ok(p_items jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50 then
    return false;
  end if;
  for v_item in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string' or length(v_item ->> 'id') not between 1 and 100
       or jsonb_typeof(v_item -> 'url') is distinct from 'string' or length(v_item ->> 'url') not between 1 and 1000
       or jsonb_typeof(v_item -> 'name') is distinct from 'string' or length(v_item ->> 'name') > 255
       or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'url', 'name')) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke execute on function private.card_checklist_ok(jsonb) from public;
revoke execute on function private.card_labels_ok(jsonb) from public;
revoke execute on function private.card_attachments_ok(jsonb) from public;

-- ---------------------------------------------------------------------------
-- 2. Gatilho de integridade (BEFORE INSERT OR UPDATE)
-- ---------------------------------------------------------------------------

-- Sem DEFAULT: o card que chega sem posição vai para o fim da coluna (o app
-- contava os cards visíveis, e com filtro ativo repetia posições).
alter table public.project_cards alter column sort_order drop default;

create function private.project_card_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid             uuid := auth.uid();
  v_no_user         boolean := auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon');
  v_added           uuid[];
  v_old_attachments jsonb;
  v_item            jsonb;
begin
  -- Posição e versão valem também sem usuário.
  if new.sort_order is null then
    select coalesce(max(c.sort_order), -1) + 1 into new.sort_order
      from public.project_cards c
     where c.column_id = new.column_id;
  end if;
  if tg_op = 'UPDATE' then
    -- Versão do conteúdo: mover (coluna e ordem) mantém a versão, para arrastar
    -- não dar conflito com quem está editando o card. clock_timestamp(), não
    -- now(): o now() é o mesmo na transação inteira, e o gatilho da fila
    -- (cq_on_card_change) muda o card de novo depois do RETURNING do app; com a
    -- mesma versão, o app nunca saberia.
    if (to_jsonb(new) - array['sort_order', 'column_id', 'updated_at']) is distinct from
       (to_jsonb(old) - array['sort_order', 'column_id', 'updated_at']) then
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    else
      new.updated_at := old.updated_at;
    end if;
  elsif not v_no_user then
    new.updated_at := clock_timestamp();
  end if;

  -- Sem usuário (restore, cards-api por service_role, seed): não há de quem conferir.
  if v_no_user then
    return new;
  end if;

  -- O gatilho roda antes do WITH CHECK do RLS: sem isto, quem não edita o
  -- quadro descobriria pelas mensagens abaixo quem é membro e que cards e
  -- colunas existem. No UPDATE, o USING do RLS já esconde a linha.
  if tg_op = 'INSERT' and not public.user_can_access_board(new.board_id, 'editor') then
    raise exception 'Sem permissão para editar este quadro' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.board_id is distinct from old.board_id then
    raise exception 'Um card não muda de quadro' using errcode = '23514', hint = 'akool';
  end if;
  if tg_op = 'INSERT' or new.column_id is distinct from old.column_id then
    if not exists (select 1 from public.project_columns col where col.id = new.column_id and col.board_id = new.board_id) then
      raise exception 'A coluna é de outro quadro' using errcode = '23514', hint = 'akool';
    end if;
  end if;

  -- Pai: mesmo quadro e sem ciclo.
  if new.parent_card_id is not null and (tg_op = 'INSERT' or new.parent_card_id is distinct from old.parent_card_id) then
    if new.parent_card_id = new.id then
      raise exception 'Um card não pode ser pai de si mesmo' using errcode = '23514', hint = 'akool';
    end if;
    if not exists (select 1 from public.project_cards p where p.id = new.parent_card_id and p.board_id = new.board_id) then
      raise exception 'O card pai é de outro quadro ou não existe' using errcode = '23514', hint = 'akool';
    end if;
    if exists (
      with recursive up(id, depth) as (
        select p.parent_card_id, 1 from public.project_cards p where p.id = new.parent_card_id
        union all
        select p.parent_card_id, up.depth + 1 from up join public.project_cards p on p.id = up.id where up.depth < 200
      )
      select 1 from up where up.id = new.id
    ) then
      raise exception 'Esse pai criaria um ciclo' using errcode = '23514', hint = 'akool';
    end if;
  end if;

  -- Dependências: só as acrescentadas são conferidas (ids velhos e órfãos ficam).
  if tg_op = 'INSERT' or new.depends_on is distinct from old.depends_on then
    if cardinality(new.depends_on) > 100 then
      raise exception 'Um card tem no máximo 100 dependências' using errcode = '23514', hint = 'akool';
    end if;
    v_added := array(select unnest(new.depends_on)
                     except select unnest(case when tg_op = 'UPDATE' then old.depends_on else '{}'::uuid[] end));
    if new.id = any (v_added) then
      raise exception 'Um card não pode depender de si mesmo' using errcode = '23514', hint = 'akool';
    end if;
    if exists (select 1 from unnest(v_added) d
                where not exists (select 1 from public.project_cards x where x.id = d and x.board_id = new.board_id)) then
      raise exception 'A dependência é de outro quadro ou não existe' using errcode = '23514', hint = 'akool';
    end if;
    if exists (
      with recursive reach(id) as (
        select unnest(v_added)
        union
        select d from reach r join public.project_cards x on x.id = r.id cross join lateral unnest(x.depends_on) d
      )
      select 1 from reach where reach.id = new.id
    ) then
      raise exception 'Essa dependência criaria um ciclo' using errcode = '23514', hint = 'akool';
    end if;
  end if;

  -- Responsável: dono do quadro ou com share válido (emitido pelo dono, SEC-002).
  if new.assignee_user_id is not null and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id) then
    if private.cq_board_role(new.assignee_user_id, new.board_id) is null then
      raise exception 'O responsável não tem acesso ao quadro' using errcode = '23514', hint = 'akool';
    end if;
  end if;

  -- Página vinculada: quem vincula precisa conseguir ler.
  if new.linked_page_id is not null and (tg_op = 'INSERT' or new.linked_page_id is distinct from old.linked_page_id) then
    if not public.page_is_readable(new.linked_page_id) then
      raise exception 'A página vinculada não está acessível' using errcode = '42501', hint = 'akool';
    end if;
  end if;

  -- Forma dos campos JSON.
  if (tg_op = 'INSERT' or new.checklist is distinct from old.checklist) and not private.card_checklist_ok(new.checklist) then
    raise exception 'Checklist fora do formato: até 500 itens {id, text, completed}' using errcode = '23514', hint = 'akool';
  end if;
  if (tg_op = 'INSERT' or new.labels is distinct from old.labels) and not private.card_labels_ok(new.labels) then
    raise exception 'Rótulos fora do formato: até 30, de 1 a 50 caracteres, sem repetir' using errcode = '23514', hint = 'akool';
  end if;
  if tg_op = 'INSERT' or new.attachments is distinct from old.attachments then
    if not private.card_attachments_ok(new.attachments) then
      raise exception 'Anexos fora do formato: até 50 {id, url, name}' using errcode = '23514', hint = 'akool';
    end if;
    -- Anexo novo só sob <quem envia>/<quadro>/ (a policy do bucket exige o
    -- primeiro nível = quem envia). URL antiga e anexo de outra pessoa ficam.
    -- "Antigo" é o par (id, url) que já estava no card: manter o id e trocar a
    -- url não escapa da regra, nem um item antigo sem id.
    v_old_attachments := case when tg_op = 'UPDATE' and jsonb_typeof(old.attachments) = 'array'
                              then old.attachments else '[]'::jsonb end;
    for v_item in select e from jsonb_array_elements(new.attachments) e loop
      if not coalesce(v_old_attachments @> jsonb_build_array(jsonb_build_object('id', v_item -> 'id', 'url', v_item -> 'url')), false)
         and (left(v_item ->> 'url', length(v_uid::text) + length(new.board_id::text) + 2) <> v_uid::text || '/' || new.board_id::text || '/'
              or (v_item ->> 'url') like '%..%') then
        raise exception 'Anexo novo fora da pasta do quadro' using errcode = '42501', hint = 'akool';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke execute on function private.project_card_integrity() from public;

create trigger project_cards_integrity
  before insert or update on public.project_cards
  for each row execute function private.project_card_integrity();

-- Duas gravações ao mesmo tempo poderiam fechar um ciclo que nenhuma das duas
-- vê (A depende de B numa, B de A na outra). Quem muda pai ou dependência
-- espera a vez; as consultas de ciclo do gatilho de linha já veem o que a
-- outra gravou. A trava é pega por instrução, antes de qualquer linha ser
-- travada: pega por linha, uma instrução de várias linhas (o cronograma)
-- e outra de uma linha podiam esperar uma pela outra (deadlock). Ela é do
-- site, não do quadro (o gatilho de instrução não sabe o quadro), e só vale
-- até o fim da transação.
create function private.project_cards_graph_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('cards-graph'));
  return null;
end;
$$;

revoke execute on function private.project_cards_graph_lock() from public;

create trigger project_cards_graph_lock
  before insert or update of parent_card_id, depends_on on public.project_cards
  for each statement execute function private.project_cards_graph_lock();

-- ---------------------------------------------------------------------------
-- 3. Rótulos sem diferença de caixa na fila
-- ---------------------------------------------------------------------------

-- A CLI manda o rótulo em minúsculas ("segurança") e o card pode ter
-- "Segurança": antes não achava. Rótulos que não são lista (linha antiga vinda
-- de um caminho sem validação) não casam, em vez de derrubar o filtro do
-- quadro inteiro; o CASE garante que o tipo é olhado antes.
create function private.cq_labels_match(p_card_labels jsonb, p_labels text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_card_labels) = 'array'
              then exists (select 1 from jsonb_array_elements_text(p_card_labels) l
                            join unnest(p_labels) x on lower(l) = lower(x))
              else false end
$$;

revoke execute on function private.cq_labels_match(jsonb, text[]) from public;

-- Iguais às de 20260925123814 (cq_cards) e 20260926114819 (cq_enqueue), com
-- `c.labels ?| p_labels` trocado por private.cq_labels_match.
create or replace function public.cq_cards(p_board uuid, p_columns text[] default null::text[], p_priorities text[] default null::text[], p_labels text[] default null::text[], p_completed boolean default false, p_actor uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
      and (coalesce(cardinality(p_labels), 0) = 0 or private.cq_labels_match(c.labels, p_labels))
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.cq_enqueue(p_board uuid, p_cards text[] default null::text[], p_columns text[] default null::text[], p_priorities text[] default null::text[], p_labels text[] default null::text[], p_actor uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
           and (coalesce(cardinality(p_labels), 0) = 0 or private.cq_labels_match(c.labels, p_labels))
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
$function$;

-- ---------------------------------------------------------------------------
-- 4. Quem grava sem usuário fica dentro das mesmas formas
-- ---------------------------------------------------------------------------

-- Iguais às de 20260926114819_card_queue_flow.sql, com os limites do API-013:
-- cq_block recusa item "Você" acima de 2000 caracteres ou checklist acima de
-- 500 itens; cq_setup_flow não repete rótulo ignorando a caixa e respeita 50
-- caracteres e 30 rótulos. `create or replace` mantém os grants do SEC-012.
create or replace function public.cq_block(
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

  -- API-013: os itens novos seguem a forma do checklist (sem usuário, o
  -- gatilho não confere, e o app depois não conseguiria marcar o item).
  if exists (select 1 from unnest(coalesce(p_user_items, '{}')) x where length(trim(x)) > 2000) then
    raise exception 'Item do usuário com mais de 2000 caracteres' using errcode = '22023', hint = 'akool';
  end if;
  if (select case when jsonb_typeof(c.checklist) = 'array' then jsonb_array_length(c.checklist) else 0 end
        from public.project_cards c where c.id = v_card)
     + (select count(*) from unnest(coalesce(p_user_items, '{}')) x where nullif(trim(x), '') is not null) > 500 then
    raise exception 'O checklist passaria de 500 itens' using errcode = '22023', hint = 'akool';
  end if;

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
    -- API-013: sem repetir ignorando a caixa ("Backend" já cobre "backend") e
    -- dentro dos limites do gatilho, que sem usuário não confere.
    if not (private.cq_norm(v_card.col_name) = any (private.cq_stage_names('doing')))
       and not private.cq_labels_match(coalesce(v_card.labels, '[]'::jsonb), array[v_label])
       and length(v_label) between 1 and 50
       and (case when jsonb_typeof(v_card.labels) = 'array' then jsonb_array_length(v_card.labels) else 0 end) < 30 then
      update public.project_cards
         set labels = (case when jsonb_typeof(labels) = 'array' then labels else '[]'::jsonb end) || to_jsonb(v_label)
       where id = v_card.id;
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
