-- API-024: RPCs de Estudos por item, importação atômica e reagendamento
-- (migration 20261011120000_api024_study_rpcs).
--
-- Três blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Cada linha sai "ok" ou "FALHA", e a
-- última conta as "ok" (N/N ok). Rode cada bloco numa chamada própria.
--
-- Bloco 1 (staging e produção): começa pelo levantamento (só contagens) e
-- segue com pessoas descartáveis O (dona) e X (de fora). Cada RPC por item
-- mexe só no item e repete sem gravar (nem a versão muda nem nasce tupla
-- nova: o xmin da linha fica); remover item ausente dá P0002; a
-- segunda resposta diferente dá P0001; anexar e importar são tudo ou nada,
-- com "cards/N: " (N a partir de 0); os vetores de resource_add batem com o
-- resourceFromInput da tela e os de reagendamento com o distributeDueDates
-- (os dois conjuntos são lidos também pelo vitest, em
-- src/modules/study/studyRpcParity.test.ts e src/lib/studySchedule.test.ts);
-- p_today a mais de 1 dia de São Paulo dá
-- 22023, e ±infinity também (no p_today e na data-alvo, nunca o 22008 da
-- subtração); e a estrutura (11 RPCs INVOKER, search_path vazio, EXECUTE só para
-- authenticated, akool_api por herança quando o papel existir).
--
-- Subtransações (staging e produção): um append de 70 cards como
-- authenticated, sem nenhum EXCEPTION em volta, abre uma subtransação só
-- (pg_stat_get_backend_subxact: 1, overflowed f). O controle no fim prova que
-- a medida enxerga o estouro. Fica à parte porque os wrappers do bloco 1 abrem
-- uma subtransação por caso e estourariam o cache sozinhos.
--
-- Bloco 2 (SÓ STAGING): uma RESTRICTIVE de SELECT em study_topics, como a do
-- API-022 para um token sem leitura de tópicos (criada e desfeita na
-- transação). Toggle, resposta e reset continuam (só tocam study_cards);
-- append, reagendamento e importação falham fechados. Evidência para o API-022.
-- Só com o opt-in na sessão:
--   select set_config('akool.api024_rls_sim', 'staging', false);
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres, depois da
-- migration (ou, no ensaio, com o corpo da migration no começo do bloco).

do $bloco1$
declare
  o uuid := gen_random_uuid();
  x uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  tx uuid := gen_random_uuid();
  tc uuid := gen_random_uuid();
  k uuid := gen_random_uuid();
  kl uuid := gen_random_uuid();
  kr uuid := gen_random_uuid();
  kx uuid := gen_random_uuid();
  tv uuid;
  tag text := substr(md5(random()::text), 1, 6);
  sp date := (now() at time zone 'America/Sao_Paulo')::date;
  -- Reagendamento: [span = meta - hoje, n cards, prazo de cada card - hoje],
  -- gerados pelo distributeDueDates do app (src/lib/studySchedule.test.ts
  -- confere cada um contra ele).
  vec jsonb := '[
    [28, 4, [7, 14, 21, 28]],
    [10, 3, [3, 7, 10]],
    [28, 1, [28]],
    [0, 3, [0, 0, 0]],
    [-10, 2, [-10, -10]],
    [2, 5, [0, 1, 1, 2, 2]],
    [3, 4, [1, 2, 2, 3]],
    [4, 7, [1, 1, 2, 2, 3, 3, 4]],
    [3, 2, [2, 3]],
    [10, 4, [3, 5, 8, 10]],
    [364, 100, [4, 7, 11, 15, 18, 22, 25, 29, 33, 36, 40, 44, 47, 51, 55, 58, 62, 66, 69, 73, 76, 80, 84, 87,
      91, 95, 98, 102, 106, 109, 113, 116, 120, 124, 127, 131, 135, 138, 142, 146, 149, 153, 157, 160, 164,
      167, 171, 175, 178, 182, 186, 189, 193, 197, 200, 204, 207, 211, 215, 218, 222, 226, 229, 233, 237,
      240, 244, 248, 251, 255, 258, 262, 266, 269, 273, 277, 280, 284, 288, 291, 295, 298, 302, 306, 309,
      313, 317, 320, 324, 328, 331, 335, 339, 342, 346, 349, 353, 357, 360, 364]],
    [5, 2, [3, 5]],
    [259, 31, [8, 17, 25, 33, 42, 50, 58, 67, 75, 84, 92, 100, 109, 117, 125, 134, 142, 150, 159, 167, 175,
      184, 192, 201, 209, 217, 226, 234, 242, 251, 259]],
    [-1, 10, [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1]],
    [248, 15, [17, 33, 50, 66, 83, 99, 116, 132, 149, 165, 182, 198, 215, 231, 248]],
    [319, 34, [9, 19, 28, 38, 47, 56, 66, 75, 84, 94, 103, 113, 122, 131, 141, 150, 160, 169, 178, 188, 197,
      206, 216, 225, 235, 244, 253, 263, 272, 281, 291, 300, 310, 319]],
    [-2, 31, [-2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2, -2,
      -2, -2, -2, -2, -2, -2, -2]],
    [114, 26, [4, 9, 13, 18, 22, 26, 31, 35, 39, 44, 48, 53, 57, 61, 66, 70, 75, 79, 83, 88, 92, 96, 101,
      105, 110, 114]],
    [287, 11, [26, 52, 78, 104, 130, 157, 183, 209, 235, 261, 287]],
    [202, 27, [7, 15, 22, 30, 37, 45, 52, 60, 67, 75, 82, 90, 97, 105, 112, 120, 127, 135, 142, 150, 157,
      165, 172, 180, 187, 195, 202]],
    [71, 34, [2, 4, 6, 8, 10, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 36, 38, 40, 42, 44, 46, 48, 50, 52,
      54, 56, 58, 61, 63, 65, 67, 69, 71]],
    [318, 12, [27, 53, 80, 106, 133, 159, 186, 212, 239, 265, 292, 318]],
    [41, 38, [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28,
      29, 30, 31, 32, 33, 35, 36, 37, 38, 39, 40, 41]],
    [273, 24, [11, 23, 34, 46, 57, 68, 80, 91, 102, 114, 125, 137, 148, 159, 171, 182, 193, 205, 216, 228,
      239, 250, 262, 273]],
    [15, 11, [1, 3, 4, 5, 7, 8, 10, 11, 12, 14, 15]],
    [75, 33, [2, 5, 7, 9, 11, 14, 16, 18, 20, 23, 25, 27, 30, 32, 34, 36, 39, 41, 43, 45, 48, 50, 52, 55, 57,
      59, 61, 64, 66, 68, 70, 73, 75]],
    [-10, 6, [-10, -10, -10, -10, -10, -10]],
    [149, 16, [9, 19, 28, 37, 47, 56, 65, 75, 84, 93, 102, 112, 121, 130, 140, 149]],
    [-11, 31, [-11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11,
      -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11, -11]],
    [252, 22, [11, 23, 34, 46, 57, 69, 80, 92, 103, 115, 126, 137, 149, 160, 172, 183, 195, 206, 218, 229,
      241, 252]],
    [147, 10, [15, 29, 44, 59, 74, 88, 103, 118, 132, 147]],
    [95, 40, [2, 5, 7, 10, 12, 14, 17, 19, 21, 24, 26, 29, 31, 33, 36, 38, 40, 43, 45, 48, 50, 52, 55, 57,
      59, 62, 64, 67, 69, 71, 74, 76, 78, 81, 83, 86, 88, 90, 93, 95]],
    [361, 24, [15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 181, 196, 211, 226, 241, 256, 271, 286, 301,
      316, 331, 346, 361]],
    [312, 27, [12, 23, 35, 46, 58, 69, 81, 92, 104, 116, 127, 139, 150, 162, 173, 185, 196, 208, 220, 231,
      243, 254, 266, 277, 289, 300, 312]],
    [326, 14, [23, 47, 70, 93, 116, 140, 163, 186, 210, 233, 256, 279, 303, 326]],
    [341, 14, [24, 49, 73, 97, 122, 146, 171, 195, 219, 244, 268, 292, 317, 341]],
    [16, 22, [1, 1, 2, 3, 4, 4, 5, 6, 7, 7, 8, 9, 9, 10, 11, 12, 12, 13, 14, 15, 15, 16]],
    [359, 38, [9, 19, 28, 38, 47, 57, 66, 76, 85, 94, 104, 113, 123, 132, 142, 151, 161, 170, 180, 189, 198,
      208, 217, 227, 236, 246, 255, 265, 274, 283, 293, 302, 312, 321, 331, 340, 350, 359]],
    [164, 21, [8, 16, 23, 31, 39, 47, 55, 62, 70, 78, 86, 94, 102, 109, 117, 125, 133, 141, 148, 156, 164]],
    [112, 40, [3, 6, 8, 11, 14, 17, 20, 22, 25, 28, 31, 34, 36, 39, 42, 45, 48, 50, 53, 56, 59, 62, 64, 67,
      70, 73, 76, 78, 81, 84, 87, 90, 92, 95, 98, 101, 104, 106, 109, 112]],
    [1, 1, [1]],
    [1, 2, [1, 1]],
    [1, 5, [0, 0, 1, 1, 1]],
    [2, 3, [1, 1, 2]],
    [6, 4, [2, 3, 5, 6]],
    [7, 7, [1, 2, 3, 4, 5, 6, 7]],
    [7, 3, [2, 5, 7]],
    [30, 7, [4, 9, 13, 17, 21, 26, 30]],
    [100, 3, [33, 67, 100]],
    [1, 100, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
    [365, 12, [30, 61, 91, 122, 152, 183, 213, 243, 274, 304, 335, 365]],
    [29, 4, [7, 15, 22, 29]],
    [60, 9, [7, 13, 20, 27, 33, 40, 47, 53, 60]],
    [13, 6, [2, 4, 7, 9, 11, 13]],
    [-3, 4, [-3, -3, -3, -3]],
    [0, 1, [0]],
    [45, 2, [23, 45]],
    [9, 6, [2, 3, 5, 6, 8, 9]]
  ]';
  -- resource_add: [url digitada, título digitado, url gravada, título
  -- gravado], null = recusa. src/modules/study/studyRpcParity.test.ts confere
  -- cada um contra o resourceFromInput da tela. Fora daqui, de propósito: caractere de
  -- formatação invisível (U+200B…), que a tela recusa e o servidor aceita
  -- (API-021), e título acima de 2048, que a tela corta no campo.
  url_vec jsonb := '[
    ["https://exemplo.com/guia", "", "https://exemplo.com/guia", "exemplo.com/guia"],
    ["  exemplo.com/a  ", "  Guia  ", "https://exemplo.com/a", "Guia"],
    ["HTTP://X.Y/z", "", "HTTP://X.Y/z", "X.Y/z"],
    ["www.site.org/x?y=1#z", "", "https://www.site.org/x?y=1#z", "www.site.org/x?y=1#z"],
    ["sub-dominio.exemplo_1.com", "\t", "https://sub-dominio.exemplo_1.com", "sub-dominio.exemplo_1.com"],
    ["a.b", " Título com espaço ", "https://a.b", "Título com espaço"],
    ["https://a.b/\u00a0", "", "https://a.b/", "a.b/"],
    ["\ufeffexemplo.com\u3000", "\u2028", "https://exemplo.com", "exemplo.com"],
    ["javascript:alert(1)", "", null, null],
    ["data:text/html,x", "x", null, null],
    ["mailto:a@b.com", "", null, null],
    ["café.com", "", null, null],
    ["localhost", "", null, null],
    ["ftp://a.b", "", null, null],
    ["https://", "", null, null],
    ["https://a b.com", "", null, null],
    ["exemplo.com/caminho com espaço", "", null, null],
    ["  ", "x", null, null]
  ]';
  v jsonb;
  a jsonb;
  b jsonb;
  ts timestamptz;
  x0 text;
  xs jsonb;
  n int;
  ok_count int;
  bad text;
  r text;
  calls text[];
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

  create function pg_temp.as_role(p_role text, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('role', p_role)::text, true);
    execute format('set local role %I', p_role);
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
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 180))
  $f$;

  create function pg_temp.card(p_id uuid)
  returns jsonb
  language sql
  as $f$
    select to_jsonb(c) from public.study_cards c where c.id = p_id
  $f$;

  -- O resto do card igual, a lista igual fora do índice p_idx e a versão
  -- para frente.
  create function pg_temp.only_item(p_before jsonb, p_after jsonb, p_col text, p_idx int)
  returns text
  language sql
  as $f$
    select format('%s %s %s',
                  (p_after - p_col - 'updated_at') = (p_before - p_col - 'updated_at'),
                  (p_after -> p_col) - p_idx = (p_before -> p_col) - p_idx,
                  (p_after ->> 'updated_at')::timestamptz > (p_before ->> 'updated_at')::timestamptz)
  $f$;

  -- "Não grava" pela tupla, não só pela versão: o gatilho do API-021 mantém o
  -- updated_at num UPDATE que não muda nada, e esse UPDATE ainda cria tupla
  -- nova. Cada pg_temp.as_user roda numa subtransação com XID próprio, então
  -- qualquer escrita troca o xmin da linha (a trava FOR NO KEY UPDATE não).
  create function pg_temp.ver(p_id uuid)
  returns text
  language sql
  as $f$
    select c.xmin::text from public.study_cards c where c.id = p_id
  $f$;

  create function pg_temp.vers(p_topic uuid)
  returns jsonb
  language sql
  as $f$
    select coalesce(jsonb_object_agg(c.id, c.xmin::text), '{}') from public.study_cards c where c.topic_id = p_topic
  $f$;

  -- Cards do tópico com tupla nova desde o retrato p_before de pg_temp.vers.
  create function pg_temp.new_tuples(p_before jsonb, p_topic uuid)
  returns int
  language sql
  as $f$
    select count(*)::int from jsonb_each_text(pg_temp.vers(p_topic)) a where a.value is distinct from p_before ->> a.key
  $f$;

  -- 0. Levantamento (só contagens), antes das pessoas de teste. As RPCs acham
  -- o item pelo id, e o gatilho confere a coluna inteira que mudou: item sem
  -- id de texto, id repetido ou dado fora da forma travam a RPC daquele card.
  select format('%s %s',
                (select count(*) from public.study_cards c,
                         lateral (select e from jsonb_array_elements(case when jsonb_typeof(c.checkpoints) = 'array' then c.checkpoints else '[]' end) e
                                  union all select e from jsonb_array_elements(case when jsonb_typeof(c.resources) = 'array' then c.resources else '[]' end) e
                                  union all select e from jsonb_array_elements(case when jsonb_typeof(c.quiz) = 'array' then c.quiz else '[]' end) e) i
                  where jsonb_typeof(i.e -> 'id') is distinct from 'string'),
                (select count(*) from public.study_cards c
                  where (select count(*) - count(distinct e ->> 'id') from jsonb_array_elements(case when jsonb_typeof(c.checkpoints) = 'array' then c.checkpoints else '[]' end) e) > 0
                     or (select count(*) - count(distinct e ->> 'id') from jsonb_array_elements(case when jsonb_typeof(c.resources) = 'array' then c.resources else '[]' end) e) > 0
                     or (select count(*) - count(distinct e ->> 'id') from jsonb_array_elements(case when jsonb_typeof(c.quiz) = 'array' then c.quiz else '[]' end) e) > 0))
    into r;
  out := out || pg_temp.expect('levantamento: itens sem id de texto e cards com id repetido', r, '0 0');
  select format('%s %s %s %s',
                count(*) filter (where private.study_checkpoints_problem(c.checkpoints) is not null),
                count(*) filter (where private.study_resources_problem(c.resources) is not null),
                count(*) filter (where private.study_quiz_problem(c.quiz) is not null),
                count(*) filter (where private.study_blocks_problem(c.blocks) is not null))
    into r from public.study_cards c;
  out := out || pg_temp.expect('levantamento: cards fora da forma (pontos, recursos, quiz, blocos)', r, '0 0 0 0');
  select format('tópicos=%s com meta=%s cards=%s com prazo=%s máx. por tópico=%s posições repetidas=%s respondidas=%s sem a chave userAnswer=%s pontos marcados=%s maior card=%s bytes',
                (select count(*) from public.study_topics),
                (select count(*) from public.study_topics where target_date is not null),
                (select count(*) from public.study_cards),
                (select count(*) from public.study_cards where due_date is not null),
                (select coalesce(max(m), 0) from (select count(*) m from public.study_cards group by topic_id) s),
                (select count(*) from (select 1 from public.study_cards group by topic_id, user_id, sort_order having count(*) > 1) s),
                (select count(*) from public.study_cards c, jsonb_array_elements(case when jsonb_typeof(c.quiz) = 'array' then c.quiz else '[]' end) e
                  where coalesce(e -> 'userAnswer', 'null') <> 'null'),
                (select count(*) from public.study_cards c, jsonb_array_elements(case when jsonb_typeof(c.quiz) = 'array' then c.quiz else '[]' end) e
                  where jsonb_typeof(e) = 'object' and not e ? 'userAnswer'),
                (select count(*) from public.study_cards c, jsonb_array_elements(case when jsonb_typeof(c.checkpoints) = 'array' then c.checkpoints else '[]' end) e
                  where e -> 'completed' = 'true'),
                (select coalesce(max(octet_length(c.checkpoints::text) + octet_length(c.resources::text) + octet_length(c.quiz::text) + octet_length(c.blocks::text)), 0)
                   from public.study_cards c))
    into r;
  out := out || pg_temp.expect('levantamento (informativo)', r, '%');

  -- Fixtures sem gatilhos. k: card completo de O; kl: card de O com ponto
  -- antigo fora da forma (chave extra); kr: card de O para os vetores de
  -- recurso; kx: card de X. t2 tem cards de O nas posições 0 e 5 e uma linha
  -- antiga de X pendurada com sort_order no teto do integer; tc tem meta,
  -- dois cards de O e um de X pendurado.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (o, format('api024-o-%s@example.invalid', tag)), (x, format('api024-x-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (o, format('api024-o-%s@example.invalid', tag), 'O', 'standard', true, 0),
    (x, format('api024-x-%s@example.invalid', tag), 'X', 'standard', true, 0);
  insert into public.study_topics (id, user_id, title, status, target_date) values
    (t, o, 'api024 T', 'planned', null), (t2, o, 'api024 T2', 'planned', null),
    (tx, x, 'api024 TX', 'planned', sp + 10), (tc, o, 'api024 TC', 'planned', sp + 10);
  insert into public.study_cards (id, user_id, topic_id, title, sort_order, checkpoints, resources, quiz) values
    (k, o, t, 'K', 0,
     '[{"id": "p1", "text": "Ler", "completed": false}, {"id": "p2", "text": "Fazer", "completed": true, "note": "nota"}]',
     '[{"id": "r1", "title": "Doc", "url": "https://a.b/doc"}]',
     '[{"id": "q1", "statement": "S1", "answer": "certo", "userAnswer": null},
       {"kind": "choice", "id": "q2", "statement": "S2", "options": ["a", "b", "c"], "answer": 1, "userAnswer": null},
       {"id": "q3", "statement": "S3", "answer": "errado", "userAnswer": "certo"},
       {"id": "q4", "statement": "S4", "answer": "certo"}]'),
    (kl, o, t, 'Legado', 1, '[{"id": "p1", "text": "Ler", "completed": false, "extra": 1}]', '[]',
     '[{"id": "q1", "statement": "S1", "answer": "certo", "userAnswer": null}]'),
    (kr, o, t, 'Recursos', 2, '[]', '[]', '[]'),
    (kx, x, tx, 'KX', 0, '[{"id": "p1", "text": "de X", "completed": false}]', '[{"id": "r1", "title": "x", "url": "https://x.y"}]',
     '[{"id": "q1", "statement": "S1", "answer": "certo", "userAnswer": null}]');
  insert into public.study_cards (user_id, topic_id, title, sort_order) values
    (o, t2, 'A', 0), (o, t2, 'B', 5), (x, t2, 'Pendurado', 2147483647),
    (o, tc, 'C1', 0), (o, tc, 'C2', 1), (x, tc, 'Pendurado', 0);
  set local session_replication_role = origin;

  -- 1. Pontos de estudo.
  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select jsonb_array_length(checkpoints) || ' ' || (checkpoints -> 2 ->> 'text') || ' ' || (checkpoints -> 2 ->> 'completed') from public.study_checkpoint_add(%L, E'  Novo\t', 'p3')$q$, k));
  out := out || pg_temp.expect('add: o ponto vai para o fim, aparado e sem progresso', r, 'ok 3 Novo false');
  a := pg_temp.card(k);
  out := out || pg_temp.expect('add: resto do card e outros pontos iguais, versão avança', pg_temp.only_item(b, a, 'checkpoints', 2), 't t t');
  x0 := pg_temp.ver(k);
  r := pg_temp.as_user(o, format($q$select (updated_at = %L::timestamptz)::text from public.study_checkpoint_add(%L, 'Novo ', 'p3')$q$, a ->> 'updated_at', k));
  out := out || pg_temp.expect('add repetido (mesmo id e texto aparado) não grava', r, 'ok true');
  out := out || pg_temp.expect('add repetido: sem tupla nova (xmin igual)', (pg_temp.ver(k) = x0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, 'Outro', 'p3')$q$, k));
  out := out || pg_temp.expect('add com id existente e outro texto', r, 'erro 23505: Já existe um ponto de estudo com este id');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, U&' \0009\00a0\3000\feff\2028')$q$, k));
  out := out || pg_temp.expect('add só com espaços (os do trim do JS)', r, 'erro 22023: Informe o texto do ponto de estudo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, null)$q$, k));
  out := out || pg_temp.expect('add com texto nulo', r, 'erro 22023: Informe o texto do ponto de estudo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, 'x')$q$, kx));
  out := out || pg_temp.expect('add no card de outra pessoa', r, 'erro P0002: Card não encontrado');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, 'x')$q$, gen_random_uuid()));
  out := out || pg_temp.expect('add em card que não existe: a mesma mensagem', r, 'erro P0002: Card não encontrado');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, %L)$q$, k, repeat('x', 2001)));
  out := out || pg_temp.expect('add acima do teto de texto: o gatilho do API-021 recusa', r, 'erro 23514: Pontos de estudo fora do formato: item 3: text%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, 'y', %L)$q$, k, repeat('i', 101)));
  out := out || pg_temp.expect('add com id acima de 100: o gatilho recusa', r, 'erro 23514: Pontos de estudo fora do formato: item 3: id é texto de 1 a 100 caracteres');
  r := pg_temp.as_user(o, format($q$select length(checkpoints -> 3 ->> 'id')::text from public.study_checkpoint_add(%L, 'Sem id')$q$, k));
  out := out || pg_temp.expect('add sem id: o servidor gera', r, 'ok 36');

  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select checkpoints -> 0 ->> 'text' from public.study_checkpoint_edit(%L, 'p1', p_text => '  Ler o capítulo ')$q$, k));
  out := out || pg_temp.expect('edit: texto aparado', r, 'ok Ler o capítulo');
  a := pg_temp.card(k);
  out := out || pg_temp.expect('edit: só o item muda', pg_temp.only_item(b, a, 'checkpoints', 0), 't t t');
  x0 := pg_temp.ver(k);
  r := pg_temp.as_user(o, format($q$select (updated_at = %L::timestamptz)::text from public.study_checkpoint_edit(%L, 'p1', p_text => 'Ler o capítulo')$q$, a ->> 'updated_at', k));
  out := out || pg_temp.expect('edit com o mesmo texto não grava', r, 'ok true');
  out := out || pg_temp.expect('edit com o mesmo texto: sem tupla nova (xmin igual)', (pg_temp.ver(k) = x0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select coalesce(checkpoints -> 1 ->> 'note', '(sem nota)') || ' ' || (checkpoints -> 1 ->> 'completed') from public.study_checkpoint_edit(%L, 'p2', p_note => ' ')$q$, k));
  out := out || pg_temp.expect('edit: nota em branco tira a chave e não mexe no progresso', r, 'ok (sem nota) true');
  r := pg_temp.as_user(o, format($q$select checkpoints -> 1 ->> 'note' from public.study_checkpoint_edit(%L, 'p2', p_note => '  nova ')$q$, k));
  out := out || pg_temp.expect('edit: nota aparada', r, 'ok nova');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_edit(%L, 'p1')$q$, k));
  out := out || pg_temp.expect('edit sem texto nem nota', r, 'erro 22023: Informe o texto ou a nota do ponto de estudo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_edit(%L, 'p1', p_text => E'\t ')$q$, k));
  out := out || pg_temp.expect('edit com texto em branco', r, 'erro 22023: O texto do ponto de estudo não pode ficar vazio%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_edit(%L, 'nao', p_text => 'x')$q$, k));
  out := out || pg_temp.expect('edit de ponto que não existe', r, 'erro P0002: Ponto de estudo não encontrado');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_edit(%L, null, p_text => 'x')$q$, k));
  out := out || pg_temp.expect('edit com id nulo', r, 'erro 22023: Informe o id do ponto de estudo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_edit(%L, 'p1', p_text => 'x')$q$, kx));
  out := out || pg_temp.expect('edit no card de outra pessoa', r, 'erro P0002: Card não encontrado');

  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select checkpoints -> 0 ->> 'completed' from public.study_checkpoint_toggle(%L, 'p1')$q$, k));
  out := out || pg_temp.expect('toggle sem valor inverte', r, 'ok true');
  a := pg_temp.card(k);
  out := out || pg_temp.expect('toggle: só o item muda', pg_temp.only_item(b, a, 'checkpoints', 0), 't t t');
  x0 := pg_temp.ver(k);
  r := pg_temp.as_user(o, format($q$select (updated_at = %L::timestamptz)::text from public.study_checkpoint_toggle(%L, 'p1', true)$q$, a ->> 'updated_at', k));
  out := out || pg_temp.expect('toggle com o valor que já está não grava', r, 'ok true');
  out := out || pg_temp.expect('toggle com o valor que já está: sem tupla nova (xmin igual)', (pg_temp.ver(k) = x0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select checkpoints -> 0 ->> 'completed' from public.study_checkpoint_toggle(%L, 'p1', false)$q$, k));
  out := out || pg_temp.expect('toggle com valor explícito', r, 'ok false');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_toggle(%L, 'nao')$q$, k));
  out := out || pg_temp.expect('toggle de ponto que não existe', r, 'erro P0002: Ponto de estudo não encontrado');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_toggle(%L, null)$q$, k));
  out := out || pg_temp.expect('toggle com id nulo', r, 'erro 22023: Informe o id do ponto de estudo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_toggle(%L, 'p1')$q$, kx));
  out := out || pg_temp.expect('toggle no card de outra pessoa', r, 'erro P0002: Card não encontrado');

  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select jsonb_array_length(checkpoints) || ' ' || (checkpoints @> '[{"id": "p3"}]') from public.study_checkpoint_remove(%L, 'p3')$q$, k));
  out := out || pg_temp.expect('remove', r, 'ok 3 false');
  a := pg_temp.card(k);
  out := out || pg_temp.expect('remove: os outros pontos e o resto do card iguais',
                               format('%s %s', (a -> 'checkpoints') = (b -> 'checkpoints') - 2, (a - 'checkpoints' - 'updated_at') = (b - 'checkpoints' - 'updated_at')), 't t');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_remove(%L, 'p3')$q$, k));
  out := out || pg_temp.expect('remove de ponto ausente: P0002 (zero linhas nunca é sucesso)', r, 'erro P0002: Ponto de estudo não encontrado');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_remove(%L, null)$q$, k));
  out := out || pg_temp.expect('remove com id nulo', r, 'erro 22023: Informe o id do ponto de estudo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_remove(%L, 'p1')$q$, kx));
  out := out || pg_temp.expect('remove no card de outra pessoa', r, 'erro P0002: Card não encontrado');

  -- Duas abas com as RPCs: a aba B adiciona, a aba A (com estado velho) marca.
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_add(%L, 'Da aba B', 'p4')$q$, k));
  r := pg_temp.as_user(o, format($q$select (checkpoints @> '[{"id": "p4"}]')::text || ' ' || (checkpoints -> 0 ->> 'completed') from public.study_checkpoint_toggle(%L, 'p1')$q$, k));
  out := out || pg_temp.expect('duas abas: o ponto da aba B continua depois do toggle da aba A', r, 'ok true true');

  -- Dado antigo fora da forma (risco do cabeçalho): o gatilho confere a coluna
  -- inteira, então a RPC de um ponto falha apontando o item antigo; outra
  -- coluna do mesmo card continua.
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_checkpoint_toggle(%L, 'p1')$q$, kl));
  out := out || pg_temp.expect('ponto antigo fora da forma trava a RPC da coluna', r, 'erro 23514: Pontos de estudo fora do formato: item 0: as chaves aceitas%');
  r := pg_temp.as_user(o, format($q$select quiz -> 0 ->> 'userAnswer' from public.study_quiz_answer(%L, 'q1', '"certo"')$q$, kl));
  out := out || pg_temp.expect('o quiz do mesmo card continua', r, 'ok certo');

  -- 2. Recursos.
  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select resources -> 1 ->> 'title' from public.study_resource_add(%L, 'https://exemplo.com/guia', p_id => 'r2')$q$, k));
  out := out || pg_temp.expect('resource_add: título vazio vira a URL sem o esquema', r, 'ok exemplo.com/guia');
  a := pg_temp.card(k);
  out := out || pg_temp.expect('resource_add: só o item muda', pg_temp.only_item(b, a, 'resources', 1), 't t t');
  r := pg_temp.as_user(o, format($q$select (resources -> 2 ->> 'url') || ' ' || (resources -> 2 ->> 'title') from public.study_resource_add(%L, ' exemplo.com/a ', p_id => 'r3')$q$, k));
  out := out || pg_temp.expect('resource_add: domínio sem esquema ganha https://', r, 'ok https://exemplo.com/a exemplo.com/a');
  a := pg_temp.card(k);
  x0 := pg_temp.ver(k);
  r := pg_temp.as_user(o, format($q$select (updated_at = %L::timestamptz)::text from public.study_resource_add(%L, 'exemplo.com/a', p_id => 'r3')$q$, a ->> 'updated_at', k));
  out := out || pg_temp.expect('resource_add repetido (mesmo id, URL e título normalizados) não grava', r, 'ok true');
  out := out || pg_temp.expect('resource_add repetido: sem tupla nova (xmin igual)', (pg_temp.ver(k) = x0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_add(%L, 'https://outro.com', p_id => 'r3')$q$, k));
  out := out || pg_temp.expect('resource_add com id existente e outra URL', r, 'erro 23505: Já existe um recurso com este id');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_add(%L, %L)$q$, k, 'https://a.b/' || repeat('x', 2037)));
  out := out || pg_temp.expect('resource_add com URL acima de 2048: a recusa fala da URL', r, 'erro 23514: Recursos fora do formato: item 3: url é http(s)%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_add(%L, E'\t')$q$, k));
  out := out || pg_temp.expect('resource_add sem URL', r, 'erro 22023: Informe a URL do recurso');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_add(%L, null)$q$, k));
  out := out || pg_temp.expect('resource_add com URL nula', r, 'erro 22023: Informe a URL do recurso');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_add(%L, 'https://x.y')$q$, kx));
  out := out || pg_temp.expect('resource_add no card de outra pessoa', r, 'erro P0002: Card não encontrado');
  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select jsonb_array_length(resources) || ' ' || (resources @> '[{"id": "r1"}]') from public.study_resource_remove(%L, 'r1')$q$, k));
  out := out || pg_temp.expect('resource_remove', r, 'ok 2 false');
  out := out || pg_temp.expect('resource_remove: os outros recursos iguais', ((pg_temp.card(k) -> 'resources') = (b -> 'resources') - 0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_remove(%L, 'r1')$q$, k));
  out := out || pg_temp.expect('resource_remove de recurso ausente: P0002', r, 'erro P0002: Recurso não encontrado');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_remove(%L, null)$q$, k));
  out := out || pg_temp.expect('resource_remove com id nulo', r, 'erro 22023: Informe o id do recurso');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_resource_remove(%L, 'r1')$q$, kx));
  out := out || pg_temp.expect('resource_remove no card de outra pessoa', r, 'erro P0002: Card não encontrado');

  -- Vetores de paridade com o resourceFromInput da tela (card kr, vazio).
  ok_count := 0;
  bad := null;
  for v in select e from jsonb_array_elements(url_vec) e loop
    r := pg_temp.as_user(o, format($q$select (resources -> -1 ->> 'url') || '|' || (resources -> -1 ->> 'title') from public.study_resource_add(%L, %L, %L)$q$,
                                   kr, v ->> 0, v ->> 1));
    if (v -> 2 = 'null'::jsonb and r like 'erro 2%') or r = 'ok ' || (v ->> 2) || '|' || (v ->> 3) then
      ok_count := ok_count + 1;
    else
      bad := coalesce(bad || '; ', '') || format('%s → %s', v, left(r, 80));
    end if;
  end loop;
  out := out || pg_temp.expect('resource_add: vetores do resourceFromInput da tela',
                               format('%s/%s %s', ok_count, jsonb_array_length(url_vec), coalesce(bad, '')),
                               format('%s/%s ', jsonb_array_length(url_vec), jsonb_array_length(url_vec)));

  -- 3. Quiz.
  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select quiz -> 0 ->> 'userAnswer' from public.study_quiz_answer(%L, 'q1', '"certo"')$q$, k));
  out := out || pg_temp.expect('answer: primeira resposta', r, 'ok certo');
  a := pg_temp.card(k);
  out := out || pg_temp.expect('answer: só a pergunta muda', pg_temp.only_item(b, a, 'quiz', 0), 't t t');
  x0 := pg_temp.ver(k);
  r := pg_temp.as_user(o, format($q$select (updated_at = %L::timestamptz)::text from public.study_quiz_answer(%L, 'q1', '"certo"')$q$, a ->> 'updated_at', k));
  out := out || pg_temp.expect('answer repetida (mesmo valor) não grava', r, 'ok true');
  out := out || pg_temp.expect('answer repetida: sem tupla nova (xmin igual)', (pg_temp.ver(k) = x0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q1', '"errado"')$q$, k));
  out := out || pg_temp.expect('segunda resposta diferente é recusada', r, 'erro P0001: Pergunta já respondida: reinicie o quiz para responder de novo');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q2', '"certo"')$q$, k));
  out := out || pg_temp.expect('escolha com texto', r, 'erro 22023: Resposta inválida: informe o índice (a partir de 0) de uma das 3 alternativas');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q2', '3')$q$, k));
  out := out || pg_temp.expect('escolha fora do intervalo', r, 'erro 22023: Resposta inválida%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q2', '-1')$q$, k));
  out := out || pg_temp.expect('escolha negativa', r, 'erro 22023: Resposta inválida%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q2', '1.5')$q$, k));
  out := out || pg_temp.expect('escolha não inteira', r, 'erro 22023: Resposta inválida%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q2', 'null')$q$, k));
  out := out || pg_temp.expect('escolha com null do JSON (zerar é o reset)', r, 'erro 22023: Resposta inválida%');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q2', null)$q$, k));
  out := out || pg_temp.expect('escolha com nulo', r, 'erro 22023: Resposta inválida%');
  r := pg_temp.as_user(o, format($q$select (quiz -> 1 -> 'userAnswer')::text from public.study_quiz_answer(%L, 'q2', '2.0')$q$, k));
  out := out || pg_temp.expect('escolha 2.0 é gravada como 2', r, 'ok 2');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q1', '0')$q$, k));
  out := out || pg_temp.expect('certo/errado com número', r, 'erro 22023: Resposta inválida: use "certo" ou "errado"');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q1', '"CERTO"')$q$, k));
  out := out || pg_temp.expect('certo/errado em maiúsculas', r, 'erro 22023: Resposta inválida: use "certo" ou "errado"');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'qq', '"certo"')$q$, k));
  out := out || pg_temp.expect('pergunta que não existe', r, 'erro P0002: Pergunta não encontrada');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, null, '"certo"')$q$, k));
  out := out || pg_temp.expect('pergunta com id nulo', r, 'erro 22023: Informe o id da pergunta');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_answer(%L, 'q1', '"certo"')$q$, kx));
  out := out || pg_temp.expect('answer no card de outra pessoa', r, 'erro P0002: Card não encontrado');
  r := pg_temp.as_user(o, format($q$select quiz -> 3 ->> 'userAnswer' from public.study_quiz_answer(%L, 'q4', '"errado"')$q$, k));
  out := out || pg_temp.expect('pergunta legada sem a chave userAnswer conta como não respondida', r, 'ok errado');
  b := pg_temp.card(k);
  r := pg_temp.as_user(o, format($q$select (select string_agg(coalesce(e ->> 'userAnswer', '-'), ',' order by n) from jsonb_array_elements(quiz) with ordinality q(e, n)) from public.study_quiz_reset(%L, true)$q$, k));
  out := out || pg_temp.expect('reset só das erradas (a certa fica)', r, 'ok certo,-,-,-');
  out := out || pg_temp.expect('reset: o resto do card igual', ((pg_temp.card(k) - 'quiz' - 'updated_at') = (b - 'quiz' - 'updated_at'))::text, 'true');
  r := pg_temp.as_user(o, format($q$select (select string_agg(coalesce(e ->> 'userAnswer', '-'), ',' order by n) from jsonb_array_elements(quiz) with ordinality q(e, n)) from public.study_quiz_reset(%L)$q$, k));
  out := out || pg_temp.expect('reset de todas', r, 'ok -,-,-,-');
  a := pg_temp.card(k);
  x0 := pg_temp.ver(k);
  r := pg_temp.as_user(o, format($q$select (updated_at = %L::timestamptz)::text from public.study_quiz_reset(%L)$q$, a ->> 'updated_at', k));
  out := out || pg_temp.expect('reset sem nada respondido não grava', r, 'ok true');
  out := out || pg_temp.expect('reset sem nada respondido: sem tupla nova (xmin igual)', (pg_temp.ver(k) = x0)::text, 'true');
  r := pg_temp.as_user(o, format($q$select 1::text from public.study_quiz_reset(%L)$q$, kx));
  out := out || pg_temp.expect('reset no card de outra pessoa', r, 'erro P0002: Card não encontrado');
  r := pg_temp.as_user(o, format($q$select quiz -> 0 ->> 'userAnswer' from public.study_quiz_answer(%L, 'q1', '"errado"')$q$, k));
  out := out || pg_temp.expect('depois do reset, responde de novo', r, 'ok errado');
  -- Decisão do usuário: a trava fica só na RPC. O UPDATE direto da tela de
  -- hoje (lista inteira) continua aceito até o API-029.
  r := pg_temp.as_user(o, format($q$with u as (update public.study_cards set quiz = jsonb_set(quiz, '{0,userAnswer}', '"certo"') where id = %L returning 1) select count(*)::text from u$q$, k));
  out := out || pg_temp.expect('sem gatilho de trava: o UPDATE direto da tela continua aceito', r, 'ok 1');

  -- 4. Anexar cards (t2: O nas posições 0 e 5, X pendurado em 2147483647).
  r := pg_temp.as_user(o, format($q$select string_agg(sort_order::text, ',' order by sort_order) from public.study_cards_append(%L, %L)$q$, t2,
       '[{"title": "  A1  ", "description": " d ", "rationale": "r\n",
          "checkpoints": [{"text": "x"}, {"id": "c", "text": "y", "completed": true}],
          "quiz": [{"statement": "s", "answer": "certo", "userAnswer": "certo"}],
          "resources": [{"title": "t", "url": "https://a.b"}],
          "blocks": [{"kind": "note", "body": "b"}]},
         {"title": "", "description": null, "checkpoints": null, "due_date": "2026-03-01"}]'));
  out := out || pg_temp.expect('append: posição a partir do max dos cards do dono (a linha de X não conta)', r, 'ok 6,7');
  select format('%s|%s|%s %s %s %s %s %s %s %s',
                c.title, c.description, c.rationale,
                length(c.checkpoints -> 0 ->> 'id'), c.checkpoints -> 0 ->> 'completed',
                c.checkpoints -> 1 ->> 'id', c.checkpoints -> 1 ->> 'completed',
                (c.quiz -> 0 -> 'userAnswer')::text,
                length(c.resources -> 0 ->> 'id'), length(c.blocks -> 0 ->> 'id'))
    into r from public.study_cards c where c.topic_id = t2 and c.sort_order = 6;
  out := out || pg_temp.expect('append: textos aparados, ids gerados, completed que veio fica, userAnswer sempre null', r, 'A1|d|r 36 false c true null 36 36');
  select format('[%s] [%s] [%s] %s %s', c.title, c.description, c.rationale, c.checkpoints, c.due_date) into r
    from public.study_cards c where c.topic_id = t2 and c.sort_order = 7;
  out := out || pg_temp.expect('append: título vazio aceito, null vira vazio, due_date gravado', r, '[] [] [] [] 2026-03-01');
  select count(*) into n from public.study_cards where topic_id = t2;
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, %L)$q$, t2,
       '[{"title": "B0"}, {"title": "B1", "resources": [{"title": "x", "url": "javascript:alert(1)"}]}]'));
  out := out || pg_temp.expect('append com o card de índice 1 fora da forma: cards/1 e o SQLSTATE do gatilho', r, 'erro 23514: cards/1: Recursos fora do formato: item 0: url é http(s)%');
  out := out || pg_temp.expect('append com erro não grava nenhum card', (select count(*) from public.study_cards where topic_id = t2)::text, n::text);
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, %L)$q$, t2,
       '[{"title": "Q", "quiz": [{"statement": " ", "answer": "certo"}]}]'));
  out := out || pg_temp.expect('append: quiz fora da forma no card 0', r, 'erro 23514: cards/0: Quiz fora do formato: pergunta 0: statement%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "C", "extra": 1}]')$q$, t2));
  out := out || pg_temp.expect('append com chave desconhecida', r, 'erro 22023: cards/0: chave "extra" não aceita%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "ok"}, {"title": "C", "zz": 1, "aa": 2}]')$q$, t2));
  out := out || pg_temp.expect('append: o índice é o do card com problema', r, 'erro 22023: cards/1: chave "aa" não aceita%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[1]')$q$, t2));
  out := out || pg_temp.expect('append com card que não é objeto', r, 'erro 22023: cards/0: o card é um objeto%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"description": "x"}]')$q$, t2));
  out := out || pg_temp.expect('append sem title', r, 'erro 22023: cards/0: title é texto (pode ser vazio)');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": 1}]')$q$, t2));
  out := out || pg_temp.expect('append com title número', r, 'erro 22023: cards/0: title é texto (pode ser vazio)');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "x", "rationale": 2}]')$q$, t2));
  out := out || pg_temp.expect('append com rationale número', r, 'erro 22023: cards/0: description e rationale são texto ou null');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "D", "due_date": "2026-02-30"}]')$q$, t2));
  out := out || pg_temp.expect('append com data que não existe', r, 'erro 22023: cards/0: due_date é uma data AAAA-MM-DD ou null');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "D", "due_date": "2026-3-1"}]')$q$, t2));
  out := out || pg_temp.expect('append com data fora do formato', r, 'erro 22023: cards/0: due_date%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "D", "due_date": 20260301}]')$q$, t2));
  out := out || pg_temp.expect('append com data número', r, 'erro 22023: cards/0: due_date%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[]')$q$, t2));
  out := out || pg_temp.expect('append vazio', r, 'erro 22023: Informe uma lista de 1 a 100 cards');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '{"title": "x"}')$q$, t2));
  out := out || pg_temp.expect('append com objeto em vez de lista', r, 'erro 22023: Informe uma lista de 1 a 100 cards');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, null)$q$, t2));
  out := out || pg_temp.expect('append com nulo', r, 'erro 22023: Informe uma lista de 1 a 100 cards');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, %L)$q$, t2, (select jsonb_agg(jsonb_build_object('title', 'n' || i)) from generate_series(1, 101) i)));
  out := out || pg_temp.expect('append com 101 cards', r, 'erro 22023: Informe uma lista de 1 a 100 cards');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, %L)$q$, t2,
       jsonb_build_array(jsonb_build_object('title', 'g1', 'description', repeat('x', 2100000)), jsonb_build_object('title', 'g2', 'description', repeat('x', 2100000)))));
  out := out || pg_temp.expect('append acima de 4 MiB', r, 'erro 22023: Os cards passam de 4 MiB por chamada');
  r := pg_temp.as_user(o, format($q$select count(*)::text || ' ' || min(sort_order) || ' ' || max(sort_order) from public.study_cards_append(%L, %L)$q$, t2, (select jsonb_agg(jsonb_build_object('title', 'n' || i)) from generate_series(1, 100) i)));
  out := out || pg_temp.expect('append com 100 cards, na ordem da lista', r, 'ok 100 8 107');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "intruso"}]')$q$, tx));
  out := out || pg_temp.expect('append no tópico de outra pessoa', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "intruso"}]')$q$, gen_random_uuid()));
  out := out || pg_temp.expect('append em tópico que não existe: a mesma mensagem', r, 'erro P0002: Tópico não encontrado');

  -- 5. Importar.
  select count(*) into n from public.study_topics where user_id = o;
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L, %L) ->> 'topic'$q$,
       '{"topic": {"title": "api024 import ruim"}, "cards": [{"title": "ok"}, {"title": "ruim", "resources": [{"url": "data:text/html,x", "title": "x"}]}]}', sp));
  out := out || pg_temp.expect('importação com o card de índice 1 fora da forma falha', r, 'erro 23514: cards/1: Recursos fora do formato%');
  out := out || pg_temp.expect('importação com erro não deixa tópico', (select count(*) from public.study_topics where user_id = o)::text, n::text);
  r := pg_temp.as_user(o, format($q$with i as (select public.study_import_topic(%L, %L) as j)
       select (select string_agg((c ->> 'sort_order') || ':' || ((c ->> 'due_date')::date - %L::date), ',' order by (c ->> 'sort_order')::int) from jsonb_array_elements(j -> 'cards') c)
              || ' ' || (j -> 'topic' ->> 'status') || ' [' || (j -> 'topic' ->> 'title') || '] [' || (j -> 'topic' ->> 'area') || '] '
              || (j -> 'topic' ->> 'target_date') || ' ' || ((j -> 'topic' ->> 'user_id') = %L)
              || ' ' || (j -> 'cards' -> 0 -> 'checkpoints' -> 0 ->> 'completed') || ' ' || (j -> 'cards' -> 0 -> 'quiz' -> 0 -> 'userAnswer')::text
         from i$q$,
       jsonb_build_object('topic', jsonb_build_object('title', '  api024 import  ', 'area', ' A ', 'target_date', (sp + 28)::text),
                          'cards', '[{"title": "1", "checkpoints": [{"text": "feito", "completed": true}], "quiz": [{"statement": "s", "answer": "certo", "userAnswer": "certo"}]},
                                     {"title": "2"}, {"title": "3"}, {"title": "4"}]'::jsonb), sp, sp, o));
  out := out || pg_temp.expect('importação: posições 0..3, prazos até a meta, textos aparados, "- [x]" mantido e userAnswer null',
                               r, format('ok 0:7,1:14,2:21,3:28 planned [api024 import] [A] %s true true null', sp + 28));
  r := pg_temp.as_user(o, format($q$select (select string_agg(coalesce(c ->> 'due_date', '-'), ',' order by (c ->> 'sort_order')::int) from jsonb_array_elements(public.study_import_topic(%L) -> 'cards') c)$q$,
       '{"topic": {"title": "api024 sem meta"}, "cards": [{"title": "1", "due_date": "2026-05-01"}, {"title": "2"}]}'));
  out := out || pg_temp.expect('importação sem meta: o due_date de cada card fica', r, 'ok 2026-05-01,-');
  r := pg_temp.as_user(o, format($q$select (select string_agg(((c ->> 'due_date')::date - %L::date)::text, ',' order by (c ->> 'sort_order')::int) from jsonb_array_elements(public.study_import_topic(%L, %L) -> 'cards') c)$q$,
       sp, jsonb_build_object('topic', jsonb_build_object('title', 'api024 ontem', 'target_date', (sp + 30)::text), 'cards', '[{"title": "1"}, {"title": "2"}, {"title": "3"}]'::jsonb), sp - 1));
  out := out || pg_temp.expect('importação com o dia do aparelho (ontem)', r, 'ok 9,20,30');
  r := pg_temp.as_user(o, format($q$select jsonb_array_length(public.study_import_topic(%L) -> 'cards')::text$q$, '{"topic": {"title": "api024 vazio"}}'));
  out := out || pg_temp.expect('importação sem cards cria só o tópico (como o app)', r, 'ok 0');
  r := pg_temp.as_user(o, format($q$select jsonb_array_length(public.study_import_topic(%L) -> 'cards')::text$q$, '{"topic": {"title": "api024 vazio 2"}, "cards": null}'));
  out := out || pg_temp.expect('importação com cards null', r, 'ok 0');
  select count(*) into n from public.study_topics where user_id = o;
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$,
       jsonb_build_object('topic', jsonb_build_object('title', 'x', 'target_date', (sp + 10)::text), 'cards', '[{"title": "1"}, {"title": "2", "due_date": "2026-05-01"}]'::jsonb)));
  out := out || pg_temp.expect('importação com due_date por card junto de target_date', r, 'erro 22023: cards/1: due_date não combina com topic.target_date%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"title": " "}, "cards": []}'));
  out := out || pg_temp.expect('importação com título em branco', r, 'erro 22023: topic/title: o título do tópico é obrigatório');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"area": "x"}}'));
  out := out || pg_temp.expect('importação sem título', r, 'erro 22023: topic/title%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"title": "x", "status": "completed"}}'));
  out := out || pg_temp.expect('importação com status (é do progresso)', r, 'erro 22023: topic: chave "status" não aceita%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"title": "x"}, "extra": 1}'));
  out := out || pg_temp.expect('importação com chave desconhecida na raiz', r, 'erro 22023: chave "extra" não aceita (topic e cards)');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '[{"title": "x"}]'));
  out := out || pg_temp.expect('importação com lista em vez de objeto', r, 'erro 22023: Envie {topic, cards}');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"cards": []}'));
  out := out || pg_temp.expect('importação sem topic', r, 'erro 22023: topic é um objeto%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"title": "x", "target_date": "2026-13-01"}}'));
  out := out || pg_temp.expect('importação com target_date inválida', r, 'erro 22023: topic/target_date%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"title": "x", "area": 1}}'));
  out := out || pg_temp.expect('importação com area número', r, 'erro 22023: topic: area, level e objective%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, jsonb_build_object('topic', '{"title": "x"}'::jsonb, 'cards', (select jsonb_agg(jsonb_build_object('title', 'n' || i)) from generate_series(1, 101) i))));
  out := out || pg_temp.expect('importação com 101 cards', r, 'erro 22023: cards é uma lista de até 100 cards');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L)::text$q$, '{"topic": {"title": "x"}, "cards": {"title": "1"}}'));
  out := out || pg_temp.expect('importação com cards que não é lista', r, 'erro 22023: cards é uma lista de até 100 cards');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L, %L)::text$q$, '{"topic": {"title": "x"}}', sp + 2));
  out := out || pg_temp.expect('importação com p_today a 2 dias de São Paulo', r, 'erro 22023: Data de hoje%');
  -- ±infinity é data válida no Postgres (e o PostgREST aceita): 22023, nunca
  -- o 22008 sem hint de "cannot subtract infinite dates".
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L, 'infinity')::text$q$, '{"topic": {"title": "x"}}'));
  out := out || pg_temp.expect('importação com p_today infinity: 22023', r, 'erro 22023: Data de hoje (infinity)%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L, '-infinity')::text$q$, '{"topic": {"title": "x"}}'));
  out := out || pg_temp.expect('importação com p_today -infinity: 22023', r, 'erro 22023: Data de hoje (-infinity)%');
  r := pg_temp.as_user(o, format($q$select public.study_import_topic(%L, %L)::text$q$, '{"topic": {"title": "x", "target_date": "infinity"}, "cards": [{"title": "1"}]}', sp));
  out := out || pg_temp.expect('importação com target_date infinity: 22023', r, 'erro 22023: topic/target_date%');
  out := out || pg_temp.expect('as importações recusadas não deixaram tópico', (select count(*) from public.study_topics where user_id = o)::text, n::text);

  -- 6. Reagendar: vetores do distributeDueDates.
  ok_count := 0;
  bad := null;
  for v in select e from jsonb_array_elements(vec) e loop
    tv := gen_random_uuid();
    set local session_replication_role = replica;
    insert into public.study_topics (id, user_id, title, target_date) values (tv, o, 'vec', sp + (v ->> 0)::int);
    insert into public.study_cards (user_id, topic_id, title, sort_order) select o, tv, 'c' || i, i from generate_series(1, (v ->> 1)::int) i;
    set local session_replication_role = origin;
    r := pg_temp.as_user(o, format($q$select string_agg((due_date - %L::date)::text, ',' order by sort_order) from public.study_reschedule(%L, %L)$q$, sp, tv, sp));
    if r = 'ok ' || (select string_agg(e #>> '{}', ',' order by i) from jsonb_array_elements(v -> 2) with ordinality q(e, i)) then
      ok_count := ok_count + 1;
    else
      bad := coalesce(bad || '; ', '') || format('%s → %s', v, left(r, 80));
    end if;
  end loop;
  out := out || pg_temp.expect('reagendar: vetores do distributeDueDates do app', format('%s/%s %s', ok_count, jsonb_array_length(vec), coalesce(bad, '')),
                               format('%s/%s ', jsonb_array_length(vec), jsonb_array_length(vec)));

  tv := gen_random_uuid();
  set local session_replication_role = replica;
  insert into public.study_topics (id, user_id, title, target_date) values (tv, o, 'dia', sp + 30);
  insert into public.study_cards (user_id, topic_id, title, sort_order) select o, tv, 'c' || i, i from generate_series(1, 3) i;
  set local session_replication_role = origin;
  r := pg_temp.as_user(o, format($q$select string_agg((due_date - %L::date)::text, ',' order by sort_order) from public.study_reschedule(%L)$q$, sp, tv));
  out := out || pg_temp.expect('reagendar sem data: hoje de São Paulo', r, 'ok 10,20,30');
  r := pg_temp.as_user(o, format($q$select string_agg((due_date - %L::date)::text, ',' order by sort_order) from public.study_reschedule(%L, %L)$q$, sp, tv, sp - 1));
  out := out || pg_temp.expect('reagendar com o dia do aparelho (ontem)', r, 'ok 9,20,30');
  r := pg_temp.as_user(o, format($q$select string_agg((due_date - %L::date)::text, ',' order by sort_order) from public.study_reschedule(%L, %L)$q$, sp, tv, sp + 1));
  out := out || pg_temp.expect('reagendar com o dia do aparelho (amanhã)', r, 'ok 11,20,30');
  select max(updated_at) into ts from public.study_cards where topic_id = tv;
  xs := pg_temp.vers(tv);
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp + 1));
  out := out || pg_temp.expect('reagendar sem mudança de prazo não grava', ((select max(updated_at) from public.study_cards where topic_id = tv) = ts)::text, 'true');
  out := out || pg_temp.expect('reagendar sem mudança de prazo: 3 cards, nenhuma tupla nova', format('%s %s', r, pg_temp.new_tuples(xs, tv)), 'ok 3 0');
  xs := pg_temp.vers(tv);
  r := pg_temp.as_user(o, format($q$select string_agg((due_date - %L::date)::text, ',' order by sort_order) from public.study_reschedule(%L, %L)$q$, sp, tv, sp));
  out := out || pg_temp.expect('reagendar de amanhã para hoje', r, 'ok 10,20,30');
  out := out || pg_temp.expect('reagendar só grava o card cujo prazo mudou', (select count(*) from public.study_cards where topic_id = tv and updated_at > ts)::text, '1');
  out := out || pg_temp.expect('reagendar de amanhã para hoje: uma tupla nova (só o card cujo prazo mudou)', pg_temp.new_tuples(xs, tv)::text, '1');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp + 2));
  out := out || pg_temp.expect('reagendar com data a 2 dias: 22023', r, format('erro 22023: Data de hoje (%s) a mais de 1 dia do hoje de São Paulo (%s)%%', sp + 2, sp));
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp - 2));
  out := out || pg_temp.expect('reagendar com data 2 dias antes: 22023', r, 'erro 22023: Data de hoje%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp + 10));
  out := out || pg_temp.expect('reagendar com data a 10 dias: 22023', r, 'erro 22023: Data de hoje%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, 'infinity')$q$, tv));
  out := out || pg_temp.expect('reagendar com p_today infinity: 22023', r, 'erro 22023: Data de hoje (infinity)%');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, '-infinity')$q$, tv));
  out := out || pg_temp.expect('reagendar com p_today -infinity: 22023', r, 'erro 22023: Data de hoje (-infinity)%');
  -- Meta infinita gravada pelo UPDATE direto de study_topics, que o
  -- authenticated ainda tem: 22023, e nenhum prazo muda.
  r := pg_temp.as_user(o, format($q$with u as (update public.study_topics set target_date = 'infinity' where id = %L returning 1) select count(*)::text from u$q$, tv));
  out := out || pg_temp.expect('o UPDATE direto aceita meta infinity', r, 'ok 1');
  xs := pg_temp.vers(tv);
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp));
  out := out || pg_temp.expect('reagendar com meta infinity: 22023', r, 'erro 22023: A data-alvo do tópico (infinity)%');
  r := pg_temp.as_user(o, format($q$with u as (update public.study_topics set target_date = '-infinity' where id = %L returning 1) select count(*)::text from u$q$, tv));
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp));
  out := out || pg_temp.expect('reagendar com meta -infinity: 22023, e nenhum card regravado', format('%s | %s', r, pg_temp.new_tuples(xs, tv)),
                               'erro 22023: A data-alvo do tópico (-infinity)% | 0');

  -- Empate de posição: (sort_order, created_at, id).
  tv := gen_random_uuid();
  set local session_replication_role = replica;
  insert into public.study_topics (id, user_id, title, target_date) values (tv, o, 'empate', sp + 3);
  insert into public.study_cards (user_id, topic_id, title, sort_order, created_at) values
    (o, tv, 'a', 0, '2020-01-02'), (o, tv, 'b', 0, '2020-01-01'), (o, tv, 'c', 1, '2020-01-01');
  set local session_replication_role = origin;
  r := pg_temp.as_user(o, format($q$select string_agg(title || ':' || (due_date - %L::date), ',' order by title) from public.study_reschedule(%L, %L)$q$, sp, tv, sp));
  out := out || pg_temp.expect('reagendar: posição repetida desempata pelo created_at', r, 'ok a:2,b:1,c:3');
  r := pg_temp.as_user(o, format($q$select count(*)::text || ' ' || string_agg((due_date - %L::date)::text, ',' order by sort_order) from public.study_reschedule(%L, %L)$q$, sp, tc, sp));
  out := out || pg_temp.expect('reagendar: só os cards do dono contam (a linha de X fica de fora)', r, 'ok 2 5,10');
  out := out || pg_temp.expect('reagendar: a linha de X no tópico fica sem prazo', (select count(*) from public.study_cards where topic_id = tc and user_id = x and due_date is null)::text, '1');
  tv := gen_random_uuid();
  set local session_replication_role = replica;
  insert into public.study_topics (id, user_id, title, target_date) values (tv, o, 'vazio', sp + 3);
  set local session_replication_role = origin;
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tv, sp));
  out := out || pg_temp.expect('reagendar tópico sem cards', r, 'ok 0');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, t, sp));
  out := out || pg_temp.expect('reagendar tópico sem meta', r, 'erro P0001: O tópico não tem data-alvo');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tx, sp));
  out := out || pg_temp.expect('reagendar tópico de outra pessoa', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(o, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, gen_random_uuid(), sp));
  out := out || pg_temp.expect('reagendar tópico que não existe: a mesma mensagem', r, 'erro P0002: Tópico não encontrado');

  -- 7. Sem usuário e anon, nas 11.
  calls := array[
    format($q$select count(*)::text from public.study_checkpoint_add(%L, 'x')$q$, k),
    format($q$select count(*)::text from public.study_checkpoint_edit(%L, 'p1', 'x')$q$, k),
    format($q$select count(*)::text from public.study_checkpoint_toggle(%L, 'p1')$q$, k),
    format($q$select count(*)::text from public.study_checkpoint_remove(%L, 'p1')$q$, k),
    format($q$select count(*)::text from public.study_resource_add(%L, 'https://a.b')$q$, k),
    format($q$select count(*)::text from public.study_resource_remove(%L, 'r2')$q$, k),
    format($q$select count(*)::text from public.study_quiz_answer(%L, 'q2', '0')$q$, k),
    format($q$select count(*)::text from public.study_quiz_reset(%L)$q$, k),
    format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "x"}]')$q$, t),
    format($q$select count(*)::text from public.study_reschedule(%L)$q$, tc),
    $q$select count(*)::text from public.study_import_topic('{"topic": {"title": "x"}}')$q$];
  select count(*) filter (where pg_temp.try(null, c) = 'erro 42501: not authenticated')::text || '/' || count(*) into r from unnest(calls) c;
  out := out || pg_temp.expect('sem usuário: 42501 nas 11', r, '11/11');
  select count(*) filter (where pg_temp.as_role('anon', c) like 'erro 42501: permission denied for function%')::text || '/' || count(*) into r from unnest(calls) c;
  out := out || pg_temp.expect('anon sem EXECUTE nas 11', r, '11/11');

  -- 8. Estrutura.
  select format('%s %s %s %s %s %s',
                count(*),
                count(*) filter (where not p.prosecdef and p.proconfig = array['search_path=""']),
                count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')),
                count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
                count(*) filter (where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g where g.grantee = 0)),
                count(*) filter (where obj_description(p.oid, 'pg_proc') like 'API-024%'))
    into r
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('study_checkpoint_add', 'study_checkpoint_edit', 'study_checkpoint_toggle', 'study_checkpoint_remove',
                       'study_resource_add', 'study_resource_remove', 'study_quiz_answer', 'study_quiz_reset',
                       'study_cards_append', 'study_import_topic', 'study_reschedule');
  out := out || pg_temp.expect('11 RPCs INVOKER, search_path vazio, anon 0, authenticated 11, PUBLIC 0, COMMENT 11', r, '11 11 0 11 0 11');
  select string_agg(p.proname || ':' || case when p.proretset then 'setof ' else '' end || ty.typname, ', ' order by p.proname) into r
    from pg_proc p join pg_type ty on ty.oid = p.prorettype
   where p.pronamespace = 'public'::regnamespace and p.proname like 'study\_%' and p.proname <> 'study_lookup_cache_prune';
  out := out || pg_temp.expect('retornos', r,
                               'study_cards_append:setof study_cards, study_checkpoint_add:study_cards, study_checkpoint_edit:study_cards, '
                               'study_checkpoint_remove:study_cards, study_checkpoint_toggle:study_cards, study_import_topic:jsonb, '
                               'study_quiz_answer:study_cards, study_quiz_reset:study_cards, study_reschedule:setof study_cards, '
                               'study_resource_add:study_cards, study_resource_remove:study_cards');
  -- akool_api (API-004) herda de authenticated (§1.2): quando o papel existir,
  -- as 11 têm de valer para ele sem grant direto.
  if exists (select 1 from pg_roles where rolname = 'akool_api') then
    select count(*)::text into r from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname like 'study\_%' and p.proname <> 'study_lookup_cache_prune'
       and has_function_privilege('akool_api', p.oid, 'EXECUTE');
    out := out || pg_temp.expect('akool_api executa as 11 por herança', r, '11');
  else
    out := out || pg_temp.expect('akool_api ainda não existe (API-004): caso pulado', 'sem o papel', 'sem o papel');
  end if;
  select format('%s %s',
                (select count(*) from pg_trigger where tgrelid = 'public.study_cards'::regclass and not tgisinternal and tgname ilike '%quiz%'),
                (select count(*) from pg_proc where pronamespace = 'private'::regnamespace and proname ilike '%quiz%' and prorettype = 'trigger'::regtype))
    into r;
  out := out || pg_temp.expect('sem gatilho nem função de trava do quiz (decisão do usuário)', r, '0 0');
  select count(*)::text into r from pg_trigger
   where tgname in ('study_cards_rules', 'study_topics_rules', 'study_logs_rules') and not tgisinternal;
  out := out || pg_temp.expect('os gatilhos do API-021 continuam (a forma depende deles)', r, '3');

  raise exception using message = format(E'API-024 bloco 1: RPCs de Estudos (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;

do $subxact$
declare
  o uuid := gen_random_uuid();
  t uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  cnt int;
  ovf boolean;
  r text;
  out text[] := array[]::text[];
begin
  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 180))
  $f$;

  set local session_replication_role = replica;
  insert into auth.users (id, email) values (o, format('api024-s-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (o, format('api024-s-%s@example.invalid', tag), 'S', 'standard', true, 0);
  insert into public.study_topics (id, user_id, title, status) values (t, o, 'api024 S', 'planned');
  set local session_replication_role = origin;

  -- Sem nenhum EXCEPTION em volta: só a subtransação do append conta.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', o, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  set local role authenticated;
  perform count(*) from public.study_cards_append(t, (select jsonb_agg(jsonb_build_object('title', 'c' || i, 'checkpoints', jsonb_build_array(jsonb_build_object('text', 'p'))))
                                                        from generate_series(1, 70) i));
  reset role;

  -- O retrato de pg_stat_get_backend_* fica em cache na transação: limpa antes de ler.
  perform pg_stat_clear_snapshot();
  select s.subxact_count, s.subxact_overflowed into cnt, ovf
    from pg_stat_get_backend_subxact((select b from pg_stat_get_backend_idset() b where pg_stat_get_backend_pid(b) = pg_backend_pid())) s;
  out := out || pg_temp.expect('append de 70 cards: uma subtransação, sem estourar o cache (subxact_count, overflowed, cards)',
                               format('%s %s %s', cnt, ovf, (select count(*) from public.study_cards where topic_id = t)), '1 f 70');

  -- Controle: 70 blocos com EXCEPTION e escrita (o desenho de um bloco por
  -- card) estouram o cache, então a medida acima enxerga o estouro.
  create temp table api024_subxact (i int) on commit drop;
  for i in 1..70 loop
    begin
      insert into api024_subxact values (i);
    exception when others then
      null;
    end;
  end loop;
  perform pg_stat_clear_snapshot();
  select s.subxact_count, s.subxact_overflowed into cnt, ovf
    from pg_stat_get_backend_subxact((select b from pg_stat_get_backend_idset() b where pg_stat_get_backend_pid(b) = pg_backend_pid())) s;
  out := out || pg_temp.expect('controle: um bloco por escrita estoura (64, overflowed)', format('%s %s', cnt, ovf), '64 t');

  -- Com o bloco único, o erro ainda sai com o índice do card e nada fica.
  begin
    set local role authenticated;
    perform count(*) from public.study_cards_append(t, (select jsonb_agg(case when i = 3 then jsonb_build_object('title', 'ruim', 'resources', '[{"title": "x", "url": "javascript:alert(1)"}]'::jsonb)
                                                                          else jsonb_build_object('title', 'c' || i) end order by i)
                                                          from generate_series(0, 69) i));
    r := 'gravou';
  exception when others then
    r := format('erro %s: %s', sqlstate, sqlerrm);
  end;
  reset role;
  out := out || pg_temp.expect('70 cards com o de índice 3 fora da forma', r, 'erro 23514: cards/3: Recursos fora do formato: item 0: url%');
  out := out || pg_temp.expect('nenhum card dessa chamada ficou', (select count(*) from public.study_cards where topic_id = t)::text, '70');

  raise exception using message = format(E'API-024 subtransações (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$subxact$;

do $bloco2$
declare
  u uuid := gen_random_uuid();
  tu uuid := gen_random_uuid();
  ku uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  sp date := (now() at time zone 'America/Sao_Paulo')::date;
  r text;
  out text[] := array[]::text[];
begin
  if coalesce(current_setting('akool.api024_rls_sim', true), '') <> 'staging' then
    raise exception 'API-024 bloco 2: só no staging, com set_config(''akool.api024_rls_sim'', ''staging'', false) na mesma sessão';
  end if;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 180))
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

  set local session_replication_role = replica;
  insert into auth.users (id, email) values (u, format('api024-r-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (u, format('api024-r-%s@example.invalid', tag), 'R', 'standard', true, 0);
  insert into public.study_topics (id, user_id, title, status, target_date) values (tu, u, 'api024 RLS', 'planned', sp + 10);
  insert into public.study_cards (id, user_id, topic_id, title, sort_order, checkpoints, quiz) values
    (ku, u, tu, 'K', 0, '[{"id": "p1", "text": "Ler", "completed": false}]',
     '[{"id": "q1", "statement": "S1", "answer": "certo", "userAnswer": null}, {"id": "q2", "statement": "S2", "answer": "certo", "userAnswer": "errado"}]');
  set local session_replication_role = origin;

  -- Tópicos invisíveis para quem grava: uma RESTRICTIVE de SELECT que nega
  -- tudo, como a do API-022 para um token sem leitura de study_topics (criada
  -- aqui e desfeita com o resto).
  create policy api024_check_sem_leitura on public.study_topics as restrictive for select to authenticated using (false);
  r := pg_temp.as_user(u, 'select count(*)::text from public.study_topics');
  out := out || pg_temp.expect('com a RESTRICTIVE, quem grava não enxerga os próprios tópicos', r, 'ok 0');
  r := pg_temp.as_user(u, format($q$select checkpoints -> 0 ->> 'completed' from public.study_checkpoint_toggle(%L, 'p1')$q$, ku));
  out := out || pg_temp.expect('toggle continua (só toca study_cards)', r, 'ok true');
  r := pg_temp.as_user(u, format($q$select quiz -> 0 ->> 'userAnswer' from public.study_quiz_answer(%L, 'q1', '"certo"')$q$, ku));
  out := out || pg_temp.expect('answer continua', r, 'ok certo');
  r := pg_temp.as_user(u, format($q$select (select string_agg(coalesce(e ->> 'userAnswer', '-'), ',' order by n) from jsonb_array_elements(quiz) with ordinality q(e, n)) from public.study_quiz_reset(%L, true)$q$, ku));
  out := out || pg_temp.expect('reset continua', r, 'ok certo,-');
  r := pg_temp.as_user(u, format($q$select jsonb_array_length(checkpoints)::text from public.study_checkpoint_add(%L, 'Novo')$q$, ku));
  out := out || pg_temp.expect('conteúdo por item também não lê tópicos (add de ponto continua)', r, 'ok 2');
  r := pg_temp.as_user(u, format($q$select count(*)::text from public.study_cards_append(%L, '[{"title": "x"}]')$q$, tu));
  out := out || pg_temp.expect('append falha fechado', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(u, format($q$select count(*)::text from public.study_reschedule(%L, %L)$q$, tu, sp));
  out := out || pg_temp.expect('reschedule falha fechado', r, 'erro P0002: Tópico não encontrado');
  r := pg_temp.as_user(u, $q$select public.study_import_topic('{"topic": {"title": "x"}}')::text$q$);
  out := out || pg_temp.expect('import falha fechado (o RETURNING do tópico novo esbarra na RESTRICTIVE)', r, 'erro 42501: %');

  raise exception using message = format(E'API-024 bloco 2: RPCs com study_topics invisível, no staging (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco2$;
