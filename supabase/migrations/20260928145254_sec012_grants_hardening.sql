-- SEC-012: privilégios de tabela e EXECUTE de funções no mínimo que o app usa.
--
-- Hoje quem segura é o RLS; isto é defesa em profundidade. `anon` e
-- `authenticated` tinham TRUNCATE (que ignora o RLS), TRIGGER, REFERENCES e
-- MAINTAIN em quase todas as tabelas, `anon` podia escrever em tudo e
-- `authenticated` no audit_log. E 22 funções SECURITY DEFINER que o frontend
-- nunca chama estavam expostas em /rest/v1/rpc.
--
-- Fica como está, de propósito:
--   - SELECT de `anon` e a escrita de `authenticated`: o RLS decide por linha;
--   - EXECUTE das 10 funções usadas nas políticas de RLS (page_is_*,
--     loan_is_*, loan_file_is_readable, is_admin, is_workspace_member,
--     profile_is_related, user_can_access_board, current_user_can_share_page):
--     a política roda como quem consulta, e sem o EXECUTE o RLS quebra. Tirar da
--     API exige movê-las para `private` e refazer as políticas (card à parte);
--   - as 22 RPCs que o frontend chama, e a validate_invite_code para `anon`
--     (cadastro, antes do login);
--   - `service_role` e `postgres`, que não mudam.
-- Funções novas de `postgres` já nascem sem EXECUTE para anon/authenticated
-- (privilégio padrão). O de `supabase_admin` continua aberto e só ele muda.

-- 1. Tabelas: nada de TRUNCATE/TRIGGER/REFERENCES/MAINTAIN pela API.
revoke truncate, trigger, references, maintain on all tables in schema public from anon, authenticated;

-- `anon` não escreve em nada: o cadastro cria o perfil pelo gatilho
-- handle_new_user (SECURITY DEFINER) e o convite é validado por RPC. Nenhuma
-- política de escrita passa sem auth.uid().
revoke insert, update, delete on all tables in schema public from anon;

-- audit_log só recebe linha das edge functions (admin-ops, site-backup), com
-- service_role. O app só lê (admins).
revoke insert, update, delete on public.audit_log from authenticated;

-- Tabelas novas de `postgres` nascem com as mesmas regras.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke insert, update, delete on tables from anon;

-- 2. Funções que o app não chama com o JWT do usuário: só service_role.
--    - cq_*: a cards-api (service_role, com p_actor conferido por
--      private.cq_actor). As que o QueueModal chama (cq_list, cq_enqueue,
--      cq_move, cq_remove, cq_reprioritize, cq_validate) ficam;
--    - admin_revoke_user_sessions: a admin-ops, com service_role (SEC-006);
--    - loan_*: não há tela de empréstimos. Os helpers de RLS loan_is_* e
--      loan_file_is_readable ficam;
--    - set_ai_credentials: não há tela;
--    - check_auto_site_backup_due: feita para o pg_cron (roda como postgres).
--    As assinaturas vêm do pg_proc; nome que não existir aborta a migration.
do $$
declare
  names text[] := array[
    'cq_block', 'cq_boards', 'cq_card', 'cq_cards', 'cq_check', 'cq_complete',
    'cq_next', 'cq_note', 'cq_release', 'cq_setup_flow', 'cq_start',
    'admin_revoke_user_sessions',
    'loan_approve', 'loan_cancel_request', 'loan_confirm_payment', 'loan_link_borrower',
    'loan_reject', 'loan_reject_payment', 'loan_report_payment', 'loan_request',
    'set_ai_credentials',
    'check_auto_site_backup_due'
  ];
  missing text[];
  fn regprocedure;
begin
  select array_agg(n) into missing
  from unnest(names) as n
  where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n);
  if missing is not null then
    raise exception 'SEC-012: funções não encontradas: %', missing;
  end if;

  for fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname = any (names)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

-- Função de gatilho: o gatilho dispara sem conferir EXECUTE, e chamada direta
-- não serve para nada.
revoke execute on function public.update_updated_at() from public, anon, authenticated;

-- 3. generate_invite_code: sem linha em profiles, `v_role != 'admin'` dava
--    NULL e pulava a checagem de cotas (código ilimitado). Agora quem não é
--    comprovadamente admin precisa de cota. Resto do corpo igual.
--    (admin_revoke_invite_code não muda: a checagem de admin é um EXISTS, e o
--    `role != 'admin'` da devolução da cota nunca vê NULL, porque
--    profiles.role é NOT NULL.)
create or replace function public.generate_invite_code()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_role    TEXT;
  v_slots   INT;
  v_code    TEXT;
  v_attempt INT := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT role, invite_slots_remaining
    INTO v_role, v_slots
    FROM public.profiles
    WHERE id = v_user_id;

  -- Non-admins must have remaining slots (no profile row = no slots)
  IF NOT coalesce(v_role = 'admin', false) THEN
    IF coalesce(v_slots, 0) <= 0 THEN
      RAISE EXCEPTION 'no_slots_remaining';
    END IF;
    -- Decrement slot
    UPDATE public.profiles
      SET invite_slots_remaining = invite_slots_remaining - 1
      WHERE id = v_user_id;
  END IF;

  -- Generate unique 8-char alphanumeric code
  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.invite_codes WHERE code = v_code);
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN RAISE EXCEPTION 'code_generation_failed'; END IF;
  END LOOP;

  INSERT INTO public.invite_codes (code, created_by, expires_at)
    VALUES (v_code, v_user_id, now() + INTERVAL '7 days');

  RETURN jsonb_build_object('code', v_code);
END;
$function$;
