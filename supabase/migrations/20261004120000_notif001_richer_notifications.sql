-- NOTIF-001: notificações mais ricas (central de notificações do app).
--
-- 1. `notifications` entra de fato no supabase_realtime. Em produção ela já
--    estava (adicionada pelo painel, sem arquivo); num banco montado só pelo
--    repositório (staging) não. Idempotente.
-- 2. O dono só altera a coluna `read`. A política de UPDATE (dono) não tem
--    WITH CHECK de colunas, então hoje o dono podia reescrever título, corpo e
--    `data` das próprias notificações. A tabela não tem grants por coluna, então
--    o REVOKE de tabela aqui não apaga nada além do UPDATE geral (ver o aviso
--    sobre `profiles` no README das migrations).
-- 3. Enriquecimento: um gatilho BEFORE INSERT completa a `data` com o nome de
--    quem agiu (`actor_name`, a partir de `actor_id`) e o nome do workspace
--    (`workspace_name`, a partir de `workspace_id`). Assim as cinco RPCs do
--    workspace, o alerta de backup e os empréstimos ganham esses campos sem
--    serem reescritos, e o app mostra o texto no idioma de quem lê. O nome vai
--    na própria notificação porque o RLS de `profiles` nem sempre deixa o
--    destinatário ler o perfil de quem agiu (convite pendente).
-- 4. Três produtores novos: página compartilhada (`page_shared`), quadro
--    compartilhado (`board_shared`) e card atribuído (`card_assigned`). Só
--    avisam quando há um usuário autenticado agindo e ele não é o destinatário:
--    restauração de backup e a API de cards (service_role) não geram aviso, nem
--    quem atribui um card a si mesmo. Contra abuso: o card só avisa quem tem
--    acesso ao quadro (dono ou compartilhado); aviso não lido do mesmo item não
--    se repete; cada pessoa gera no máximo 60 avisos por hora em cada tipo
--    (private.rate_limit_touch); nomes e títulos vão cortados em 200 caracteres.
--    Um erro ao notificar nunca derruba o compartilhamento ou o card (bloco com
--    exception + raise warning). O título e o corpo em pt-BR continuam como
--    reserva; a `data` leva os valores crus (título vazio fica vazio, sem nome
--    de quem agiu fica sem `actor_name`) e o app põe o texto no idioma de quem
--    lê. Renomear o card atualiza o título nos avisos ainda não lidos.

-- ─── 1. Realtime ─────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ─── 2. O dono só marca como lida / não lida ────────────────────────────────
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- ─── 3. Enriquecimento ──────────────────────────────────────────────────────
-- Nome de quem agiu, cru (nome de exibição, senão o e-mail; null se o perfil
-- não existe mais). O "Alguém" da reserva em pt-BR fica com quem monta o título.
create or replace function private.notification_actor_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(nullif(p.display_name, ''), p.email), 200) from public.profiles p where p.id = p_user_id;
$$;

create or replace function private.notification_enrich()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_text text;
begin
  if new.data ? 'actor_id' and not (new.data ? 'actor_name') then
    begin
      v_id := (new.data ->> 'actor_id')::uuid;
    exception when others then
      v_id := null;
    end;
    v_text := case when v_id is null then null else private.notification_actor_name(v_id) end;
    if v_text is not null then
      new.data := new.data || jsonb_build_object('actor_name', v_text);
    end if;
  end if;
  if new.data ? 'workspace_id' and not (new.data ? 'workspace_name') then
    begin
      v_id := (new.data ->> 'workspace_id')::uuid;
    exception when others then
      v_id := null;
    end;
    v_text := case when v_id is null then null else (select left(w.name, 200) from public.finance_workspaces w where w.id = v_id) end;
    if v_text is not null then
      new.data := new.data || jsonb_build_object('workspace_name', v_text);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_enrich on public.notifications;
create trigger notifications_enrich
  before insert on public.notifications
  for each row execute function private.notification_enrich();

-- ─── 4. Produtores novos ────────────────────────────────────────────────────
-- Limite por pessoa e tipo (60 avisos por hora): passou, o aviso simplesmente
-- não sai (a ação principal segue).
create or replace function private.notification_allowed(p_kind text, p_actor uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select allowed from private.rate_limit_touch('notify:' || p_kind, p_actor::text, 60, 3600);
$$;

-- Página compartilhada com alguém (ou papel alterado).
create or replace function private.notify_page_shared()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_title text;
begin
  if v_actor is null or new.shared_with_user_id = v_actor then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;
  begin
    -- Já há um aviso não lido desta página: não repete (papel alterado várias vezes).
    if exists (
      select 1 from public.notifications n
      where n.user_id = new.shared_with_user_id and n.type = 'page_shared' and not n.read
        and n.data ->> 'page_id' = new.page_id::text
    ) or not private.notification_allowed('page_shared', v_actor) then
      return new;
    end if;
    v_name := private.notification_actor_name(v_actor);
    select left(coalesce(p.title, ''), 200) into v_title from public.pages p where p.id = new.page_id;
    v_title := coalesce(v_title, '');
    perform public._notify(
      new.shared_with_user_id,
      'page_shared',
      case when tg_op = 'UPDATE'
        then coalesce(v_name, 'Alguém') || ' mudou seu acesso a "' || coalesce(nullif(v_title, ''), 'Sem título') || '"'
        else coalesce(v_name, 'Alguém') || ' compartilhou "' || coalesce(nullif(v_title, ''), 'Sem título') || '" com você' end,
      '',
      jsonb_build_object(
        'page_id', new.page_id, 'page_title', v_title, 'role', new.role,
        'actor_id', v_actor, 'actor_name', v_name, 'changed', tg_op = 'UPDATE'
      )
    );
  exception when others then
    raise warning 'notify_page_shared: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists page_shares_notify on public.page_shares;
create trigger page_shares_notify
  after insert or update of role on public.page_shares
  for each row execute function private.notify_page_shared();

-- Quadro de projetos compartilhado com alguém (ou papel alterado).
create or replace function private.notify_board_shared()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_board text;
begin
  if v_actor is null or new.shared_with_user_id = v_actor then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.role is not distinct from old.role then
    return new;
  end if;
  begin
    if exists (
      select 1 from public.notifications n
      where n.user_id = new.shared_with_user_id and n.type = 'board_shared' and not n.read
        and n.data ->> 'board_id' = new.board_id::text
    ) or not private.notification_allowed('board_shared', v_actor) then
      return new;
    end if;
    v_name := private.notification_actor_name(v_actor);
    select left(coalesce(b.name, ''), 200) into v_board from public.project_boards b where b.id = new.board_id;
    v_board := coalesce(v_board, '');
    perform public._notify(
      new.shared_with_user_id,
      'board_shared',
      case when tg_op = 'UPDATE'
        then coalesce(v_name, 'Alguém') || ' mudou seu acesso ao quadro "' || coalesce(nullif(v_board, ''), 'Quadro') || '"'
        else coalesce(v_name, 'Alguém') || ' compartilhou o quadro "' || coalesce(nullif(v_board, ''), 'Quadro') || '" com você' end,
      '',
      jsonb_build_object(
        'board_id', new.board_id, 'board_name', v_board, 'role', new.role,
        'actor_id', v_actor, 'actor_name', v_name, 'changed', tg_op = 'UPDATE'
      )
    );
  exception when others then
    raise warning 'notify_board_shared: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists project_shares_notify on public.project_shares;
create trigger project_shares_notify
  after insert or update of role on public.project_shares
  for each row execute function private.notify_board_shared();

-- Card atribuído a alguém que acessa o quadro (dono ou compartilhado). Sem
-- repetir: se a pessoa já tem um aviso não lido deste card, não ganha outro.
create or replace function private.notify_card_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text;
  v_board text;
  v_card text;
begin
  if new.assignee_user_id is null or v_actor is null or new.assignee_user_id = v_actor then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_user_id is not distinct from old.assignee_user_id then
    return new;
  end if;
  begin
    if not exists (select 1 from public.project_boards b where b.id = new.board_id and b.user_id = new.assignee_user_id)
       and not exists (select 1 from public.project_shares s where s.board_id = new.board_id and s.shared_with_user_id = new.assignee_user_id) then
      return new;
    end if;
    if exists (
      select 1 from public.notifications n
      where n.user_id = new.assignee_user_id and n.type = 'card_assigned' and not n.read
        and n.data ->> 'card_id' = new.id::text
    ) or not private.notification_allowed('card_assigned', v_actor) then
      return new;
    end if;
    v_name := private.notification_actor_name(v_actor);
    select left(coalesce(b.name, ''), 200) into v_board from public.project_boards b where b.id = new.board_id;
    v_board := coalesce(v_board, '');
    v_card := left(coalesce(new.title, ''), 200);
    perform public._notify(
      new.assignee_user_id,
      'card_assigned',
      coalesce(v_name, 'Alguém') || ' atribuiu "' || coalesce(nullif(v_card, ''), 'Sem título') || '" a você',
      'Quadro: ' || coalesce(nullif(v_board, ''), 'Quadro'),
      jsonb_build_object(
        'card_id', new.id, 'card_title', v_card, 'board_id', new.board_id, 'board_name', v_board,
        'actor_id', v_actor, 'actor_name', v_name
      )
    );
  exception when others then
    raise warning 'notify_card_assigned: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists project_cards_notify_assignee on public.project_cards;
create trigger project_cards_notify_assignee
  after insert or update of assignee_user_id on public.project_cards
  for each row execute function private.notify_card_assigned();

-- Card renomeado: o aviso ainda não lido do responsável mostra o título novo
-- (o card nasce no autosave com o título pela metade). O realtime leva a
-- mudança para a tela aberta.
create or replace function private.refresh_card_assigned_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card text := left(coalesce(new.title, ''), 200);
begin
  if new.assignee_user_id is null or new.title is not distinct from old.title then
    return new;
  end if;
  begin
    update public.notifications n
       set data = jsonb_set(n.data, '{card_title}', to_jsonb(v_card)),
           title = coalesce(n.data ->> 'actor_name', 'Alguém') || ' atribuiu "' || coalesce(nullif(v_card, ''), 'Sem título') || '" a você'
     where n.user_id = new.assignee_user_id and n.type = 'card_assigned' and not n.read
       and n.data ->> 'card_id' = new.id::text;
  exception when others then
    raise warning 'refresh_card_assigned_title: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists project_cards_refresh_assigned_title on public.project_cards;
create trigger project_cards_refresh_assigned_title
  after update of title on public.project_cards
  for each row execute function private.refresh_card_assigned_title();

-- Funções de gatilho e os ajudantes: só os gatilhos chamam (DEV-002).
revoke execute on function private.notification_actor_name(uuid) from public, anon, authenticated;
revoke execute on function private.notification_allowed(text, uuid) from public, anon, authenticated;
revoke execute on function private.notification_enrich() from public, anon, authenticated;
revoke execute on function private.notify_page_shared() from public, anon, authenticated;
revoke execute on function private.notify_board_shared() from public, anon, authenticated;
revoke execute on function private.notify_card_assigned() from public, anon, authenticated;
revoke execute on function private.refresh_card_assigned_title() from public, anon, authenticated;
