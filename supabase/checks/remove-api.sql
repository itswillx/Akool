-- Remoção da API v1 e da fila de cards (migration
-- 20261015100000_remove_api_and_queue).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Rode cada bloco numa chamada própria.
--
-- Bloco 0 (produção ANTES do apply, e staging): o levantamento, só SELECT,
-- sem id, nome de pessoa ou valor: tokens (total, ativos, donos, dia do último
-- uso), a fila por status e origem, as linhas de auditoria de token, os papéis
-- akool_api*, assinaturas realtime na fila, as DEFINER para authenticated
-- (a mesma conta do sec012-grants.sql) e tudo o que abortaria o apply:
--   * 7, 10 e 11: uma das 54 assinaturas, o private.api_scope_catalog ou o
--     gatilho project_cards_queue_flow ausente (os drops não têm IF EXISTS);
--   * 12: o gatilho de integridade de cards ausente ou desligado (o DO de
--     conferência da migration exige);
--   * 8, 13 e 14: função, relação ou gatilho cq_*/api_*/queue fora da lista (o
--     DO de conferência recusaria; os gatilhos, em qualquer schema);
--   * 15: um dependente de fora das 3 tabelas e das 54 funções (view, FK,
--     default, policy ou gatilho em outra tabela): sem CASCADE, o DROP recusa.
-- Antes do apply, o esperado é 54/54, "presente" em 10 e 11, "presente" e
-- "ligado" em 12 e "nenhum(a)" em 8, 13, 14 e 15. Se o ensaio do bloco 1 na
-- produção for barrado, este bloco é a única conferência antes do apply. Roda
-- antes e depois do apply (o que já sumiu sai como "não existe"/"ausente").
--
-- Bloco 1 (staging e ensaio na produção, depois da migration): cada linha sai
-- "ok" ou "FALHA", e a última conta as "ok" (N/N ok). No ensaio, o corpo da
-- migration entra logo depois das contagens do começo (no marcador
-- "ensaio:"), e o RAISE do fim desfaz tudo. O ensaio segura os locks da
-- migration (AccessExclusive em auth.users, project_boards e project_cards)
-- pelo DO inteiro, alguns segundos: rodar com pouco tráfego e longe das 06:00
-- UTC (site-backup-auto). Cobre:
--   1. no ensaio, que o corpo pôs lock_timeout de 5 s (depois do apply, o caso
--      sai como n/a); a ausência de cada objeto (as 54 funções por grupo, as 3
--      tabelas, o gatilho, as 2 policies) e de qualquer cq_*/api_* fora do
--      cq_board_role; a publicação realtime com as 7 tabelas do app e nada da
--      fila;
--   2. só saiu o que estava na lista: as funções, tabelas, gatilhos e policies
--      de public e private caem exatamente o que a lista tinha antes; as linhas
--      de auditoria de token e os cards continuam;
--   3. o que fica: private.cq_board_role (chamada pelo gatilho de integridade),
--      os 4 gatilhos de project_cards, o rate limit (check_rate_limit só para
--      service_role), as tabelas de public iguais a BACKUP_TABLES +
--      EXCLUDED_TABLES do site-backup (o assertNoTableDrift da versão nova
--      passa) e as 29 DEFINER para authenticated (eram 40: saem 5 de token e
--      6 da fila);
--   4. o gatilho de integridade de cards continua valendo, com pessoas
--      descartáveis O (dona do quadro), E (editora por share) e X (de fora):
--      responsável sem acesso ao quadro é recusado (no UPDATE e no INSERT),
--      com acesso passa, e quem está de fora recebe a recusa genérica;
--   5. regressão do que fica ao mover e reordenar cards: mover de coluna
--      mantém a versão, o reorder_project_cards (PERF-004) grava a ordem,
--      levar o card para "Concluído" não altera descrição nem versão, e o
--      RETURNING do checklist é a versão final. A prova de que o gatilho da
--      fila saiu é o catálogo (seção 1): depois do apply, a fila não existe e
--      estes casos dariam o mesmo resultado com o gatilho antigo. Só no ensaio
--      o último caso discrimina: antes do corpo, o K2 ganha um item "blocked"
--      na fila, e com o gatilho antigo marcar o item "Você" carimbaria a
--      descrição e mudaria a versão depois do RETURNING (FALHA); o corpo leva
--      o gatilho e o item.
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres, depois da
-- migration (ou, no ensaio, com o corpo da migration no marcador).

do $bloco0$
declare
  sigs text[] := array[
    'public.cq_list(uuid, text[], uuid)', 'public.cq_enqueue(uuid, text[], text[], text[], text[], uuid)',
    'public.cq_move(uuid, integer, uuid)', 'public.cq_remove(uuid, uuid)', 'public.cq_reprioritize(uuid, uuid)',
    'public.cq_validate(uuid, text, boolean, text, uuid)', 'public.cq_block(uuid, text, text, text[], text[], uuid)',
    'public.cq_boards(uuid)', 'public.cq_card(uuid, text, uuid)', 'public.cq_cards(uuid, text[], text[], text[], boolean, uuid)',
    'public.cq_check(uuid, text, text[], boolean, uuid)', 'public.cq_complete(uuid, text, text, uuid)', 'public.cq_next(uuid, uuid)',
    'public.cq_note(uuid, text, text, text, uuid)', 'public.cq_release(uuid, text, text, uuid)', 'public.cq_setup_flow(uuid, uuid)',
    'public.cq_start(uuid, integer, uuid)',
    'private.cq_on_card_change()', 'private.cq_insert_queued(uuid, uuid[], uuid, boolean)', 'private.cq_renumber(uuid, integer)',
    'private.cq_card_json(uuid)', 'private.cq_labels_match(jsonb, text[])', 'private.cq_resolve_columns(uuid, text[])',
    'private.cq_priorities(text[])', 'private.cq_resolve_card(uuid, text)', 'private.cq_move_card(uuid, uuid)',
    'private.cq_phase_column(uuid, text)', 'private.cq_status_column(uuid, text)', 'private.cq_flow_enabled(uuid)',
    'private.cq_stage_kind(text)', 'private.cq_stage_names(text)', 'private.cq_sync_todo_order(uuid)', 'private.cq_stamp(text, text)',
    'private.cq_effort_rank(jsonb)', 'private.cq_priority_rank(text)', 'private.cq_require(uuid, uuid, text)', 'private.cq_actor(uuid)',
    'private.cq_source()', 'private.cq_norm(text)', 'private.cq_is_uuid(text)',
    'public.create_api_token(text, integer, jsonb)', 'public.update_api_token_scopes(uuid, jsonb)', 'public.revoke_api_token(uuid)',
    'public.revoke_all_my_api_tokens()', 'public.delete_api_token(uuid)', 'public.resolve_api_token(text)',
    'public.resolve_api_token_v2(text, text)',
    'private.api_token_audit_admin(uuid, uuid, text, text, jsonb, jsonb)', 'private.api_token_policy(uuid, jsonb, timestamp with time zone)',
    'private.api_token_app_user()', 'private.api_validate_scopes(jsonb, boolean)', 'private.api_scopes_shape_ok(jsonb)',
    'private.api_legacy_scopes()', 'private.api_level_rank(text)'];
  tabelas text[] := array['public.api_tokens', 'public.project_card_queue', 'private.api_scope_catalog'];
  tab_oids oid[];
  typ_oids oid[];
  fn_oids oid[];
  r text;
  out text[] := array[]::text[];
begin
  select coalesce(array_agg(to_regclass(t)::oid) filter (where to_regclass(t) is not null), '{}') into tab_oids from unnest(tabelas) t;
  select coalesce(array_agg(reltype), '{}') into typ_oids from pg_class where oid = any (tab_oids);
  select coalesce(array_agg(to_regprocedure(s)::oid) filter (where to_regprocedure(s) is not null), '{}') into fn_oids from unnest(sigs) s;

  if to_regclass('public.api_tokens') is not null then
    execute $q$
      select format('total=%s ativos=%s donos=%s último uso (dia, São Paulo)=%s', count(*),
                    count(*) filter (where revoked_at is null and (expires_at is null or expires_at > now())),
                    count(distinct user_id),
                    coalesce(to_char(max(last_used_at) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'), 'nunca'))
        from public.api_tokens
    $q$ into r;
  else
    r := 'a tabela não existe';
  end if;
  out := out || ('1 api_tokens: ' || r);

  if to_regclass('public.project_card_queue') is not null then
    execute $q$
      select coalesce(string_agg(format('%s/%s=%s', status, source, n), ' ' order by status, source), 'vazia')
        from (select status, source, count(*) as n from public.project_card_queue group by 1, 2) x
    $q$ into r;
  else
    r := 'a tabela não existe';
  end if;
  out := out || ('2 project_card_queue por status/origem: ' || r);

  select format('%s (target_type api_token: %s)', count(*) filter (where action = 'api_token_admin_scopes'),
                count(*) filter (where target_type = 'api_token'))
    into r from public.audit_log;
  out := out || ('3 audit_log com action api_token_admin_scopes (ficam): ' || r);

  select coalesce(string_agg(rolname || case when rolcanlogin then ' (login)' else '' end, ', ' order by rolname), 'nenhum')
    into r from pg_roles where rolname like 'akool\_api%';
  out := out || ('4 papéis akool_api* (a migration não mexe; se existirem, decisão à parte): ' || r);

  if to_regclass('public.project_card_queue') is not null and to_regclass('realtime.subscription') is not null then
    execute $q$select count(*)::text from realtime.subscription where entity = 'public.project_card_queue'::regclass$q$ into r;
  else
    r := 'a tabela não existe';
  end if;
  out := out || ('5 assinaturas realtime abertas na fila: ' || r);

  select count(*)::text into r from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('authenticated', oid, 'execute');
  out := out || ('6 funções SECURITY DEFINER de public para authenticated (40 antes, 29 depois): ' || r);

  select format('%s/%s presentes; ausentes: %s', count(*) filter (where to_regprocedure(s) is not null), cardinality(sigs),
                coalesce(string_agg(s, ', ') filter (where to_regprocedure(s) is null), 'nenhuma'))
    into r from unnest(sigs) s;
  out := out || ('7 assinaturas da migration (54/54 antes do apply, 0/54 depois): ' || r);

  select coalesce(string_agg(format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', '), 'nenhuma')
    into r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.proname like 'cq\_%' or p.proname like 'api\_%' or p.proname like '%api\_token%')
     and p.oid is distinct from to_regprocedure('private.cq_board_role(uuid, uuid)')
     and not exists (select 1 from unnest(sigs) s where to_regprocedure(s) = p.oid);
  out := out || ('8 funções cq_*/api_* fora da lista e fora do cq_board_role (o DO da migration recusaria): ' || r);

  select count(*)::text into r from private.rate_limits where bucket = 'cards-api';
  out := out || ('9 contadores de rate limit do balde cards-api (ficam; somem na limpeza oportunística): ' || r);

  -- 10 a 15: o resto do que abortaria o apply (só catálogo).
  out := out || ('10 private.api_scope_catalog (o DROP não tem IF EXISTS): '
                 || case when to_regclass('private.api_scope_catalog') is not null then 'presente' else 'ausente' end);

  out := out || ('11 gatilho project_cards_queue_flow em public.project_cards (o DROP não tem IF EXISTS): '
                 || case when exists (select 1 from pg_trigger where tgrelid = 'public.project_cards'::regclass
                                         and tgname = 'project_cards_queue_flow' and not tgisinternal)
                         then 'presente' else 'ausente' end);

  select format('função private.project_card_integrity() %s; gatilho project_cards_integrity %s',
                case when to_regprocedure('private.project_card_integrity()') is not null then 'presente' else 'ausente' end,
                coalesce((select case when tgenabled = 'D' then 'desligado' else 'ligado' end from pg_trigger
                           where tgrelid = 'public.project_cards'::regclass and tgname = 'project_cards_integrity' and not tgisinternal),
                         'ausente'))
    into r;
  out := out || ('12 integridade de cards (a conferência da migration exige presente e ligado): ' || r);

  -- Fora as 3 tabelas e o que é delas (índices, sequências de coluna).
  select coalesce(string_agg(format('%s.%s', n.nspname, c.relname), ', ' order by n.nspname, c.relname), 'nenhuma')
    into r
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
     and (c.relname like 'cq\_%' or c.relname like 'api\_%' or c.relname like 'project\_card\_queue%')
     and c.oid <> all (tab_oids)
     and not exists (select 1 from pg_index i where i.indexrelid = c.oid and i.indrelid = any (tab_oids))
     and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid
                       and d.refclassid = 'pg_class'::regclass and d.refobjid = any (tab_oids) and d.deptype in ('a', 'i'));
  out := out || ('13 relações cq_*/api_*/project_card_queue* em public e private fora das 3 tabelas (o DO da migration recusaria): ' || r);

  -- Os mesmos padrões do DO $conferencia$, que não filtra schema.
  select coalesce(string_agg(format('%s.%s', t.tgrelid::regclass::text, t.tgname), ', ' order by t.tgname), 'nenhum')
    into r
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and (t.tgname like '%queue%' or t.tgname like 'cq\_%' or t.tgname like 'api\_%'
          or p.proname like 'cq\_%' or p.proname like 'api\_%')
     and not (t.tgrelid = 'public.project_cards'::regclass and t.tgname = 'project_cards_queue_flow')
     and t.tgrelid <> all (tab_oids);
  out := out || ('14 gatilhos queue/cq_*/api_* em qualquer schema, fora o project_cards_queue_flow (o DO da migration recusaria): ' || r);

  -- Quem depende (deptype 'n') das 3 tabelas, dos tipos delas ou das 54
  -- funções, fora o que cai junto: o que pertence às tabelas (constraints, como
  -- a CHECK api_tokens_scopes_shape; policies; índices; gatilhos), as próprias
  -- 54 funções e o gatilho da fila, que cai primeiro.
  select coalesce(string_agg(distinct pg_describe_object(d.classid, d.objid, d.objsubid), ', '), 'nenhum')
    into r
    from pg_depend d
   where d.deptype = 'n'
     and ((d.refclassid = 'pg_class'::regclass and d.refobjid = any (tab_oids))
          or (d.refclassid = 'pg_type'::regclass and d.refobjid = any (typ_oids))
          or (d.refclassid = 'pg_proc'::regclass and d.refobjid = any (fn_oids)))
     and not exists (select 1 from pg_depend o where o.classid = d.classid and o.objid = d.objid and o.deptype in ('a', 'i')
                       and o.refclassid = 'pg_class'::regclass and o.refobjid = any (tab_oids))
     and not (d.classid = 'pg_proc'::regclass and d.objid = any (fn_oids))
     and not (d.classid = 'pg_trigger'::regclass
              and d.objid in (select oid from pg_trigger where tgrelid = 'public.project_cards'::regclass and tgname = 'project_cards_queue_flow'));
  out := out || ('15 dependentes de fora das 3 tabelas e das 54 funções (sem CASCADE, o DROP recusaria): ' || r);

  raise exception using message = format(E'remove-api bloco 0: levantamento (só contagens, nada gravado)\n%s', array_to_string(out, E'\n'));
end
$bloco0$;

do $bloco1$
declare
  sigs_public_cq text[] := array[
    'public.cq_list(uuid, text[], uuid)', 'public.cq_enqueue(uuid, text[], text[], text[], text[], uuid)',
    'public.cq_move(uuid, integer, uuid)', 'public.cq_remove(uuid, uuid)', 'public.cq_reprioritize(uuid, uuid)',
    'public.cq_validate(uuid, text, boolean, text, uuid)', 'public.cq_block(uuid, text, text, text[], text[], uuid)',
    'public.cq_boards(uuid)', 'public.cq_card(uuid, text, uuid)', 'public.cq_cards(uuid, text[], text[], text[], boolean, uuid)',
    'public.cq_check(uuid, text, text[], boolean, uuid)', 'public.cq_complete(uuid, text, text, uuid)', 'public.cq_next(uuid, uuid)',
    'public.cq_note(uuid, text, text, text, uuid)', 'public.cq_release(uuid, text, text, uuid)', 'public.cq_setup_flow(uuid, uuid)',
    'public.cq_start(uuid, integer, uuid)'];
  sigs_private_cq text[] := array[
    'private.cq_on_card_change()', 'private.cq_insert_queued(uuid, uuid[], uuid, boolean)', 'private.cq_renumber(uuid, integer)',
    'private.cq_card_json(uuid)', 'private.cq_labels_match(jsonb, text[])', 'private.cq_resolve_columns(uuid, text[])',
    'private.cq_priorities(text[])', 'private.cq_resolve_card(uuid, text)', 'private.cq_move_card(uuid, uuid)',
    'private.cq_phase_column(uuid, text)', 'private.cq_status_column(uuid, text)', 'private.cq_flow_enabled(uuid)',
    'private.cq_stage_kind(text)', 'private.cq_stage_names(text)', 'private.cq_sync_todo_order(uuid)', 'private.cq_stamp(text, text)',
    'private.cq_effort_rank(jsonb)', 'private.cq_priority_rank(text)', 'private.cq_require(uuid, uuid, text)', 'private.cq_actor(uuid)',
    'private.cq_source()', 'private.cq_norm(text)', 'private.cq_is_uuid(text)'];
  sigs_token text[] := array[
    'public.create_api_token(text, integer, jsonb)', 'public.update_api_token_scopes(uuid, jsonb)', 'public.revoke_api_token(uuid)',
    'public.revoke_all_my_api_tokens()', 'public.delete_api_token(uuid)', 'public.resolve_api_token(text)',
    'public.resolve_api_token_v2(text, text)'];
  sigs_private_api text[] := array[
    'private.api_token_audit_admin(uuid, uuid, text, text, jsonb, jsonb)', 'private.api_token_policy(uuid, jsonb, timestamp with time zone)',
    'private.api_token_app_user()', 'private.api_validate_scopes(jsonb, boolean)', 'private.api_scopes_shape_ok(jsonb)',
    'private.api_legacy_scopes()', 'private.api_level_rank(text)'];
  tabelas text[] := array['public.api_tokens', 'public.project_card_queue', 'private.api_scope_catalog'];
  policies text[] := array['api_tokens_select_own', 'project_card_queue_select'];
  -- site-backup/tables.ts depois deste PR: BACKUP_TABLES (38) + EXCLUDED_TABLES (8).
  tabelas_backup text[] := array[
    'profiles', 'invite_codes', 'pages', 'page_shares', 'note_contents', 'drawing_contents', 'todos', 'project_boards',
    'project_columns', 'project_cards', 'project_shares', 'finance_workspaces', 'finance_workspace_members', 'finance_accounts',
    'finance_categories', 'finance_budgets', 'finance_goals', 'finance_goal_shares', 'finance_recurring', 'finance_transactions',
    'finance_goal_contributions', 'finance_recurring_entries', 'finance_workspace_invites', 'finance_suppliers',
    'finance_store_customers', 'finance_store_products', 'finance_store_purchases', 'finance_store_sales',
    'finance_store_sale_items', 'finance_loan_borrowers', 'finance_loans', 'finance_loan_payments', 'finance_loan_collaterals',
    'notifications', 'quick_notes', 'study_topics', 'study_cards', 'study_logs',
    'site_backups', 'site_backup_settings', 'profile_secrets', 'page_presence', 'mindmap_contents', 'finance_statements',
    'audit_log', 'study_lookup_cache'];
  todas text[];
  o uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  cd uuid := gen_random_uuid();
  k1 uuid := gen_random_uuid();
  k2 uuid := gen_random_uuid();
  k3 uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  audit_antes bigint;
  cards_antes bigint;
  funcs_antes bigint;
  funcs_lista_antes bigint;
  tabelas_antes bigint;
  tabelas_lista_antes bigint;
  gatilhos_antes bigint;
  gatilho_fila_antes bigint;
  policies_antes bigint;
  policies_lista_antes bigint;
  ts1 timestamptz;
  lock_corpo text;
  r text;
  out text[] := array[]::text[];
begin
  -- Fixtures sem gatilhos, antes das contagens (e, no ensaio, antes do corpo):
  -- quadro da O com share de editora para E; X de fora.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (o, format('rmapi-o-%s@example.invalid', tag)), (e, format('rmapi-e-%s@example.invalid', tag)), (x, format('rmapi-x-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (o, format('rmapi-o-%s@example.invalid', tag), 'O', 'standard', true, 0),
    (e, format('rmapi-e-%s@example.invalid', tag), 'E', 'standard', true, 0),
    (x, format('rmapi-x-%s@example.invalid', tag), 'X', 'standard', true, 0);
  insert into public.project_boards (id, user_id, name) values (b, o, 'remove-api B');
  insert into public.project_columns (id, board_id, name, sort_order) values
    (c1, b, 'A Fazer', 0), (c2, b, 'Fazendo', 1), (cd, b, 'Concluído', 2);
  insert into public.project_shares (board_id, owner_id, shared_with_user_id, role) values (b, o, e, 'editor');
  insert into public.project_cards (id, board_id, column_id, title, sort_order, description, checklist, updated_at) values
    (k1, b, c1, 'K1', 0, 'd1', '[]', '2020-01-01'),
    (k2, b, c1, 'K2', 1, 'd2', '[{"id": "u1", "text": "Você faz", "completed": false, "owner": "user"}]', '2020-01-01'),
    (k3, b, c1, 'K3', 2, 'd3', '[]', '2020-01-01');
  -- Só no ensaio (a fila ainda existe): o último item do K2 fica "blocked". Com
  -- o gatilho antigo, marcar o item "Você" do K2 carimbaria a descrição e
  -- mudaria a versão depois do RETURNING (o último caso da seção 5 daria
  -- FALHA); o corpo da migration leva o gatilho e, com a tabela, o item.
  if to_regclass('public.project_card_queue') is not null then
    execute format('insert into public.project_card_queue (board_id, card_id, position, status, note) values (%L, %L, 0, %L, %L)',
                   b, k2, 'blocked', 'remove-api');
  end if;
  set local session_replication_role = origin;

  -- Contagens antes do corpo da migration (no ensaio). Depois do apply, "antes"
  -- e "depois" são a mesma foto e as diferenças dão 0.
  todas := sigs_public_cq || sigs_private_cq || sigs_token || sigs_private_api;
  select count(*) into audit_antes from public.audit_log where action = 'api_token_admin_scopes';
  select count(*) into cards_antes from public.project_cards;
  select count(*) into funcs_antes from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace);
  select count(*) into funcs_lista_antes from unnest(todas) s where to_regprocedure(s) is not null;
  select count(*) into tabelas_antes from pg_class where relnamespace in ('public'::regnamespace, 'private'::regnamespace) and relkind in ('r', 'p');
  select count(*) into tabelas_lista_antes from unnest(tabelas) t where to_regclass(t) is not null;
  select count(*) into gatilhos_antes from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'private'::regnamespace);
  select count(*) into gatilho_fila_antes from pg_trigger where tgname = 'project_cards_queue_flow' and not tgisinternal;
  select count(*) into policies_antes from pg_policies where schemaname in ('public', 'private');
  select count(*) into policies_lista_antes from pg_policies where schemaname in ('public', 'private') and policyname = any (policies);

  -- ensaio: o corpo da migration entra aqui

  -- Logo depois do corpo: a seção 0 da migration pôs lock_timeout de 5 s (SET
  -- LOCAL vale até o fim da transação, mesmo dentro deste DO).
  lock_corpo := current_setting('lock_timeout');

  create function pg_temp.as_user(p_uid uuid, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    execute p_sql into v_res;
    reset role;
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(coalesce(p_got, '(nulo)'), 200))
  $f$;

  -- 1. No ensaio, o lock_timeout do corpo (depois do apply, as 54 já não
  --    existem antes e o caso sai como n/a). Depois, a ausência.
  out := out || pg_temp.expect('o corpo da migration põe lock_timeout de 5 s (só no ensaio; depois do apply, n/a)',
                               case when funcs_lista_antes > 0 then lock_corpo else '5s (depois do apply: n/a)' end, '5s%');
  select coalesce(string_agg(s, ', '), 'nenhuma') into r from unnest(sigs_public_cq) s where to_regprocedure(s) is not null;
  out := out || pg_temp.expect('as 17 public.cq_* saíram', r, 'nenhuma');
  select coalesce(string_agg(s, ', '), 'nenhuma') into r from unnest(sigs_private_cq) s where to_regprocedure(s) is not null;
  out := out || pg_temp.expect('as 23 private.cq_* (todas menos cq_board_role) saíram', r, 'nenhuma');
  select coalesce(string_agg(s, ', '), 'nenhuma') into r from unnest(sigs_token) s where to_regprocedure(s) is not null;
  out := out || pg_temp.expect('as 7 RPCs de token saíram', r, 'nenhuma');
  select coalesce(string_agg(s, ', '), 'nenhuma') into r from unnest(sigs_private_api) s where to_regprocedure(s) is not null;
  out := out || pg_temp.expect('as 7 private.api_* saíram', r, 'nenhuma');
  select coalesce(string_agg(format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', '), 'nenhuma')
    into r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.proname like 'cq\_%' or p.proname like 'api\_%' or p.proname like '%api\_token%')
     and p.oid is distinct from to_regprocedure('private.cq_board_role(uuid, uuid)');
  out := out || pg_temp.expect('nenhuma outra função cq_*/api_* em public e private (fora o cq_board_role)', r, 'nenhuma');
  select coalesce(string_agg(t, ', '), 'nenhuma') into r from unnest(tabelas) t where to_regclass(t) is not null;
  out := out || pg_temp.expect('as tabelas api_tokens, project_card_queue e api_scope_catalog saíram', r, 'nenhuma');
  select coalesce(string_agg(n.nspname || '.' || c.relname, ', '), 'nenhum') into r
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private') and (c.relname like 'api\_%' or c.relname like 'cq\_%' or c.relname like 'project\_card\_queue%');
  out := out || pg_temp.expect('nenhuma tabela, índice ou sequência cq_*/api_*/project_card_queue* em public e private', r, 'nenhum');
  select coalesce(string_agg(format('%s.%s', t.tgrelid::regclass::text, t.tgname), ', '), 'nenhum') into r
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and (t.tgname like '%queue%' or t.tgname like 'cq\_%' or t.tgname like 'api\_%' or p.proname like 'cq\_%' or p.proname like 'api\_%');
  out := out || pg_temp.expect('o gatilho project_cards_queue_flow saiu e nenhum gatilho chama cq_*/api_*', r, 'nenhum');
  select coalesce(string_agg(policyname, ', '), 'nenhuma') into r from pg_policies where policyname = any (policies);
  out := out || pg_temp.expect('as policies api_tokens_select_own e project_card_queue_select saíram', r, 'nenhuma');
  select coalesce(string_agg(format('%s.%s', schemaname, tablename), ',' order by tablename), 'nenhuma') into r
    from pg_publication_tables where pubname = 'supabase_realtime';
  out := out || pg_temp.expect('a publicação realtime fica com as 7 tabelas do app, sem a fila', r,
                               'public.drawing_contents,public.note_contents,public.notifications,public.pages,public.project_cards,public.project_columns,public.todos');
  select count(*)::text into r from pg_publication_tables
   where tablename in ('project_card_queue', 'api_tokens', 'api_scope_catalog')
      or not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = pg_publication_tables.schemaname and c.relname = pg_publication_tables.tablename);
  out := out || pg_temp.expect('nenhum resto da fila em pg_publication_tables (em nenhuma publicação)', r, '0');

  -- 2. Só saiu o que estava na lista.
  select format('funções %s→%s (-%s) tabelas %s→%s (-%s) gatilhos %s→%s (-%s) policies %s→%s (-%s)',
                funcs_antes, (select count(*) from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)), funcs_lista_antes,
                tabelas_antes, (select count(*) from pg_class where relnamespace in ('public'::regnamespace, 'private'::regnamespace) and relkind in ('r', 'p')), tabelas_lista_antes,
                gatilhos_antes, (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
                                  where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)), gatilho_fila_antes,
                policies_antes, (select count(*) from pg_policies where schemaname in ('public', 'private')), policies_lista_antes)
    into r;
  out := out || pg_temp.expect('em public e private caiu exatamente o que a lista tinha (nada levado junto)', r,
                               format('funções %s→%s (-%s) tabelas %s→%s (-%s) gatilhos %s→%s (-%s) policies %s→%s (-%s)',
                                      funcs_antes, funcs_antes - funcs_lista_antes, funcs_lista_antes,
                                      tabelas_antes, tabelas_antes - tabelas_lista_antes, tabelas_lista_antes,
                                      gatilhos_antes, gatilhos_antes - gatilho_fila_antes, gatilho_fila_antes,
                                      policies_antes, policies_antes - policies_lista_antes, policies_lista_antes));
  select format('%s %s', ((select count(*) from public.audit_log where action = 'api_token_admin_scopes') = audit_antes)::text,
                ((select count(*) from public.project_cards) = cards_antes)::text)
    into r;
  out := out || pg_temp.expect(format('as linhas antigas do audit_log (%s) e os cards (%s) continuam', audit_antes, cards_antes), r, 'true true');

  -- 3. O que fica.
  select format('%s %s', (to_regprocedure('private.cq_board_role(uuid, uuid)') is not null)::text,
                (position('private.cq_board_role(' in (select prosrc from pg_proc where oid = 'private.project_card_integrity()'::regprocedure)) > 0)::text)
    into r;
  out := out || pg_temp.expect('private.cq_board_role fica e o gatilho de integridade a chama', r, 'true true');
  select string_agg(t.tgname, ',' order by t.tgname) into r from pg_trigger t
   where t.tgrelid = 'public.project_cards'::regclass and not t.tgisinternal and t.tgenabled <> 'D';
  out := out || pg_temp.expect('os 4 gatilhos de project_cards continuam ligados', r,
                               'project_cards_graph_lock,project_cards_integrity,project_cards_notify_assignee,project_cards_refresh_assigned_title');
  select format('%s %s %s %s %s', (to_regclass('private.rate_limits') is not null)::text,
                (to_regprocedure('private.rate_limit_touch(text, text, integer, integer)') is not null)::text,
                (to_regprocedure('private.raise_rate_limited(integer, text)') is not null)::text,
                has_function_privilege('authenticated', 'public.check_rate_limit(text, text, integer, integer)'::regprocedure, 'execute')::text,
                has_function_privilege('service_role', 'public.check_rate_limit(text, text, integer, integer)'::regprocedure, 'execute')::text)
    into r;
  out := out || pg_temp.expect('o rate limit fica (tabela, touch, raise; check_rate_limit só para service_role)', r, 'true true true false true');
  select format('faltam: %s | sem classificação: %s',
                coalesce((select string_agg(t, ',' order by t) from unnest(tabelas_backup) t where t <> all (public.list_public_tables())), '-'),
                coalesce((select string_agg(t, ',' order by t) from unnest(public.list_public_tables()) t where t <> all (tabelas_backup)), '-'))
    into r;
  out := out || pg_temp.expect('as tabelas de public são as 46 do site-backup (o assertNoTableDrift da versão nova passa)', r, 'faltam: - | sem classificação: -');
  select count(*)::text into r from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('authenticated', oid, 'execute');
  out := out || pg_temp.expect('29 funções SECURITY DEFINER de public para authenticated (eram 40; saem 5 de token e 6 da fila)', r, '29');
  select coalesce(string_agg(proname, ','), 'nenhuma') into r from pg_proc
   where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('anon', oid, 'execute');
  out := out || pg_temp.expect('para anon, só a validate_invite_code', r, 'validate_invite_code');

  -- 4. O gatilho de integridade continua valendo.
  r := pg_temp.as_user(e, format($q$update public.project_cards set assignee_user_id = %L where id = %L$q$, x, k1));
  out := out || pg_temp.expect('responsável sem acesso ao quadro é recusado (UPDATE)', r, 'erro 23514: O responsável não tem acesso ao quadro');
  r := pg_temp.as_user(e, format($q$insert into public.project_cards (board_id, column_id, title, assignee_user_id) values (%L, %L, 'novo', %L)$q$, b, c1, x));
  out := out || pg_temp.expect('responsável sem acesso ao quadro é recusado (INSERT)', r, 'erro 23514: O responsável não tem acesso ao quadro');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set assignee_user_id = %L where id = %L returning 1) select count(*)::text from u$q$, e, k1));
  out := out || pg_temp.expect('responsável com share de editora é aceito', r, 'ok 1');
  r := pg_temp.as_user(e, format($q$insert into public.project_cards (board_id, column_id, title, assignee_user_id) values (%L, %L, 'novo', %L) returning sort_order::text$q$, b, c2, o));
  out := out || pg_temp.expect('card novo com a dona como responsável passa e vai para o fim da coluna', r, 'ok 0');
  r := pg_temp.as_user(x, format($q$insert into public.project_cards (board_id, column_id, title) values (%L, %L, 'x')$q$, b, c1));
  out := out || pg_temp.expect('quem está de fora recebe só a recusa genérica', r, 'erro 42501: Sem permissão para editar este quadro');

  -- 5. Regressão do que fica ao mover e reordenar. A prova de que o gatilho da
  --    fila saiu é o catálogo (seção 1); só no ensaio o último caso discrimina
  --    (o item "blocked" do K2, posto antes do corpo).
  select updated_at into ts1 from public.project_cards where id = k1;
  r := pg_temp.as_user(e, format($q$update public.project_cards set column_id = %L, sort_order = 1 where id = %L returning (updated_at = %L::timestamptz)::text$q$, c2, k1, ts1));
  out := out || pg_temp.expect('mover de coluna mantém a versão', r, 'ok true');
  r := pg_temp.as_user(e, format($q$select public.reorder_project_cards(%L, %L)::text$q$, b,
                                 jsonb_build_array(jsonb_build_object('id', k3, 'column_id', c1, 'sort_order', 0),
                                                   jsonb_build_object('id', k2, 'column_id', c1, 'sort_order', 1))));
  if r = 'ok 2' then
    select string_agg(title, ',' order by sort_order) into r from public.project_cards where column_id = c1;
  end if;
  out := out || pg_temp.expect('reorder_project_cards grava a nova ordem da coluna', r, 'K3,K2');
  select updated_at into ts1 from public.project_cards where id = k3;
  r := pg_temp.as_user(e, format($q$select public.reorder_project_cards(%L, %L)::text$q$, b,
                                 jsonb_build_array(jsonb_build_object('id', k3, 'column_id', cd, 'sort_order', 0))));
  if r = 'ok 1' then
    select format('%s %s %s', (c.column_id = cd)::text, c.description, (c.updated_at = ts1)::text) into r from public.project_cards c where c.id = k3;
  end if;
  out := out || pg_temp.expect('levar o card para "Concluído" pelo reorder não altera descrição nem versão', r, 'true d3 true');
  r := pg_temp.as_user(e, format($q$update public.project_cards set checklist = '[{"id": "u1", "text": "Você faz", "completed": true, "owner": "user"}]' where id = %L returning updated_at::text$q$, k2));
  if r like 'ok %' then
    select format('%s %s', (c.updated_at = substr(r, 4)::timestamptz)::text, c.description) into r from public.project_cards c where c.id = k2;
  end if;
  out := out || pg_temp.expect('o RETURNING do checklist é a versão final e a descrição fica igual', r, 'true d2');

  raise exception using message = format(E'remove-api bloco 1: API v1 e fila fora do banco (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;
