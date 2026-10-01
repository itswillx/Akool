-- SEC-002: compartilhamentos não podem ser re-apontados.
--
-- Antes: authenticated (e anon) tinham UPDATE em todas as colunas de
-- page_shares/project_shares e as policies de UPDATE só checavam owner_id.
-- Quem compartilhava a própria página/quadro podia trocar page_id/board_id para
-- o recurso de outra pessoa e escolher o role, ganhando leitura e escrita.
-- Reproduzido no remoto em 25/09/2026 (transação desfeita).
--
-- Depois:
--   1. Só a coluna role aceita UPDATE (grant por coluna) e anon perde tudo.
--   2. Trigger congela o alvo mesmo para quem tiver grant amplo.
--   3. WITH CHECK do UPDATE exige que o emissor ainda possa compartilhar.
--   4. As funções de acesso só honram shares emitidos pelo dono do recurso
--      (ou, em páginas, por um co_owner nomeado pelo dono). Isso também anula
--      shares órfãos de quem perdeu o direito de compartilhar.

-- ---------------------------------------------------------------------------
-- 1. Grants
-- ---------------------------------------------------------------------------

revoke all on public.page_shares, public.project_shares from anon;

revoke update on public.page_shares, public.project_shares from authenticated;
revoke update (id, page_id, owner_id, shared_with_user_id, role, created_at) on public.page_shares from authenticated;
revoke update (id, board_id, owner_id, shared_with_user_id, role, created_at) on public.project_shares from authenticated;
grant update (role) on public.page_shares, public.project_shares to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Alvo congelado
-- ---------------------------------------------------------------------------

create or replace function private.shares_freeze_target()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'role') is distinct from (to_jsonb(old) - 'role') then
    raise exception 'Só o papel (role) de um compartilhamento pode ser alterado. Para outro recurso ou pessoa, crie um novo compartilhamento.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists page_shares_freeze_target on public.page_shares;
create trigger page_shares_freeze_target
  before update on public.page_shares
  for each row execute function private.shares_freeze_target();

drop trigger if exists project_shares_freeze_target on public.project_shares;
create trigger project_shares_freeze_target
  before update on public.project_shares
  for each row execute function private.shares_freeze_target();

-- ---------------------------------------------------------------------------
-- 3. UPDATE só por quem ainda pode compartilhar
-- ---------------------------------------------------------------------------

drop policy if exists page_shares_update on public.page_shares;
create policy page_shares_update on public.page_shares
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.current_user_can_share_page(page_id));

drop policy if exists project_shares_update on public.project_shares;
create policy project_shares_update on public.project_shares
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.project_boards b where b.id = board_id and b.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 4. Funções de acesso: só vale share de emissor válido
-- ---------------------------------------------------------------------------

create or replace function public.current_user_can_share_page(p_page_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  -- Dono da página (lê pages SEM RLS)
  select exists (
    select 1 from pages p
    where p.id = p_page_id
      and p.user_id = (select auth.uid())
  )
  or
  -- Co-owner nomeado pelo próprio dono da página (lê page_shares SEM RLS)
  exists (
    select 1 from page_shares ps
    join pages p on p.id = ps.page_id
    where ps.page_id = p_page_id
      and ps.shared_with_user_id = (select auth.uid())
      and ps.role = 'co_owner'
      and ps.owner_id = p.user_id
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
                -- SEC-002: emitido pelo dono da página ou por co_owner nomeado por ele
                and (ps.owner_id = a.user_id
                     or exists (select 1 from page_shares co
                                 where co.page_id = a.id
                                   and co.shared_with_user_id = ps.owner_id
                                   and co.role = 'co_owner'
                                   and co.owner_id = a.user_id))
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
                -- SEC-002: emitido pelo dono da página ou por co_owner nomeado por ele
                and (ps.owner_id = a.user_id
                     or exists (select 1 from page_shares co
                                 where co.page_id = a.id
                                   and co.shared_with_user_id = ps.owner_id
                                   and co.role = 'co_owner'
                                   and co.owner_id = a.user_id))
           )
  );
end;
$function$;

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
    -- SEC-002: só share emitido pelo dono do quadro
    join public.project_boards b on b.id = s.board_id and b.user_id = s.owner_id
    where s.board_id = p_board_id
      and s.shared_with_user_id = auth.uid()
      and (p_min_role = 'viewer' or s.role = 'editor')
  );
$function$;

-- Mesma regra na fila de desenvolvimento (cards-api / cq_*).
create or replace function private.cq_board_role(p_user uuid, p_board uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when exists (select 1 from public.project_boards b where b.id = p_board and b.user_id = p_user) then 'owner'
    else (select s.role
            from public.project_shares s
            join public.project_boards b on b.id = s.board_id and b.user_id = s.owner_id
           where s.board_id = p_board and s.shared_with_user_id = p_user
           limit 1)
  end
$$;

-- ---------------------------------------------------------------------------
-- Auditoria (rodar sob demanda): shares cujo emissor não tem direito sobre o
-- recurso. Em 25/09/2026 retornava 0 linhas.
--
-- select 'page' as tipo, s.id, s.page_id as recurso, s.owner_id
--   from public.page_shares s
--   join public.pages p on p.id = s.page_id
--  where s.owner_id <> p.user_id
--    and not exists (select 1 from public.page_shares co
--                     where co.page_id = s.page_id and co.shared_with_user_id = s.owner_id
--                       and co.role = 'co_owner' and co.owner_id = p.user_id)
-- union all
-- select 'board', s.id, s.board_id, s.owner_id
--   from public.project_shares s
--   join public.project_boards b on b.id = s.board_id
--  where s.owner_id <> b.user_id;
-- ---------------------------------------------------------------------------
