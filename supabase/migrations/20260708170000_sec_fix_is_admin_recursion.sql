-- FIX urgente: a nova policy profiles_authenticated_select chama is_admin(),
-- que era SECURITY INVOKER e faz SELECT em profiles => a propria policy era
-- reavaliada => recursao infinita (stack depth exceeded) em qualquer SELECT
-- que tocasse linha de outro usuario.
-- SECURITY DEFINER faz is_admin ler profiles sem RLS, quebrando o ciclo.
-- STABLE permite ao planner cachear o resultado dentro da query.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from anon, public;
grant execute on function public.is_admin() to authenticated;
