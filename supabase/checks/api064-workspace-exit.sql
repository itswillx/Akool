-- API-064 + API-065: sair do workspace e remover membro (migration
-- 20261014120000_api064_065_workspace_exit).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Rode cada bloco numa chamada própria.
--
-- Bloco 0 (produção ANTES do apply, e staging): o levantamento, só contagens,
-- sem id, nome ou valor. O resultado entra no cabeçalho da migration.
--
-- Bloco 1 (staging e ensaio na produção): cada linha sai "ok" ou "FALHA", e a
-- última conta as "ok" (N/N ok). Tem duas partes com o mesmo preâmbulo e as
-- mesmas fixtures (a 2ª começa no marcador "parte 2"), que o ensaio roda em
-- chamadas separadas quando o texto passa do tamanho de uma chamada. No ensaio
-- na produção, o corpo da migration entra logo depois do "begin" do bloco (no
-- marcador "ensaio:"), e o RAISE do fim desfaz tudo.
--
-- Pessoas descartáveis: D (dona e criadora do W), F, G e H (membros), X
-- (ex-membro antigo, com sobras no W) e C (de fora). D e F abrem Finanças pelo
-- app (bootstrap_finance_categories, como o usuário) e D cria o W pelo
-- create_workspace, que semeia no W as 12 categorias com os nomes das
-- pessoais: é o caso da colisão (23505) da criadora. O resto das fixtures vai
-- em replica. Cada cenário roda num sub-bloco desfeito e parte das mesmas
-- fixtures:
--   1. F sai (leave_workspace), com a Loja cruzada: cliente, fornecedor e
--      produto de F usados por D; item de F na venda de D; item de D na venda
--      de F; receita e despesa cruzadas nos dois sentidos, inclusive com venda
--      e compra PRIVADAS de D; contas usadas por outros; categorias;
--      shared_with com e sem outro vínculo; empréstimos ficam (API-067);
--   2. D remove F (remove_workspace_member), F com linhas nas 6 tabelas;
--   3. a criadora sai com membros (a posse passa e as categorias ficam);
--   4. todos saem e a criadora, por último, apaga o W (categorias renomeadas
--      com o nome do W; sobras pela saída (a); a categoria do ex-membro
--      renomeada na cascata) e o caso do pagamento de empréstimo (API-067);
--   5. o gatilho de categorias pelo cliente (CategoryModal), com número, e
--      sem usuário;
--   6. sobra antiga (fixture sem filiação) e venda travada resolvidas pelo
--      private.finance_workspace_reconcile;
--   7. a guarda: pelo cliente (membro ativo, não-dona, a dona barrada pela
--      guarda e pelo RLS, empréstimos), pela DEFINER (o GUC akool.ws_release),
--      JWT sem sub, DELETE direto da filiação e do W (0 linhas) e o contexto
--      sem usuário (restore);
--   8. as mensagens das RPCs, iguais às de antes;
--   9. estrutura: DEFINER, search_path, EXECUTE, os 16 gatilhos da guarda, o
--      gatilho de categorias, sem as policies de DELETE e as 40 DEFINER do
--      sec012.
--
-- A concorrência (sair × remover em duas sessões) fica no roteiro manual: as
-- duas RPCs começam com SELECT ... FOR UPDATE na filiação de quem chama.
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres, depois da
-- migration (ou, no ensaio, com o corpo da migration no marcador).

do $bloco0$
declare
  r text;
  out text[] := array[]::text[];
begin
  select format('%s / %s / %s', (select count(*) from public.finance_workspaces),
                (select count(*) from public.finance_workspace_members),
                (select count(*) from (select workspace_id from public.finance_workspace_members group by 1 having count(*) > 1) x))
    into r;
  out := out || ('1 workspaces / membros / workspaces com 2+ membros: ' || r);

  with ws_rows as (
    select 'transactions' as t, user_id, workspace_id from public.finance_transactions
    union all select 'budgets', user_id, workspace_id from public.finance_budgets
    union all select 'accounts', user_id, workspace_id from public.finance_accounts
    union all select 'categories', user_id, workspace_id from public.finance_categories
    union all select 'goals', user_id, workspace_id from public.finance_goals
    union all select 'recurring', user_id, workspace_id from public.finance_recurring
    union all select 'store_products', user_id, workspace_id from public.finance_store_products
    union all select 'store_purchases', user_id, workspace_id from public.finance_store_purchases
    union all select 'store_sales', user_id, workspace_id from public.finance_store_sales
    union all select 'store_sale_items', user_id, workspace_id from public.finance_store_sale_items
    union all select 'store_customers', user_id, workspace_id from public.finance_store_customers
    union all select 'suppliers', user_id, workspace_id from public.finance_suppliers
    union all select 'loan_borrowers', user_id, workspace_id from public.finance_loan_borrowers
    union all select 'loans', user_id, workspace_id from public.finance_loans
    union all select 'loan_payments', user_id, workspace_id from public.finance_loan_payments
    union all select 'loan_collaterals', user_id, workspace_id from public.finance_loan_collaterals
  )
  select coalesce(string_agg(format('%s=%s(%s)', t, total, orfas), ' ' order by t), 'nenhuma')
    into r
    from (select t, count(*) as total,
                 count(*) filter (where not exists (select 1 from public.finance_workspace_members m
                                                     where m.workspace_id = w.workspace_id and m.user_id = w.user_id)) as orfas
            from ws_rows w where w.workspace_id is not null group by t) x;
  out := out || ('2 linhas em workspace por tabela: total(de autor que não é membro dele; o backfill trata as 12 que não são categorias nem empréstimos): ' || r);

  select format('dona=%s membro=%s fora=%s',
                count(*) filter (where m.role = 'owner'), count(*) filter (where m.role = 'member'), count(*) filter (where m.user_id is null))
    into r
    from public.finance_categories c
    left join public.finance_workspace_members m on m.workspace_id = c.workspace_id and m.user_id = c.user_id
   where c.workspace_id is not null
     and exists (select 1 from public.finance_categories p
                  where p.user_id = c.user_id and p.workspace_id is null and p.name = c.name and p.type = c.type);
  out := out || ('3 categorias do W com gêmea pessoal do autor, por papel (eram 23505 ao sair; agora renomeadas só na cascata e no CategoryModal): ' || r);

  select format('compra→produto=%s compra→fornecedor=%s compra→despesa=%s compra→conta=%s item→produto=%s item→venda=%s venda→cliente=%s venda→receita=%s venda→conta=%s',
           (select count(*) from public.finance_store_purchases pu join public.finance_store_products p on p.id = pu.product_id where p.user_id <> pu.user_id),
           (select count(*) from public.finance_store_purchases pu join public.finance_suppliers s on s.id = pu.supplier_id where s.user_id <> pu.user_id),
           (select count(*) from public.finance_store_purchases pu join public.finance_transactions t on t.id = pu.transaction_id where t.user_id <> pu.user_id),
           (select count(*) from public.finance_store_purchases pu join public.finance_accounts a on a.id = pu.account_id where a.user_id <> pu.user_id),
           (select count(*) from public.finance_store_sale_items i join public.finance_store_products p on p.id = i.product_id where p.user_id <> i.user_id),
           (select count(*) from public.finance_store_sale_items i join public.finance_store_sales s on s.id = i.sale_id where s.user_id <> i.user_id),
           (select count(*) from public.finance_store_sales s join public.finance_store_customers c on c.id = s.customer_id where c.user_id <> s.user_id),
           (select count(*) from public.finance_store_sales s join public.finance_transactions t on t.id = s.transaction_id where t.user_id <> s.user_id),
           (select count(*) from public.finance_store_sales s join public.finance_accounts a on a.id = s.account_id where a.user_id <> s.user_id))
    into r;
  out := out || ('4 referências cruzadas (linha de uma pessoa apontando a de outra): ' || r);

  select format('%s / %s',
           (select count(*) from public.finance_store_sales s join public.finance_transactions t on t.id = s.transaction_id
             where t.user_id <> s.user_id and not (t.workspace_id is not null and exists (
               select 1 from public.finance_workspace_members m where m.workspace_id = t.workspace_id and m.user_id = s.user_id))),
           (select count(*) from public.finance_store_purchases pu join public.finance_transactions t on t.id = pu.transaction_id
             where t.user_id <> pu.user_id and not (t.workspace_id is not null and exists (
               select 1 from public.finance_workspace_members m where m.workspace_id = t.workspace_id and m.user_id = pu.user_id))))
    into r;
  out := out || ('5 vendas / compras com receita ou despesa fora do escopo do dono (travadas hoje; o backfill desvincula): ' || r);

  select format('%s / %s',
           (select count(*) from public.finance_store_sales s join public.finance_transactions t on t.id = s.transaction_id
             where s.workspace_id is null and t.workspace_id is not null and t.user_id <> s.user_id),
           (select count(*) from public.finance_store_purchases pu join public.finance_transactions t on t.id = pu.transaction_id
             where pu.workspace_id is null and t.workspace_id is not null and t.user_id <> pu.user_id))
    into r;
  out := out || ('6 vendas / compras PRIVADAS com receita ou despesa no W de outra pessoa: ' || r);

  select format('%s', count(*)) into r
    from public.finance_accounts a
   where a.workspace_id is not null
     and exists (select 1 from public.finance_transactions t where t.account_id = a.id and t.user_id <> a.user_id);
  out := out || ('7 contas de workspace usadas em lançamento de outra pessoa (ficam no W quando o dono sai): ' || r);

  select format('transações=%s orçamentos=%s',
           (select count(*) from public.finance_transactions t where t.workspace_id is not null and t.shared_with_user_id is not null and t.shared_with_user_id <> t.user_id),
           (select count(*) from public.finance_budgets b where b.workspace_id is not null and b.shared_with_user_id is not null and b.shared_with_user_id <> b.user_id))
    into r;
  out := out || ('8 linhas de workspace com shared_with de outra pessoa (limpo na saída dela, se não houver outro vínculo): ' || r);

  select count(*)::text into r from public.finance_workspaces w
   where not exists (select 1 from public.finance_workspace_members m where m.workspace_id = w.id and m.user_id = w.owner_id and m.role = 'owner')
      or (select count(*) from public.finance_workspace_members m where m.workspace_id = w.id and m.role = 'owner') <> 1;
  out := out || ('9 workspaces com dona inconsistente (owner_id sem role owner, ou 0 ou 2+ donas): ' || r);

  raise exception using message = format(E'API-064 bloco 0: levantamento (só contagens, nada gravado)\n%s', array_to_string(out, E'\n'));
end
$bloco0$;

do $bloco1$
declare
  ud uuid := gen_random_uuid();
  uf uuid := gen_random_uuid();
  ug uuid := gen_random_uuid();
  uh uuid := gen_random_uuid();
  ux uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  ws uuid;
  ws_other uuid := gen_random_uuid();
  acc_d uuid := gen_random_uuid();
  acc_fu uuid := gen_random_uuid();
  acc_fo uuid := gen_random_uuid();
  cat_fw uuid := gen_random_uuid();
  cat_fp uuid := gen_random_uuid();
  cat_b uuid := gen_random_uuid();
  cat_u uuid := gen_random_uuid();
  cust_f uuid := gen_random_uuid();
  cust_h uuid := gen_random_uuid();
  cust_x uuid := gen_random_uuid();
  sup_f uuid := gen_random_uuid();
  p_f uuid := gen_random_uuid();
  p_d uuid := gen_random_uuid();
  tx_fd uuid := gen_random_uuid();
  tx_fdp uuid := gen_random_uuid();
  tx_df uuid := gen_random_uuid();
  tx_fe uuid := gen_random_uuid();
  tx_fep uuid := gen_random_uuid();
  tx_de uuid := gen_random_uuid();
  tx_ff uuid := gen_random_uuid();
  tx_fo uuid := gen_random_uuid();
  tx_dfu uuid := gen_random_uuid();
  tx_dsh uuid := gen_random_uuid();
  tx_gsh uuid := gen_random_uuid();
  tx_xp uuid := gen_random_uuid();
  tx_x uuid := gen_random_uuid();
  b_f uuid := gen_random_uuid();
  b_gsh uuid := gen_random_uuid();
  g_f uuid := gen_random_uuid();
  g_d uuid := gen_random_uuid();
  r_f uuid := gen_random_uuid();
  pu_f uuid := gen_random_uuid();
  pu_df uuid := gen_random_uuid();
  pu_dp uuid := gen_random_uuid();
  pu_f2 uuid := gen_random_uuid();
  pu_d uuid := gen_random_uuid();
  s_d uuid := gen_random_uuid();
  s_dn uuid := gen_random_uuid();
  s_dp uuid := gen_random_uuid();
  s_dx uuid := gen_random_uuid();
  s_f uuid := gen_random_uuid();
  s_f2 uuid := gen_random_uuid();
  i_dd uuid := gen_random_uuid();
  i_fd uuid := gen_random_uuid();
  i_dpf uuid := gen_random_uuid();
  i_dp uuid := gen_random_uuid();
  i_ff uuid := gen_random_uuid();
  i_df uuid := gen_random_uuid();
  i_f2 uuid := gen_random_uuid();
  lb_f uuid := gen_random_uuid();
  l_f uuid := gen_random_uuid();
  lp_f uuid := gen_random_uuid();
  lc_f uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  wsname text;
  sp date := (now() at time zone 'America/Sao_Paulo')::date;
  ym text := to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM');
  v jsonb;
  r text;
  out text[] := array[]::text[];
begin
  -- ensaio: o corpo da migration entra aqui

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
    perform set_config('request.jwt.claims', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  -- O cliente com o GUC da saída (b) forjado. Pelo PostgREST nenhum cliente
  -- liga um GUC akool.*: aqui é para provar que o RLS também barra.
  create function pg_temp.as_user_guc(p_uid uuid, p_guc text, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    perform set_config('akool.ws_release', p_guc, true);
    set local role authenticated;
    execute p_sql into v_res;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('akool.ws_release', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  -- Como postgres (sem RLS, como dentro de uma função DEFINER), com os claims
  -- (null = sem usuário: restore, cron) e o GUC dados.
  create function pg_temp.try(p_claims jsonb, p_guc text, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    perform set_config('akool.ws_release', coalesce(p_guc, ''), true);
    execute p_sql into v_res;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('akool.ws_release', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(coalesce(p_got, 'null'), 220))
  $f$;

  -- O que p_uid enxerga das linhas de p_of, pelo RLS.
  create function pg_temp.sees(p_uid uuid, p_of uuid)
  returns text
  language sql
  as $f$
    select pg_temp.as_user(p_uid, format($q$select format('cli=%%s forn=%%s prod=%%s comp=%%s vend=%%s itens=%%s tx=%%s conta=%%s',
      (select count(*) from public.finance_store_customers where user_id = %1$L),
      (select count(*) from public.finance_suppliers where user_id = %1$L),
      (select count(*) from public.finance_store_products where user_id = %1$L),
      (select count(*) from public.finance_store_purchases where user_id = %1$L),
      (select count(*) from public.finance_store_sales where user_id = %1$L),
      (select count(*) from public.finance_store_sale_items where user_id = %1$L),
      (select count(*) from public.finance_transactions where user_id = %1$L),
      (select count(*) from public.finance_accounts where user_id = %1$L))$q$, p_of))
  $f$;

  -- O UPDATE que tira uma linha do workspace, devolvendo quantas mudaram.
  create function pg_temp.to_private(p_table text, p_id uuid)
  returns text
  language sql
  as $f$
    select format($q$with u as (update public.%I set workspace_id = null where id = %L returning 1) select count(*)::text from u$q$, p_table, p_id)
  $f$;

  -- Fixtures. Pessoas em replica; D e F abrem Finanças e D cria o W pelo app.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (ud, format('api064-d-%s@example.invalid', tag)), (uf, format('api064-f-%s@example.invalid', tag)),
    (ug, format('api064-g-%s@example.invalid', tag)), (uh, format('api064-h-%s@example.invalid', tag)),
    (ux, format('api064-x-%s@example.invalid', tag)), (uc, format('api064-c-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (ud, format('api064-d-%s@example.invalid', tag), 'D', 'standard', true, 0),
    (uf, format('api064-f-%s@example.invalid', tag), 'F', 'standard', true, 0),
    (ug, format('api064-g-%s@example.invalid', tag), 'G', 'standard', true, 0),
    (uh, format('api064-h-%s@example.invalid', tag), 'H', 'standard', true, 0),
    (ux, format('api064-x-%s@example.invalid', tag), 'X', 'standard', true, 0),
    (uc, format('api064-c-%s@example.invalid', tag), 'C', 'standard', true, 0);
  set local session_replication_role = origin;

  wsname := 'api064 W ' || tag;
  r := pg_temp.as_user(ud, format('select public.bootstrap_finance_categories(%L)::text', ud));
  out := out || pg_temp.expect('fixture: D abre Finanças (bootstrap_finance_categories, como D)', r, 'ok ');
  r := pg_temp.as_user(uf, format('select public.bootstrap_finance_categories(%L)::text', uf));
  out := out || pg_temp.expect('fixture: F abre Finanças', r, 'ok ');
  r := pg_temp.as_user(ud, format('select public.create_workspace(%L)::text', wsname));
  out := out || pg_temp.expect('fixture: D cria o W (create_workspace, como D)', r, 'ok %');
  ws := substr(r, 4)::uuid;
  select format('%s %s %s', count(*) filter (where c.workspace_id is null), count(*) filter (where c.workspace_id = ws),
                count(*) filter (where c.workspace_id = ws and exists (
                  select 1 from public.finance_categories p where p.user_id = ud and p.workspace_id is null and p.name = c.name and p.type = c.type)))
    into r from public.finance_categories c where c.user_id = ud;
  out := out || pg_temp.expect('fixture: D com 12 categorias pessoais, 12 no W, as 12 com o mesmo nome (a colisão da criadora)', r, '12 12 12');

  set local session_replication_role = replica;
  -- F é o membro mais antigo (herda a posse quando D sai com membros).
  insert into public.finance_workspace_members (workspace_id, user_id, role, joined_at) values
    (ws, uf, 'member', now() - interval '3 days'), (ws, ug, 'member', now() - interval '2 days'), (ws, uh, 'member', now() - interval '1 day');
  insert into public.finance_accounts (id, user_id, workspace_id, name, type) values
    (acc_d, ud, ws, 'W da D', 'checking'), (acc_fu, uf, ws, 'De F, usada por D', 'checking'), (acc_fo, uf, ws, 'Só de F', 'checking');
  insert into public.finance_categories (id, user_id, workspace_id, name, type) values
    (cat_fw, uf, ws, 'api064 Pets', 'expense'), (cat_fp, uf, null, 'api064 Pets', 'expense');
  insert into public.finance_store_customers (id, user_id, workspace_id, name, phone) values
    (cust_f, uf, ws, 'Cliente de F', '11 9999-0000'), (cust_h, uh, ws, 'Cliente de H', ''), (cust_x, ux, ws, 'Cliente de X (saiu antes)', '');
  insert into public.finance_suppliers (id, user_id, workspace_id, name) values (sup_f, uf, ws, 'Fornecedor de F');
  insert into public.finance_store_products (id, user_id, workspace_id, kind, name, target_price) values
    (p_f, uf, ws, 'stock', 'Produto de F', 5000), (p_d, ud, ws, 'stock', 'Produto de D', 5000);
  insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date, account_id, category_id, shared_with_user_id) values
    (tx_fd, uf, ws, 'income', 100, 'F: receita da venda de D', sp, acc_d, null, null),
    (tx_fdp, uf, ws, 'income', 100, 'F: receita da venda PRIVADA de D', sp, acc_d, null, null),
    (tx_df, ud, ws, 'income', 100, 'D: receita da venda de F', sp, acc_d, null, null),
    (tx_fe, uf, ws, 'expense', 100, 'F: despesa da compra de D', sp, acc_d, null, null),
    (tx_fep, uf, ws, 'expense', 100, 'F: despesa da compra PRIVADA de D', sp, acc_d, null, null),
    (tx_de, ud, ws, 'expense', 100, 'D: despesa da compra de F', sp, acc_d, null, null),
    (tx_ff, uf, ws, 'expense', 100, 'F: despesa da própria compra', sp, acc_fo, null, null),
    (tx_fo, uf, ws, 'expense', 10, 'F: lançamento comum', sp, acc_fo, cat_fw, null),
    (tx_dfu, ud, ws, 'expense', 10, 'D: na conta de F', sp, acc_fu, null, null),
    (tx_dsh, ud, ws, 'expense', 10, 'D: compartilhado com F (meta em comum)', sp, acc_d, null, uf),
    (tx_gsh, ug, ws, 'expense', 10, 'G: compartilhado com F (sem outro vínculo)', sp, null, null, uf),
    (tx_xp, ux, null, 'income', 100, 'X: receita privada da venda de D (legado)', sp, null, null, null),
    (tx_x, ux, ws, 'expense', 10, 'X: sobra antiga', sp, null, null, null);
  insert into public.finance_budgets (id, user_id, workspace_id, category_id, month, amount_limit, shared_with_user_id) values
    (b_f, uf, ws, cat_fw, ym, 100, null), (b_gsh, ug, ws, cat_fw, ym, 100, uf);
  insert into public.finance_goals (id, user_id, workspace_id, name, target_amount, deadline) values
    (g_f, uf, ws, 'Meta de F', 100, sp + 30), (g_d, ud, null, 'Meta de D com F', 100, sp + 30);
  insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (g_d, ud, uf);
  insert into public.finance_recurring (id, user_id, workspace_id, type, description, amount, day_of_month) values
    (r_f, uf, ws, 'expense', 'Recorrente de F', 10, 5);
  insert into public.finance_store_purchases (id, user_id, workspace_id, product_id, supplier_id, quantity, unit_cost, date, status, transaction_id) values
    (pu_f, uf, ws, p_f, sup_f, 5, 1000, sp, 'received', tx_ff),
    (pu_df, ud, ws, p_f, sup_f, 2, 1000, sp, 'received', tx_fe),
    (pu_dp, ud, null, p_d, null, 1, 1000, sp, 'received', tx_fep),
    (pu_f2, uf, ws, p_f, null, 1, 1000, sp, 'received', tx_de),
    (pu_d, ud, ws, p_d, null, 5, 1000, sp, 'received', null);
  insert into public.finance_store_sales (id, user_id, workspace_id, status, sold_on, customer_id, account_id, transaction_id) values
    (s_d, ud, ws, 'sold', sp, cust_f, acc_d, tx_fd),
    (s_dn, ud, ws, 'negotiating', null, null, null, null),
    (s_dp, ud, null, 'sold', sp, null, acc_d, tx_fdp),
    (s_dx, ud, ws, 'sold', sp, null, acc_d, tx_xp),
    (s_f, uf, ws, 'negotiating', null, cust_f, null, null),
    (s_f2, uf, ws, 'sold', sp, null, acc_fo, tx_df);
  insert into public.finance_store_sale_items (id, user_id, workspace_id, sale_id, product_id, product_name, quantity, unit_price) values
    (i_dd, ud, ws, s_d, p_d, 'Produto de D', 1, 5000),
    (i_fd, uf, ws, s_d, p_f, 'Produto de F', 1, 5000),
    (i_dpf, ud, ws, s_dn, p_f, 'Produto de F', 1, 1000),
    (i_dp, ud, null, s_dp, p_d, 'Produto de D', 1, 10000),
    (i_ff, uf, ws, s_f, p_f, 'Produto de F', 1, 1000),
    (i_df, ud, ws, s_f, p_d, 'Produto de D', 1, 1000),
    (i_f2, uf, ws, s_f2, p_f, 'Produto de F', 1, 10000);
  set local session_replication_role = origin;
  -- fixtures:end

  -- 1. F sai (leave_workspace).
  begin
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('1 F sai do W (leave_workspace)', r, 'ok ');
    out := out || pg_temp.expect('1 G vê de F só o item na venda de D, as 4 receitas/despesas ligadas a venda/compra de D (também as privadas) e a conta usada por D',
                                 pg_temp.sees(ug, uf), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=4 conta=1');
    out := out || pg_temp.expect('1 D vê de F o mesmo', pg_temp.sees(ud, uf), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=4 conta=1');
    out := out || pg_temp.expect('1 F, fora, vê tudo o que é dele', pg_temp.sees(uf, uf), 'ok cli=1 forn=1 prod=1 comp=2 vend=2 itens=3 tx=6 conta=2');
    select format('%s %s %s %s %s %s',
                  (select transaction_id is null from public.finance_store_sales where id = s_f2),
                  (select workspace_id = ws from public.finance_transactions where id = tx_df),
                  (select transaction_id is null from public.finance_store_purchases where id = pu_f2),
                  (select workspace_id = ws from public.finance_transactions where id = tx_de),
                  (select workspace_id is null from public.finance_transactions where id = tx_ff),
                  (select transaction_id = tx_ff from public.finance_store_purchases where id = pu_f))
      into r;
    out := out || pg_temp.expect('1 venda e compra de F desvinculadas da receita e da despesa de D (que ficam no W); a despesa de F na compra dele vai junto, vinculada', r, 't t t t t t');
    r := pg_temp.as_user(ud, format('select count(*)::text from public.finance_store_sale_items where id = %L', i_df))
         || ' ' || pg_temp.as_user(ug, format('select count(*)::text from public.finance_store_sale_items where id = %L', i_df));
    out := out || pg_temp.expect('1 o item de D na venda de F fica no W e segue a venda: D (autora) lê, G não', r, 'ok 1 ok 0');
    r := pg_temp.as_user(ud, format($q$select (select count(*) from public.finance_store_purchases where id = %L) || ' ' || (select count(*) from public.finance_store_products where id = %L)$q$, pu_df, p_f));
    out := out || pg_temp.expect('1 a compra de D do produto de F: D vê a compra, não o produto', r, 'ok 1 0');
    r := pg_temp.as_user(ud, format($q$select (public.store_sale_update(%L, '{"fees": 1000}') -> 'transaction' ->> 'amount')$q$, s_d));
    out := out || pg_temp.expect('1 D muda a taxa da própria venda (100,00 - 10,00): a receita de F ficou no W e acompanha (sem 42501)', r, 'ok 9000.00');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_dp));
    out := out || pg_temp.expect('1 D cancela a venda PRIVADA dela com a receita de F (que ficou no W)', r, 'ok cancelled');
    r := pg_temp.as_user(uf, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_f2));
    out := out || pg_temp.expect('1 F, fora, cancela a própria venda (desvinculada da receita de D)', r, 'ok cancelled');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_items_update(%L, '{"quantity": 2}')::text$q$, i_dpf));
    out := out || pg_temp.expect('1 efeito conhecido (decisão 2): D muda a quantidade do item dela com o produto de F, que ficou privado', r, 'erro P0002: Produto não encontrado%');
    select format('%s %s', count(*) filter (where workspace_id = ws), (select workspace_id is null from public.finance_categories where id = cat_fp))
      into r from public.finance_categories where user_id in (ud, uf);
    out := out || pg_temp.expect('1 as categorias do W ficam (12 de D e a de F); a pessoal de F intacta', r, '13 t');
    select format('%s %s %s', (select shared_with_user_id = uf from public.finance_transactions where id = tx_dsh),
                  (select shared_with_user_id is null from public.finance_transactions where id = tx_gsh),
                  (select shared_with_user_id is null from public.finance_budgets where id = b_gsh))
      into r;
    out := out || pg_temp.expect('1 shared_with para F: fica no lançamento de D (meta em comum), sai do lançamento e do orçamento de G', r, 't t t');
    r := pg_temp.as_user(ug, format($q$with u as (update public.finance_transactions set amount = 11 where id = %L returning 1) select count(*)::text from u$q$, tx_gsh))
         || ' ' || pg_temp.as_user(ud, format($q$with u as (update public.finance_transactions set amount = 11 where id = %L returning 1) select count(*)::text from u$q$, tx_dsh));
    out := out || pg_temp.expect('1 G e D editam os próprios lançamentos (sem a limpeza, o WITH CHECK do SEC-013 barrava G)', r, 'ok 1 ok 1');
    select count(*)::text into r from public.notifications where type = 'member_left' and data ->> 'actor_id' = uf::text and user_id in (ud, ug, uh);
    out := out || pg_temp.expect('1 D, G e H recebem o aviso', r, '3');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 1 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 2. D remove F, que tem linhas nas 6 tabelas, na Loja e em vendas e
  --    compras de D (o 42501 de antes).
  begin
    r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', uf));
    out := out || pg_temp.expect('2 D remove F (com transação, orçamento, conta, categoria, meta, recorrente e Loja no W)', r, 'ok ');
    out := out || pg_temp.expect('2 G vê de F o mesmo que na saída', pg_temp.sees(ug, uf), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=4 conta=1');
    select format('%s %s', (select count(*) from public.finance_workspace_members where user_id = uf),
                  (select count(*) from public.notifications where user_id = uf and type = 'member_left' and data ->> 'actor_id' = ud::text))
      into r;
    out := out || pg_temp.expect('2 F fora do W e avisado', r, '0 1');
    select format('%s %s %s %s %s %s',
                  (select workspace_id is null from public.finance_transactions where id = tx_fo),
                  (select workspace_id is null from public.finance_budgets where id = b_f),
                  (select workspace_id is null from public.finance_accounts where id = acc_fo),
                  (select workspace_id = ws from public.finance_categories where id = cat_fw),
                  (select workspace_id is null from public.finance_goals where id = g_f),
                  (select workspace_id is null from public.finance_recurring where id = r_f))
      into r;
    out := out || pg_temp.expect('2 as 6 tabelas: transação, orçamento, conta, meta e recorrente de F no privado; a categoria fica no W', r, 't t t t t t');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_d));
    out := out || pg_temp.expect('2 D cancela a venda com a receita de F (apagada no W, sem 42501)', r || ' ' || (select count(*) from public.finance_transactions where id = tx_fd), 'ok cancelled 0');
    r := pg_temp.as_user(uf, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_f2));
    out := out || pg_temp.expect('2 F, removido, cancela a própria venda (desvinculada)', r, 'ok cancelled');
    r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', uh)) || ' ' || pg_temp.sees(ug, uh);
    out := out || pg_temp.expect('2 D remove H (só Loja): G não vê mais o cliente de H', r, 'ok  ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=0 tx=0 conta=0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 2 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 3. A criadora sai com membros (antes: 23505 nas categorias semeadas).
  begin
    r := pg_temp.as_user(ud, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('3 D (criadora, dona) sai com membros', r, 'ok ');
    select format('%s %s %s', (select role from public.finance_workspace_members where user_id = uf),
                  (select owner_id = uf from public.finance_workspaces where id = ws),
                  (select count(*) from public.finance_workspace_members where workspace_id = ws and role = 'owner'))
      into r;
    out := out || pg_temp.expect('3 a posse passa para F, o membro mais antigo', r, 'owner t 1');
    select format('%s %s', count(*) filter (where workspace_id = ws), count(*) filter (where workspace_id is null)) into r
      from public.finance_categories where user_id = ud;
    r := r || ' ' || pg_temp.as_user(ug, format('select count(*)::text from public.finance_categories where workspace_id = %L', ws));
    out := out || pg_temp.expect('3 as 12 categorias do W ficam no W (autora D) e G as vê com a de F; as 12 pessoais de D intactas', r, '12 12 ok 13');
    select format('%s %s %s %s %s',
                  (select workspace_id is null and transaction_id is null from public.finance_store_sales where id = s_d),
                  (select workspace_id = ws from public.finance_transactions where id = tx_fd),
                  (select workspace_id = ws from public.finance_accounts where id = acc_d),
                  (select workspace_id = ws from public.finance_transactions where id = tx_df),
                  (select workspace_id is null from public.finance_transactions where id = tx_dfu))
      into r;
    out := out || pg_temp.expect('3 a venda de D sai desvinculada da receita de F (que fica); a conta de D usada por F fica; a receita de D na venda de F fica', r, 't t t t t');
    out := out || pg_temp.expect('3 G vê de D só o item na venda de F, a receita e a despesa ligadas a venda/compra de F e a conta usada por F',
                                 pg_temp.sees(ug, ud), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=2 conta=1');
    r := pg_temp.as_user(uf, format('select public.remove_workspace_member(%L)::text', ug));
    out := out || pg_temp.expect('3 F, a nova dona, remove G', r, 'ok ');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 3 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 4. Todos saem; a criadora, sozinha, sai por último e o W é apagado.
  begin
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(ug, 'select public.leave_workspace()::text')
         || '|' || pg_temp.as_user(uh, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(ud, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('4 F, G, H e por fim D (sozinha) saem: o W é apagado', r || ' ' || (select count(*) from public.finance_workspaces where id = ws), 'ok |ok |ok |ok  0');
    select format('%s %s', count(*), count(*) filter (where name like format('%% (%s)', wsname))) into r
      from public.finance_categories where user_id = ud and workspace_id is null;
    out := out || pg_temp.expect('4 as 12 categorias do W de D vão para o privado com o nome do W (24 pessoais)', r, '24 12');
    select name into r from public.finance_categories where id = cat_fw;
    out := out || pg_temp.expect('4 a categoria do W que F deixou, na cascata, colide com a pessoal de F e vira "(workspace)"', r, 'api064 Pets (workspace)');
    select format('%s %s %s %s', (select workspace_id is null from public.finance_store_sale_items where id = i_fd),
                  (select workspace_id is null and user_id = uf from public.finance_transactions where id = tx_fd),
                  (select transaction_id is null from public.finance_store_sales where id = s_d),
                  (select workspace_id is null from public.finance_store_customers where id = cust_x))
      into r;
    out := out || pg_temp.expect('4 as sobras (item e receita de F na venda de D, cliente de X) vão para o privado dos autores pela saída (a)', r, 't t t t');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 4 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;
  -- 4b. Fora do card (API-067): o pagamento de empréstimo de quem saiu ainda
  --     trava a saída da última pessoa (o trg_loan_payment_guard recusa a
  --     cascata de quem não é dona do empréstimo).
  begin
    set local session_replication_role = replica;
    insert into public.finance_loan_borrowers (id, user_id, workspace_id, name) values (lb_f, uf, ws, 'Devedor de F');
    insert into public.finance_loans (id, user_id, workspace_id, borrower_id, principal, disbursed_on, status, requested_by)
      values (l_f, uf, ws, lb_f, 1000, sp, 'active', uf);
    insert into public.finance_loan_payments (id, user_id, workspace_id, loan_id, amount, date, reported_by) values (lp_f, uf, ws, l_f, 100, sp, uf);
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(ug, 'select public.leave_workspace()::text')
         || '|' || pg_temp.as_user(uh, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(ud, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('4b API-067: com o pagamento de empréstimo de F no W, a última pessoa não sai (o W fica)',
                                 r || ' ' || (select count(*) from public.finance_workspaces where id = ws), 'ok |ok |ok |erro 42501: Devedor so pode%1');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 4b erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- parte 2

  -- 5. O gatilho de categorias: pelo cliente (o escopo do CategoryModal), com
  --    número, e sem usuário.
  begin
    r := pg_temp.as_user(uf, pg_temp.to_private('finance_categories', cat_fw));
    out := out || pg_temp.expect('5 F leva a categoria do W para o pessoal (CategoryModal): renomeada com o nome do W',
                                 r || ' ' || (select name from public.finance_categories where id = cat_fw), format('ok 1 api064 Pets (%s)', wsname));
    set local session_replication_role = replica;
    insert into public.finance_categories (id, user_id, workspace_id, name, type) values
      (cat_b, uf, ws, 'api064 Bis', 'expense'), (gen_random_uuid(), uf, null, 'api064 Bis', 'expense'),
      (gen_random_uuid(), uf, null, format('api064 Bis (%s)', wsname), 'expense');
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, pg_temp.to_private('finance_categories', cat_b));
    out := out || pg_temp.expect('5 com "Nome (W)" também ocupado: o número entra',
                                 r || ' ' || (select name from public.finance_categories where id = cat_b), format('ok 1 api064 Bis (%s 2)', wsname));
    r := pg_temp.try(null, null, format($q$with u as (update public.finance_categories set workspace_id = null
                                          where user_id = %L and workspace_id = %L and name = 'Alimentação' and type = 'expense' returning name) select name from u$q$, ud, ws));
    out := out || pg_temp.expect('5 sem usuário (cascata, exclusão de conta): também renomeia', r, format('ok Alimentação (%s)', wsname));
    r := pg_temp.as_user(ud, format($q$with u as (update public.finance_categories set workspace_id = null
                                     where user_id = %L and workspace_id = %L and name = 'Moradia' returning name) select name from u$q$, ud, ws));
    out := out || pg_temp.expect('5 D leva "Moradia" do W para o pessoal: colide e é renomeada', r, format('ok Moradia (%s)', wsname));
    set local session_replication_role = replica;
    insert into public.finance_categories (id, user_id, workspace_id, name, type) values (cat_u, ud, ws, 'api064 Única', 'income');
    set local session_replication_role = origin;
    r := pg_temp.as_user(ud, pg_temp.to_private('finance_categories', cat_u));
    out := out || pg_temp.expect('5 sem colisão o nome não muda', r || ' ' || (select name from public.finance_categories where id = cat_u), 'ok 1 api064 Única');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 5 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 6. Sobras antigas: X saiu antes da migration (cliente e despesa no W, a
  --    receita privada dele travando a venda de D) e H saiu pelo DELETE direto
  --    da filiação, que existia antes da migration.
  begin
    delete from public.finance_workspace_members where workspace_id = ws and user_id = uh;
    r := pg_temp.as_user(ug, format('select count(*)::text from public.finance_store_customers where id in (%L, %L)', cust_x, cust_h));
    out := out || pg_temp.expect('6 antes: G lê os clientes de X e de H, que já não são membros', r, 'ok 2');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled')::text$q$, s_dx));
    out := out || pg_temp.expect('6 antes: D não cancela a venda com a receita privada de X', r, 'erro 42501: A receita vinculada é de outra pessoa%');
    v := private.finance_workspace_reconcile();
    out := out || pg_temp.expect('6 reconcile: pares tratados e vendas desvinculadas',
                                 format('%s %s', (v ->> 'pairs')::int >= 2, (v ->> 'sales_unlinked')::int >= 1), 't t');
    r := pg_temp.as_user(ug, format('select count(*)::text from public.finance_store_customers where id in (%L, %L)', cust_x, cust_h));
    out := out || pg_temp.expect('6 depois: G não lê mais os clientes de X e de H', r, 'ok 0');
    select format('%s %s %s', (select workspace_id is null from public.finance_transactions where id = tx_x),
                  (select transaction_id is null from public.finance_store_sales where id = s_dx),
                  (select workspace_id is null and user_id = ux from public.finance_transactions where id = tx_xp))
      into r;
    out := out || pg_temp.expect('6 depois: a despesa de X no privado; a venda de D desvinculada da receita privada de X (que não volta ao W)', r, 't t t');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_dx));
    out := out || pg_temp.expect('6 depois: D cancela', r, 'ok cancelled');
    v := private.finance_workspace_reconcile();
    out := out || pg_temp.expect('6 de novo: nada a desvincular', format('%s %s', v ->> 'sales_unlinked', v ->> 'purchases_unlinked'), '0 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 6 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 7. A guarda, depois que F saiu (a despesa de F na compra de D, tx_fe,
  --    ficou no W: é a sobra de ex-membro).
  begin
    set local session_replication_role = replica;
    insert into public.finance_loan_borrowers (id, user_id, workspace_id, name) values (lb_f, uf, ws, 'Devedor de F');
    insert into public.finance_loans (id, user_id, workspace_id, borrower_id, principal, disbursed_on, status, requested_by)
      values (l_f, uf, ws, lb_f, 1000, sp, 'active', uf);
    insert into public.finance_loan_payments (id, user_id, workspace_id, loan_id, amount, date, reported_by) values (lp_f, uf, ws, l_f, 100, sp, uf);
    insert into public.finance_loan_collaterals (id, user_id, workspace_id, loan_id, description) values (lc_f, uf, ws, l_f, 'Garantia');
    insert into public.finance_workspaces (id, name, owner_id) values (ws_other, 'api064 outro W', uc);
    insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws_other, uc, 'owner');
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('7 F sai (o empréstimo, o devedor e o pagamento ficam: API-067)',
                                 r || ' ' || pg_temp.as_user(ug, format($q$select (select count(*) from public.finance_loans where id = %L) || ' ' || (select count(*) from public.finance_loan_borrowers where id = %L)$q$, l_f, lb_f)),
                                 'ok  ok 1 1');
    -- Pelo cliente.
    r := pg_temp.as_user(ug, pg_temp.to_private('finance_store_products', p_d));
    out := out || pg_temp.expect('7 cliente: G (membro) não tira do W o produto de D', r, 'erro 42501: Somente o autor%');
    r := pg_temp.as_user(ud, pg_temp.to_private('finance_store_customers', cust_h));
    out := out || pg_temp.expect('7 cliente: D (dona) não tira do W o cliente de H (membro ativo)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.as_user(ug, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 cliente: G (não é dona) não tira do W a sobra de F', r, 'erro 42501: Somente o autor%');
    r := pg_temp.as_user(ud, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 cliente: D (dona) não tira do W a sobra de F (sem o GUC, a guarda)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.as_user_guc(ud, ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 cliente com o GUC forjado: o RLS de finance_transactions barra a dona', r, 'erro 42501: new row violates row-level security policy%');
    r := pg_temp.as_user(ud, pg_temp.to_private('finance_loan_payments', lp_f)) || ' | ' || pg_temp.as_user(ud, pg_temp.to_private('finance_loan_collaterals', lc_f));
    out := out || pg_temp.expect('7 cliente: D não tira do W o pagamento nem a garantia do empréstimo de F (o RLS deixaria: só a guarda barra)', r,
                                 'erro 42501: Somente o autor% | erro 42501: Somente o autor%');
    r := pg_temp.as_user(ud, format($q$with u as (update public.finance_loan_payments set note = 'D' where id = %L returning 1) select count(*)::text from u$q$, lp_f));
    out := out || pg_temp.expect('7 cliente: (o RLS de pagamentos deixa D atualizar a nota: é por isso que a saída (b) exige o GUC)', r, 'ok 1');
    -- Como DEFINER (postgres, sem RLS), com os claims e o GUC.
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), null, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona sem o GUC', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws_other::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC de outro workspace', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ug, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: G (não é dona) com o GUC', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', uc, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: C (dona de outro W) com o GUC', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_gsh));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC na linha de G (membro ativo)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text,
                     format($q$update public.finance_transactions set workspace_id = %L where id = %L returning 'x'$q$, ws_other, tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC levando a sobra para outro workspace', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text,
                     format($q$update public.finance_transactions set workspace_id = null, user_id = %L where id = %L returning 'x'$q$, ud, tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC trocando o autor da sobra', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: JWT authenticated sem sub, com o GUC (o "is distinct from")', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_loan_payments', lp_f));
    out := out || pg_temp.expect('7 DEFINER: com o GUC a saída (b) vale em qualquer tabela; só o release o liga, e ele não mexe em empréstimos (decisão 11)', r, 'ok 1');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC tira do W a sobra de F (o caminho do remove)', r, 'ok 1');
    -- DELETE direto (sem as policies) e JWT sem sub pelo cliente.
    r := pg_temp.as_user(ug, format($q$with d as (delete from public.finance_workspace_members where user_id = %L returning 1) select count(*)::text from d$q$, ug))
         || ' ' || pg_temp.as_user(ud, format($q$with d as (delete from public.finance_workspace_members where user_id = %L returning 1) select count(*)::text from d$q$, ug))
         || ' ' || pg_temp.as_user(ud, format($q$with d as (delete from public.finance_workspaces where id = %L returning 1) select count(*)::text from d$q$, ws));
    out := out || pg_temp.expect('7 DELETE direto: G da própria filiação, D da filiação de G e D do W: 0 linhas',
                                 r || ' | ' || (select count(*) from public.finance_workspace_members where user_id = ug) || ' ' || (select count(*) from public.finance_workspaces where id = ws),
                                 'ok 0 ok 0 ok 0 | 1 1');
    -- Sem usuário (restore, cron): passa.
    r := pg_temp.try(jsonb_build_object('role', 'service_role'), null,
                     format($q$insert into public.finance_store_customers (user_id, workspace_id, name) values (%L, %L, 'restore') returning 'x'$q$, ux, ws));
    out := out || pg_temp.expect('7 service_role sem sub (restore): linha de quem não é membro entra no W', r, 'ok x');
    r := pg_temp.try(null, null, pg_temp.to_private('finance_store_products', p_d));
    out := out || pg_temp.expect('7 sem claims (SQL pelo MCP): tira do W a linha de outra pessoa', r, 'ok 1');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 7 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 8. As mensagens das RPCs não mudam (o app as traduz).
  r := pg_temp.as_user(ug, format('select public.remove_workspace_member(%L)::text', ud));
  out := out || pg_temp.expect('8 G (membro) remove D', r, 'erro P0001: Only the owner can remove members');
  r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', ud));
  out := out || pg_temp.expect('8 D remove a si mesma', r, 'erro P0001: Cannot remove yourself');
  r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', uc));
  out := out || pg_temp.expect('8 D remove C, que não é membro', r, 'erro P0001: User is not a member of this workspace');
  r := pg_temp.as_user(uc, 'select public.leave_workspace()::text') || ' | ' || pg_temp.as_user(uc, format('select public.remove_workspace_member(%L)::text', ud));
  out := out || pg_temp.expect('8 C (fora de workspace) sai e remove', r, 'erro P0001: Not in a workspace | erro P0001: Not in a workspace');
  r := pg_temp.try(jsonb_build_object('role', 'authenticated'), null, 'select public.leave_workspace()::text');
  out := out || pg_temp.expect('8 sem usuário', r, 'erro P0001: Not authenticated');

  -- 9. Estrutura.
  select format('%s %s %s %s', p.prosecdef, array_to_string(p.proconfig, ','),
                has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE'))
    into r from pg_proc p where p.oid = 'public.finance_guard_workspace()'::regprocedure;
  out := out || pg_temp.expect('9 guarda: DEFINER, search_path=public, sem EXECUTE de cliente', r, 't search_path=public f f');
  select string_agg(format('%s %s %s %s %s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                           has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('anon', p.oid, 'EXECUTE')), ' | ' order by p.proname)
    into r from pg_proc p where p.oid in ('public.leave_workspace()'::regprocedure, 'public.remove_workspace_member(uuid)'::regprocedure);
  out := out || pg_temp.expect('9 leave e remove: DEFINER, search_path vazio, só authenticated',
                               r, 'leave_workspace t search_path="" t f | remove_workspace_member t search_path="" t f');
  select string_agg(format('%s %s %s %s', p.proname, p.prosecdef, array_to_string(p.proconfig, ','),
                           has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
                           or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g where g.grantee = 0)), ' | ' order by p.proname)
    into r from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.proname in ('finance_category_ws_exit', 'finance_people_related', 'finance_workspace_reconcile', 'finance_workspace_release');
  out := out || pg_temp.expect('9 as 4 de private: search_path vazio, sem EXECUTE de cliente; só o gatilho de categorias é DEFINER', r,
                               'finance_category_ws_exit t search_path="" f | finance_people_related f search_path="" f | finance_workspace_reconcile f search_path="" f | finance_workspace_release f search_path="" f');
  select format('%s %s', count(*), bool_and(t.tgname < 'trg_finance_categories_ws_guard' and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE OF workspace_id ON public.finance_categories FOR EACH ROW%'))
    into r from pg_trigger t where t.tgfoid = 'private.finance_category_ws_exit()'::regprocedure and not t.tgisinternal;
  out := out || pg_temp.expect('9 gatilho de categorias: 1, BEFORE UPDATE OF workspace_id, antes da guarda', r, '1 t');
  select count(*)::text into r from pg_trigger t where t.tgfoid = 'public.finance_guard_workspace()'::regprocedure and not t.tgisinternal;
  out := out || pg_temp.expect('9 os 16 gatilhos ws_guard seguem na guarda', r, '16');
  select count(*)::text into r from pg_policies where schemaname = 'public' and tablename in ('finance_workspace_members', 'finance_workspaces') and cmd in ('DELETE', 'ALL');
  out := out || pg_temp.expect('9 sem policy de DELETE na filiação e no workspace', r, '0');
  select count(*)::text into r from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('authenticated', oid, 'execute');
  out := out || pg_temp.expect('9 as funções DEFINER de public para authenticated continuam 40 (sec012)', r, '40');

  raise exception using message = format(E'API-064 bloco 1: sair do workspace (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;
