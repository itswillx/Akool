-- API-016: recorrentes no servidor (migration
-- 20261008120000_api016_finance_recurring_server).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Cada linha sai "ok" ou "FALHA".
--
-- Bloco 1 (staging e ensaio na produção): pessoas descartáveis A (dona dos
-- recorrentes), B (membro do workspace de A) e C (de fora, com recorrentes
-- próprios para o dia editado). O núcleo é chamado só com p_user := A ou B e
-- datas fixas em 2030 (virada do mês sem depender do relógio); a materialização
-- global (private.finance_materialize_all) nunca roda aqui, para não travar os
-- recorrentes reais. Cobre datas (o vencimento e o limite da data do
-- aparelho), parcelas, orçamentos (parcelado só em mês com parcela, também o
-- de outro membro ainda sem lançamento; fora da janela nunca antes da criação,
-- na janela nos meses da conta; o mais antigo do workspace também no modo
-- usuário, o mês visto), o retorno (todos os orçamentos dos meses, não só os
-- criados), modo usuário, pré-ocupação, pagar, pular, a passagem para pago, o
-- dia editado, grants e o job do cron.
--
-- Bloco 2 (SÓ STAGING): o restore de verdade com lançamento pré-ocupado, dois
-- lançamentos no mesmo mês e pago sem transação (ele apaga as 38 tabelas antes
-- de inserir; tudo desfeito no fim), a materialização global de verdade e o
-- aviso aos admins quando um recorrente falha. Só com o opt-in na sessão:
--   select set_config('akool.api016_full_restore', 'staging', false);
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres, depois da
-- migration (ou no mesmo envio, como ensaio).

do $bloco1$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();   -- workspace de A, com B
  w2 uuid := gen_random_uuid();   -- workspace de C (A não é membro)
  acc_a uuid := gen_random_uuid();
  acc_c uuid := gen_random_uuid();
  cat_p uuid := gen_random_uuid();
  cat_p2 uuid := gen_random_uuid();
  cat_p3 uuid := gen_random_uuid();
  cat_o uuid := gen_random_uuid();
  cat_v uuid := gen_random_uuid();
  cat_r uuid := gen_random_uuid();
  cat_w uuid := gen_random_uuid();
  cat_w2 uuid := gen_random_uuid();
  cat_l1 uuid := gen_random_uuid();
  cat_l4 uuid := gen_random_uuid();
  rp uuid := gen_random_uuid();   -- pessoal, dia 31, 5000, cat_p
  rw uuid := gen_random_uuid();   -- workspace, dia 10, 8000, cat_w
  ro uuid := gen_random_uuid();   -- workspace W2 (A fora), dia 15, 3000
  ri uuid := gen_random_uuid();   -- 3 parcelas: 1 paga, 1 pulada
  rd uuid := gen_random_uuid();   -- dia 20, com pendente no dia 10 de out/2030
  rx uuid := gen_random_uuid();   -- inativo, com pendente
  rv uuid := gen_random_uuid();   -- variável
  rr uuid := gen_random_uuid();   -- receita
  ra1 uuid := gen_random_uuid();  -- cat_p2, 1111 (mais antigo)
  ra2 uuid := gen_random_uuid();  -- cat_p2, 2222
  rm uuid := gen_random_uuid();   -- cat_p3, com orçamento manual em out/2030
  rw2 uuid := gen_random_uuid();  -- workspace, cat_w2, com orçamento de B em out/2030
  rk uuid := gen_random_uuid();   -- 2 parcelas: 1 paga
  rl1 uuid := gen_random_uuid();  -- 1 parcela, cat_l1: a única cai em out/2030
  rl4 uuid := gen_random_uuid();  -- 4 parcelas, cat_l4: out/2030 a jan/2031
  rb uuid := gen_random_uuid();   -- de B no workspace, cat_w
  cat_wi uuid := gen_random_uuid();
  cat_n uuid := gen_random_uuid();
  rwi uuid := gen_random_uuid();  -- de A no workspace, cat_wi, 6 parcelas, sem lançamento (entra depois)
  rbi uuid := gen_random_uuid();  -- de B no workspace, cat_wi, fixo, mais novo (entra depois)
  rn uuid := gen_random_uuid();   -- de A, cat_n, criado em 01/11/2030 00:30 de São Paulo (entra depois)
  rc1 uuid := gen_random_uuid();  -- de C, dia 10 (dia editado)
  rc2 uuid := gen_random_uuid();  -- de C, dia 5, dois pendentes no mês atual
  tx_i uuid := gen_random_uuid();
  tx_k uuid := gen_random_uuid();
  tx_free uuid := gen_random_uuid();
  tx_c uuid := gen_random_uuid();
  e_free uuid;
  e_b uuid;
  t0 timestamptz := '2026-01-01T12:00:00Z';  -- janeiro de 2026 também em São Paulo
  v_sp date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cur date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_prev date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
  v_next date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '1 month')::date;
  v_next2 date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '2 months')::date;
  tag text := substr(md5(random()::text), 1, 6);
  res jsonb;
  r text;
  n int;
  out text[] := array[]::text[];
begin
  -- as_user: SQL como authenticated com os claims da pessoa; 'ok <resultado>'
  -- ou 'erro <sqlstate>: <mensagem>'. try: claims (ou nenhum) sem trocar de
  -- papel, como o cron, a migration e o restore (service_role sem sub). O
  -- resultado só é lido de SELECT, WITH ou RETURNING.
  create function pg_temp.as_user(p_uid uuid, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    if p_sql ~* '^\s*(select|with)\M' or p_sql ~* '\mreturning\M' then
      execute p_sql into v_res;
    else
      execute p_sql;
    end if;
    reset role;
    perform set_config('request.jwt.claims', '', true);
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
    if p_sql ~* '^\s*(select|with)\M' or p_sql ~* '\mreturning\M' then
      execute p_sql into v_res;
    else
      execute p_sql;
    end if;
    perform set_config('request.jwt.claims', '', true);
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

  -- O núcleo sem claims (como o cron), só para uma pessoa, numa data fixa e,
  -- opcionalmente, com o mês visto: 'criados falhas orçamentos falhas_orç
  -- lançamentos_devolvidos orçamentos_devolvidos'.
  create function pg_temp.core(p_user uuid, p_today date, p_month date default null)
  returns text
  language plpgsql
  as $f$
  declare
    v jsonb;
  begin
    perform set_config('request.jwt.claims', '', true);
    v := private.finance_materialize_core(p_user, p_today, p_month);
    return format('%s %s %s %s %s %s', v ->> 'created', v ->> 'failed', v ->> 'budgets_created', v ->> 'budgets_failed',
                  jsonb_array_length(v -> 'entries'), jsonb_array_length(v -> 'budgets'));
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  -- Meses dos orçamentos de uma categoria, em ordem.
  create function pg_temp.months(p_cat uuid)
  returns text
  language sql
  as $f$
    select coalesce(string_agg(bu.month, ',' order by bu.month), '-')
      from public.finance_budgets bu where bu.category_id = p_cat
  $f$;

  -- Datas das linhas de um recorrente, em ordem.
  create function pg_temp.dates(p_rec uuid)
  returns text
  language sql
  as $f$
    select coalesce(string_agg(e.due_date::text, ',' order by e.due_date), '-')
      from public.finance_recurring_entries e where e.recurring_id = p_rec
  $f$;

  create function pg_temp.entry(p_rec uuid, p_due date)
  returns uuid
  language sql
  as $f$
    select e.id from public.finance_recurring_entries e where e.recurring_id = p_rec and e.due_date = p_due
  $f$;

  -- Fixtures sem gatilhos.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (a, format('api016-a-%s@example.invalid', tag)), (b, format('api016-b-%s@example.invalid', tag)),
    (c, format('api016-c-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api016-a-%s@example.invalid', tag), 'A', 'standard', true, 0),
    (b, format('api016-b-%s@example.invalid', tag), 'B', 'standard', true, 0),
    (c, format('api016-c-%s@example.invalid', tag), 'C', 'standard', true, 0);
  insert into public.finance_workspaces (id, name, owner_id) values (ws, 'api016', a), (w2, 'api016 C', c);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, b, 'member'), (w2, c, 'owner');
  insert into public.finance_accounts (id, user_id, name, type) values (acc_a, a, 'Conta de A', 'checking'), (acc_c, c, 'Conta de C', 'checking');
  insert into public.finance_categories (id, user_id, name, type, workspace_id) values
    (cat_p, a, 'api016 P', 'expense', null), (cat_p2, a, 'api016 P2', 'expense', null), (cat_p3, a, 'api016 P3', 'expense', null),
    (cat_o, a, 'api016 O', 'expense', null), (cat_v, a, 'api016 V', 'expense', null), (cat_r, a, 'api016 R', 'income', null),
    (cat_w, a, 'api016 W', 'expense', ws), (cat_w2, a, 'api016 W2', 'expense', ws),
    (cat_l1, a, 'api016 L1', 'expense', null), (cat_l4, a, 'api016 L4', 'expense', null);
  insert into public.finance_recurring (id, user_id, type, description, amount, is_variable, category_id, account_id, day_of_month, active, total_installments, workspace_id, created_at) values
    (rp,  a, 'expense', 'RP',  5000, false, cat_p,  acc_a, 31, true,  null, null, t0 + interval '1 minute'),
    (rw,  a, 'expense', 'RW',  8000, false, cat_w,  acc_a, 10, true,  null, ws,   t0 + interval '2 minutes'),
    (ro,  a, 'expense', 'RO',  3000, false, cat_o,  acc_a, 15, true,  null, w2,   t0 + interval '3 minutes'),
    (ri,  a, 'expense', 'RI',  1000, false, null,   acc_a,  5, true,  3,    null, t0 + interval '4 minutes'),
    (rd,  a, 'expense', 'RD',  2000, false, null,   acc_a, 20, true,  null, null, t0 + interval '5 minutes'),
    (rx,  a, 'expense', 'RX',  1500, false, null,   acc_a, 12, false, null, null, t0 + interval '6 minutes'),
    (rv,  a, 'expense', 'RV',  null, true,  cat_v,  acc_a,  8, true,  null, null, t0 + interval '7 minutes'),
    (rr,  a, 'income',  'RR',  9000, false, cat_r,  acc_a,  1, true,  null, null, t0 + interval '8 minutes'),
    (ra1, a, 'expense', 'RA1', 1111, false, cat_p2, acc_a,  3, true,  null, null, t0 + interval '9 minutes'),
    (ra2, a, 'expense', 'RA2', 2222, false, cat_p2, acc_a,  4, true,  null, null, t0 + interval '10 minutes'),
    (rm,  a, 'expense', 'RM',  4000, false, cat_p3, acc_a,  6, true,  null, null, t0 + interval '11 minutes'),
    (rw2, a, 'expense', 'RW2', 6000, false, cat_w2, acc_a,  7, true,  null, ws,   t0 + interval '12 minutes'),
    (rk,  a, 'expense', 'RK',   700, false, null,   acc_a,  9, true,  2,    null, t0 + interval '13 minutes'),
    (rl1, a, 'expense', 'RL1',  600, false, cat_l1, acc_a, 10, true,  1,    null, t0 + interval '14 minutes'),
    (rl4, a, 'expense', 'RL4',  400, false, cat_l4, acc_a, 12, true,  4,    null, t0 + interval '15 minutes'),
    (rb,  b, 'expense', 'RB',  7000, false, cat_w,  null,  11, true,  null, ws,   t0 + interval '20 minutes'),
    (rc1, c, 'expense', 'RC1',  100, false, null,   acc_c, 10, true,  null, null, t0 + interval '21 minutes'),
    (rc2, c, 'expense', 'RC2',  100, false, null,   acc_c,  5, true,  null, null, t0 + interval '22 minutes');
  insert into public.finance_transactions (id, user_id, type, amount, description, date, account_id) values
    (tx_i, a, 'expense', 1000, 'RI', '2030-08-05', acc_a), (tx_k, a, 'expense', 700, 'RK', '2030-09-09', acc_a),
    (tx_free, a, 'expense', 5000, 'livre', '2030-10-31', acc_a), (tx_c, c, 'expense', 100, 'de C', '2030-10-31', acc_c);
  insert into public.finance_recurring_entries (user_id, recurring_id, due_date, status, amount, transaction_id) values
    (a, ri, '2030-08-05', 'paid', 1000, tx_i), (a, ri, '2030-09-05', 'skipped', null, null),
    (a, rd, '2030-10-10', 'pending', null, null), (a, rx, '2030-10-12', 'pending', null, null),
    (a, rk, '2030-09-09', 'paid', 700, tx_k),
    (c, rc1, v_prev + 9, 'pending', null, null), (c, rc1, v_cur + 9, 'pending', null, null),
    (c, rc1, v_next + 9, 'pending', null, null), (c, rc1, v_next2 + 9, 'pending', null, tx_c),
    (c, rc2, v_cur + 4, 'pending', null, null), (c, rc2, v_cur + 11, 'pending', null, null);
  insert into public.finance_budgets (user_id, category_id, month, amount_limit, workspace_id) values
    (a, cat_p3, '2030-10', 999, null), (b, cat_w2, '2030-10', 555, ws);
  set local session_replication_role = origin;

  -- 1. Datas. Vencimento: dia limitado ao último do mês.
  r := concat_ws(',', private.finance_recurring_due_date('2027-02-01', 31), private.finance_recurring_due_date('2028-02-01', 31),
                 private.finance_recurring_due_date('2026-04-15', 31), private.finance_recurring_due_date('2026-10-20', 5));
  out := out || pg_temp.expect('31/02 vira 28/02, 29/02 no bissexto, 31/04 vira 30/04, dia 5 fica', r, '2027-02-28,2028-02-29,2026-04-30,2026-10-05');
  -- Data do aparelho: ±1 dia da referência, com referências fixas que viram o
  -- mês (31/10 e 01/11/2030), para um limite errado não passar por coincidir
  -- de mês com o certo.
  r := concat_ws(',', private.finance_clamp_today('2000-01-01', '2030-10-31'), private.finance_clamp_today('2999-01-01', '2030-10-31'),
                 private.finance_clamp_today('2030-10-31', '2030-10-31'), coalesce(private.finance_clamp_today(null, '2030-10-31')::text, 'nula'),
                 private.finance_clamp_today('2000-01-01', '2030-11-01'), private.finance_clamp_today('2030-11-02', '2030-10-31'),
                 private.finance_clamp_today('2030-10-30', '2030-10-31'));
  out := out || pg_temp.expect('data do aparelho: 2000 vira ref−1, 2999 vira ref+1 (novembro), ref fica, nula vira ref, 2000 com ref 01/11 vira 31/10, ±1 fica',
    r, '2030-10-30,2030-11-01,2030-10-31,2030-10-31,2030-10-31,2030-11-01,2030-10-30');

  -- 2. Núcleo sem claims (cron), só para A, em 31/10/2030: outubro e novembro.
  -- Devolve todos os orçamentos dos dois meses que A enxerga: os pessoais e os
  -- do workspace, inclusive o manual e o de B.
  r := pg_temp.core(a, '2030-10-31');
  out := out || pg_temp.expect('núcleo: 24 lançamentos e 11 orçamentos criados, 26 lançamentos (criados + os 2 que já estavam) e 13 orçamentos devolvidos', r, '24 0 11 0 26 13');
  out := out || pg_temp.expect('dia 31: 31/10 e 30/11', pg_temp.dates(rp), '2030-10-31,2030-11-30');
  out := out || pg_temp.expect('3 parcelas com 1 paga e 1 pulada: só mais 1 (pulada conta no teto)', pg_temp.dates(ri), '2030-08-05,2030-09-05,2030-10-05');
  out := out || pg_temp.expect('2 parcelas com 1 paga: só mais 1', pg_temp.dates(rk), '2030-09-09,2030-10-09');
  out := out || pg_temp.expect('parcelado de 1: a única parcela em outubro', pg_temp.dates(rl1), '2030-10-10');
  out := out || pg_temp.expect('parcelado com a última parcela em outubro: orçamento só em outubro, não em novembro', pg_temp.months(cat_l1), '2030-10');
  out := out || pg_temp.expect('parcelado de 4: parcelas e orçamentos em out e nov', pg_temp.dates(rl4) || ' ' || pg_temp.months(cat_l4), '2030-10-12,2030-11-12 2030-10,2030-11');
  out := out || pg_temp.expect('dia editado: outubro já tem (dia 10), novembro nasce no dia 20', pg_temp.dates(rd), '2030-10-10,2030-11-20');
  out := out || pg_temp.expect('inativo não ganha lançamento', pg_temp.dates(rx), '2030-10-12');
  out := out || pg_temp.expect('workspace com o dono fora: lançamentos nascem', pg_temp.dates(ro), '2030-10-15,2030-11-15');
  out := out || pg_temp.expect('variável e receita ganham lançamento', pg_temp.dates(rv) || ' ' || pg_temp.dates(rr), '2030-10-08,2030-11-08 2030-10-01,2030-11-01');
  out := out || pg_temp.expect('o núcleo não toca recorrente de outra pessoa', pg_temp.dates(rb), '-');
  select string_agg(format('%s %s %s', bu.month, bu.user_id = a, bu.amount_limit::bigint), ',' order by bu.month) into r
    from public.finance_budgets bu where bu.workspace_id = ws and bu.category_id = cat_w;
  out := out || pg_temp.expect('workspace: orçamento do workspace em out e nov, de A, 8000', r, '2030-10 t 8000,2030-11 t 8000');
  select string_agg(bu.amount_limit::bigint::text, ',' order by bu.month) into r from public.finance_budgets bu where bu.category_id = cat_p2;
  out := out || pg_temp.expect('duas na mesma categoria: um orçamento por mês, do mais antigo', r, '1111,1111');
  select string_agg(format('%s %s', bu.month, bu.amount_limit::bigint), ',' order by bu.month) into r from public.finance_budgets bu where bu.category_id = cat_p3;
  out := out || pg_temp.expect('orçamento manual em outubro fica; novembro automático', r, '2030-10 999,2030-11 4000');
  select string_agg(format('%s %s', bu.month, case when bu.user_id = b then 'B' else 'A' end), ',' order by bu.month) into r from public.finance_budgets bu where bu.category_id = cat_w2;
  out := out || pg_temp.expect('orçamento de B no workspace bloqueia outubro; novembro de A', r, '2030-10 B,2030-11 A');
  select count(*) into n from public.finance_budgets bu where bu.category_id in (cat_o, cat_v, cat_r);
  out := out || pg_temp.expect('sem orçamento: dono fora do workspace, variável e receita', n::text, '0');
  select string_agg(bu.month, ',' order by bu.month) into r from public.finance_budgets bu where bu.category_id = cat_p and bu.user_id = a and bu.workspace_id is null;
  out := out || pg_temp.expect('pessoal: orçamento em out e nov', r, '2030-10,2030-11');

  r := pg_temp.core(a, '2030-10-31');
  out := out || pg_temp.expect('idempotente: rodar de novo não cria nada e devolve de novo os 13 orçamentos dos meses', r, '0 0 0 0 26 13');
  delete from public.finance_budgets bu where bu.category_id = cat_p and bu.month = '2030-10';
  r := pg_temp.core(a, '2030-10-31');
  out := out || pg_temp.expect('orçamento automático apagado volta (decisão do usuário)', r, '0 0 1 0 26 13');
  r := pg_temp.core(a, '2030-11-01');
  out := out || pg_temp.expect('virada: 01/11 cria só dezembro (11 lançamentos, 6 orçamentos); devolve nov e dez', r, '11 0 6 0 22 12');
  out := out || pg_temp.expect('dia 31 em dezembro', pg_temp.dates(rp), '2030-10-31,2030-11-30,2030-12-31');
  out := out || pg_temp.expect('parcelado de 1 encerrado em outubro: nem novembro nem dezembro ganham orçamento na virada', pg_temp.months(cat_l1), '2030-10');

  -- Mês visto (o 3º parâmetro): só orçamentos, nunca lançamento.
  r := pg_temp.core(a, '2030-11-01', '2031-01-15');
  out := out || pg_temp.expect('mês visto jan/2031: 6 orçamentos só de janeiro, nenhum lançamento; devolve nov, dez e jan', r, '0 0 6 0 22 18');
  select count(*) into n from public.finance_recurring_entries e where e.user_id = a and e.due_date >= '2031-01-01';
  out := out || pg_temp.expect('nenhum lançamento em janeiro', n::text, '0');
  r := pg_temp.core(a, '2030-11-01', '2031-02-01');
  out := out || pg_temp.expect('mês visto fev/2031: 5 orçamentos (o parcelado de 4 acaba em janeiro)', r, '0 0 5 0 22 17');
  out := out || pg_temp.expect('parcelado de 4: orçamento até a última parcela por vir (jan), não depois', pg_temp.months(cat_l4), '2030-10,2030-11,2030-12,2031-01');
  r := pg_temp.core(a, '2030-11-01', '2025-12-01');
  out := out || pg_temp.expect('mês visto antes da criação dos recorrentes (jan/2026): nada', r, '0 0 0 0 22 12');
  r := pg_temp.core(a, '2030-11-01', '2026-01-01');
  out := out || pg_temp.expect('mês visto = mês da criação: os 5 fixos ganham; parcelado sem parcela nele, não', r, '0 0 5 0 22 17');
  out := out || pg_temp.expect('o parcelado de 4 não ganha orçamento em mês passado sem parcela', pg_temp.months(cat_l4), '2030-10,2030-11,2030-12,2031-01');
  r := pg_temp.core(a, '2030-11-01', '2030-12-01');
  out := out || pg_temp.expect('mês visto dentro da janela: nada a mais', r, '0 0 0 0 22 12');

  r := pg_temp.core(b, '2030-10-31');
  out := out || pg_temp.expect('B: lançamentos de RB; os orçamentos do workspace (de A e de B) bloqueiam e voltam no retorno', r, '2 0 0 0 2 4');
  delete from public.finance_budgets bu where bu.workspace_id = ws and bu.category_id = cat_w and bu.month = '2030-11';
  r := pg_temp.core(b, '2030-10-31');
  out := out || pg_temp.expect('B, sem o orçamento do workspace em novembro: recria', r, '0 0 1 0 2 4');
  select string_agg(format('%s %s', case when bu.user_id = a then 'A' else 'B' end, bu.amount_limit::bigint), ',') into r
    from public.finance_budgets bu where bu.workspace_id = ws and bu.category_id = cat_w and bu.month = '2030-11';
  out := out || pg_temp.expect('no modo usuário de B, o do workspace sai do recorrente mais antigo (de A, 8000), como no cron', coalesce(r, 'nenhum'), 'A 8000');

  -- Parcelado de A ainda sem lançamento (criado pelo banco ou pela API, ou a
  -- materialização dele falhou), mais antigo que um fixo de B na mesma
  -- categoria do workspace, sem orçamento. B chama antes de A: o passo dos
  -- lançamentos só roda para os de B, e o parcelado de A conta a 1ª parcela no
  -- 1º mês da janela (out), a 6ª em mar/2031. O orçamento sai de A, como se A
  -- ou o cron chamassem primeiro; antes da janela e depois da 6ª, do fixo de B.
  set local session_replication_role = replica;
  insert into public.finance_categories (id, user_id, name, type, workspace_id) values (cat_wi, a, 'api016 WI', 'expense', ws);
  insert into public.finance_recurring (id, user_id, type, description, amount, is_variable, category_id, account_id, day_of_month, active, total_installments, workspace_id, created_at) values
    (rwi, a, 'expense', 'RWI', 8000, false, cat_wi, acc_a, 10, true, 6,    ws, t0 + interval '16 minutes'),
    (rbi, b, 'expense', 'RBI', 7000, false, cat_wi, null,  11, true, null, ws, t0 + interval '23 minutes');
  set local session_replication_role = origin;
  r := pg_temp.core(b, '2030-10-31');
  select string_agg(format('%s %s %s', bu.month, case when bu.user_id = a then 'A' else 'B' end, bu.amount_limit::bigint), ',' order by bu.month) into r
    from public.finance_budgets bu where bu.category_id = cat_wi;
  out := out || pg_temp.expect('parcelado de A sem lançamento, mais antigo que o fixo de B: B chama antes de A e o orçamento sai de A; as parcelas de A não nascem',
    coalesce(r, 'nenhum') || ' ' || pg_temp.dates(rwi), '2030-10 A 8000,2030-11 A 8000 -');
  r := pg_temp.core(b, '2030-10-31', '2030-09-01');
  r := pg_temp.core(b, '2030-10-31', '2031-03-01');
  r := pg_temp.core(b, '2030-10-31', '2031-04-01');
  select string_agg(format('%s %s', bu.month, case when bu.user_id = a then 'A' else 'B' end), ',' order by bu.month) into r
    from public.finance_budgets bu where bu.category_id = cat_wi;
  out := out || pg_temp.expect('mês visto pela chamada de B: set (antes da janela) e abr/2031 (depois da 6ª) de B; mar/2031 (a 6ª) de A',
    coalesce(r, 'nenhum'), '2030-09 B,2030-10 A,2030-11 A,2031-03 A,2031-04 B');
  r := pg_temp.core(a, '2030-10-31');
  out := out || pg_temp.expect('depois A chama: as parcelas de A nascem nos meses dos orçamentos de A',
    pg_temp.dates(rwi) || ' ' || coalesce((select string_agg(bu.month, ',' order by bu.month) from public.finance_budgets bu
                                            where bu.category_id = cat_wi and bu.user_id = a and bu.month < '2031-01'), '-'),
    '2030-10-10,2030-11-10 2030-10,2030-11');

  -- Aparelho a oeste de São Paulo na virada do mês: o recorrente foi criado em
  -- 01/11/2030 00:30 de São Paulo (31/10 23:30 em Manaus) e o aparelho manda
  -- 31/10, que o limite de ±1 dia aceita. A conta de outubro nasce e o
  -- orçamento de outubro também (a janela do aparelho); mês visto antes da
  -- janela e da criação continua sem nada.
  set local session_replication_role = replica;
  insert into public.finance_categories (id, user_id, name, type, workspace_id) values (cat_n, a, 'api016 N', 'expense', null);
  insert into public.finance_recurring (id, user_id, type, description, amount, is_variable, category_id, account_id, day_of_month, active, total_installments, workspace_id, created_at) values
    (rn, a, 'expense', 'RN', 3000, false, cat_n, acc_a, 31, true, null, null, '2030-11-01T03:30:00Z');
  set local session_replication_role = origin;
  r := pg_temp.core(a, private.finance_clamp_today('2030-10-31', ('2030-11-01T03:30:00Z'::timestamptz at time zone 'America/Sao_Paulo')::date));
  out := out || pg_temp.expect('criado em 01/11 00:30 de São Paulo com o aparelho em 31/10: conta e orçamento em out e nov',
    pg_temp.dates(rn) || ' ' || pg_temp.months(cat_n), '2030-10-31,2030-11-30 2030-10,2030-11');
  r := pg_temp.core(a, '2030-10-31', '2030-09-01');
  select count(*) into n from public.finance_budgets bu where bu.category_id = cat_n and bu.month = '2030-09';
  out := out || pg_temp.expect('o mesmo recorrente, mês visto set/2030 (antes da janela e da criação): nada', n::text, '0');
  r := pg_temp.core(a, null);
  out := out || pg_temp.expect('núcleo exige a data', r, 'erro 22023:%');

  -- 3. Pré-ocupação: o lançamento é do dono do recorrente.
  r := pg_temp.as_user(b, format($q$insert into public.finance_recurring_entries (user_id, recurring_id, due_date) values (%L, %L, '2031-01-10')$q$, b, rw));
  out := out || pg_temp.expect('B não ocupa o mês do recorrente de A', r, 'erro 42501:%');
  r := pg_temp.as_user(b, format($q$insert into public.finance_recurring_entries (user_id, recurring_id, due_date) values (%L, %L, '2031-01-11') returning id::text$q$, b, rb));
  out := out || pg_temp.expect('B insere no próprio recorrente', r, 'ok %');
  e_b := pg_temp.entry(rb, '2031-01-11');
  r := pg_temp.as_user(b, format($q$update public.finance_recurring_entries set recurring_id = %L where id = %L$q$, rw, e_b));
  out := out || pg_temp.expect('B não reaponta o próprio lançamento para o recorrente de A', r, 'erro 42501:%');
  r := pg_temp.as_user(a, format($q$insert into public.finance_recurring_entries (user_id, recurring_id, due_date) values (%L, %L, '2031-01-31') returning id::text$q$, a, rp));
  out := out || pg_temp.expect('A insere no próprio recorrente', r, 'ok %');
  r := pg_temp.as_user(a, format($q$update public.finance_recurring_entries set due_date = '2031-01-30' where id = %L$q$, pg_temp.entry(rp, '2031-01-31')));
  out := out || pg_temp.expect('A não muda a data direto (fora do grant)', r, 'erro 42501:%');
  r := pg_temp.as_user(a, format($q$update public.finance_recurring_entries set user_id = %L where id = %L$q$, b, pg_temp.entry(rp, '2031-01-31')));
  out := out || pg_temp.expect('A não passa o lançamento para B', r, 'erro 42501:%');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.finance_recurring_entries (user_id, recurring_id, due_date) values (%L, %L, '2031-02-10')$q$, b, rw));
  out := out || pg_temp.expect('service_role sem sub (restore) insere como no backup', r, 'ok %');
  r := pg_temp.try(jsonb_build_object('role', 'authenticated'), format($q$insert into public.finance_recurring_entries (user_id, recurring_id, due_date) values (%L, %L, '2031-03-10')$q$, b, rw));
  out := out || pg_temp.expect('JWT authenticated sem sub continua conferido', r, 'erro 42501:%');

  -- 4. Pagar.
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rw, '2030-10-10')));
  out := out || pg_temp.expect('A paga o recorrente do workspace', r, 'ok %"already_paid": false%');
  select format('%s %s %s %s %s', t.workspace_id = ws, t.amount::bigint, t.date, t.category_id = cat_w, e.status)
    into r from public.finance_recurring_entries e join public.finance_transactions t on t.id = e.transaction_id
   where e.id = pg_temp.entry(rw, '2030-10-10');
  out := out || pg_temp.expect('a transação herda o workspace, o valor, a data e a categoria', r, 't 8000 2030-10-10 t paid');
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rw, '2030-10-10')));
  out := out || pg_temp.expect('pagar de novo devolve already_paid', r, 'ok %"already_paid": true%');
  select count(*) into n from public.finance_transactions t where t.user_id = a and t.description = 'RW';
  out := out || pg_temp.expect('e uma transação só', n::text, '1');
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(ro, '2030-10-15')));
  select format('%s %s', r like 'ok %', coalesce(t.workspace_id::text, 'pessoal')) into r
    from public.finance_recurring_entries e join public.finance_transactions t on t.id = e.transaction_id
   where e.id = pg_temp.entry(ro, '2030-10-15');
  out := out || pg_temp.expect('dono fora do workspace: a transação fica pessoal', coalesce(r, 'sem transação'), 't pessoal');
  r := pg_temp.as_user(b, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('B (membro) não paga o lançamento de A', r, 'erro P0002:%');
  r := pg_temp.as_user(c, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('C (de fora) não paga', r, 'erro P0002:%');
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rv, '2030-10-08')));
  out := out || pg_temp.expect('variável sem valor', r, 'erro 22023:%');
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L, 0)::text$q$, pg_temp.entry(rv, '2030-10-08')));
  out := out || pg_temp.expect('valor 0', r, 'erro 22023:%');
  r := pg_temp.as_user(a, format($q$select (public.finance_mark_entry_paid(%L, 1234) -> 'entry' ->> 'amount')$q$, pg_temp.entry(rv, '2030-10-08')));
  out := out || pg_temp.expect('variável com valor', r, 'ok 1234%');
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L, null, null, %L)::text$q$, pg_temp.entry(rr, '2030-10-01'), acc_c));
  out := out || pg_temp.expect('conta de C', r, 'erro P0002:%');
  r := pg_temp.as_user(a, format($q$select (public.finance_mark_entry_paid(%L, null, '2030-10-02', %L) -> 'transaction' ->> 'date')$q$, pg_temp.entry(rr, '2030-10-01'), acc_a));
  out := out || pg_temp.expect('conta e data informadas', r, 'ok 2030-10-02');
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(ri, '2030-09-05')));
  out := out || pg_temp.expect('pulado não é pago', r, 'erro P0001:%');
  r := pg_temp.as_user(a, format($q$select (public.finance_mark_entry_paid(%L) -> 'entry' ->> 'status')$q$, pg_temp.entry(rx, '2030-10-12')));
  out := out || pg_temp.expect('recorrente inativo: pendente é pago (a Visão geral mostra)', r, 'ok paid');
  r := pg_temp.as_user(a, format($q$select (public.finance_mark_entry_paid(%L) -> 'recurring' ->> 'active')$q$, pg_temp.entry(ri, '2030-10-05')));
  out := out || pg_temp.expect('última parcela (com uma pulada) encerra o recorrente', r, 'ok false');
  select active::text into r from public.finance_recurring where id = ri;
  out := out || pg_temp.expect('o recorrente ficou inativo', r, 'false');

  -- Atomicidade: o UPDATE do lançamento falha e a transação criada é desfeita.
  execute format($f$create function public.api016_boom() returns trigger language plpgsql as $b$
    begin if new.id = %L then raise exception 'api016 boom'; end if; return new; end $b$$f$, pg_temp.entry(rp, '2030-10-31'));
  create trigger api016_boom before update on public.finance_recurring_entries for each row execute function public.api016_boom();
  select count(*) into n from public.finance_transactions where user_id = a;
  r := pg_temp.as_user(a, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('falha no meio: erro sobe', r, 'erro P0001: api016 boom%');
  select format('%s %s', count(*) - n, (select status from public.finance_recurring_entries where id = pg_temp.entry(rp, '2030-10-31')))
    into r from public.finance_transactions where user_id = a;
  out := out || pg_temp.expect('nenhuma transação ficou e o lançamento segue pendente', r, '0 pending');
  drop trigger api016_boom on public.finance_recurring_entries;
  drop function public.api016_boom();
  r := pg_temp.try(null, format($q$select public.finance_mark_entry_paid(%L)::text$q$, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('pagar exige sessão de usuário', r, 'erro 42501:%');

  -- 5. Pular.
  r := pg_temp.as_user(a, format($q$select (public.finance_skip_entry(%L) -> 'entry' ->> 'status')$q$, pg_temp.entry(rp, '2030-11-30')));
  out := out || pg_temp.expect('A pula', r, 'ok skipped');
  r := pg_temp.as_user(a, format($q$select (public.finance_skip_entry(%L) -> 'entry' ->> 'status')$q$, pg_temp.entry(rp, '2030-11-30')));
  out := out || pg_temp.expect('pular de novo devolve sem mudar', r, 'ok skipped');
  r := pg_temp.as_user(b, format($q$select public.finance_skip_entry(%L)::text$q$, pg_temp.entry(rp, '2030-12-31')));
  out := out || pg_temp.expect('B não pula o lançamento de A', r, 'erro P0002:%');
  r := pg_temp.as_user(a, format($q$select public.finance_skip_entry(%L)::text$q$, pg_temp.entry(rw, '2030-10-10')));
  out := out || pg_temp.expect('pago não é pulado', r, 'erro P0001:%');
  r := pg_temp.as_user(a, format($q$select (public.finance_skip_entry(%L) -> 'recurring' ->> 'active')$q$, pg_temp.entry(rk, '2030-10-09')));
  out := out || pg_temp.expect('pular a última parcela encerra (pulada conta)', r, 'ok false');

  -- 6. Passagem para pago só com transação da própria pessoa.
  r := pg_temp.as_user(a, format($q$update public.finance_recurring_entries set status = 'paid' where id = %L$q$, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('UPDATE direto para pago sem transação', r, 'erro 23514:%');
  r := pg_temp.as_user(a, format($q$update public.finance_recurring_entries set status = 'paid', transaction_id = %L where id = %L$q$, tx_c, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('com transação de outra pessoa', r, 'erro 42501:%');
  r := pg_temp.as_user(a, format($q$insert into public.finance_recurring_entries (user_id, recurring_id, due_date, status) values (%L, %L, '2031-03-31', 'paid')$q$, a, rp));
  out := out || pg_temp.expect('INSERT já pago sem transação', r, 'erro 23514:%');
  r := pg_temp.as_user(a, format($q$with u as (update public.finance_recurring_entries set status = 'paid', amount = 5000, transaction_id = %L where id = %L returning 1) select count(*)::text from u$q$, tx_free, pg_temp.entry(rp, '2030-10-31')));
  out := out || pg_temp.expect('o caminho do app antigo (transação própria + 3 colunas) passa', r, 'ok 1');
  e_free := pg_temp.entry(rp, '2030-12-31');
  r := pg_temp.try(null, format($q$update public.finance_recurring_entries set status = 'paid' where id = %L$q$, e_free));
  out := out || pg_temp.expect('sem claims (restore, cron) nada barra', r, 'ok %');

  -- 7. Dia editado: pendentes do mês atual em diante vão para o dia novo.
  r := pg_temp.as_user(c, format($q$update public.finance_recurring set day_of_month = 31 where id = %L$q$, rc1));
  out := out || pg_temp.expect('C muda o dia do recorrente', r, 'ok %');
  out := out || pg_temp.expect('mês passado e o que tem transação ficam; atual e seguinte vão para o dia 31', pg_temp.dates(rc1),
    concat_ws(',', v_prev + 9, private.finance_recurring_due_date(v_cur, 31), private.finance_recurring_due_date(v_next, 31), v_next2 + 9));
  r := pg_temp.as_user(c, format($q$update public.finance_recurring set day_of_month = 25 where id = %L$q$, rc2));
  out := out || pg_temp.expect('dois pendentes no mesmo mês: muda o dia sem erro', r, 'ok %');
  out := out || pg_temp.expect('o primeiro vai para o 25; o segundo bateria nele e fica', pg_temp.dates(rc2), concat_ws(',', v_cur + 11, v_cur + 24));

  -- 8. Modo usuário (a RPC do app): só os recorrentes de quem chama, data do
  -- aparelho limitada a ±1 dia do hoje de São Paulo (o limite em si está
  -- provado na seção 1). O fuso da sessão não conta.
  set local timezone = 'Pacific/Kiritimati';
  select format('%s %s', p.prosrc like '%private.finance_clamp_today(p_today, v_sp)%', p.prosrc like '%private.finance_materialize_core(v_uid, %')
    into r from pg_proc p where p.oid = 'public.finance_materialize_recurring(date, date)'::regprocedure;
  out := out || pg_temp.expect('a RPC passa a data do aparelho por finance_clamp_today, com o hoje de São Paulo', coalesce(r, 'sem a RPC'), 't t');
  r := pg_temp.as_user(a, $q$select public.finance_materialize_recurring('2000-01-01')::text$q$);
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  out := out || pg_temp.expect('A com a data do aparelho errada: roda sem falha', coalesce(format('%s %s', res ->> 'failed', res ->> 'budgets_failed'), r), '0 0');
  select count(*) into n from public.finance_recurring_entries e where e.user_id = a and e.due_date < '2001-01-01';
  out := out || pg_temp.expect('a data é limitada: nada em 2000', n::text, '0');
  select count(*) into n from public.finance_recurring_entries e
   where e.recurring_id = rp and e.due_date >= date_trunc('month', (v_sp - 1)::timestamp)::date
     and e.due_date < (date_trunc('month', (v_sp - 1)::timestamp) + interval '1 month')::date;
  out := out || pg_temp.expect('o lançamento nasce no mês de hoje − 1 dia (São Paulo)', n::text, '1');
  select format('%s %s', count(*) > 0, coalesce(bool_and((x ->> 'due_date')::date >= date_trunc('month', (v_sp - 1)::timestamp)::date
                                                     and (x ->> 'due_date')::date < (date_trunc('month', (v_sp - 1)::timestamp) + interval '2 months')::date), false))
    into r from jsonb_array_elements(res -> 'entries') x;
  out := out || pg_temp.expect('2000: a janela devolvida é a do mês de hoje − 1 dia e o seguinte', r, 't t');
  r := pg_temp.as_user(a, $q$select public.finance_materialize_recurring()::text$q$);
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  select count(*) into n from public.finance_recurring_entries e
   where e.recurring_id = rp and e.due_date >= v_cur and e.due_date < v_next2;
  out := out || pg_temp.expect('sem data: o hoje de São Paulo (mês atual e seguinte)', n::text, '2');
  out := out || pg_temp.expect('sem data: sem falha', coalesce(format('%s %s', res ->> 'failed', res ->> 'budgets_failed'), r), '0 0');
  select string_agg(format('%s %s', bu.user_id = a, bu.amount_limit::bigint), ',') into r from public.finance_budgets bu
   where bu.workspace_id = ws and bu.category_id = cat_w and bu.month = to_char(v_sp, 'YYYY-MM');
  out := out || pg_temp.expect('com sessão de A, a guarda do workspace deixa o orçamento do workspace nascer', coalesce(r, 'nenhum'), 't 8000');
  select format('%s %s', bool_and(x ->> 'user_id' = a::text), bool_and((x ->> 'due_date')::date >= v_cur and (x ->> 'due_date')::date < v_next2))
    into r from jsonb_array_elements(res -> 'entries') x;
  out := out || pg_temp.expect('devolve só lançamentos de A, na janela', r, 't t');
  select format('%s %s', count(*) > 0, count(*) filter (where not ((x ->> 'workspace_id' is null and x ->> 'user_id' = a::text)
                                                                   or x ->> 'workspace_id' = ws::text)
                                                         or x ->> 'month' not in (to_char(v_cur, 'YYYY-MM'), to_char(v_next, 'YYYY-MM'))))
    into r from jsonb_array_elements(res -> 'budgets') x;
  out := out || pg_temp.expect('orçamentos devolvidos: os pessoais de A e os do workspace, só dos dois meses', r, 't 0');

  -- O mês visto na tela: só orçamentos dele, a até 12 meses do mês de São Paulo.
  r := pg_temp.as_user(a, format($q$select public.finance_materialize_recurring(null, %L)::text$q$, (v_cur + interval '3 months 14 days')::date));
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  select string_agg(format('%s %s', bu.user_id = a, bu.amount_limit::bigint), ',') into r from public.finance_budgets bu
   where bu.category_id = cat_p and bu.workspace_id is null and bu.month = to_char(v_cur + interval '3 months', 'YYYY-MM');
  out := out || pg_temp.expect('mês visto +3 (qualquer dia dele): o orçamento automático nasce', coalesce(r, 'nenhum'), 't 5000');
  out := out || pg_temp.expect('e nenhum lançamento', coalesce(format('%s %s', res ->> 'created', res ->> 'failed'), r), '0 0');
  select count(*) into n from jsonb_array_elements(res -> 'budgets') x
   where x ->> 'category_id' = cat_p::text and x ->> 'month' = to_char(v_cur + interval '3 months', 'YYYY-MM');
  out := out || pg_temp.expect('e volta no retorno', n::text, '1');
  r := pg_temp.as_user(a, format($q$select public.finance_materialize_recurring(null, %L)::text$q$, (v_cur + interval '12 months')::date));
  select count(*) into n from public.finance_budgets bu
   where bu.category_id = cat_p and bu.workspace_id is null and bu.month = to_char(v_cur + interval '12 months', 'YYYY-MM');
  out := out || pg_temp.expect('mês visto +12: ainda nasce', n::text, '1');
  r := pg_temp.as_user(a, format($q$select public.finance_materialize_recurring(null, %L)::text$q$, (v_cur + interval '13 months')::date));
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  select format('%s %s', res ->> 'budgets_created', count(*)) into r from jsonb_array_elements(res -> 'budgets') x
   where x ->> 'month' = to_char(v_cur + interval '13 months', 'YYYY-MM');
  out := out || pg_temp.expect('mês visto +13: ignorado', coalesce(r, 'erro'), '0 0');
  r := pg_temp.as_user(a, format($q$select public.finance_materialize_recurring(null, %L)::text$q$, (v_cur - interval '13 months')::date));
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  select format('%s %s', res ->> 'budgets_created', count(*)) into r from jsonb_array_elements(res -> 'budgets') x
   where x ->> 'month' = to_char(v_cur - interval '13 months', 'YYYY-MM');
  out := out || pg_temp.expect('mês visto −13: ignorado', coalesce(r, 'erro'), '0 0');

  r := pg_temp.as_user(a, $q$select public.finance_materialize_recurring('2999-01-01')::text$q$);
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  select count(*) into n from public.finance_recurring_entries e where e.user_id = a and e.due_date >= '2100-01-01';
  out := out || pg_temp.expect('data no futuro distante também é limitada', n::text, '0');
  select format('%s %s', count(*) > 0, coalesce(bool_and((x ->> 'due_date')::date >= date_trunc('month', (v_sp + 1)::timestamp)::date
                                                     and (x ->> 'due_date')::date < (date_trunc('month', (v_sp + 1)::timestamp) + interval '2 months')::date), false))
    into r from jsonb_array_elements(res -> 'entries') x;
  out := out || pg_temp.expect('2999: a janela devolvida é a do mês de hoje + 1 dia e o seguinte', r, 't t');
  select count(*) into n from public.finance_recurring_entries e where e.recurring_id = rb and e.due_date >= v_cur and e.due_date < v_next2;
  out := out || pg_temp.expect('a chamada de A não toca o recorrente de B', n::text, '0');
  r := pg_temp.as_user(c, $q$select public.finance_materialize_recurring()::text$q$);
  res := case when r like 'ok %' then substr(r, 4)::jsonb end;
  select format('%s %s', count(*) > 0, coalesce(bool_and(x ->> 'user_id' = c::text), false)) into r from jsonb_array_elements(res -> 'entries') x;
  out := out || pg_temp.expect('C recebe só os dele', r, 't t');
  r := pg_temp.try(null, $q$select public.finance_materialize_recurring()::text$q$);
  out := out || pg_temp.expect('a RPC exige sessão de usuário', r, 'erro 42501:%');
  r := pg_temp.try(jsonb_build_object('role', 'authenticated'), $q$select public.finance_materialize_recurring()::text$q$);
  out := out || pg_temp.expect('JWT authenticated sem sub também', r, 'erro 42501:%');
  set local timezone = 'UTC';

  -- 9. Grants e estrutura.
  r := format('%s %s %s %s %s %s %s %s',
    has_table_privilege('authenticated', 'public.finance_recurring_entries', 'UPDATE'),
    has_column_privilege('authenticated', 'public.finance_recurring_entries', 'status', 'UPDATE'),
    has_column_privilege('authenticated', 'public.finance_recurring_entries', 'amount', 'UPDATE'),
    has_column_privilege('authenticated', 'public.finance_recurring_entries', 'transaction_id', 'UPDATE'),
    has_column_privilege('authenticated', 'public.finance_recurring_entries', 'recurring_id', 'UPDATE'),
    has_column_privilege('authenticated', 'public.finance_recurring_entries', 'user_id', 'UPDATE'),
    has_column_privilege('authenticated', 'public.finance_recurring_entries', 'due_date', 'UPDATE'),
    has_table_privilege('authenticated', 'public.finance_recurring_entries', 'SELECT')
      and has_table_privilege('authenticated', 'public.finance_recurring_entries', 'INSERT')
      and has_table_privilege('authenticated', 'public.finance_recurring_entries', 'DELETE'));
  out := out || pg_temp.expect('authenticated: UPDATE só em status, amount e transaction_id; SELECT/INSERT/DELETE ficam', r, 'f t t t f f f t');
  r := format('%s %s', has_table_privilege('service_role', 'public.finance_recurring_entries', 'UPDATE'),
              has_table_privilege('authenticated', 'public.finance_recurring', 'UPDATE'));
  out := out || pg_temp.expect('service_role e a tabela de recorrentes não mudam', r, 't t');
  select string_agg(format('%s=%s', attname, attacl), '; ' order by attnum) into r
    from pg_attribute where attrelid = 'public.finance_recurring_entries'::regclass and attacl is not null;
  out := out || pg_temp.expect('attacl de finance_recurring_entries', coalesce(r, '(vazio)'),
    'status={authenticated=w/postgres}; amount={authenticated=w/postgres}; transaction_id={authenticated=w/postgres}');
  select string_agg(format('%s %s %s %s %s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                           has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')), '; ' order by p.proname)
    into r from pg_proc p
   where p.oid in ('public.finance_materialize_recurring(date, date)'::regprocedure, 'public.finance_mark_entry_paid(uuid, bigint, date, uuid)'::regprocedure,
                   'public.finance_skip_entry(uuid)'::regprocedure);
  out := out || pg_temp.expect('RPCs: materializar DEFINER, pagar e pular INVOKER, search_path vazio, só authenticated', r,
    'finance_mark_entry_paid f search_path="" f t; finance_materialize_recurring t search_path="" f t; finance_skip_entry f search_path="" f t');
  select string_agg(format('%s %s %s %s', p.proname, p.prosecdef,
                           has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE')), '; ' order by p.proname)
    into r from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname like 'finance\_%';
  out := out || pg_temp.expect('private: sem EXECUTE para clientes', r,
    'finance_clamp_today f f f; finance_materialize_all t f f; finance_materialize_core t f f; finance_recurring_day_moved t f f; finance_recurring_due_date f f f; finance_recurring_entry_guard t f f');
  select string_agg(t.tgname, ',' order by t.tgname) into r from pg_trigger t
   where t.tgrelid in ('public.finance_recurring_entries'::regclass, 'public.finance_recurring'::regclass) and not t.tgisinternal
     and t.tgname like 'finance\_recurring%';
  out := out || pg_temp.expect('gatilhos', r, 'finance_recurring_day_moved,finance_recurring_entries_guard');
  select format('%s %s %s', j.schedule, j.command, j.active) into r from cron.job j where j.jobname = 'finance-recurring-materialize';
  out := out || pg_temp.expect('job do cron às 00:05 de São Paulo', coalesce(r, 'sem job'), '5 3 * * * select private.finance_materialize_all() t');

  raise exception using message = format(E'API-016 bloco 1: recorrentes no servidor (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$bloco1$;

do $bloco2$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  m uuid := gen_random_uuid();   -- admin, recebe o aviso de falha
  ws uuid := gen_random_uuid();
  cat_a uuid := gen_random_uuid();
  cat_w uuid := gen_random_uuid();
  ra uuid := gen_random_uuid();   -- pessoal de A, com lançamento pré-ocupado por B e dois no mesmo mês
  rw uuid := gen_random_uuid();   -- de A no workspace
  rf uuid := gen_random_uuid();   -- de A, que vai falhar
  v_cur date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_next2 date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '2 months')::date;
  tag text := substr(md5(random()::text), 1, 6);
  payload jsonb;
  summary jsonb;
  res jsonb;
  r text;
  n int;
  out text[] := array[]::text[];
begin
  if coalesce(current_setting('akool.api016_full_restore', true), '') <> 'staging' then
    raise exception 'API-016 bloco 2: só no staging, com set_config(''akool.api016_full_restore'', ''staging'', false) na mesma sessão';
  end if;

  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (a, format('api016-ra-%s@example.invalid', tag)), (b, format('api016-rb-%s@example.invalid', tag)), (m, format('api016-rm-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api016-ra-%s@example.invalid', tag), 'A', 'standard', true, 0),
    (b, format('api016-rb-%s@example.invalid', tag), 'B', 'standard', true, 0),
    (m, format('api016-rm-%s@example.invalid', tag), 'M', 'admin', true, 0);
  insert into public.finance_workspaces (id, name, owner_id) values (ws, 'api016 restore', a);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, b, 'member');
  insert into public.finance_categories (id, user_id, name, type, workspace_id) values
    (cat_a, a, 'api016 RA', 'expense', null), (cat_w, a, 'api016 RW', 'expense', ws);
  insert into public.finance_recurring (id, user_id, type, description, amount, is_variable, category_id, day_of_month, active, workspace_id) values
    (ra, a, 'expense', 'RA', 5000, false, cat_a, 10, true, null),
    (rw, a, 'expense', 'RW', 8000, false, cat_w, 12, true, ws),
    (rf, a, 'expense', 'RF', 300, false, null, 15, true, null);
  -- Dado antigo fora das regras novas: pré-ocupado (de B no recorrente de A),
  -- dois no mesmo mês (o dia editado de antes) e pago sem transação.
  insert into public.finance_recurring_entries (user_id, recurring_id, due_date, status) values
    (b, ra, '2026-01-10', 'pending'), (a, ra, '2026-02-10', 'pending'), (a, ra, '2026-02-20', 'pending'),
    (a, ra, '2026-03-10', 'paid');
  set local session_replication_role = origin;

  payload := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(t)) from public.profiles t where t.id in (a, b, m)),
    'finance_workspaces', (select jsonb_agg(to_jsonb(t)) from public.finance_workspaces t where t.id = ws),
    'finance_workspace_members', (select jsonb_agg(to_jsonb(t)) from public.finance_workspace_members t where t.workspace_id = ws),
    'finance_categories', (select jsonb_agg(to_jsonb(t)) from public.finance_categories t where t.id in (cat_a, cat_w)),
    'finance_recurring', (select jsonb_agg(to_jsonb(t)) from public.finance_recurring t where t.user_id = a),
    'finance_recurring_entries', (select jsonb_agg(to_jsonb(t)) from public.finance_recurring_entries t where t.recurring_id = ra)
  );

  -- Como a edge function site-backup chama: service_role, sem usuário.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    summary := public.restore_site_backup(payload);
    select count(*) into n from public.finance_recurring_entries where recurring_id = ra;
    out := out || format('%s restauração com lançamento pré-ocupado, dois no mesmo mês e pago sem transação conclui → recorrentes: %s, lançamentos: %s, no banco: %s',
                         case when (summary ->> 'finance_recurring') = '3' and (summary ->> 'finance_recurring_entries') = '4' and n = 4 then 'ok   ' else 'FALHA' end,
                         summary ->> 'finance_recurring', summary ->> 'finance_recurring_entries', n);
  exception when others then
    out := out || format('FALHA restauração → erro %s: %s', sqlstate, sqlerrm);
  end;

  -- O job de verdade, sem claims (como o pg_cron). Depois do restore, o banco
  -- só tem as linhas do payload.
  perform set_config('request.jwt.claims', '', true);
  begin
    res := private.finance_materialize_all();
    select count(*) into n from public.finance_recurring_entries e
     where e.recurring_id in (ra, rw, rf) and e.due_date >= v_cur and e.due_date < v_next2;
    out := out || format('%s materialização global (cron) → %s; lançamentos no mês atual e no seguinte: %s',
                         case when res ->> 'failed' = '0' and res ->> 'budgets_failed' = '0' and n = 6 then 'ok   ' else 'FALHA' end, res, n);
    select count(*) into n from public.finance_budgets bu where bu.workspace_id = ws and bu.category_id = cat_w and bu.user_id = a;
    out := out || format('%s cron sem usuário cria o orçamento do workspace → %s', case when n = 2 then 'ok   ' else 'FALHA' end, n);
  exception when others then
    out := out || format('FALHA materialização global → erro %s: %s', sqlstate, sqlerrm);
  end;

  -- Um recorrente que falha: os outros seguem e os admins são avisados uma vez por dia.
  begin
    delete from public.finance_recurring_entries where recurring_id = rf;
    execute format($f$create function public.api016_boom() returns trigger language plpgsql as $b$
      begin if new.recurring_id = %L then raise exception 'api016 boom'; end if; return new; end $b$$f$, rf);
    create trigger api016_boom before insert on public.finance_recurring_entries for each row execute function public.api016_boom();
    res := private.finance_materialize_all();
    res := res || jsonb_build_object('de_novo', private.finance_materialize_all());
    select count(*) into n from public.notifications nt where nt.user_id = m and nt.type = 'finance_recurring_failed';
    out := out || format('%s recorrente com falha conta em failed e avisa o admin uma vez → %s; avisos: %s',
                         case when res ->> 'failed' = '1' and res -> 'de_novo' ->> 'failed' = '1' and n = 1 then 'ok   ' else 'FALHA' end, res, n);
    drop trigger api016_boom on public.finance_recurring_entries;
    drop function public.api016_boom();
  exception when others then
    out := out || format('FALHA aviso de falha → erro %s: %s', sqlstate, sqlerrm);
  end;

  raise exception using message = format(E'API-016 bloco 2: restauração e cron no staging (tudo desfeito)\n%s', array_to_string(out, E'\n'));
end
$bloco2$;
