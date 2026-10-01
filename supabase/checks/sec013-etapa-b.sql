-- SEC-013 etapa B: conferência atômica (desfeita pelo RAISE no fim).
-- Depois da migration, role/is_active/last_login_date/invite_slots_remaining/
-- ai_has_key de public.profiles não são legíveis por authenticated nem anon;
-- o próprio perfil vem por get_my_profile() e a lista de admin por
-- admin_list_profiles() (security definer). Rodar no SQL Editor ou via MCP.
do $$
declare
  out text := '';
  n int;
begin
  select count(*) into n from information_schema.column_privileges
   where table_schema='public' and table_name='profiles' and grantee in ('authenticated','anon') and privilege_type='SELECT'
     and column_name in ('role','is_active','last_login_date','invite_slots_remaining','ai_has_key');
  out := out || format('1 colunas sensíveis legíveis por authenticated/anon: %s (esperado 0); ', n);

  set local role authenticated;
  perform id, email, display_name, avatar_emoji, avatar_color, avatar_url from public.profiles limit 0;
  out := out || '2 colunas públicas legíveis como authenticated: ok; ';
  begin
    perform role from public.profiles limit 0;
    out := out || '3 select role como authenticated: PASSOU (ERRADO); ';
  exception when insufficient_privilege then
    out := out || '3 select role como authenticated: recusado 42501 (ok); ';
  end;
  reset role;

  out := out || format('4 RPCs executáveis por authenticated: %s; ',
    has_function_privilege('authenticated', 'public.get_my_profile()', 'execute')
    and has_function_privilege('authenticated', 'public.admin_list_profiles()', 'execute'));

  raise exception 'CHECK (desfeito): %', out;
end $$;
