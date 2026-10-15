-- API-013: regras de cards no servidor (migration
-- 20261007130000_api013_project_cards_integrity).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado). Cada linha sai "ok" ou "FALHA".
--
-- Bloco 1 (staging e produção): pessoas descartáveis O (dona dos quadros), E
-- (editora por share), V (leitora por share) e X (de fora). Cada regra
-- recusada e a aceita, a versão do conteúdo (inclusive duas vezes na mesma
-- transação, e o RETURNING do checklist como versão final), quem está de fora
-- só com a recusa genérica, o contexto sem usuário (as formas não são
-- conferidas) e a estrutura: project_cards só com os 4 gatilhos do app (o da
-- fila, que mudava o card depois do RETURNING, saiu em
-- 20261015100000_remove_api_and_queue). A última linha conta as "ok" (N/N ok).
--
-- Bloco 2 (SÓ STAGING): o restore de verdade com cards (ele apaga as 38
-- tabelas antes de inserir; tudo desfeito no fim), só com o opt-in na sessão:
--   select set_config('akool.api013_full_restore', 'staging', false);
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres.

do $bloco1$
declare
  o uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  v uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  b1 uuid := gen_random_uuid();
  b2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  k1col uuid := gen_random_uuid();
  k1 uuid := gen_random_uuid();
  k2 uuid := gen_random_uuid();
  k3 uuid := gen_random_uuid();
  k4 uuid := gen_random_uuid();
  k5 uuid := gen_random_uuid();
  kq uuid := gen_random_uuid();
  kout uuid := gen_random_uuid();
  page_e uuid := gen_random_uuid();
  page_x uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  r text;
  ts1 timestamptz;
  n int;
  out text[] := array[]::text[];
begin
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

  create function pg_temp.try(p_claims jsonb, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    execute p_sql into v_res;
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 160))
  $f$;

  -- Fixtures sem gatilhos: inclui dado antigo fora da regra (dependência órfã e
  -- anexo com URL antiga), que tem de continuar valendo.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (o, format('api013-o-%s@example.invalid', tag)), (e, format('api013-e-%s@example.invalid', tag)),
    (v, format('api013-v-%s@example.invalid', tag)), (x, format('api013-x-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (o, format('api013-o-%s@example.invalid', tag), 'O', 'standard', true, 0),
    (e, format('api013-e-%s@example.invalid', tag), 'E', 'standard', true, 0),
    (v, format('api013-v-%s@example.invalid', tag), 'V', 'standard', true, 0),
    (x, format('api013-x-%s@example.invalid', tag), 'X', 'standard', true, 0);
  insert into public.project_boards (id, user_id, name) values (b1, o, 'api013 B1'), (b2, o, 'api013 B2');
  insert into public.project_columns (id, board_id, name, sort_order) values
    (c1, b1, 'A Fazer', 0), (c2, b1, 'Fazendo', 1), (k1col, b2, 'Outra', 0);
  insert into public.project_shares (board_id, owner_id, shared_with_user_id, role) values (b1, o, e, 'editor'), (b1, o, v, 'viewer');
  insert into public.pages (id, user_id, title) values (page_e, e, 'Página de E'), (page_x, x, 'Página de X');
  -- updated_at antigo, para a versão nova (clock_timestamp) ser sempre maior.
  insert into public.project_cards (id, board_id, column_id, title, sort_order, labels, depends_on, attachments, updated_at) values
    (k1, b1, c1, 'K1', 0, '["Segurança"]', '{}', '[]', '2020-01-01'),
    (k2, b1, c1, 'K2', 1, '[]', array[k1], '[]', '2020-01-01'),
    (k3, b1, c1, 'K3', 2, '[]', array[gen_random_uuid()], format('[{"id": "velho", "url": "https://exemplo.supabase.co/storage/v1/object/public/project-card-images/%s/%s/x.png", "name": "x.png"}]', o, b1)::jsonb, '2020-01-01'),
    (kout, b2, k1col, 'Fora', 0, '[]', '{}', '[]', '2020-01-01'),
    -- Anexo legado sem id, e jsonb que não é lista (caminhos sem validação).
    (k4, b1, c2, 'K4', 0, '[]', '{}', '[{"url": "legado.png", "name": "l"}]', '2020-01-01'),
    (k5, b1, c2, 'K5', 1, '{}', '{}', '{}', '2020-01-01');
  -- Card com um item "Você" no checklist (o formato antigo continua valendo).
  insert into public.project_cards (id, board_id, column_id, title, sort_order, description, checklist, updated_at) values
    (kq, b1, c2, 'KQ', 2, 'dq', '[{"id": "u1", "text": "Você faz", "completed": false, "owner": "user"}]', '2020-01-01');
  update public.project_cards set parent_card_id = k1 where id = k2;
  set local session_replication_role = origin;

  -- 1. Posição e versão do servidor.
  r := pg_temp.as_user(e, format($q$insert into public.project_cards (board_id, column_id, title, updated_at) values (%L, %L, 'novo', '2001-01-01') returning sort_order::text || ' ' || (updated_at > now() - interval '1 minute')::text$q$, b1, c1));
  out := out || pg_temp.expect('card sem posição vai para o fim da coluna; updated_at do cliente é ignorado', r, 'ok 3 true');
  select updated_at into ts1 from public.project_cards where id = k1;
  r := pg_temp.as_user(e, format($q$update public.project_cards set sort_order = 9, column_id = %L, updated_at = '2001-01-01' where id = %L returning (updated_at = %L::timestamptz)::text$q$, c2, k1, ts1));
  out := out || pg_temp.expect('mover (coluna e ordem) mantém a versão', r, 'ok true');
  r := pg_temp.as_user(e, format($q$update public.project_cards set title = 'K1 editado' where id = %L returning (updated_at > %L::timestamptz)::text$q$, k1, ts1));
  out := out || pg_temp.expect('mudar o conteúdo avança a versão', r, 'ok true');
  select updated_at into ts1 from public.project_cards where id = k1;
  r := pg_temp.as_user(e, format($q$update public.project_cards set title = 'K1 de novo' where id = %L returning (updated_at > %L::timestamptz)::text$q$, k1, ts1));
  out := out || pg_temp.expect('segunda mudança na mesma transação avança a versão de novo', r, 'ok true');
  r := pg_temp.as_user(e, format($q$update public.project_cards set checklist = '[{"id": "u1", "text": "Você faz", "completed": true, "owner": "user"}]' where id = %L returning updated_at::text$q$, kq));
  if r like 'ok %' then
    select format('%s %s', (c.updated_at = substr(r, 4)::timestamptz)::text, c.description) into r
      from public.project_cards c where c.id = kq;
  end if;
  out := out || pg_temp.expect('o RETURNING do checklist é a versão final e a descrição não muda', r, 'true dq');

  -- 2. Quem não edita o quadro, quadro e coluna.
  r := pg_temp.as_user(x, format($q$insert into public.project_cards (board_id, column_id, title, assignee_user_id) values (%L, %L, 'x', %L)$q$, b1, c1, x));
  out := out || pg_temp.expect('quem está de fora recebe só a recusa genérica', r, 'erro 42501: Sem permissão para editar este quadro');
  r := pg_temp.as_user(v, format($q$insert into public.project_cards (board_id, column_id, title) values (%L, %L, 'x')$q$, b1, k1col));
  out := out || pg_temp.expect('leitora também (nem a regra da coluna aparece)', r, 'erro 42501: Sem permissão para editar este quadro');
  r := pg_temp.as_user(e, format($q$insert into public.project_cards (board_id, column_id, title) values (%L, %L, 'x')$q$, b1, k1col));
  out := out || pg_temp.expect('coluna de outro quadro é recusada', r, 'erro 23514: A coluna é de outro quadro');
  r := pg_temp.as_user(o, format($q$update public.project_cards set board_id = %L, column_id = %L where id = %L$q$, b2, k1col, k3));
  out := out || pg_temp.expect('card não muda de quadro', r, 'erro 23514: Um card não muda de quadro');

  -- 3. Pai.
  r := pg_temp.as_user(e, format($q$update public.project_cards set parent_card_id = %L where id = %L$q$, kout, k3));
  out := out || pg_temp.expect('pai de outro quadro é recusado', r, 'erro 23514: O card pai é de outro quadro%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set parent_card_id = %L where id = %L$q$, k3, k3));
  out := out || pg_temp.expect('card não é pai de si mesmo', r, 'erro 23514: Um card não pode ser pai de si mesmo');
  r := pg_temp.as_user(e, format($q$update public.project_cards set parent_card_id = %L where id = %L$q$, k2, k1));
  out := out || pg_temp.expect('pai em ciclo é recusado (K2 já é filho de K1)', r, 'erro 23514: Esse pai criaria um ciclo');

  -- 4. Dependências.
  r := pg_temp.as_user(e, format($q$update public.project_cards set depends_on = array[%L]::uuid[] where id = %L$q$, kout, k1));
  out := out || pg_temp.expect('dependência de outro quadro é recusada', r, 'erro 23514: A dependência é de outro quadro%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set depends_on = array[%L]::uuid[] where id = %L$q$, k1, k1));
  out := out || pg_temp.expect('card não depende de si mesmo', r, 'erro 23514: Um card não pode depender de si mesmo');
  r := pg_temp.as_user(e, format($q$update public.project_cards set depends_on = array[%L]::uuid[] where id = %L$q$, k2, k1));
  out := out || pg_temp.expect('dependência em ciclo é recusada (K2 já depende de K1)', r, 'erro 23514: Essa dependência criaria um ciclo');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set title = 'K3 editado' where id = %L returning 1) select count(*)::text from u$q$, k3));
  out := out || pg_temp.expect('dependência órfã antiga não trava quem edita outra coisa', r, 'ok 1');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set depends_on = depends_on || %L::uuid where id = %L returning 1) select count(*)::text from u$q$, k1, k3));
  out := out || pg_temp.expect('acrescentar dependência válida mantendo a órfã', r, 'ok 1');

  -- 5. Responsável e página vinculada.
  r := pg_temp.as_user(e, format($q$update public.project_cards set assignee_user_id = %L where id = %L$q$, x, k3));
  out := out || pg_temp.expect('responsável sem acesso ao quadro é recusado', r, 'erro 23514: O responsável não tem acesso ao quadro');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set assignee_user_id = %L where id = %L returning 1) select count(*)::text from u$q$, v, k3));
  out := out || pg_temp.expect('responsável com share de leitura é aceito', r, 'ok 1');
  r := pg_temp.as_user(e, format($q$update public.project_cards set linked_page_id = %L where id = %L$q$, page_x, k3));
  out := out || pg_temp.expect('página que E não lê é recusada', r, 'erro 42501: A página vinculada não está acessível');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set linked_page_id = %L where id = %L returning 1) select count(*)::text from u$q$, page_e, k3));
  out := out || pg_temp.expect('página de E é aceita', r, 'ok 1');

  -- 6. Forma do checklist, dos rótulos e dos anexos.
  r := pg_temp.as_user(e, format($q$update public.project_cards set checklist = '[{"id": "1", "text": "x"}]' where id = %L$q$, k3));
  out := out || pg_temp.expect('item de checklist sem completed é recusado', r, 'erro 23514: Checklist fora do formato%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set checklist = '[{"id": "1", "text": "x", "completed": false, "extra": 1}]' where id = %L$q$, k3));
  out := out || pg_temp.expect('chave desconhecida no checklist é recusada', r, 'erro 23514: Checklist fora do formato%');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set checklist = '[{"id": "1", "text": "x", "completed": false}, {"id": "2", "text": "y", "completed": true, "owner": "user"}]' where id = %L returning 1) select count(*)::text from u$q$, k3));
  out := out || pg_temp.expect('checklist no formato é aceito', r, 'ok 1');
  r := pg_temp.as_user(e, format($q$update public.project_cards set labels = '["Segurança", "segurança"]' where id = %L$q$, k3));
  out := out || pg_temp.expect('rótulo repetido só na caixa é recusado', r, 'erro 23514: Rótulos fora do formato%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set labels = '[" api"]' where id = %L$q$, k3));
  out := out || pg_temp.expect('rótulo com espaço na ponta é recusado', r, 'erro 23514: Rótulos fora do formato%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set labels = %L where id = %L$q$, (select jsonb_agg('r' || i) from generate_series(1, 31) i), k3));
  out := out || pg_temp.expect('31 rótulos são recusados', r, 'erro 23514: Rótulos fora do formato%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set attachments = attachments || jsonb_build_array(jsonb_build_object('id', 'novo', 'url', %L, 'name', 'a.png')) where id = %L$q$, format('%s/%s/k3/a.png', o, b1), k3));
  out := out || pg_temp.expect('anexo novo na pasta de outra pessoa é recusado', r, 'erro 42501: Anexo novo fora da pasta do quadro');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set attachments = attachments || jsonb_build_array(jsonb_build_object('id', 'novo', 'url', %L, 'name', 'a.png')) where id = %L returning 1) select count(*)::text from u$q$, format('%s/%s/k3/a.png', e, b1), k3));
  out := out || pg_temp.expect('anexo novo em <quem envia>/<quadro>/ é aceito, e o antigo com URL fica', r, 'ok 1');
  r := pg_temp.as_user(e, format($q$update public.project_cards set attachments = '[{"id": "a", "url": "x", "name": "a", "size": 1}]' where id = %L$q$, k3));
  out := out || pg_temp.expect('anexo com chave desconhecida é recusado', r, 'erro 23514: Anexos fora do formato%');
  r := pg_temp.as_user(e, format($q$update public.project_cards set attachments = jsonb_build_array(jsonb_build_object('id', 'velho', 'url', %L, 'name', 'x.png')) where id = %L$q$, format('%s/%s/x.png', o, b2), k3));
  out := out || pg_temp.expect('manter o id de um anexo antigo e trocar a URL é recusado', r, 'erro 42501: Anexo novo fora da pasta do quadro');
  r := pg_temp.as_user(e, format($q$update public.project_cards set attachments = '[{"id": "n1", "url": "fora/x.png", "name": "x"}]' where id = %L$q$, k4));
  out := out || pg_temp.expect('anexo antigo sem id não libera URL nova fora da pasta', r, 'erro 42501: Anexo novo fora da pasta do quadro');
  r := pg_temp.as_user(e, format($q$with u as (update public.project_cards set attachments = %L where id = %L returning 1) select count(*)::text from u$q$,
                                 jsonb_build_array(jsonb_build_object('id', 'n', 'url', format('%s/%s/k5/a.png', e, b1), 'name', 'a')), k5));
  out := out || pg_temp.expect('anexos antigos que não são lista contam como vazios', r, 'ok 1');

  -- 7. Sem usuário (restore, seed): só posição e versão.
  select coalesce(max(sort_order), -1) + 1 into n from public.project_cards where column_id = c2;
  r := pg_temp.try(null, format($q$insert into public.project_cards (board_id, column_id, title, labels) values (%L, %L, 'restore', '["A", "a"]') returning sort_order::text$q$, b1, c2));
  out := out || pg_temp.expect('sem claims: validação pula, posição vai para o fim', r, 'ok ' || n);
  r := pg_temp.try(null, format($q$insert into public.project_cards (board_id, column_id, title, checklist) values (%L, %L, 'restore 501', %L) returning jsonb_array_length(checklist)::text$q$,
                                b1, c2, (select jsonb_agg(jsonb_build_object('id', 'i' || g, 'text', 'i', 'completed', false)) from generate_series(1, 501) g)));
  out := out || pg_temp.expect('sem claims: checklist acima de 500 itens também passa (as formas só valem com usuário)', r, 'ok 501');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$update public.project_cards set checklist = '[{"id": "z", "text": "z", "completed": true}]' where id = %L returning 'ok'$q$, k1));
  out := out || pg_temp.expect('service_role (restore) atualiza checklist', r, 'ok ok');
  r := pg_temp.try(jsonb_build_object('role', 'authenticated'), format($q$update public.project_cards set labels = '["A", "a"]' where id = %L returning 'ok'$q$, k1));
  out := out || pg_temp.expect('JWT de cliente sem sub continua validado', r, 'erro 23514:%');

  -- 8. Estrutura.
  select format('%s %s', p.prosecdef, array_to_string(p.proconfig, ',')) into r
    from pg_proc p where p.oid = 'private.project_card_integrity()'::regprocedure;
  out := out || pg_temp.expect('gatilho: SECURITY DEFINER e search_path vazio', r, 't search_path=""');
  select count(*)::text into r from pg_trigger where tgrelid = 'public.project_cards'::regclass and tgname = 'project_cards_integrity' and not tgisinternal;
  out := out || pg_temp.expect('gatilho project_cards_integrity existe', r, '1');
  select coalesce(string_agg(tgname, ',' order by tgname), 'nenhum') into r from pg_trigger
   where tgrelid = 'public.project_cards'::regclass and not tgisinternal;
  out := out || pg_temp.expect('project_cards só com os 4 gatilhos do app (o project_cards_queue_flow saiu)', r,
                               'project_cards_graph_lock,project_cards_integrity,project_cards_notify_assignee,project_cards_refresh_assigned_title');
  select coalesce(column_default, 'sem default') into r from information_schema.columns
   where table_schema = 'public' and table_name = 'project_cards' and column_name = 'sort_order';
  out := out || pg_temp.expect('sort_order sem DEFAULT', r, 'sem default');
  select pg_get_triggerdef(t.oid) into r from pg_trigger t
   where t.tgrelid = 'public.project_cards'::regclass and t.tgname = 'project_cards_graph_lock';
  out := out || pg_temp.expect('mudança no grafo espera a vez, travada por instrução (antes das linhas)', coalesce(r, 'sem gatilho'),
                               '%BEFORE INSERT OR UPDATE OF parent_card_id, depends_on ON public.project_cards FOR EACH STATEMENT%');
  select count(*)::text into r from pg_locks
   where locktype = 'advisory' and pid = pg_backend_pid() and granted
     and objid = (hashtext('cards-graph')::bigint & 4294967295)::oid;
  out := out || pg_temp.expect('a trava do grafo foi pega nesta transação (houve INSERT e mudança de dependência)', r, '1');

  raise exception using message = format(E'API-013 bloco 1: regras de cards (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;

do $bloco2$
declare
  u uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  col uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  payload jsonb;
  summary jsonb;
  out text[] := array[]::text[];
begin
  if coalesce(current_setting('akool.api013_full_restore', true), '') <> 'staging' then
    raise exception 'API-013 bloco 2: só no staging, com set_config(''akool.api013_full_restore'', ''staging'', false) na mesma sessão';
  end if;

  -- Card com responsável por share: no restore, project_cards entra antes de
  -- project_shares, e a regra do responsável quebraria sem o pulo sem usuário.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('api013-r-%s@example.invalid', tag)), (m, format('api013-m-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (u, format('api013-r-%s@example.invalid', tag), 'R', 'standard', true, 0),
    (m, format('api013-m-%s@example.invalid', tag), 'M', 'standard', true, 0);
  insert into public.project_boards (id, user_id, name) values (b, u, 'api013 restore');
  insert into public.project_columns (id, board_id, name, sort_order) values (col, b, 'A Fazer', 0);
  insert into public.project_shares (board_id, owner_id, shared_with_user_id, role) values (b, u, m, 'editor');
  insert into public.project_cards (board_id, column_id, title, sort_order, assignee_user_id, labels) values
    (b, col, 'restaurado', 4, m, '["Segurança"]');
  set local session_replication_role = origin;

  payload := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(t)) from public.profiles t where t.id in (u, m)),
    'project_boards', (select jsonb_agg(to_jsonb(t)) from public.project_boards t where t.id = b),
    'project_columns', (select jsonb_agg(to_jsonb(t)) from public.project_columns t where t.board_id = b),
    'project_shares', (select jsonb_agg(to_jsonb(t)) from public.project_shares t where t.board_id = b),
    'project_cards', (select jsonb_agg(to_jsonb(t)) from public.project_cards t where t.board_id = b)
  );

  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    summary := public.restore_site_backup(payload);
    out := out || format('%s restauração com cards conclui → project_cards: %s, sort_order: %s',
                         case when (summary ->> 'project_cards') = '1'
                                   and (select sort_order from public.project_cards where board_id = b) = 4 then 'ok   ' else 'FALHA' end,
                         summary ->> 'project_cards', (select sort_order from public.project_cards where board_id = b));
  exception when others then
    out := out || format('FALHA restauração com cards → erro %s: %s', sqlstate, sqlerrm);
  end;

  raise exception using message = format(E'API-013 bloco 2: restauração no staging (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$bloco2$;
