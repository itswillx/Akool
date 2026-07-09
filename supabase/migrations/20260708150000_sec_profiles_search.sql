-- SEC (P2 / SEC-007): impedir enumeracao de todos os profiles.
-- Hoje profiles_authenticated_select = USING(true): qualquer autenticado lista
-- todos os usuarios e emails. Restringimos a: propria linha, admins e perfis
-- "relacionados" (compartilhamento ou co-membership). Busca por nome/email passa
-- a ser feita por RPC dedicada com limite.

-- Perfis relacionados ao usuario atual (para lookups por id em telas de share).
create or replace function public.profile_is_related(p_other uuid)
returns boolean
language sql
security definer
set search_path to 'public'
stable
as $$
  select
    p_other = auth.uid()
    or exists (select 1 from page_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from project_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from finance_goal_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from finance_workspace_members m1
        join finance_workspace_members m2 on m1.workspace_id = m2.workspace_id
        where m1.user_id = auth.uid() and m2.user_id = p_other);
$$;

grant execute on function public.profile_is_related(uuid) to authenticated;

drop policy if exists profiles_authenticated_select on public.profiles;
create policy profiles_authenticated_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or is_admin()
    or profile_is_related(id)
  );

-- Busca por nome/email para telas de compartilhamento: RPC com minimo de 3 chars
-- e limite fixo, evitando dump completo via .ilike direto.
create or replace function public.search_users_for_share(p_term text)
returns table (id uuid, display_name text, email text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_term is null or length(trim(p_term)) < 3 then
    return;
  end if;
  return query
    select p.id, p.display_name, p.email
    from profiles p
    where p.id <> auth.uid()
      and (p.email ilike '%' || trim(p_term) || '%'
           or p.display_name ilike '%' || trim(p_term) || '%')
    order by p.display_name nulls last
    limit 6;
end;
$$;

grant execute on function public.search_users_for_share(text) to authenticated;
