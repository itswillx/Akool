-- API-021: regras de Estudos no servidor (migration
-- 20261008130000_api021_study_rules).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Cada linha sai "ok" ou "FALHA", e a
-- última conta as "ok" (N/N ok).
--
-- Bloco 1 (staging e produção): começa pelo levantamento (só contagens do que
-- já está gravado e as regras novas recusariam) e segue com pessoas
-- descartáveis O (dona dos tópicos) e X (de fora, com uma linha antiga
-- pendurada no tópico de O). Dono do tópico, posição (inclusive o estouro pela
-- linha cruzada), versão, datas pelo status, cada recusa de forma e as chaves
-- aceitas, dado antigo, INSERT em lote, os payloads do app, o contexto sem
-- usuário (inclusive o conserto à mão de versão no futuro), as CHECK e a
-- estrutura.
--
-- Bloco 2 (SÓ STAGING): o restore de verdade (ele apaga as 38 tabelas antes de
-- inserir; tudo desfeito no fim) com tópico studying, quiz legado fora da
-- forma, linha cruzada e backups sem as chaves blocks e quiz. Depois, o diário
-- com study_topics invisível para quem grava (uma RESTRICTIVE de SELECT como as
-- do API-022, criada e desfeita na transação). Só com o opt-in na sessão:
--   select set_config('akool.api021_full_restore', 'staging', false);
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres.

do $bloco1$
declare
  o uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  t_o uuid := gen_random_uuid();
  t_o2 uuid := gen_random_uuid();
  t_x uuid := gen_random_uuid();
  t_f uuid := gen_random_uuid();
  k_o1 uuid := gen_random_uuid();
  k_l uuid := gen_random_uuid();
  k_m uuid := gen_random_uuid();
  k_f uuid := gen_random_uuid();
  k_x uuid := gen_random_uuid();
  k_xo uuid := gen_random_uuid();
  l_x uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  long_url text := 'https://a.b/' || repeat('x', 2036);
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

  -- Uma coluna JSON do card, como a pessoa (o app regrava a lista inteira).
  create function pg_temp.set_col(p_uid uuid, p_card uuid, p_col text, p_value jsonb)
  returns text
  language sql
  as $f$
    select pg_temp.as_user(p_uid, format('with u as (update public.study_cards set %I = %L where id = %L returning 1) select count(*)::text from u',
                                         p_col, p_value, p_card))
  $f$;

  -- 0. Levantamento (só contagens): o que já está gravado e as regras novas
  -- recusariam. Roda antes das pessoas de teste.
  select format('%s %s %s %s',
                count(*) filter (where private.study_checkpoints_problem(c.checkpoints) is not null),
                count(*) filter (where private.study_resources_problem(c.resources) is not null),
                count(*) filter (where private.study_quiz_problem(c.quiz) is not null),
                count(*) filter (where private.study_blocks_problem(c.blocks) is not null))
    into r from public.study_cards c;
  out := out || pg_temp.expect('levantamento: cards gravados fora das formas (pontos, recursos, quiz, blocos)', r, '0 0 0 0');
  select format('%s %s',
                (select count(*) from public.study_cards c
                  where not exists (select 1 from public.study_topics t where t.id = c.topic_id and t.user_id = c.user_id)),
                (select count(*) from public.study_logs l
                  where not exists (select 1 from public.study_topics t where t.id = l.topic_id and t.user_id = l.user_id)))
    into r;
  out := out || pg_temp.expect('levantamento: cards e diário em tópico de outra pessoa', r, '0 0');
  select format('%s %s', (select count(*) from public.study_cards where updated_at > now()),
                         (select count(*) from public.study_topics where updated_at > now()))
    into r;
  -- Se não der 0 0, o conserto é um UPDATE sem usuário que mude só o
  -- updated_at (o gatilho guarda o valor; seção 10):
  --   update public.study_cards set updated_at = least(updated_at, now()) where updated_at > now();
  --   update public.study_topics set updated_at = least(updated_at, now()) where updated_at > now();
  out := out || pg_temp.expect('levantamento: versões no futuro (cards, tópicos)', r, '0 0');

  -- Fixtures sem gatilhos: inclui dado antigo fora da regra (quiz de escolha
  -- sem alternativas, ponto com chave extra), a linha de X pendurada no tópico
  -- de O com sort_order no teto do integer e um card e um tópico com versão
  -- no futuro.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (o, format('api021-o-%s@example.invalid', tag)), (x, format('api021-x-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (o, format('api021-o-%s@example.invalid', tag), 'O', 'standard', true, 0),
    (x, format('api021-x-%s@example.invalid', tag), 'X', 'standard', true, 0);
  insert into public.study_topics (id, user_id, title, status, updated_at) values
    (t_o, o, 'api021 TO', 'planned', '2020-01-01'), (t_o2, o, 'api021 TO2', 'planned', '2020-01-01'),
    (t_x, x, 'api021 TX', 'planned', '2020-01-01'), (t_f, o, 'api021 TF', 'planned', '2999-01-01');
  insert into public.study_cards (id, user_id, topic_id, title, sort_order, checkpoints, quiz, updated_at) values
    (k_o1, o, t_o, 'K1', 0, '[{"id": "p1", "text": "Ler", "completed": false}]', '[]', '2020-01-01'),
    (k_l, o, t_o, 'Legado', 1, '[{"id": "p1", "text": "Ler", "completed": false, "extra": 1}]',
     '[{"kind": "choice", "id": "q1", "statement": "Sem alternativas", "answer": 0, "userAnswer": null}]', '2020-01-01'),
    (k_m, o, t_o2, 'Muda de tópico', 5, '[]', '[]', '2020-01-01'),
    (k_f, o, t_o2, 'Futuro', 0, '[]', '[]', '2999-01-01'),
    (k_x, x, t_o, 'Pendurado', 2147483647, '[]', '[]', '2020-01-01'),
    (k_xo, x, t_x, 'De X', 0, '[]', '[]', '2020-01-01');
  insert into public.study_logs (id, user_id, topic_id, content) values (l_x, x, t_x, 'diário de X');
  set local session_replication_role = origin;

  -- 1. Dono do tópico.
  r := pg_temp.as_user(x, format($q$insert into public.study_cards (user_id, topic_id, title, sort_order) values (%L, %L, 'intruso', 0)$q$, x, t_o));
  out := out || pg_temp.expect('X cria card no tópico de O', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(x, format($q$insert into public.study_cards (user_id, topic_id, title, sort_order) values (%L, %L, 'x', 0)$q$, x, gen_random_uuid()));
  out := out || pg_temp.expect('tópico que não existe: a mesma mensagem (não é 23503)', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(x, format($q$update public.study_cards set topic_id = %L where id = %L$q$, t_o, k_xo));
  out := out || pg_temp.expect('X move o próprio card para o tópico de O', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(x, format($q$update public.study_cards set user_id = %L where id = %L$q$, o, k_xo));
  out := out || pg_temp.expect('X troca o dono do próprio card', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(x, format($q$insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'x')$q$, x, t_o));
  out := out || pg_temp.expect('X escreve no diário do tópico de O', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(x, format($q$update public.study_logs set topic_id = %L where id = %L$q$, t_o, l_x));
  out := out || pg_temp.expect('X move o próprio diário para o tópico de O', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(o, format($q$with i as (insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'hoje') returning 1) select count(*)::text from i$q$, o, t_o));
  out := out || pg_temp.expect('O escreve no diário do próprio tópico', r, 'ok 1');
  r := pg_temp.as_user(o, format($q$insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'x')$q$, o, gen_random_uuid()));
  out := out || pg_temp.expect('diário em tópico que não existe: a mesma mensagem (não é 23503)', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(o, format($q$with u as (update public.study_cards set topic_id = %L where id = %L returning 1) select count(*)::text from u$q$, t_o, k_m));
  out := out || pg_temp.expect('O move card entre os próprios tópicos', r, 'ok 1');

  -- 2. Posição: só os cards do mesmo dono contam (a linha de X no tópico de O
  -- está em 2147483647; contando todo mundo, o max + 1 estouraria).
  select coalesce(max(sort_order), -1) + 1 into n from public.study_cards where topic_id = t_o and user_id = o;
  r := pg_temp.as_user(o, format($q$insert into public.study_cards (user_id, topic_id, title, updated_at) values (%L, %L, 'novo', '2001-01-01') returning sort_order::text || ' ' || (updated_at > now() - interval '1 minute')::text$q$, o, t_o));
  out := out || pg_temp.expect('card sem posição vai para o fim (só os do dono; a linha cruzada em 2147483647 não estoura); updated_at do cliente é ignorado',
                               r, format('ok %s true', n));
  select coalesce(max(sort_order), -1) + 1 into n from public.study_cards where topic_id = t_o2 and user_id = o;
  r := pg_temp.as_user(o, format($q$with i as (insert into public.study_cards (user_id, topic_id, title) values (%L, %L, 'a'), (%L, %L, 'b') returning sort_order) select string_agg(sort_order::text, ',' order by sort_order) from i$q$, o, t_o2, o, t_o2));
  out := out || pg_temp.expect('INSERT de várias linhas sem posição numera em sequência', r, format('ok %s,%s', n, n + 1));

  -- 3. Linha cruzada antiga (de antes da migration): conteúdo passa, tópico não.
  r := pg_temp.as_user(x, format($q$with u as (update public.study_cards set title = 'editado por X' where id = %L returning 1) select count(*)::text from u$q$, k_x));
  out := out || pg_temp.expect('linha cruzada antiga: X muda o conteúdo', r, 'ok 1');
  r := pg_temp.as_user(x, format($q$update public.study_cards set topic_id = %L where id = %L$q$, t_o2, k_x));
  out := out || pg_temp.expect('linha cruzada antiga: X não leva para outro tópico de O', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(x, format($q$with u as (update public.study_cards set topic_id = %L where id = %L returning 1) select count(*)::text from u$q$, t_x, k_x));
  out := out || pg_temp.expect('linha cruzada antiga: X traz para o próprio tópico (conserta)', r, 'ok 1');

  -- 4. Versão do conteúdo.
  select updated_at into ts1 from public.study_cards where id = k_o1;
  r := pg_temp.as_user(o, format($q$update public.study_cards set title = 'K1 editado', updated_at = '2001-01-01' where id = %L returning (updated_at > %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('mudar o conteúdo avança a versão (a do cliente é ignorada)', r, 'ok true');
  select updated_at into ts1 from public.study_cards where id = k_o1;
  r := pg_temp.as_user(o, format($q$update public.study_cards set title = 'K1 de novo' where id = %L returning (updated_at > %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('segunda mudança na mesma transação avança de novo', r, 'ok true');
  select updated_at into ts1 from public.study_cards where id = k_o1;
  r := pg_temp.as_user(o, format($q$update public.study_cards set title = title where id = %L returning (updated_at = %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('UPDATE com o mesmo valor mantém a versão', r, 'ok true');
  r := pg_temp.as_user(o, format($q$update public.study_cards set sort_order = 9 where id = %L returning (updated_at = %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('mudar só a ordem mantém a versão', r, 'ok true');
  r := pg_temp.as_user(o, format($q$update public.study_cards set title = 'F' where id = %L returning (updated_at = '2999-01-01'::timestamptz + interval '1 microsecond')::text$q$, k_f));
  out := out || pg_temp.expect('versão antiga no futuro só avança 1 µs (fica no futuro)', r, 'ok true');

  -- 5. Datas do tópico pelo status (o cliente não grava as datas).
  r := pg_temp.as_user(o, format($q$insert into public.study_topics (user_id, title, status, started_at, completed_at, updated_at) values (%L, 'novo', 'studying', '2001-01-01', '2001-01-01', '2001-01-01') returning format('%%s %%s %%s', started_at >= now(), completed_at is null, updated_at >= now())$q$, o));
  out := out || pg_temp.expect('INSERT studying: started_at e updated_at do servidor, completed_at nulo', r, 'ok t t t');
  r := pg_temp.as_user(o, format($q$update public.study_topics set status = 'studying', started_at = '2001-01-01', updated_at = '2001-01-01' where id = %L returning format('%%s %%s', started_at >= now(), updated_at >= now())$q$, t_o));
  out := out || pg_temp.expect('payload do updateTopic (planned → studying): started_at e updated_at do servidor', r, 'ok t t');
  select started_at into ts1 from public.study_topics where id = t_o;
  r := pg_temp.as_user(o, format($q$update public.study_topics set status = 'paused' where id = %L returning (started_at = %L::timestamptz)::text$q$, t_o, ts1));
  out := out || pg_temp.expect('studying → paused mantém started_at', r, 'ok true');
  r := pg_temp.as_user(o, format($q$update public.study_topics set status = 'completed' where id = %L returning (completed_at >= now())::text$q$, t_o));
  out := out || pg_temp.expect('paused → completed preenche completed_at', r, 'ok true');
  r := pg_temp.as_user(o, format($q$update public.study_topics set status = 'studying', completed_at = now() where id = %L returning format('%%s %%s', completed_at is null, started_at = %L::timestamptz)$q$, t_o, ts1));
  out := out || pg_temp.expect('completed → studying zera completed_at e mantém started_at', r, 'ok t t');
  r := pg_temp.as_user(o, format($q$update public.study_topics set started_at = '2001-01-01', title = 'TO renomeado' where id = %L returning (started_at = %L::timestamptz)::text$q$, t_o, ts1));
  out := out || pg_temp.expect('started_at mandado sem mudar o status não muda', r, 'ok true');
  r := pg_temp.as_user(o, format($q$update public.study_topics set status = 'completed' where id = %L returning format('%%s %%s', started_at is null, completed_at is not null)$q$, t_o2));
  out := out || pg_temp.expect('planned → completed direto deixa started_at nulo (como o app)', r, 'ok t t');

  -- 6. Forma: cada recusa (23514, hint akool), com o índice e sem repetir o conteúdo.
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '{}');
  out := out || pg_temp.expect('pontos: objeto no lugar da lista', r, 'erro 23514: Pontos de estudo fora do formato: não é uma lista');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '[{"id": "a", "text": "ok", "completed": false}, null]');
  out := out || pg_temp.expect('pontos: item que não é objeto (índice a partir de 0)', r, 'erro 23514: Pontos de estudo fora do formato: item 1 não é objeto');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '[{"id": "a", "text": "x"}]');
  out := out || pg_temp.expect('pontos: sem completed', r, 'erro 23514: Pontos de estudo fora do formato: item 0: completed é true ou false');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '[{"id": "a", "text": "x", "completed": false, "extra": 1}]');
  out := out || pg_temp.expect('pontos: chave desconhecida', r, 'erro 23514: Pontos de estudo fora do formato: item 0: as chaves aceitas%');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '[{"id": "a", "text": "   ", "completed": false}]');
  out := out || pg_temp.expect('pontos: texto em branco', r, 'erro 23514: Pontos de estudo fora do formato: item 0: text é texto de 1 a 2000%');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', jsonb_build_array(jsonb_build_object('id', 'a', 'text', repeat('t', 2001), 'completed', false)));
  out := out || pg_temp.expect('pontos: texto com 2001 caracteres', r, 'erro 23514: Pontos de estudo fora do formato: item 0: text é texto de 1 a 2000%');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', jsonb_build_array(jsonb_build_object('id', 'a', 'text', 'x', 'completed', false, 'note', repeat('n', 5001))));
  out := out || pg_temp.expect('pontos: nota com 5001 caracteres', r, 'erro 23514: Pontos de estudo fora do formato: item 0: note é texto de até 5000%');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', (select jsonb_agg(jsonb_build_object('id', 'p' || i, 'text', 't', 'completed', false)) from generate_series(1, 201) i));
  out := out || pg_temp.expect('pontos: 201 itens', r, 'erro 23514: Pontos de estudo fora do formato: mais de 200 itens');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '[{"id": "a", "text": "x", "completed": false}, {"id": "a", "text": "y", "completed": true}]');
  out := out || pg_temp.expect('pontos: ids repetidos', r, 'erro 23514: Pontos de estudo fora do formato: ids repetidos');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', (select jsonb_agg(jsonb_build_object('id', 'p' || i, 'text', repeat('é', 1000), 'completed', false)) from generate_series(1, 150) i));
  out := out || pg_temp.expect('pontos: lista acima de 256 KiB', r, 'erro 23514: Pontos de estudo fora do formato: a lista passa de 256 KiB');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', (select jsonb_agg(jsonb_build_object('id', 'p' || i, 'text', 'ponto ' || i, 'completed', i % 2 = 0)) from generate_series(1, 200) i));
  out := out || pg_temp.expect('pontos: 200 itens são aceitos', r, 'ok 1');

  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "x", "url": "javascript:alert(1)"}]');
  out := out || pg_temp.expect('recursos: javascript:', r, 'erro 23514: Recursos fora do formato: item 0: url é http(s)%');
  out := out || pg_temp.expect('recursos: a mensagem não repete a URL', (position('alert' in r) = 0)::text, 'true');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "x", "url": "data:text/html,x"}]');
  out := out || pg_temp.expect('recursos: data:', r, 'erro 23514: Recursos fora do formato: item 0: url%');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "x", "url": "https://a b.com"}]');
  out := out || pg_temp.expect('recursos: URL com espaço', r, 'erro 23514: Recursos fora do formato: item 0: url%');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "x", "url": "https://"}]');
  out := out || pg_temp.expect('recursos: "https://" vazio', r, 'erro 23514: Recursos fora do formato: item 0: url%');
  r := pg_temp.set_col(o, k_o1, 'resources', jsonb_build_array(jsonb_build_object('id', 'r', 'title', 'x', 'url', long_url || 'x')));
  out := out || pg_temp.expect('recursos: URL com 2049 caracteres', r, 'erro 23514: Recursos fora do formato: item 0: url%');
  r := pg_temp.set_col(o, k_o1, 'resources', jsonb_build_array(jsonb_build_object('id', 'r', 'title', repeat('t', 2049), 'url', 'https://a.b')));
  out := out || pg_temp.expect('recursos: título com 2049 caracteres', r, 'erro 23514: Recursos fora do formato: item 0: title é texto de até 2048%');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "x", "url": "https://a.b", "size": 1}]');
  out := out || pg_temp.expect('recursos: chave desconhecida', r, 'erro 23514: Recursos fora do formato: item 0: as chaves aceitas%');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "x", "url": "https://a.b", "licenseUrl": "javascript:x"}]');
  out := out || pg_temp.expect('recursos: licenseUrl fora de http(s)', r, 'erro 23514: Recursos fora do formato: item 0: licenseUrl é http(s)%');
  r := pg_temp.set_col(o, k_o1, 'resources', (select jsonb_agg(jsonb_build_object('id', 'r' || i, 'title', 't', 'url', 'https://a.b')) from generate_series(1, 51) i));
  out := out || pg_temp.expect('recursos: 51 itens', r, 'erro 23514: Recursos fora do formato: mais de 50 itens');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r", "title": "a", "url": "https://a.b"}, {"id": "r", "title": "b", "url": "https://b.c"}]');
  out := out || pg_temp.expect('recursos: ids repetidos', r, 'erro 23514: Recursos fora do formato: ids repetidos');
  r := pg_temp.set_col(o, k_o1, 'resources', '[{"id": "r1", "title": "Wiki", "url": "https://pt.wikipedia.org/wiki/X", "license": "CC BY-SA 4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0"}, {"id": "r2", "title": "", "url": "HTTPS://OK.EXAMPLE", "license": null, "licenseUrl": null}]');
  out := out || pg_temp.expect('recursos: license e licenseUrl aceitos, título vazio e HTTPS maiúsculo também', r, 'ok 1');

  r := pg_temp.set_col(o, k_o1, 'quiz', '{}');
  out := out || pg_temp.expect('quiz: objeto no lugar da lista', r, 'erro 23514: Quiz fora do formato: não é uma lista');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "choice", "id": "q", "statement": "s", "answer": 0, "userAnswer": null}]');
  out := out || pg_temp.expect('quiz: escolha sem alternativas', r, 'erro 23514: Quiz fora do formato: pergunta 0: options é uma lista de 2 a 10%');
  r := pg_temp.set_col(o, k_o1, 'quiz', jsonb_build_array(jsonb_build_object('kind', 'choice', 'id', 'q', 'statement', 's', 'answer', 0, 'options', (select jsonb_agg('op' || i) from generate_series(1, 11) i))));
  out := out || pg_temp.expect('quiz: 11 alternativas', r, 'erro 23514: Quiz fora do formato: pergunta 0: options é uma lista de 2 a 10%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "choice", "id": "q", "statement": "s", "answer": 0, "options": ["só uma"]}]');
  out := out || pg_temp.expect('quiz: 1 alternativa', r, 'erro 23514: Quiz fora do formato: pergunta 0: options é uma lista de 2 a 10%');
  r := pg_temp.set_col(o, k_o1, 'quiz', jsonb_build_array(jsonb_build_object('kind', 'choice', 'id', 'q', 'statement', 's', 'answer', 0, 'options', jsonb_build_array('a', repeat('o', 1001)))));
  out := out || pg_temp.expect('quiz: alternativa com 1001 caracteres', r, 'erro 23514: Quiz fora do formato: pergunta 0: cada alternativa%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "choice", "id": "q", "statement": "s", "answer": 4, "options": ["a", "b", "c", "d"]}]');
  out := out || pg_temp.expect('quiz: answer 4 com 4 alternativas', r, 'erro 23514: Quiz fora do formato: pergunta 0: answer é o índice%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "choice", "id": "q", "statement": "s", "answer": "0", "options": ["a", "b"]}]');
  out := out || pg_temp.expect('quiz: answer "0" em texto', r, 'erro 23514: Quiz fora do formato: pergunta 0: answer é o índice%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "choice", "id": "q", "statement": "s", "answer": 0, "userAnswer": 9, "options": ["a", "b"]}]');
  out := out || pg_temp.expect('quiz: userAnswer 9', r, 'erro 23514: Quiz fora do formato: pergunta 0: userAnswer é null ou o índice%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"id": "q", "statement": "s", "answer": "talvez", "userAnswer": null}]');
  out := out || pg_temp.expect('quiz: Certo/Errado com answer "talvez"', r, 'erro 23514: Quiz fora do formato: pergunta 0: answer é certo ou errado');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"id": "q", "statement": "s", "answer": "certo", "userAnswer": "sim"}]');
  out := out || pg_temp.expect('quiz: Certo/Errado com userAnswer "sim"', r, 'erro 23514: Quiz fora do formato: pergunta 0: userAnswer é null, certo ou errado');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": null, "id": "q", "statement": "s", "answer": "certo"}]');
  out := out || pg_temp.expect('quiz: kind null', r, 'erro 23514: Quiz fora do formato: pergunta 0: kind é boolean ou choice%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "aberta", "id": "q", "statement": "s", "answer": "certo"}]');
  out := out || pg_temp.expect('quiz: kind desconhecido', r, 'erro 23514: Quiz fora do formato: pergunta 0: kind é boolean ou choice%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"id": "q", "statement": " ", "answer": "certo"}]');
  out := out || pg_temp.expect('quiz: enunciado em branco', r, 'erro 23514: Quiz fora do formato: pergunta 0: statement é texto de 1 a 2000%');
  r := pg_temp.set_col(o, k_o1, 'quiz', jsonb_build_array(jsonb_build_object('id', 'q', 'statement', 's', 'answer', 'certo', 'explanation', repeat('e', 4001))));
  out := out || pg_temp.expect('quiz: justificativa com 4001 caracteres', r, 'erro 23514: Quiz fora do formato: pergunta 0: explanation é texto de até 4000%');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"id": "q", "statement": "s", "answer": "certo", "options": ["a", "b"]}]');
  out := out || pg_temp.expect('quiz: options em pergunta Certo/Errado', r, 'erro 23514: Quiz fora do formato: pergunta 0: as chaves aceitas%');
  r := pg_temp.set_col(o, k_o1, 'quiz', (select jsonb_agg(jsonb_build_object('id', 'q' || i, 'statement', 's', 'answer', 'certo')) from generate_series(1, 101) i));
  out := out || pg_temp.expect('quiz: 101 perguntas', r, 'erro 23514: Quiz fora do formato: mais de 100 perguntas');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"id": "q", "statement": "a", "answer": "certo"}, {"id": "q", "statement": "b", "answer": "errado"}]');
  out := out || pg_temp.expect('quiz: ids repetidos', r, 'erro 23514: Quiz fora do formato: ids repetidos');
  r := pg_temp.set_col(o, k_o1, 'quiz', '[{"kind": "boolean", "id": "q1", "statement": "s", "answer": "errado", "userAnswer": "certo", "explanation": null}, {"kind": "choice", "id": "q2", "statement": "s", "options": ["a", "b"], "answer": 1, "userAnswer": 0}]');
  out := out || pg_temp.expect('quiz: kind boolean explícito, explanation null e escolha respondida aceitos', r, 'ok 1');

  r := pg_temp.set_col(o, k_o1, 'blocks', '[{"id": "b", "kind": "Exemplo", "body": "x"}]');
  out := out || pg_temp.expect('blocos: kind com maiúscula', r, 'erro 23514: Blocos fora do formato: bloco 0: kind é um nome%');
  r := pg_temp.set_col(o, k_o1, 'blocks', jsonb_build_array(jsonb_build_object('id', 'b', 'kind', 'a' || repeat('b', 32), 'body', 'x')));
  out := out || pg_temp.expect('blocos: kind com 33 caracteres', r, 'erro 23514: Blocos fora do formato: bloco 0: kind é um nome%');
  r := pg_temp.set_col(o, k_o1, 'blocks', jsonb_build_array(jsonb_build_object('id', 'b', 'kind', 'note', 'title', repeat('t', 201), 'body', 'x')));
  out := out || pg_temp.expect('blocos: título com 201 caracteres', r, 'erro 23514: Blocos fora do formato: bloco 0: title é texto de até 200%');
  r := pg_temp.set_col(o, k_o1, 'blocks', jsonb_build_array(jsonb_build_object('id', 'b', 'kind', 'note', 'body', repeat('b', 20001))));
  out := out || pg_temp.expect('blocos: body com 20001 caracteres', r, 'erro 23514: Blocos fora do formato: bloco 0: body é texto de até 20000%');
  r := pg_temp.set_col(o, k_o1, 'blocks', '[{"id": "b", "kind": "note"}]');
  out := out || pg_temp.expect('blocos: sem body', r, 'erro 23514: Blocos fora do formato: bloco 0: body%');
  r := pg_temp.set_col(o, k_o1, 'blocks', (select jsonb_agg(jsonb_build_object('id', 'b' || i, 'kind', 'note', 'body', 'x')) from generate_series(1, 51) i));
  out := out || pg_temp.expect('blocos: 51 blocos', r, 'erro 23514: Blocos fora do formato: mais de 50 blocos');
  r := pg_temp.set_col(o, k_o1, 'blocks', '[{"id": "b1", "kind": "novo_tipo-2", "title": "T", "body": "**x**", "reveal": "y"}, {"id": "b2", "kind": "example", "body": ""}]');
  out := out || pg_temp.expect('blocos: kind novo (token) aceito, como manda 20260830150627', r, 'ok 1');

  -- 7. Dado antigo fora da regra: só o que muda é conferido.
  r := pg_temp.as_user(o, format($q$with u as (update public.study_cards set title = 'Legado editado' where id = %L returning 1) select count(*)::text from u$q$, k_l));
  out := out || pg_temp.expect('card antigo com quiz e pontos fora da forma: mudar o título passa', r, 'ok 1');
  r := pg_temp.set_col(o, k_l, 'quiz', '[{"kind": "choice", "id": "q1", "statement": "Sem alternativas", "answer": 0, "userAnswer": 0}]');
  out := out || pg_temp.expect('card antigo: responder a pergunta fora da forma é recusado (a lista inteira é conferida)', r, 'erro 23514: Quiz fora do formato%');
  r := pg_temp.set_col(o, k_l, 'checkpoints', '[{"id": "p1", "text": "Ler", "completed": true}]');
  out := out || pg_temp.expect('card antigo: pontos regravados na forma passam', r, 'ok 1');

  -- 8. INSERT em lote é tudo ou nada (a importação do app manda um INSERT só).
  select count(*) into n from public.study_cards where topic_id = t_o2;
  r := pg_temp.as_user(o, format($q$insert into public.study_cards (user_id, topic_id, title, sort_order, quiz) values (%L, %L, 'a', 10, '[]'), (%L, %L, 'b', 11, '[{"id": "q", "statement": "s", "answer": "talvez"}]'), (%L, %L, 'c', 12, '[]')$q$, o, t_o2, o, t_o2, o, t_o2));
  out := out || pg_temp.expect('lote com uma linha inválida falha inteiro', r, 'erro 23514: Quiz fora do formato: pergunta 0%');
  select count(*)::text into r from public.study_cards where topic_id = t_o2;
  out := out || pg_temp.expect('nenhuma linha do lote ficou', r, n::text);

  -- 9. Payloads iguais aos do app.
  r := pg_temp.as_user(o, format($q$with i as (insert into public.study_cards (user_id, topic_id, title, description, rationale, checkpoints, resources, quiz, sort_order, due_date) values (%L, %L, 'Do parser', 'Descrição', 'Ponto de partida', %L, %L, %L, 20, null) returning 1) select count(*)::text from i$q$,
         o, t_o2,
         jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Ler o capítulo', 'completed', false),
                           jsonb_build_object('id', gen_random_uuid()::text, 'text', 'Fazer os exercícios', 'completed', true)),
         jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Docs', 'url', 'https://example.com'),
                           jsonb_build_object('id', gen_random_uuid()::text, 'title', 'https://www.totaltypescript.com', 'url', 'https://www.totaltypescript.com')),
         jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'statement', 'O Brasil fica na América do Sul.', 'answer', 'certo', 'userAnswer', null, 'explanation', 'Localização.'),
                           jsonb_build_object('kind', 'choice', 'id', gen_random_uuid()::text, 'statement', 'Capital do Brasil?', 'options', jsonb_build_array('São Paulo', 'Brasília', 'Rio', 'Salvador'), 'answer', 1, 'userAnswer', null, 'explanation', 'Desde 1960.'))));
  out := out || pg_temp.expect('insertCards do parser (Certo/Errado sem kind, escolha, justificativas)', r, 'ok 1');
  r := pg_temp.as_user(o, format($q$with i as (insert into public.study_cards (user_id, topic_id, title, description, rationale, checkpoints, resources, quiz, sort_order) values (%L, %L, '', '', '', '[]', '[]', '[]', 21) returning 1) select count(*)::text from i$q$, o, t_o2));
  out := out || pg_temp.expect('createCard (card em branco)', r, 'ok 1');
  r := pg_temp.set_col(o, k_o1, 'resources', jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'title', substr(long_url, 9), 'url', long_url)));
  out := out || pg_temp.expect('addResource com URL de 2048 e título derivado dela', r, 'ok 1');
  r := pg_temp.set_col(o, k_o1, 'checkpoints', '[{"id": "p1", "text": "Ler", "completed": false, "note": "anotação"}]');
  out := out || pg_temp.expect('nota num ponto (updateCheckpointNote)', r, 'ok 1');
  select updated_at into ts1 from public.study_cards where id = k_o1;
  r := pg_temp.as_user(o, format($q$update public.study_cards set quiz = '[{"id": "q1", "statement": "s", "answer": "certo", "userAnswer": "errado"}]', updated_at = '2001-01-01' where id = %L returning (updated_at > %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('updateCard (resposta do quiz com o updated_at do cliente)', r, 'ok true');
  r := pg_temp.as_user(o, format($q$with u as (update public.study_cards set due_date = '2030-01-01', updated_at = '2001-01-01' where id = %L returning updated_at) select (updated_at > now() - interval '1 minute')::text from u$q$, k_o1));
  out := out || pg_temp.expect('reschedule (due_date e updated_at do cliente)', r, 'ok true');

  -- 10. Sem usuário (restore, SQL pelo MCP): guarda os valores e completa os nulos.
  select coalesce(max(sort_order), -1) + 1 into n from public.study_cards where topic_id = t_o2 and user_id = o;
  r := pg_temp.try(null, format($q$insert into public.study_cards (user_id, topic_id, title, checkpoints, resources, quiz, blocks, rationale, updated_at) values (%L, %L, 'restore', null, null, '[{"kind": "choice"}]', null, null, '2020-01-01') returning format('%%s %%s %%s %%s', sort_order, updated_at = '2020-01-01'::timestamptz, blocks = '[]'::jsonb and checkpoints = '[]'::jsonb and resources = '[]'::jsonb, rationale = '')$q$, o, t_o2));
  out := out || pg_temp.expect('sem claims: forma pula, posição vai para o fim, updated_at guardado e nulos completados', r, format('ok %s t t t', n));
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.study_topics (user_id, title, status, started_at, updated_at) values (%L, 'restore', 'studying', '2020-01-01', '2020-01-02') returning format('%%s %%s', started_at = '2020-01-01'::timestamptz, updated_at = '2020-01-02'::timestamptz)$q$, o));
  out := out || pg_temp.expect('service_role sem sub: tópico guarda as datas do backup', r, 'ok t t');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.study_cards (user_id, topic_id, title, sort_order) values (%L, %L, 'cruzada do backup', 3) returning 'ok'$q$, x, t_o));
  out := out || pg_temp.expect('service_role sem sub: linha cruzada do backup entra (o restore não valida dono)', r, 'ok ok');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$update public.study_topics set started_at = '2020-05-05' where id = %L returning (started_at = '2020-05-05'::timestamptz)::text$q$, t_o2));
  out := out || pg_temp.expect('service_role sem sub: data do tópico corrigida à mão fica', r, 'ok true');
  r := pg_temp.try(jsonb_build_object('role', 'authenticated'), format($q$insert into public.study_cards (user_id, topic_id, title, sort_order) values (%L, %L, 'x', 0)$q$, o, t_o));
  out := out || pg_temp.expect('JWT authenticated sem sub continua conferido', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.try(jsonb_build_object('role', 'anon'), format($q$insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'x')$q$, o, t_o));
  out := out || pg_temp.expect('JWT anon sem sub continua conferido (diário)', r, 'erro P0002: Tópico não encontrado');

  -- Conserto à mão de versão no futuro: sem usuário, um UPDATE que mude só o
  -- updated_at guarda o valor. Com usuário, ou mudando outra coluna, a versão
  -- continua do servidor.
  r := pg_temp.try(null, format($q$with u as (update public.study_cards set updated_at = least(updated_at, now()) where id = %L and updated_at > now() returning updated_at) select format('%%s %%s', count(*), bool_and(updated_at = now())) from u$q$, k_f));
  out := out || pg_temp.expect('sem claims, conserto da versão no futuro do card (só updated_at) fica', r, 'ok 1 t');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$with u as (update public.study_topics set updated_at = least(updated_at, now()) where id = %L and updated_at > now() returning updated_at) select format('%%s %%s', count(*), bool_and(updated_at = now())) from u$q$, t_f));
  out := out || pg_temp.expect('service_role sem sub, conserto da versão no futuro do tópico (só updated_at) fica', r, 'ok 1 t');
  select updated_at into ts1 from public.study_cards where id = k_o1;
  r := pg_temp.as_user(o, format($q$update public.study_cards set updated_at = '2001-01-01' where id = %L returning (updated_at = %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('com usuário, só o updated_at no UPDATE do card é ignorado', r, 'ok true');
  r := pg_temp.try(null, format($q$update public.study_cards set sort_order = 50, updated_at = '2001-01-01' where id = %L returning (updated_at = %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('sem claims, ordem e updated_at juntos: não é só a versão, ela fica a do servidor', r, 'ok true');
  r := pg_temp.try(null, format($q$update public.study_cards set title = 'pelo MCP', updated_at = '2001-01-01' where id = %L returning (updated_at > %L::timestamptz)::text$q$, k_o1, ts1));
  out := out || pg_temp.expect('sem claims, mudar o conteúdo do card continua com a versão do servidor', r, 'ok true');
  select updated_at into ts1 from public.study_topics where id = t_o;
  r := pg_temp.as_user(o, format($q$update public.study_topics set updated_at = '2001-01-01' where id = %L returning (updated_at = %L::timestamptz)::text$q$, t_o, ts1));
  out := out || pg_temp.expect('com usuário, só o updated_at no UPDATE do tópico é ignorado', r, 'ok true');
  r := pg_temp.try(null, format($q$update public.study_topics set title = 'pelo MCP', updated_at = '2001-01-01' where id = %L returning (updated_at > %L::timestamptz)::text$q$, t_o, ts1));
  out := out || pg_temp.expect('sem claims, mudar o conteúdo do tópico continua com a versão do servidor', r, 'ok true');

  -- 11. CHECK: valem também sem usuário.
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.study_cards (user_id, topic_id, title, sort_order, resources) values (%L, %L, 'x', 0, '[{"id": "r", "title": "x", "url": "javascript:alert(1)"}]')$q$, o, t_o2));
  out := out || pg_temp.expect('service_role com javascript: é recusado pela CHECK', r, 'erro 23514: %study_cards_resources_safe%');
  r := pg_temp.try(null, format($q$update public.study_cards set resources = '[{"id": "r", "title": "x", "url": "data:text/html,x"}]' where id = %L$q$, k_o1));
  out := out || pg_temp.expect('sem claims, UPDATE com data: é recusado pela CHECK', r, 'erro 23514: %study_cards_resources_safe%');
  r := pg_temp.try(null, format($q$insert into public.study_cards (user_id, topic_id, title, sort_order, quiz) values (%L, %L, 'x', 0, '{}')$q$, o, t_o2));
  out := out || pg_temp.expect('sem claims, quiz que não é lista é recusado pela CHECK', r, 'erro 23514: %study_cards_json_arrays%');

  -- 12. Projeção só do conteúdo (API-022/034).
  select format('%s %s %s',
                private.study_without_progress('[{"id": "1", "text": "a", "completed": false}]') = private.study_without_progress('[{"id": "1", "text": "a", "completed": true}]'),
                private.study_without_progress('[{"id": "q", "statement": "s", "answer": "certo", "userAnswer": null}]') = private.study_without_progress('[{"id": "q", "statement": "s", "answer": "certo", "userAnswer": "errado"}]'),
                private.study_without_progress('[{"id": "1", "text": "a", "completed": false}]') = private.study_without_progress('[{"id": "1", "text": "b", "completed": false}]'))
    into r;
  out := out || pg_temp.expect('projeção sem progresso: marcar e responder não mudam, mudar o texto muda', r, 't t f');

  -- 13. Estrutura.
  select string_agg(format('%s %s %s', p.proname, p.prosecdef, array_to_string(p.proconfig, ',')), ' | ' order by p.proname) into r
    from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname in ('study_card_rules', 'study_topic_rules', 'study_log_rules');
  out := out || pg_temp.expect('gatilhos: cards e diário DEFINER, tópicos INVOKER, search_path vazio', r,
                               'study_card_rules t search_path="" | study_log_rules t search_path="" | study_topic_rules f search_path=""');
  select string_agg(t.tgname || ' ' || c.relname, ', ' order by t.tgname) into r
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where t.tgname in ('study_cards_rules', 'study_topics_rules', 'study_logs_rules') and not t.tgisinternal;
  out := out || pg_temp.expect('os três gatilhos existem', r, 'study_cards_rules study_cards, study_logs_rules study_logs, study_topics_rules study_topics');
  select coalesce(column_default, 'sem default') into r from information_schema.columns
   where table_schema = 'public' and table_name = 'study_cards' and column_name = 'sort_order';
  out := out || pg_temp.expect('sort_order sem DEFAULT', r, 'sem default');
  select count(*)::text into r
    from pg_proc p cross join (values ('anon'), ('authenticated')) as g(role)
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('study_json_index', 'study_checkpoints_problem', 'study_resources_problem', 'study_quiz_problem',
                       'study_blocks_problem', 'study_without_progress', 'study_card_rules', 'study_topic_rules', 'study_log_rules')
     and has_function_privilege(g.role, p.oid, 'EXECUTE');
  out := out || pg_temp.expect('nenhuma função nova executável por anon ou authenticated', r, '0');
  select string_agg(conname || ' ' || convalidated, ', ' order by conname) into r
    from pg_constraint where conrelid = 'public.study_cards'::regclass and contype = 'c';
  out := out || pg_temp.expect('CHECK validadas', r, 'study_cards_json_arrays true, study_cards_resources_safe true');
  select format('%s %s', has_function_privilege('authenticated', 'private.card_links_are_safe(jsonb)', 'EXECUTE'),
                         has_function_privilege('service_role', 'private.card_links_are_safe(jsonb)', 'EXECUTE'))
    into r;
  out := out || pg_temp.expect('a função da CHECK continua executável por authenticated e service_role', r, 't t');

  raise exception using message = format(E'API-021 bloco 1: regras de Estudos (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;

do $bloco2$
declare
  u uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  c3 uuid := gen_random_uuid();
  cx uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  legacy_quiz jsonb := '[{"id": "q1", "statement": "Antiga", "answer": "certo", "userAnswer": "certo"}, {"kind": "choice", "id": "q2", "statement": "Sem alternativas", "answer": 0, "userAnswer": null}]';
  payload jsonb;
  summary jsonb;
  r text;
  out text[] := array[]::text[];
begin
  if coalesce(current_setting('akool.api021_full_restore', true), '') <> 'staging' then
    raise exception 'API-021 bloco 2: só no staging, com set_config(''akool.api021_full_restore'', ''staging'', false) na mesma sessão';
  end if;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 160))
  $f$;

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

  -- Tópico studying e outro concluído com datas antigas, card com quiz legado
  -- fora da forma e sort_order 7, card e diário de X pendurados no tópico de U.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('api021-r-%s@example.invalid', tag)), (x, format('api021-rx-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (u, format('api021-r-%s@example.invalid', tag), 'R', 'standard', true, 0),
    (x, format('api021-rx-%s@example.invalid', tag), 'RX', 'standard', true, 0);
  insert into public.study_topics (id, user_id, title, status, started_at, completed_at, updated_at) values
    (t1, u, 'api021 restore', 'studying', '2020-02-02', null, '2020-03-03'),
    (t2, u, 'api021 concluído', 'completed', '2020-01-01', '2020-04-04', '2020-04-05');
  insert into public.study_cards (id, user_id, topic_id, title, sort_order, quiz, blocks, rationale, updated_at) values
    (c1, u, t1, 'Quiz legado', 7, legacy_quiz, '[]', '', '2020-03-01'),
    (c2, u, t1, 'Sem blocks no backup', 8, '[]', '[{"id": "b1", "kind": "example", "body": "x"}]', 'r', '2020-03-01'),
    (c3, u, t2, 'Backup anterior ao quiz', 0, '[]', '[]', '', '2020-03-01'),
    (cx, x, t1, 'Cruzado', 3, '[]', '[]', '', '2020-03-01');
  insert into public.study_logs (user_id, topic_id, content) values (u, t1, 'diário'), (x, t1, 'cruzado');
  set local session_replication_role = origin;

  -- O backup guarda as linhas inteiras (to_jsonb); os dois mais antigos não
  -- tinham as chaves blocks (antes de 20260830150627) e quiz/rationale (antes
  -- de 20260720140000/20260721120000).
  payload := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(t)) from public.profiles t where t.id in (u, x)),
    'study_topics', (select jsonb_agg(to_jsonb(t)) from public.study_topics t where t.user_id = u),
    'study_cards', jsonb_build_array(
      (select to_jsonb(c) from public.study_cards c where c.id = c1),
      (select to_jsonb(c) - 'blocks' from public.study_cards c where c.id = c2),
      (select to_jsonb(c) - array['quiz', 'rationale', 'blocks'] from public.study_cards c where c.id = c3),
      (select to_jsonb(c) from public.study_cards c where c.id = cx)),
    'study_logs', (select jsonb_agg(to_jsonb(l)) from public.study_logs l where l.topic_id = t1)
  );

  -- Como a edge function site-backup chama: service_role, sem usuário.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    summary := public.restore_site_backup(payload);
    out := out || pg_temp.expect('restauração conclui (tópicos, cards, diário)',
                                 format('%s %s %s', summary ->> 'study_topics', summary ->> 'study_cards', summary ->> 'study_logs'), '2 4 2');
    select format('%s %s %s', t.status, t.started_at = '2020-02-02'::timestamptz, t.updated_at = '2020-03-03'::timestamptz) into r
      from public.study_topics t where t.id = t1;
    out := out || pg_temp.expect('tópico studying guarda status, started_at e updated_at do backup', r, 'studying t t');
    select format('%s %s', t.completed_at = '2020-04-04'::timestamptz, t.updated_at = '2020-04-05'::timestamptz) into r
      from public.study_topics t where t.id = t2;
    out := out || pg_temp.expect('tópico concluído guarda completed_at e updated_at', r, 't t');
    select format('%s %s %s', c.sort_order, c.quiz = legacy_quiz, c.updated_at = '2020-03-01'::timestamptz) into r
      from public.study_cards c where c.id = c1;
    out := out || pg_temp.expect('card com quiz legado fora da forma volta igual (sort_order 7 e versão do backup)', r, '7 t t');
    select format('%s %s', c.blocks, c.rationale) into r from public.study_cards c where c.id = c2;
    out := out || pg_temp.expect('backup sem a chave blocks: blocks vira []', r, '[] r');
    select format('%s %s %s', c.quiz, c.rationale = '', c.blocks) into r from public.study_cards c where c.id = c3;
    out := out || pg_temp.expect('backup sem quiz, rationale e blocks: [], vazio e []', r, '[] t []');
    select format('%s %s', (select count(*) from public.study_cards where id = cx), (select count(*) from public.study_logs where user_id = x)) into r;
    out := out || pg_temp.expect('linha cruzada do backup volta (o restore não valida dono)', r, '1 1');
  exception when others then
    out := out || format('FALHA restauração → erro %s: %s', sqlstate, sqlerrm);
  end;

  -- Diário com study_topics invisível para quem grava: uma RESTRICTIVE de
  -- SELECT que nega tudo, como a do API-022 para um token só com
  -- estudos.diario (criada aqui e desfeita com o resto). O gatilho do diário é
  -- DEFINER e lê o tópico por cima do RLS: o dono grava, e o tópico alheio e o
  -- inexistente continuam com o mesmo P0002.
  create policy api021_check_sem_leitura on public.study_topics as restrictive for select to authenticated using (false);
  r := pg_temp.as_user(u, 'select count(*)::text from public.study_topics');
  out := out || pg_temp.expect('com a RESTRICTIVE, quem grava não enxerga os próprios tópicos', r, 'ok 0');
  r := pg_temp.as_user(u, format($q$with i as (insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'só diário') returning 1) select count(*)::text from i$q$, u, t1));
  out := out || pg_temp.expect('sem ler study_topics, o dono grava diário no próprio tópico', r, 'ok 1');
  r := pg_temp.as_user(u, format($q$with i as (insert into public.study_cards (user_id, topic_id, title) values (%L, %L, 'só card') returning 1) select count(*)::text from i$q$, u, t1));
  out := out || pg_temp.expect('sem ler study_topics, o card no próprio tópico também passa', r, 'ok 1');
  r := pg_temp.as_user(x, format($q$insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'x')$q$, x, t1));
  out := out || pg_temp.expect('sem ler study_topics, diário no tópico alheio continua recusado', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(u, format($q$insert into public.study_logs (user_id, topic_id, content) values (%L, %L, 'x')$q$, u, gen_random_uuid()));
  out := out || pg_temp.expect('sem ler study_topics, diário em tópico inexistente dá o mesmo P0002', r, 'erro P0002: Tópico não encontrado');

  raise exception using message = format(E'API-021 bloco 2: restauração e diário sem leitura de tópicos, no staging (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco2$;
