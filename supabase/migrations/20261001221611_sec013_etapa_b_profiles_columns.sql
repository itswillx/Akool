-- SEC-013 etapa B: as colunas de privilégio e de atividade de public.profiles
-- deixam de ser legíveis por authenticated e anon. O próprio perfil vem por
-- get_my_profile() e a lista de admin por admin_list_profiles() (security
-- definer, etapa A, 20261001192049). Aplicada depois do deploy do frontend
-- que já lê por essas RPCs; antes, o login do site antigo quebraria.
-- ai_has_key é sobra do SEC-015 (IA removida) e sai junto.
revoke select (role, is_active, last_login_date, invite_slots_remaining, ai_has_key)
  on public.profiles from authenticated, anon;
