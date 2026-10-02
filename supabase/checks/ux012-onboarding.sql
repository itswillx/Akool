-- UX-012: conferência atômica (desfeita pelo RAISE no fim). A coluna
-- profiles.onboarding existe, authenticated lê e grava só nela (RLS limita à
-- própria linha), anon não lê, e get_my_profile() a devolve.
do $$
declare
  out text := '';
begin
  out := out || format('1 coluna: %s; ', (select data_type || ' default ' || coalesce(column_default, '') from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='onboarding'));
  out := out || format('2 authenticated select/update: %s/%s (esperado t/t); ',
    has_column_privilege('authenticated', 'public.profiles', 'onboarding', 'SELECT'),
    has_column_privilege('authenticated', 'public.profiles', 'onboarding', 'UPDATE'));
  out := out || format('3 anon select: %s (esperado f); ', has_column_privilege('anon', 'public.profiles', 'onboarding', 'SELECT'));
  out := out || format('4 get_my_profile devolve setof profiles: %s; ', exists (select 1 from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = 'get_my_profile' and t.typname = 'profiles'));
  set local role authenticated;
  perform onboarding from public.profiles limit 0;
  update public.profiles set onboarding = '{}'::jsonb where false;
  reset role;
  out := out || '5 select/update como authenticated: ok; ';
  raise exception 'CHECK (desfeito): %', out;
end $$;
