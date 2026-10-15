-- Saída do workspace: sair e remover membro (migration
-- 20261015120000_workspace_exit).
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
-- (ex-membro antigo, com sobras no W), C e Y (de fora). D e F abrem Finanças
-- pelo app (bootstrap_finance_categories, como o usuário) e D cria o W pelo
-- create_workspace, que semeia no W as 12 categorias com os nomes das
-- pessoais: é o caso da colisão (23505) da criadora. O resto das fixtures vai
-- em replica. Cada cenário roda num sub-bloco desfeito e parte das mesmas
-- fixtures:
--   1. F sai (leave_workspace), com a Loja cruzada: cliente, fornecedor e
--      produto de F usados por D; item de F na venda de D; item de D na venda
--      de F; receita e despesa cruzadas nos dois sentidos, inclusive com venda
--      e compra PRIVADAS de D; contas usadas por outros (passam para D, com o
--      saldo inicial: resíduo conhecido), a conta da despesa e a da meta de F
--      que ficam no W; categorias (a usada por G e a da receita de F que fica
--      passam para D, a que só F usa vai com ele, e as linhas privadas de F
--      nas que ficam ganham cópia pessoal: um membro apaga a do W e os
--      orçamentos de F ficam; o materialize não cria orçamento em categoria de
--      W); meta com aporte de G (fica e passa para D, sem o share de F); a
--      meta "Reserva de F" com 500 de F e 0,01 de G (os 500 vão para uma cópia
--      privada); o aporte de F na meta de D, que ele já não altera; shared_with
--      com e sem outro vínculo, no W e no privado, nos dois sentidos; o
--      convite pendente que F mandou e o convite direto (sem policy de
--      INSERT); os resíduos conhecidos da Loja (produto apagado);
--   2. D remove F (remove_workspace_member), F com linhas nas 6 tabelas; F,
--      fora, não mexe no que ficou no W; o convite dele some; a cópia da meta
--      e as de categoria, como na saída;
--   2b. saída em cadeia: F lança a receita na venda de G e sai; G sai (ou é
--      removido): a receita vai para o privado de F; o mesmo pela compra de G
--      e pela venda PRIVADA de G;
--   3. a criadora sai com membros (a posse passa; as categorias semeadas que
--      só ela usava vão com ela, a usada por G fica com o sucessor; a venda e
--      a compra PRIVADAS dela saem desvinculadas) e depois a conta dela é
--      excluída (nada do W vai junto); 3b. F sai e a conta de D, dona ativa, é
--      excluída: os orçamentos de F ficam (resíduo conhecido: o W some);
--   4. todos saem e a criadora, por último, apaga o W (categorias renomeadas
--      com o nome do W; sobras pela saída (a); a categoria do ex-membro
--      renomeada na cascata; nenhum orçamento privado de outra pessoa preso a
--      categoria que não é dela); 4b. os empréstimos: os de F vão com ele, e
--      o que ficou no W pelo pagamento de G vai na saída da última pessoa;
--   5. o gatilho de categorias pelo cliente (CategoryModal), com número, e
--      sem usuário;
--   6. sobra antiga (fixture sem filiação), venda travada e convite de quem
--      saiu resolvidos pelo private.finance_workspace_reconcile; 6b. o W sem
--      membros apagado e o W sem dona com dono novo; 6c. o par de linhas
--      PRIVADAS compartilhadas com quem saiu pelo DELETE direto, sem linha no
--      W (e o resíduo: duas pessoas sem W); 6d. a compra de G ligada à
--      receita de X (ex-membro) não a tira do W; 6e. W com duas donas: a mais
--      nova remove;
--   7. a guarda: pelo cliente (membro ativo, não-dona, a dona barrada pela
--      guarda e pelo RLS, empréstimos, o GUC nunca ligado na sessão), pela
--      DEFINER (o GUC akool.ws_release, as saídas (b) e (c), a ordem
--      pagamento → empréstimo), JWT sem sub, DELETE direto da filiação e do W
--      (0 linhas) e o contexto sem usuário (restore);
--   8. as mensagens das RPCs, iguais às de antes;
--   9. estrutura: DEFINER, search_path, EXECUTE, os 16 gatilhos da guarda, o
--      gatilho de categorias, o advisory lock do release, sem as policies de
--      DELETE nem a de INSERT de convite, as policies de aporte, o restore com
--      o reconcile e as 29 DEFINER do sec012.
--
-- A concorrência (sair × remover em duas sessões) fica no roteiro manual: as
-- duas RPCs começam com SELECT ... FOR UPDATE na filiação de quem chama, e o
-- release trava o W com pg_advisory_xact_lock.
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
  out := out || ('2 linhas em workspace por tabela: total(de autor que não é membro dele; o backfill trata as 16, e nas 4 de empréstimo só o que não tem pagamento ou garantia de outra pessoa): ' || r);

  select format('dona=%s membro=%s fora=%s',
                count(*) filter (where m.role = 'owner'), count(*) filter (where m.role = 'member'), count(*) filter (where m.user_id is null))
    into r
    from public.finance_categories c
    left join public.finance_workspace_members m on m.workspace_id = c.workspace_id and m.user_id = c.user_id
   where c.workspace_id is not null
     and exists (select 1 from public.finance_categories p
                  where p.user_id = c.user_id and p.workspace_id is null and p.name = c.name and p.type = c.type);
  out := out || ('3 categorias do W com gêmea pessoal do autor, por papel (eram 23505 ao sair; agora renomeadas ao sair, na cascata e no CategoryModal): ' || r);

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
  out := out || ('7 contas de workspace usadas em lançamento de outra pessoa (ficam no W e passam para a dona quando o dono sai): ' || r);

  select format('transações=%s orçamentos=%s',
           (select count(*) from public.finance_transactions t where t.workspace_id is not null and t.shared_with_user_id is not null and t.shared_with_user_id <> t.user_id),
           (select count(*) from public.finance_budgets b where b.workspace_id is not null and b.shared_with_user_id is not null and b.shared_with_user_id <> b.user_id))
    into r;
  out := out || ('8 linhas de workspace com shared_with de outra pessoa (limpo na saída dela, se não houver outro vínculo): ' || r);

  select format('inconsistente=%s sem_membros=%s sem_dona=%s',
           (select count(*) from public.finance_workspaces w
             where not exists (select 1 from public.finance_workspace_members m where m.workspace_id = w.id and m.user_id = w.owner_id and m.role = 'owner')
                or (select count(*) from public.finance_workspace_members m where m.workspace_id = w.id and m.role = 'owner') <> 1),
           (select count(*) from public.finance_workspaces w
             where not exists (select 1 from public.finance_workspace_members m where m.workspace_id = w.id)),
           (select count(*) from public.finance_workspaces w
             where exists (select 1 from public.finance_workspace_members m where m.workspace_id = w.id)
               and not exists (select 1 from public.finance_workspace_members m where m.workspace_id = w.id and m.role = 'owner')))
    into r;
  out := out || ('9 workspaces com dona inconsistente (owner_id sem role owner, ou 0 ou 2+ donas) / sem membros (o backfill apaga) / com membros e sem dona (o backfill promove o mais antigo): ' || r);

  select format('%s', count(*)) into r
    from public.finance_goals g
   where g.workspace_id is not null
     and exists (select 1 from public.finance_goal_contributions c where c.goal_id = g.id and c.user_id <> g.user_id);
  out := out || ('10 metas de workspace com aporte de outra pessoa (ficam no W e passam para a dona quando o dono sai): ' || r);

  -- Os pares de pessoas com linha privada compartilhada, e quais não têm
  -- vínculo nenhum (a regra do profile_is_related escrita aqui: o
  -- private.finance_people_related só existe depois do apply). O backfill
  -- limpa o shared_with dos pares sem vínculo em que uma das pessoas é membro
  -- de algum W; o par sem vínculo e sem W fica (resíduo).
  with pares as (
    select distinct least(x.user_id, x.shared_with_user_id) as a, greatest(x.user_id, x.shared_with_user_id) as b
      from (select t.user_id, t.shared_with_user_id from public.finance_transactions t
             where t.workspace_id is null and t.shared_with_user_id is not null and t.shared_with_user_id <> t.user_id
            union all
            select b.user_id, b.shared_with_user_id from public.finance_budgets b
             where b.workspace_id is null and b.shared_with_user_id is not null and b.shared_with_user_id <> b.user_id) x
  ), sem_vinculo as (
    select p.a, p.b from pares p
     where not exists (select 1 from public.page_shares s
                        where (s.owner_id = p.a and s.shared_with_user_id = p.b) or (s.owner_id = p.b and s.shared_with_user_id = p.a))
       and not exists (select 1 from public.project_shares s
                        where (s.owner_id = p.a and s.shared_with_user_id = p.b) or (s.owner_id = p.b and s.shared_with_user_id = p.a))
       and not exists (select 1 from public.finance_goal_shares s join public.finance_goals g on g.id = s.goal_id and g.user_id = s.owner_id
                        where (s.owner_id = p.a and s.shared_with_user_id = p.b) or (s.owner_id = p.b and s.shared_with_user_id = p.a))
       and not exists (select 1 from public.finance_workspace_members m1 join public.finance_workspace_members m2 on m2.workspace_id = m1.workspace_id
                        where m1.user_id = p.a and m2.user_id = p.b)
       and not exists (select 1 from public.finance_loan_borrowers l
                        where (l.user_id = p.a and l.borrower_user_id = p.b) or (l.user_id = p.b and l.borrower_user_id = p.a))
  )
  select format('pares=%s sem_vinculo_com_W=%s sem_vinculo_sem_W=%s', (select count(*) from pares),
                count(*) filter (where exists (select 1 from public.finance_workspace_members m where m.user_id in (s.a, s.b))),
                count(*) filter (where not exists (select 1 from public.finance_workspace_members m where m.user_id in (s.a, s.b))))
    into r from sem_vinculo s;
  out := out || ('11 pares de pessoas com linha privada compartilhada / sem vínculo e uma delas em algum W (o backfill limpa) / sem vínculo e sem W (fica): ' || r);

  select format('%s', count(*)) into r
    from public.finance_workspace_invites i
   where i.status = 'pending'
     and not exists (select 1 from public.finance_workspace_members m where m.workspace_id = i.workspace_id and m.user_id = i.invited_by);
  out := out || ('12 convites pendentes de quem já não é membro do W (o backfill apaga): ' || r);

  select format('%s', count(*)) into r
    from public.finance_loans l
   where l.workspace_id is not null
     and (exists (select 1 from public.finance_loan_payments x where x.loan_id = l.id and x.user_id <> l.user_id)
          or exists (select 1 from public.finance_loan_collaterals x where x.loan_id = l.id and x.user_id <> l.user_id));
  out := out || ('13 empréstimos de workspace com pagamento ou garantia de outra pessoa (ficam no W quando o autor sai): ' || r);

  select format('%s', count(distinct x.user_id)) into r
    from public.finance_categories c
    join (select t.user_id, t.category_id from public.finance_transactions t where t.workspace_id is null
          union all select b.user_id, b.category_id from public.finance_budgets b where b.workspace_id is null
          union all select f.user_id, f.category_id from public.finance_recurring f where f.workspace_id is null) x on x.category_id = c.id
   where c.workspace_id is not null
     and not exists (select 1 from public.finance_workspace_members m where m.workspace_id = c.workspace_id and m.user_id = x.user_id);
  out := out || ('14 ex-membros com linha privada numa categoria de workspace (o backfill dá a cópia pessoal): ' || r);

  raise exception using message = format(E'Saída do workspace bloco 0: levantamento (só contagens, nada gravado)\n%s', array_to_string(out, E'\n'));
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
  uy uuid := gen_random_uuid();
  ws uuid;
  ws_other uuid := gen_random_uuid();
  ws_noown uuid := gen_random_uuid();
  ws_empty uuid := gen_random_uuid();
  acc_d uuid := gen_random_uuid();
  acc_fu uuid := gen_random_uuid();
  acc_fo uuid := gen_random_uuid();
  acc_fr uuid := gen_random_uuid();
  acc_fo2 uuid := gen_random_uuid();
  cat_dalim uuid;
  cat_fo2 uuid := gen_random_uuid();
  cat_fw uuid := gen_random_uuid();
  cat_fp uuid := gen_random_uuid();
  cat_fo uuid := gen_random_uuid();
  cat_x uuid := gen_random_uuid();
  cat_xe uuid := gen_random_uuid();
  cat_g uuid := gen_random_uuid();
  cat_b uuid := gen_random_uuid();
  cat_u uuid := gen_random_uuid();
  cust_f uuid := gen_random_uuid();
  cust_h uuid := gen_random_uuid();
  cust_x uuid := gen_random_uuid();
  cust_xe uuid := gen_random_uuid();
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
  tx_galim uuid := gen_random_uuid();
  tx_fg uuid := gen_random_uuid();
  tx_gpriv uuid := gen_random_uuid();
  tx_fpriv uuid := gen_random_uuid();
  tx_xp uuid := gen_random_uuid();
  tx_x uuid := gen_random_uuid();
  tx_fsal uuid := gen_random_uuid();
  tx_fgp uuid := gen_random_uuid();
  tx_fgs uuid := gen_random_uuid();
  tx_xw uuid := gen_random_uuid();
  tx_gh uuid := gen_random_uuid();
  tx_cy uuid := gen_random_uuid();
  b_f uuid := gen_random_uuid();
  b_falim uuid := gen_random_uuid();
  b_hg uuid := gen_random_uuid();
  b_gsh uuid := gen_random_uuid();
  b_galim uuid := gen_random_uuid();
  b_gpriv uuid := gen_random_uuid();
  b_fpriv uuid := gen_random_uuid();
  g_f uuid := gen_random_uuid();
  g_f2 uuid := gen_random_uuid();
  g_d uuid := gen_random_uuid();
  g_f3 uuid := gen_random_uuid();
  g_dw uuid := gen_random_uuid();
  cg_g uuid := gen_random_uuid();
  cg_f3 uuid := gen_random_uuid();
  cg_g3 uuid := gen_random_uuid();
  cg_fd uuid := gen_random_uuid();
  r_f uuid := gen_random_uuid();
  r_fw uuid := gen_random_uuid();
  pu_f uuid := gen_random_uuid();
  pu_g uuid := gen_random_uuid();
  pu_gx uuid;
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
  s_g uuid := gen_random_uuid();
  s_gp uuid := gen_random_uuid();
  s_dxw uuid := gen_random_uuid();
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
  l_fg uuid := gen_random_uuid();
  lp_f2 uuid := gen_random_uuid();
  lp_g uuid := gen_random_uuid();
  lc_f uuid := gen_random_uuid();
  inv uuid;
  inv_h uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  mail_c text;
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

  -- O UPDATE que troca o autor de uma linha, devolvendo quantas mudaram.
  create function pg_temp.to_author(p_table text, p_id uuid, p_user uuid)
  returns text
  language sql
  as $f$
    select format($q$with u as (update public.%I set user_id = %L where id = %L returning 1) select count(*)::text from u$q$, p_table, p_user, p_id)
  $f$;

  -- Um UPDATE ou DELETE qualquer, devolvendo quantas linhas mudaram.
  create function pg_temp.n(p_sql text)
  returns text
  language sql
  as $f$
    select format($q$with u as (%s returning 1) select count(*)::text from u$q$, p_sql)
  $f$;

  -- Fixtures. Pessoas em replica; D e F abrem Finanças e D cria o W pelo app.
  mail_c := format('wsexit-c-%s@example.invalid', tag);
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (ud, format('wsexit-d-%s@example.invalid', tag)), (uf, format('wsexit-f-%s@example.invalid', tag)),
    (ug, format('wsexit-g-%s@example.invalid', tag)), (uh, format('wsexit-h-%s@example.invalid', tag)),
    (ux, format('wsexit-x-%s@example.invalid', tag)), (uc, mail_c), (uy, format('wsexit-y-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (ud, format('wsexit-d-%s@example.invalid', tag), 'D', 'standard', true, 0),
    (uf, format('wsexit-f-%s@example.invalid', tag), 'F', 'standard', true, 0),
    (ug, format('wsexit-g-%s@example.invalid', tag), 'G', 'standard', true, 0),
    (uh, format('wsexit-h-%s@example.invalid', tag), 'H', 'standard', true, 0),
    (ux, format('wsexit-x-%s@example.invalid', tag), 'X', 'standard', true, 0),
    (uc, mail_c, 'C', 'standard', true, 0),
    (uy, format('wsexit-y-%s@example.invalid', tag), 'Y', 'standard', true, 0);
  set local session_replication_role = origin;

  wsname := 'wsexit W ' || tag;
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
  select id into cat_dalim from public.finance_categories where user_id = ud and workspace_id = ws and name = 'Alimentação' and type = 'expense';

  set local session_replication_role = replica;
  -- F é o membro mais antigo (herda a posse quando D sai com membros).
  insert into public.finance_workspace_members (workspace_id, user_id, role, joined_at) values
    (ws, uf, 'member', now() - interval '3 days'), (ws, ug, 'member', now() - interval '2 days'), (ws, uh, 'member', now() - interval '1 day');
  insert into public.finance_accounts (id, user_id, workspace_id, name, type, initial_balance) values
    (acc_d, ud, ws, 'W da D', 'checking', 0), (acc_fu, uf, ws, 'De F, usada por D', 'checking', 1000), (acc_fo, uf, ws, 'Só de F', 'checking', 0),
    (acc_fr, uf, ws, 'De F, na despesa da compra de D', 'checking', 0), (acc_fo2, uf, ws, 'Só de F, na meta que fica no W', 'checking', 0);
  insert into public.finance_categories (id, user_id, workspace_id, name, type) values
    (cat_fw, uf, ws, 'wsexit Pets', 'expense'), (cat_fp, uf, null, 'wsexit Pets', 'expense'), (cat_fo, uf, ws, 'wsexit Só de F', 'expense'),
    (cat_fo2, uf, ws, 'wsexit Só de F, na receita que fica', 'income'),
    (cat_x, ux, ws, 'wsexit Gatos', 'expense'), (gen_random_uuid(), ux, null, 'wsexit Gatos', 'expense');
  insert into public.finance_store_customers (id, user_id, workspace_id, name, phone) values
    (cust_f, uf, ws, 'Cliente de F', '11 9999-0000'), (cust_h, uh, ws, 'Cliente de H', ''), (cust_x, ux, ws, 'Cliente de X (saiu antes)', '');
  insert into public.finance_suppliers (id, user_id, workspace_id, name) values (sup_f, uf, ws, 'Fornecedor de F');
  insert into public.finance_store_products (id, user_id, workspace_id, kind, name, target_price) values
    (p_f, uf, ws, 'stock', 'Produto de F', 5000), (p_d, ud, ws, 'stock', 'Produto de D', 5000);
  insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date, account_id, category_id, shared_with_user_id) values
    (tx_fd, uf, ws, 'income', 100, 'F: receita da venda de D', sp, acc_d, cat_fo2, null),
    (tx_fsal, uf, ws, 'income', 5000, 'F: salário na conta dele que D também usa', sp, acc_fu, null, null),
    (tx_fdp, uf, ws, 'income', 100, 'F: receita da venda PRIVADA de D', sp, acc_d, null, null),
    (tx_df, ud, ws, 'income', 100, 'D: receita da venda de F', sp, acc_d, null, null),
    (tx_fe, uf, ws, 'expense', 100, 'F: despesa da compra de D (na conta só de F)', sp, acc_fr, null, null),
    (tx_fep, uf, ws, 'expense', 100, 'F: despesa da compra PRIVADA de D', sp, acc_d, null, null),
    (tx_de, ud, ws, 'expense', 100, 'D: despesa da compra de F', sp, acc_d, null, null),
    (tx_ff, uf, ws, 'expense', 100, 'F: despesa da própria compra', sp, acc_fo, cat_fo, null),
    (tx_fo, uf, ws, 'expense', 10, 'F: lançamento comum', sp, acc_fo, cat_fw, null),
    (tx_dfu, ud, ws, 'expense', 10, 'D: na conta de F', sp, acc_fu, null, null),
    (tx_dsh, ud, ws, 'expense', 10, 'D: compartilhado com F (meta em comum)', sp, acc_d, null, uf),
    (tx_gsh, ug, ws, 'expense', 10, 'G: compartilhado com F (sem outro vínculo)', sp, null, null, uf),
    (tx_galim, ug, ws, 'expense', 10, 'G: na categoria Alimentação do W (de D)', sp, null, cat_dalim, null),
    (tx_fg, uf, ws, 'income', 100, 'F: receita da venda de G', sp, null, null, null),
    (tx_gpriv, ug, null, 'expense', 10, 'G: privado, compartilhado com F', sp, null, null, uf),
    (tx_fpriv, uf, null, 'expense', 10, 'F: privado, compartilhado com G', sp, null, null, ug),
    (tx_xp, ux, null, 'income', 100, 'X: receita privada da venda de D (legado)', sp, null, null, null),
    (tx_x, ux, ws, 'expense', 10, 'X: sobra antiga', sp, null, null, null);
  insert into public.finance_budgets (id, user_id, workspace_id, category_id, month, amount_limit, shared_with_user_id) values
    (b_f, uf, ws, cat_fw, ym, 100, null), (b_gsh, ug, ws, cat_fw, ym, 100, uf), (b_galim, ug, ws, cat_dalim, ym, 100, null),
    (b_falim, uf, ws, cat_dalim, ym, 100, null), (b_gpriv, ug, null, null, ym, 100, uf), (b_fpriv, uf, null, null, ym, 100, ug);
  insert into public.finance_goals (id, user_id, workspace_id, name, target_amount, deadline, account_id) values
    (g_f, uf, ws, 'Meta de F com aporte de G', 100, sp + 30, acc_fo2), (g_f2, uf, ws, 'Meta só de F', 100, sp + 30, null),
    (g_d, ud, null, 'Meta de D com F', 100, sp + 30, null), (g_f3, uf, ws, 'Reserva de F', 1000, sp + 30, null),
    (g_dw, ud, ws, 'Meta do W de D', 100, sp + 30, null);
  insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (g_d, ud, uf), (g_f, uf, uc);
  insert into public.finance_goal_contributions (id, goal_id, user_id, amount, note, date) values
    (cg_g, g_f, ug, 50, 'nota de G', sp), (cg_f3, g_f3, uf, 500, 'de F', sp), (cg_g3, g_f3, ug, 0.01, 'G', sp),
    (cg_fd, g_dw, uf, 30, 'F na meta de D', sp);
  insert into public.finance_recurring (id, user_id, workspace_id, type, description, amount, day_of_month, category_id) values
    (r_f, uf, ws, 'expense', 'Recorrente de F', 10, 5, cat_fo), (r_fw, uf, ws, 'expense', 'Recorrente de F em Pets', 10, 5, cat_fw);
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
    (s_f2, uf, ws, 'sold', sp, null, acc_fo, tx_df),
    (s_g, ug, ws, 'sold', sp, null, null, tx_fg);
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

  -- 1. F sai (leave_workspace), depois de convidar C pelo app.
  begin
    r := pg_temp.as_user(uf, format('select public.invite_member(%L, %L)::text', ws, mail_c));
    out := out || pg_temp.expect('1 fixture: F convida C pelo app (invite_member)', r, 'ok %');
    inv := substr(r, 4)::uuid;
    -- Convite direto (sem a policy wi_member_insert): nem em nome da dona, nem
    -- no próprio nome; só pelo invite_member.
    r := pg_temp.as_user(uf, pg_temp.n(format($q$insert into public.finance_workspace_invites (workspace_id, invited_by, invited_email) values (%L, %L, %L)$q$, ws, ud, 'wsexit-forjado-' || tag || '@example.invalid')))
         || ' | ' || pg_temp.as_user(uf, pg_temp.n(format($q$insert into public.finance_workspace_invites (workspace_id, invited_by, invited_email) values (%L, %L, %L)$q$, ws, uf, 'wsexit-forjado-' || tag || '@example.invalid')));
    out := out || pg_temp.expect('1 F (membro) grava convite direto com invited_by = D e com o próprio: barrado (sem policy de INSERT)', r,
                                 'erro 42501: new row violates row-level security policy% | erro 42501: new row violates row-level security policy%');
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('1 F sai do W (leave_workspace)', r, 'ok ');
    out := out || pg_temp.expect('1 G vê de F só o item na venda de D e as 5 receitas/despesas ligadas a venda/compra de quem fica (também as privadas); conta nenhuma em nome de F',
                                 pg_temp.sees(ug, uf), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=5 conta=0');
    out := out || pg_temp.expect('1 D vê de F o mesmo', pg_temp.sees(ud, uf), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=5 conta=0');
    out := out || pg_temp.expect('1 F, fora, vê tudo o que continua dele', pg_temp.sees(uf, uf), 'ok cli=1 forn=1 prod=1 comp=2 vend=2 itens=3 tx=9 conta=1');
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
    out := out || pg_temp.expect('1 efeito conhecido: D muda a quantidade do item dela com o produto de F, que ficou privado', r, 'erro P0002: Produto não encontrado%');
    select format('%s %s %s %s', count(*) filter (where user_id = ud and workspace_id = ws), count(*) filter (where user_id = uf and workspace_id = ws),
                  (select workspace_id is null and user_id = uf from public.finance_categories where id = cat_fo),
                  (select workspace_id is null and name = 'wsexit Pets' from public.finance_categories where id = cat_fp))
      into r from public.finance_categories where user_id in (ud, uf);
    out := out || pg_temp.expect('1 categorias: a do W que só F usava vai com ele; a que G usa e a da receita de F que fica passam para D (12 + 2); nenhuma no W em nome de F; a pessoal de F intacta', r, '14 0 t t');
    select format('%s %s %s %s %s', (select user_id = ud and workspace_id = ws from public.finance_categories where id = cat_fw),
                  (select user_id = ud and workspace_id = ws from public.finance_accounts where id = acc_fu),
                  (select user_id = ud and workspace_id = ws from public.finance_accounts where id = acc_fr),
                  (select user_id = ud and workspace_id = ws from public.finance_accounts where id = acc_fo2),
                  (select user_id = ud and workspace_id = ws from public.finance_categories where id = cat_fo2))
      into r;
    out := out || pg_temp.expect('1 o que fica no W passa para D: a categoria do orçamento de G, a conta do lançamento de D, a conta da despesa de F que ficou no W, a conta só de F da meta que fica e a categoria só de F da receita que fica', r, 't t t t t');
    r := pg_temp.as_user(ud, format('select count(*)::text from public.finance_accounts where id = %L', acc_fr));
    out := out || pg_temp.expect('1 a conta só de F usada pela despesa dele que ficou no W fica no W: D a vê', r, 'ok 1');
    select format('%s %s', (select workspace_id = ws and user_id = ud from public.finance_goals where id = g_f),
                  (select workspace_id is null and user_id = uf from public.finance_goals where id = g_f2))
      into r;
    r := r || ' ' || pg_temp.as_user(ug, format('select count(*)::text from public.finance_goals where id = %L', g_f))
         || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_goal_contributions where id = %L', cg_g));
    out := out || pg_temp.expect('1 a meta de F com o aporte de G fica no W e passa para D (G a vê; F não lê o aporte de G); a meta só de F vai com ele', r, 't t ok 1 ok 0');
    -- O share que F fez da meta que passou para D sai junto.
    r := (select count(*) from public.finance_goal_shares where goal_id = g_f)::text
         || ' ' || pg_temp.as_user(uc, format('select count(*)::text from public.finance_goals where id = %L', g_f))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('insert into public.finance_goal_shares (goal_id, owner_id, shared_with_user_id) values (%L, %L, %L)', g_f, ud, uc)))
         || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_goal_shares where goal_id = %L', g_f));
    out := out || pg_temp.expect('1 o share de F (com C) da meta que passou para D é apagado: C não a lê, D a compartilha com C, F não lê o share de D',
                                 r, '0 ok 0 ok 1 ok 0');
    -- "Reserva de F": 500 de F e 0,01 de G. Os 500 vão para uma cópia privada
    -- de F; a meta do W, de D, fica só com o de G.
    select format('%s %s %s', (select g.workspace_id is null and g.user_id = uf and g.name = 'Reserva de F' and g.id <> g_f3
                                 from public.finance_goal_contributions c join public.finance_goals g on g.id = c.goal_id where c.id = cg_f3),
                  (select workspace_id = ws and user_id = ud from public.finance_goals where id = g_f3),
                  (select string_agg(id::text, ',') = cg_g3::text from public.finance_goal_contributions where goal_id = g_f3))
      into r;
    -- (As leituras depois de uma escrita vão num comando à parte: a
    -- subconsulta no mesmo comando vê o estado de antes da chamada.)
    r := r || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_goal_contributions where id = %L', cg_f3))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_goals where id = %L', g_f3)));
    r := r || ' ' || (select count(*) from public.finance_goal_contributions where id = cg_f3);
    out := out || pg_temp.expect('1 meta de F com 500 dele e 0,01 de G: os 500 vão para a cópia privada de F, a meta do W (de D) fica com o de G; D apaga a dela e o aporte de F continua',
                                 r, 't t t ok 1 ok 1 1');
    -- O aporte que F deixou na meta de D (no W): fora, ele não o altera nem o
    -- apaga; G, membro, altera o dele.
    r := pg_temp.as_user(uf, pg_temp.n(format('update public.finance_goal_contributions set amount = 100000 where id = %L', cg_fd)))
         || ' ' || pg_temp.as_user(uf, pg_temp.n(format('delete from public.finance_goal_contributions where id = %L', cg_fd)));
    r := r || ' ' || (select amount::text from public.finance_goal_contributions where id = cg_fd)
         || ' | ' || pg_temp.as_user(ug, pg_temp.n(format('update public.finance_goal_contributions set amount = 51 where id = %L', cg_g)));
    out := out || pg_temp.expect('1 F, fora, não altera nem apaga o aporte que deixou na meta de D (o acumulado não muda); G, membro, altera o dele',
                                 r, 'ok 0 ok 0 30.00 | ok 1');
    select format('%s %s %s', (select shared_with_user_id = uf from public.finance_transactions where id = tx_dsh),
                  (select shared_with_user_id is null from public.finance_transactions where id = tx_gsh),
                  (select shared_with_user_id is null from public.finance_budgets where id = b_gsh))
      into r;
    out := out || pg_temp.expect('1 shared_with para F: fica no lançamento de D (meta em comum), sai do lançamento e do orçamento de G', r, 't t t');
    r := pg_temp.as_user(ug, pg_temp.n(format('update public.finance_transactions set amount = 11 where id = %L', tx_gsh)))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('update public.finance_transactions set amount = 11 where id = %L', tx_dsh)));
    out := out || pg_temp.expect('1 G e D editam os próprios lançamentos (sem a limpeza, o WITH CHECK do SEC-013 barrava G)', r, 'ok 1 ok 1');
    r := pg_temp.as_user(ug, pg_temp.n(format('update public.finance_transactions set amount = 11 where id = %L', tx_gpriv)))
         || ' ' || pg_temp.as_user(ug, pg_temp.n(format('update public.finance_budgets set amount_limit = 11 where id = %L', b_gpriv)))
         || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_transactions where id = %L', tx_gpriv))
         || ' | ' || pg_temp.as_user(uf, pg_temp.n(format('update public.finance_transactions set amount = 11 where id = %L', tx_fpriv)))
         || ' ' || pg_temp.as_user(uf, pg_temp.n(format('update public.finance_budgets set amount_limit = 11 where id = %L', b_fpriv)))
         || ' ' || pg_temp.as_user(ug, format('select count(*)::text from public.finance_transactions where id = %L', tx_fpriv));
    out := out || pg_temp.expect('1 privados entre G e F (sem outro vínculo), nos dois sentidos: cada um edita o lançamento e o orçamento dele, e o outro não lê mais',
                                 r, 'ok 1 ok 1 ok 0 | ok 1 ok 1 ok 0');
    r := (select count(*) from public.finance_workspace_invites where id = inv)::text
         || ' ' || pg_temp.as_user(uc, format('select public.accept_workspace_invite(%L)::text', inv))
         || ' ' || (select count(*) from public.finance_workspace_members where user_id = uc);
    out := out || pg_temp.expect('1 o convite pendente que F mandou some: C não entra pelo convite', r, '0 erro P0001: Invite not found 0');
    select count(*)::text into r from public.notifications where type = 'member_left' and data ->> 'actor_id' = uf::text and user_id in (ud, ug, uh);
    out := out || pg_temp.expect('1 D, G e H recebem o aviso', r, '3');
    -- As linhas privadas de F nas categorias que ficaram no W (Pets, que G
    -- usa, e Alimentação, de D) passam para cópias pessoais dele.
    select format('%s | %s | %s %s', (select c.name from public.finance_budgets b join public.finance_categories c on c.id = b.category_id
                                        where b.id = b_f and c.user_id = uf and c.workspace_id is null),
                  (select c.name from public.finance_budgets b join public.finance_categories c on c.id = b.category_id
                    where b.id = b_falim and c.user_id = uf and c.workspace_id is null),
                  (select category_id = (select category_id from public.finance_budgets where id = b_f) from public.finance_transactions where id = tx_fo),
                  (select category_id = (select category_id from public.finance_budgets where id = b_f) from public.finance_recurring where id = r_fw))
      into r;
    r := r || ' ' || pg_temp.as_user(uf, format($q$select count(*)::text from public.finance_categories c
                                                    where c.id in (select category_id from public.finance_budgets where id in (%L, %L))$q$, b_f, b_falim));
    out := out || pg_temp.expect('1 os orçamentos, o lançamento e o recorrente de F nas categorias que ficaram no W vão para cópias pessoais dele (renomeadas: F já tem as pessoais), que ele lê',
                                 r, format('wsexit Pets (%s) | Alimentação (%s) | t t ok 2', wsname, wsname));
    r := left(pg_temp.as_user(uf, format($q$select public.finance_materialize_recurring(%L, %L)::text$q$, sp, sp)), 3);
    select r || (select count(*) from public.finance_budgets b join public.finance_categories c on c.id = b.category_id
                  where b.user_id = uf and b.workspace_id is null and c.workspace_id is not null)
           || ' ' || (select count(*) from public.finance_budgets b where b.user_id = uf and b.workspace_id is null
                        and b.category_id = (select category_id from public.finance_recurring where id = r_fw))
      into r;
    out := out || pg_temp.expect('1 o materialize de F (cron) cria o orçamento do recorrente de Pets na cópia dele, e nenhum orçamento privado dele fica em categoria de workspace', r, 'ok 0 2');
    r := pg_temp.as_user(uh, pg_temp.n(format('delete from public.finance_categories where id = %L', cat_fw)))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_categories where id = %L', cat_dalim)));
    r := r || ' | ' || (select count(*) from public.finance_budgets where id in (b_f, b_falim))
         || ' ' || (select (category_id is not null)::text from public.finance_transactions where id = tx_fo);
    out := out || pg_temp.expect('1 H (membro) apaga Pets do W e D apaga Alimentação: os orçamentos privados de F e o lançamento dele continuam com categoria',
                                 r, 'ok 1 ok 1 | 2 true');
    -- Resíduos conhecidos (cabeçalho da migration): a conta de F que D usou
    -- passa inteira para D, com o saldo inicial de F, e D pode apagá-la; e o
    -- produto que F levou, se apagado, leva a compra de D.
    select format('%s %s', (select user_id = ud and workspace_id = ws and initial_balance = 1000 from public.finance_accounts where id = acc_fu),
                  (select workspace_id is null and user_id = uf and account_id = acc_fu from public.finance_transactions where id = tx_fsal))
      into r;
    r := r || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_accounts where id = %L', acc_fu))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_accounts where id = %L', acc_fu)));
    r := r || ' ' || coalesce((select account_id::text from public.finance_transactions where id = tx_fsal), 'nulo');
    out := out || pg_temp.expect('1 resíduo conhecido (conta): a de F que D usou passa para D com o saldo inicial de F; F não a vê; D a apaga e o salário privado de F fica sem conta',
                                 r, 't t ok 0 ok 1 nulo');
    r := pg_temp.as_user(uf, pg_temp.n(format('delete from public.finance_store_products where id = %L', p_f)));
    r := r || ' ' || (select count(*) from public.finance_store_purchases where id = pu_df);
    out := out || pg_temp.expect('1 resíduo conhecido (Loja): F, fora, apaga o produto que levou, e a compra de D (no W) vai junto', r, 'ok 1 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 1 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 2. D remove F, que tem linhas nas 6 tabelas, na Loja e em vendas e
  --    compras de D (o 42501 de antes).
  begin
    r := pg_temp.as_user(uf, format('select public.invite_member(%L, %L)::text', ws, mail_c));
    inv := substr(r, 4)::uuid;
    r := pg_temp.as_user(uf, pg_temp.n(format($q$insert into public.finance_workspace_invites (workspace_id, invited_by, invited_email) values (%L, %L, %L)$q$, ws, ud, 'wsexit-forjado-' || tag || '@example.invalid')));
    out := out || pg_temp.expect('2 F (membro) grava convite direto em nome de D: barrado', r, 'erro 42501: new row violates row-level security policy%');
    r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', uf));
    out := out || pg_temp.expect('2 D remove F (com transação, orçamento, conta, categoria, meta, recorrente e Loja no W)', r, 'ok ');
    out := out || pg_temp.expect('2 G vê de F o mesmo que na saída', pg_temp.sees(ug, uf), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=5 conta=0');
    select format('%s %s', (select count(*) from public.finance_workspace_members where user_id = uf),
                  (select count(*) from public.notifications where user_id = uf and type = 'member_left' and data ->> 'actor_id' = ud::text))
      into r;
    out := out || pg_temp.expect('2 F fora do W e avisado', r, '0 1');
    select format('%s %s %s %s %s %s %s',
                  (select workspace_id is null from public.finance_transactions where id = tx_fo),
                  (select workspace_id is null from public.finance_budgets where id = b_f),
                  (select workspace_id is null from public.finance_accounts where id = acc_fo),
                  (select workspace_id = ws and user_id = ud from public.finance_categories where id = cat_fw),
                  (select workspace_id is null from public.finance_categories where id = cat_fo),
                  (select workspace_id is null from public.finance_goals where id = g_f2),
                  (select workspace_id is null from public.finance_recurring where id = r_f))
      into r;
    out := out || pg_temp.expect('2 transação, orçamento, conta, a categoria só dele, a meta só dele e o recorrente de F no privado; a categoria que G usa fica no W, de D', r, 't t t t t t t');
    select format('%s %s %s', (select user_id = ud from public.finance_accounts where id = acc_fu),
                  (select user_id = ud from public.finance_accounts where id = acc_fr),
                  (select workspace_id = ws and user_id = ud from public.finance_goals where id = g_f))
      into r;
    out := out || pg_temp.expect('2 as contas e a meta que ficam no W passam para D', r, 't t t');
    r := pg_temp.as_user(uf, pg_temp.n(format($q$update public.finance_categories set name = 'F renomeou' where id = %L$q$, cat_fw)))
         || ' ' || pg_temp.as_user(uf, pg_temp.to_private('finance_categories', cat_fw))
         || ' ' || pg_temp.as_user(uf, pg_temp.n(format('delete from public.finance_categories where id = %L', cat_fw)))
         || ' ' || pg_temp.as_user(uf, pg_temp.n(format('delete from public.finance_accounts where id = %L', acc_fu)))
         || ' | ' || (select count(*) from public.finance_budgets where id = b_gsh)
         || ' ' || (select name from public.finance_categories where id = cat_fw)
         || ' ' || (select count(*) from public.finance_accounts where id = acc_fu);
    out := out || pg_temp.expect('2 F, removido, não renomeia, não leva nem apaga a categoria do W (a do orçamento de G) nem apaga a conta usada por D: 0 linhas, tudo intacto',
                                 r, 'ok 0 ok 0 ok 0 ok 0 | 1 wsexit Pets 1');
    r := (select count(*) from public.finance_workspace_invites where id = inv)::text
         || ' ' || pg_temp.as_user(uc, format('select public.accept_workspace_invite(%L)::text', inv))
         || ' ' || (select count(*) from public.finance_workspace_members where user_id = uc);
    out := out || pg_temp.expect('2 o convite pendente que F mandou some com a remoção: C não entra', r, '0 erro P0001: Invite not found 0');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_d));
    out := out || pg_temp.expect('2 D cancela a venda com a receita de F (apagada no W, sem 42501)', r || ' ' || (select count(*) from public.finance_transactions where id = tx_fd), 'ok cancelled 0');
    r := pg_temp.as_user(uf, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_f2));
    out := out || pg_temp.expect('2 F, removido, cancela a própria venda (desvinculada)', r, 'ok cancelled');
    select format('%s %s', (select g.workspace_id is null and g.user_id = uf and g.id <> g_f3
                              from public.finance_goal_contributions c join public.finance_goals g on g.id = c.goal_id where c.id = cg_f3),
                  (select workspace_id = ws and user_id = ud from public.finance_goals where id = g_f3))
      into r;
    r := r || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_goals where id = %L', g_f3)));
    r := r || ' ' || (select count(*) from public.finance_goal_contributions where id = cg_f3);
    out := out || pg_temp.expect('2 na remoção, os 500 de F vão para a cópia privada dele; D apaga a meta do W e o aporte de F continua', r, 't t ok 1 1');
    r := (select string_agg(c.name, ' | ' order by c.name) from public.finance_budgets b join public.finance_categories c on c.id = b.category_id
           where b.id in (b_f, b_falim) and c.user_id = uf and c.workspace_id is null)
         || ' ' || pg_temp.as_user(uh, pg_temp.n(format('delete from public.finance_categories where id = %L', cat_fw)))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_categories where id = %L', cat_dalim)));
    r := r || ' ' || (select count(*) from public.finance_budgets where id in (b_f, b_falim));
    out := out || pg_temp.expect('2 na remoção, os orçamentos de F nas categorias que ficam vão para cópias dele; H apaga Pets e D apaga Alimentação, e os orçamentos de F ficam',
                                 r, format('Alimentação (%s) | wsexit Pets (%s) ok 1 ok 1 2', wsname, wsname));
    r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', uh)) || ' ' || pg_temp.sees(ug, uh);
    out := out || pg_temp.expect('2 D remove H (só Loja): G não vê mais o cliente de H', r, 'ok  ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=0 tx=0 conta=0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 2 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 2b. Saída em cadeia: F lançou a receita da venda de G e sai (a receita
  --     fica no W, seguindo a venda); depois G sai, ou D remove G.
  begin
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    r := r || ' ' || (select (workspace_id = ws)::text from public.finance_transactions where id = tx_fg);
    r := r || ' | ' || pg_temp.as_user(ug, 'select public.leave_workspace()::text');
    select r || format(' %s %s', (select workspace_id is null and user_id = uf from public.finance_transactions where id = tx_fg),
                       (select workspace_id is null and transaction_id is null from public.finance_store_sales where id = s_g))
      into r;
    r := r || ' ' || pg_temp.as_user(ud, format('select count(*)::text from public.finance_transactions where id = %L', tx_fg));
    out := out || pg_temp.expect('2b F sai (a receita dele na venda de G fica no W); G sai: a venda vai sem a receita, e a receita vai para o privado de F (D não a vê)',
                                 r, 'ok  true | ok  t t ok 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 2b erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;
  begin
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text')
         || ' | ' || pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', ug));
    select r || format(' %s', (select workspace_id is null and user_id = uf from public.finance_transactions where id = tx_fg)) into r;
    r := r || ' ' || pg_temp.as_user(ud, format('select count(*)::text from public.finance_transactions where id = %L', tx_fg));
    out := out || pg_temp.expect('2b o mesmo quando D remove G (a dona leva a receita do ex-membro F para o privado dele)', r, 'ok  | ok  t ok 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 2b erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;
  -- 2b, pela compra de G (F lançou a despesa) e pela venda PRIVADA de G (F
  -- lançou a receita no W).
  begin
    set local session_replication_role = replica;
    insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date) values
      (tx_fgp, uf, ws, 'expense', 100, 'F: despesa da compra de G', sp), (tx_fgs, uf, ws, 'income', 100, 'F: receita da venda PRIVADA de G', sp);
    insert into public.finance_store_purchases (id, user_id, workspace_id, product_id, quantity, unit_cost, date, status, transaction_id) values
      (pu_g, ug, ws, p_d, 1, 1000, sp, 'received', tx_fgp);
    insert into public.finance_store_sales (id, user_id, workspace_id, status, sold_on, transaction_id) values (s_gp, ug, null, 'sold', sp, tx_fgs);
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    r := r || ' ' || (select (workspace_id = ws)::text from public.finance_transactions where id = tx_fgp)
         || ' ' || (select (workspace_id = ws)::text from public.finance_transactions where id = tx_fgs);
    r := r || ' | ' || pg_temp.as_user(ug, 'select public.leave_workspace()::text');
    select r || format(' %s %s %s %s', (select workspace_id is null and user_id = uf from public.finance_transactions where id = tx_fgp),
                       (select transaction_id is null from public.finance_store_purchases where id = pu_g),
                       (select workspace_id is null and user_id = uf from public.finance_transactions where id = tx_fgs),
                       (select transaction_id is null from public.finance_store_sales where id = s_gp))
      into r;
    r := r || ' ' || pg_temp.as_user(ud, format('select count(*)::text from public.finance_transactions where id in (%L, %L)', tx_fgp, tx_fgs));
    out := out || pg_temp.expect('2b pela compra de G e pela venda PRIVADA de G: F sai (a despesa e a receita ficam no W); G sai: as duas vão para o privado de F, a compra e a venda saem desvinculadas, D não as vê',
                                 r, 'ok  true true | ok  t t t t ok 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 2b erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 3. A criadora sai com membros (antes: 23505 nas categorias semeadas) e,
  --    depois, a conta dela é excluída.
  begin
    r := pg_temp.as_user(ud, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('3 D (criadora, dona) sai com membros', r, 'ok ');
    select format('%s %s %s', (select role from public.finance_workspace_members where user_id = uf),
                  (select owner_id = uf from public.finance_workspaces where id = ws),
                  (select count(*) from public.finance_workspace_members where workspace_id = ws and role = 'owner'))
      into r;
    out := out || pg_temp.expect('3 a posse passa para F, o membro mais antigo', r, 'owner t 1');
    select format('%s %s %s %s', count(*) filter (where workspace_id = ws), count(*) filter (where workspace_id is null),
                  count(*) filter (where workspace_id is null and name like format('%% (%s)', wsname)),
                  (select user_id = uf and workspace_id = ws from public.finance_categories where id = cat_dalim))
      into r from public.finance_categories where user_id = ud;
    r := r || ' ' || pg_temp.as_user(ug, format('select count(*)::text from public.finance_categories where workspace_id = %L', ws));
    out := out || pg_temp.expect('3 as 11 categorias semeadas que só D usava vão com ela (com o nome do W); "Alimentação", que G usa, fica no W e passa para F; G vê no W 5 (ela, as 3 de F e a de X)',
                                 r, '0 23 11 t ok 5');
    select format('%s %s %s %s', (select transaction_id is null from public.finance_store_sales where id = s_dp),
                  (select transaction_id is null from public.finance_store_purchases where id = pu_dp),
                  (select workspace_id = ws from public.finance_transactions where id = tx_fdp),
                  (select workspace_id = ws from public.finance_transactions where id = tx_fep))
      into r;
    out := out || pg_temp.expect('3 a venda e a compra PRIVADAS de D saem desvinculadas da receita e da despesa de F, que ficam no W (F continua membro)', r, 't t t t');
    select format('%s %s %s %s %s %s',
                  (select workspace_id is null and transaction_id is null from public.finance_store_sales where id = s_d),
                  (select workspace_id = ws from public.finance_transactions where id = tx_fd),
                  (select workspace_id = ws and user_id = uf from public.finance_accounts where id = acc_d),
                  (select workspace_id = ws from public.finance_transactions where id = tx_df),
                  (select workspace_id is null from public.finance_transactions where id = tx_dfu),
                  (select workspace_id is null from public.finance_transactions where id = tx_dsh))
      into r;
    out := out || pg_temp.expect('3 a venda de D sai desvinculada da receita de F (que fica); a conta de D usada por F fica e passa para F; a receita de D na venda de F fica', r, 't t t t t t');
    out := out || pg_temp.expect('3 G vê de D só o item na venda de F e a receita e a despesa ligadas a venda/compra de F; conta nenhuma em nome de D',
                                 pg_temp.sees(ug, ud), 'ok cli=0 forn=0 prod=0 comp=0 vend=0 itens=1 tx=2 conta=0');
    delete from auth.users where id = ud;
    select format('%s %s %s %s %s', (select count(*) from public.finance_categories where id = cat_dalim),
                  (select count(*) from public.finance_budgets where id = b_galim),
                  coalesce((select (category_id = cat_dalim)::text from public.finance_transactions where id = tx_galim), 'sem lançamento'),
                  (select count(*) from public.finance_accounts where id = acc_d),
                  coalesce((select (account_id = acc_d)::text from public.finance_transactions where id = tx_fd), 'sem lançamento'))
      into r;
    out := out || pg_temp.expect('3 a conta de D é excluída: a categoria e a conta do W (agora de F), o orçamento de G e a categoria e a conta dos lançamentos ficam',
                                 r, '1 1 true 1 true');
    r := pg_temp.as_user(uf, format('select public.remove_workspace_member(%L)::text', ug));
    out := out || pg_temp.expect('3 F, a nova dona, remove G', r, 'ok ');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 3 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;
  -- 3b. F sai e a conta de D, dona ATIVA, é excluída (admin-ops delete_user):
  --     os orçamentos de F estão nas cópias dele e ficam. Resíduo conhecido
  --     (cabeçalho): a exclusão de quem ainda é membro não passa pela saída;
  --     a da dona apaga o W e, com as categorias dela, o orçamento de G.
  begin
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    delete from auth.users where id = ud;
    r := r || ' ' || (select count(*) from public.finance_budgets where id in (b_f, b_falim))
         || ' | ' || (select count(*) from public.finance_workspaces where id = ws)
         || ' ' || (select count(*) from public.finance_budgets where id = b_galim);
    out := out || pg_temp.expect('3b F sai e a conta de D (dona ativa) é excluída: os 2 orçamentos de F ficam; resíduo conhecido: o W some e o orçamento de G em Alimentação vai junto',
                                 r, 'ok  2 | 0 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 3b erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 4. Todos saem; a criadora, sozinha, sai por último e o W é apagado.
  begin
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(ug, 'select public.leave_workspace()::text')
         || '|' || pg_temp.as_user(uh, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(ud, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('4 F, G, H e por fim D (sozinha) saem: o W é apagado', r || ' ' || (select count(*) from public.finance_workspaces where id = ws), 'ok |ok |ok |ok  0');
    select format('%s %s %s', count(*), count(*) filter (where name like format('%% (%s)', wsname)),
                  (select user_id = ud and workspace_id is null and name = 'wsexit Pets' from public.finance_categories where id = cat_fw))
      into r from public.finance_categories where user_id = ud and workspace_id is null;
    out := out || pg_temp.expect('4 as 12 categorias do W de D vão para o privado com o nome do W, e as 2 que F deixou para D vão também (26 pessoais)', r, '26 12 t');
    select format('%s %s', count(*) filter (where c.user_id <> b.user_id or c.workspace_id is not null),
                  count(*) filter (where b.id in (b_f, b_gsh)))
      into r
      from public.finance_budgets b join public.finance_categories c on c.id = b.category_id
     where b.user_id in (uf, ug);
    out := out || pg_temp.expect('4 nenhum orçamento privado de F ou G fica numa categoria que não é dele (Pets foi para D); os de Pets de F e de G existem', r, '0 2');
    select name into r from public.finance_categories where id = cat_x;
    out := out || pg_temp.expect('4 a categoria do ex-membro X, na cascata, colide com a pessoal dele e vira "(workspace)"', r, 'wsexit Gatos (workspace)');
    select format('%s %s %s %s', (select workspace_id is null from public.finance_store_sale_items where id = i_fd),
                  (select workspace_id is null and user_id = uf from public.finance_transactions where id = tx_fd),
                  (select transaction_id is null from public.finance_store_sales where id = s_d),
                  (select workspace_id is null from public.finance_store_customers where id = cust_x))
      into r;
    out := out || pg_temp.expect('4 as sobras (item e receita de F na venda de D, cliente de X) vão para o privado dos autores', r, 't t t t');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 4 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;
  -- 4b. Empréstimos (devedores são terceiros): o de F, só com pagamento e
  --     garantia dele, vai com ele; o outro, com pagamento de G, fica no W com
  --     o devedor e vai para o privado na saída da última pessoa (antes ela
  --     esbarrava no trg_loan_payment_guard e o W ficava).
  begin
    set local session_replication_role = replica;
    insert into public.finance_loan_borrowers (id, user_id, workspace_id, name) values (lb_f, uf, ws, 'Devedor de F');
    insert into public.finance_loans (id, user_id, workspace_id, borrower_id, principal, disbursed_on, status, requested_by) values
      (l_f, uf, ws, lb_f, 1000, sp, 'active', uf), (l_fg, uf, ws, lb_f, 2000, sp, 'active', uf);
    insert into public.finance_loan_payments (id, user_id, workspace_id, loan_id, amount, date, reported_by) values
      (lp_f, uf, ws, l_f, 100, sp, uf), (lp_g, ug, ws, l_fg, 100, sp, ug);
    insert into public.finance_loan_collaterals (id, user_id, workspace_id, loan_id, description) values (lc_f, uf, ws, l_f, 'Garantia');
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    select r || format('%s %s %s %s %s', (select workspace_id is null from public.finance_loans where id = l_f),
                       (select workspace_id is null from public.finance_loan_payments where id = lp_f),
                       (select workspace_id is null from public.finance_loan_collaterals where id = lc_f),
                       (select workspace_id = ws from public.finance_loans where id = l_fg),
                       (select workspace_id = ws from public.finance_loan_borrowers where id = lb_f))
      into r;
    r := r || ' ' || pg_temp.as_user(ug, format('select count(*)::text from public.finance_loans where id = %L', l_f))
         || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_loans where id = %L', l_f));
    out := out || pg_temp.expect('4b F sai: o empréstimo dele (com o pagamento e a garantia dele) vai com ele, G já não o lê; o que tem pagamento de G fica no W, com o devedor',
                                 r, 'ok t t t t t ok 0 ok 1');
    r := pg_temp.as_user(ug, 'select public.leave_workspace()::text') || '|' || pg_temp.as_user(uh, 'select public.leave_workspace()::text')
         || '|' || pg_temp.as_user(ud, 'select public.leave_workspace()::text');
    select r || format(' %s %s %s %s', (select count(*) from public.finance_workspaces where id = ws),
                       (select workspace_id is null and user_id = uf from public.finance_loans where id = l_fg),
                       (select workspace_id is null and user_id = ug from public.finance_loan_payments where id = lp_g),
                       (select workspace_id is null from public.finance_loan_borrowers where id = lb_f))
      into r;
    r := r || ' ' || pg_temp.as_user(uf, format('select count(*)::text from public.finance_loan_borrowers where id = %L', lb_f));
    out := out || pg_temp.expect('4b G, H e por fim D saem: o W é apagado (antes: 42501 do trg_loan_payment_guard), e o empréstimo, o pagamento e o devedor que ficaram vão para o privado dos autores',
                                 r, 'ok |ok |ok  0 t t t ok 1');
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
                                 r || ' ' || (select name from public.finance_categories where id = cat_fw), format('ok 1 wsexit Pets (%s)', wsname));
    set local session_replication_role = replica;
    insert into public.finance_categories (id, user_id, workspace_id, name, type) values
      (cat_b, uf, ws, 'wsexit Bis', 'expense'), (gen_random_uuid(), uf, null, 'wsexit Bis', 'expense'),
      (gen_random_uuid(), uf, null, format('wsexit Bis (%s)', wsname), 'expense');
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, pg_temp.to_private('finance_categories', cat_b));
    out := out || pg_temp.expect('5 com "Nome (W)" também ocupado: o número entra',
                                 r || ' ' || (select name from public.finance_categories where id = cat_b), format('ok 1 wsexit Bis (%s 2)', wsname));
    r := pg_temp.try(null, null, format($q$with u as (update public.finance_categories set workspace_id = null
                                          where user_id = %L and workspace_id = %L and name = 'Alimentação' and type = 'expense' returning name) select name from u$q$, ud, ws));
    out := out || pg_temp.expect('5 sem usuário (cascata, exclusão de conta): também renomeia', r, format('ok Alimentação (%s)', wsname));
    r := pg_temp.as_user(ud, format($q$with u as (update public.finance_categories set workspace_id = null
                                     where user_id = %L and workspace_id = %L and name = 'Moradia' returning name) select name from u$q$, ud, ws));
    out := out || pg_temp.expect('5 D leva "Moradia" do W para o pessoal: colide e é renomeada', r, format('ok Moradia (%s)', wsname));
    set local session_replication_role = replica;
    insert into public.finance_categories (id, user_id, workspace_id, name, type) values (cat_u, ud, ws, 'wsexit Única', 'income');
    set local session_replication_role = origin;
    r := pg_temp.as_user(ud, pg_temp.to_private('finance_categories', cat_u));
    out := out || pg_temp.expect('5 sem colisão o nome não muda', r || ' ' || (select name from public.finance_categories where id = cat_u), 'ok 1 wsexit Única');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 5 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 6. Sobras antigas: X saiu antes da migration (cliente, despesa e
  --    categoria no W, a receita privada dele travando a venda de D) e H saiu
  --    pelo DELETE direto da filiação, que existia antes da migration,
  --    deixando um convite pendente.
  begin
    delete from public.finance_workspace_members where workspace_id = ws and user_id = uh;
    set local session_replication_role = replica;
    insert into public.finance_workspace_invites (id, workspace_id, invited_by, invited_email, status) values (inv_h, ws, uh, mail_c, 'pending');
    set local session_replication_role = origin;
    r := pg_temp.as_user(ug, format('select count(*)::text from public.finance_store_customers where id in (%L, %L)', cust_x, cust_h));
    out := out || pg_temp.expect('6 antes: G lê os clientes de X e de H, que já não são membros', r, 'ok 2');
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled')::text$q$, s_dx));
    out := out || pg_temp.expect('6 antes: D não cancela a venda com a receita privada de X', r, 'erro 42501: A receita vinculada é de outra pessoa%');
    v := private.finance_workspace_reconcile();
    out := out || pg_temp.expect('6 reconcile: pares tratados, vendas desvinculadas e convite de quem saiu apagado',
                                 format('%s %s %s', (v ->> 'pairs')::int >= 2, (v ->> 'sales_unlinked')::int >= 1, coalesce((v ->> 'invites_deleted')::int >= 1, false)), 't t t');
    r := pg_temp.as_user(ug, format('select count(*)::text from public.finance_store_customers where id in (%L, %L)', cust_x, cust_h));
    out := out || pg_temp.expect('6 depois: G não lê mais os clientes de X e de H', r, 'ok 0');
    select format('%s %s %s', (select workspace_id is null from public.finance_transactions where id = tx_x),
                  (select transaction_id is null from public.finance_store_sales where id = s_dx),
                  (select workspace_id is null and user_id = ux from public.finance_transactions where id = tx_xp))
      into r;
    out := out || pg_temp.expect('6 depois: a despesa de X no privado; a venda de D desvinculada da receita privada de X (que não volta ao W)', r, 't t t');
    select format('%s | %s', (select name from public.finance_categories where id = cat_x and workspace_id is null and user_id = ux),
                  (select count(*) from public.finance_workspace_invites where id = inv_h))
      into r;
    out := out || pg_temp.expect('6 depois: a categoria que X deixou no W (ninguém usa) vai para o privado dele, renomeada; o convite de H some',
                                 r, format('wsexit Gatos (%s) | 0', wsname));
    r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_dx));
    out := out || pg_temp.expect('6 depois: D cancela', r, 'ok cancelled');
    v := private.finance_workspace_reconcile();
    out := out || pg_temp.expect('6 de novo: nada a desvincular', format('%s %s', v ->> 'sales_unlinked', v ->> 'purchases_unlinked'), '0 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 6 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 6b. Workspaces que o DELETE direto deixou para trás: um sem membros
  --     (com a categoria e o cliente de X) e um com membros e sem dona.
  begin
    set local session_replication_role = replica;
    insert into public.finance_workspaces (id, name, owner_id) values (ws_noown, 'wsexit sem dona ' || tag, uh), (ws_empty, 'wsexit vazio ' || tag, uc);
    insert into public.finance_workspace_members (workspace_id, user_id, role, joined_at) values
      (ws_noown, ux, 'member', now() - interval '2 days'), (ws_noown, uc, 'member', now() - interval '1 day');
    insert into public.finance_categories (id, user_id, workspace_id, name, type) values
      (cat_xe, ux, ws_empty, 'wsexit Vazio', 'expense'), (gen_random_uuid(), ux, null, 'wsexit Vazio', 'expense');
    insert into public.finance_store_customers (id, user_id, workspace_id, name, phone) values (cust_xe, ux, ws_empty, 'Cliente de X no W vazio', '');
    set local session_replication_role = origin;
    r := pg_temp.as_user(ux, format('select public.remove_workspace_member(%L)::text', uc));
    out := out || pg_temp.expect('6b antes: no W sem dona ninguém remove membro', r, 'erro P0001: Only the owner can remove members');
    v := private.finance_workspace_reconcile();
    select format('%s %s %s %s %s', (select count(*) from public.finance_workspaces where id = ws_empty),
                  (select name from public.finance_categories where id = cat_xe and workspace_id is null),
                  (select workspace_id is null from public.finance_store_customers where id = cust_xe),
                  (select role from public.finance_workspace_members where user_id = ux),
                  (select owner_id = ux from public.finance_workspaces where id = ws_noown))
      into r;
    out := out || pg_temp.expect('6b reconcile: o W sem membros é apagado (a categoria, renomeada, e o cliente vão para o privado de X); no W sem dona, o membro mais antigo vira dono',
                                 r, '0 wsexit Vazio (workspace) t owner t');
    r := pg_temp.as_user(ux, format('select public.remove_workspace_member(%L)::text', uc));
    out := out || pg_temp.expect('6b depois: o dono novo remove membro', r, 'ok ');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 6b erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 6c. H saiu pelo DELETE direto e não deixou linha no W: só a linha
  --     PRIVADA de G compartilhada com H (e o orçamento privado de H
  --     compartilhado com G) ligam os dois. O reconcile acha o par pela linha
  --     privada. Resíduo: C e Y, sem W nenhum, ficam com o shared_with.
  begin
    delete from public.finance_store_customers where id = cust_h;
    delete from public.finance_workspace_members where workspace_id = ws and user_id = uh;
    set local session_replication_role = replica;
    insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date, shared_with_user_id) values
      (tx_gh, ug, null, 'expense', 10, 'G: privado, compartilhado com H', sp, uh),
      (tx_cy, uc, null, 'expense', 10, 'C: privado, compartilhado com Y (sem W)', sp, uy);
    insert into public.finance_budgets (id, user_id, workspace_id, category_id, month, amount_limit, shared_with_user_id) values
      (b_hg, uh, null, null, ym, 100, ug);
    set local session_replication_role = origin;
    r := pg_temp.as_user(ug, pg_temp.n(format('update public.finance_transactions set amount = 11 where id = %L', tx_gh)));
    out := out || pg_temp.expect('6c antes: G não edita a própria linha privada compartilhada com H (sem vínculo)', r, 'erro 42501: new row violates row-level security policy%');
    v := private.finance_workspace_reconcile();
    select format('%s %s %s', (select shared_with_user_id is null from public.finance_transactions where id = tx_gh),
                  (select shared_with_user_id is null from public.finance_budgets where id = b_hg),
                  (select shared_with_user_id = uy from public.finance_transactions where id = tx_cy))
      into r;
    r := r || ' ' || pg_temp.as_user(ug, pg_temp.n(format('update public.finance_transactions set amount = 11 where id = %L', tx_gh)))
         || ' ' || pg_temp.as_user(uh, format('select count(*)::text from public.finance_transactions where id = %L', tx_gh));
    out := out || pg_temp.expect('6c reconcile: o shared_with entre G e H sai da linha de G e do orçamento de H; o de C com Y fica (resíduo); G edita, H não lê',
                                 r, 't t t ok 1 ok 0');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 6c erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 6d. A receita de X (ex-membro) segue a venda de D no W. G liga uma compra
  --     dele a essa receita (o transaction_id da compra não tem regra) e sai:
  --     a receita continua no W, e D cancela a venda.
  begin
    set local session_replication_role = replica;
    insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date) values
      (tx_xw, ux, ws, 'income', 100, 'X: receita da venda de D (fica no W)', sp);
    insert into public.finance_store_sales (id, user_id, workspace_id, status, sold_on, transaction_id) values (s_dxw, ud, ws, 'sold', sp, tx_xw);
    set local session_replication_role = origin;
    r := pg_temp.as_user(ug, format($q$with u as (insert into public.finance_store_purchases (user_id, workspace_id, product_id, quantity, unit_cost, date, status, transaction_id)
                                       values (%L, %L, %L, 1, 1000, %L, 'received', %L) returning id) select id::text from u$q$, ug, ws, p_d, sp, tx_xw));
    out := out || pg_temp.expect('6d G liga a compra dele à receita de X pelo cliente (sem regra)', r, 'ok %');
    pu_gx := substr(r, 4)::uuid;
    r := pg_temp.as_user(ug, 'select public.leave_workspace()::text');
    r := r || ' ' || (select (workspace_id = ws)::text from public.finance_transactions where id = tx_xw)
         || ' ' || (select (transaction_id is null)::text from public.finance_store_purchases where id = pu_gx)
         || ' ' || pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_dxw));
    out := out || pg_temp.expect('6d G sai: a receita de X continua no W (segue a venda de D), a compra de G sai desvinculada e D cancela a venda sem 42501',
                                 r, 'ok  true true ok cancelled');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 6d erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 6e. W com duas donas (legado da wm_owner_insert, antes do SEC-013): G,
  --     dona mais antiga, e D, mais nova. D remove F, cuja categoria Pets G
  --     usa: a categoria passa para D, que é quem remove (a saída (c) exige o
  --     novo autor igual a quem grava).
  begin
    update public.finance_workspace_members set role = 'owner' where workspace_id = ws and user_id = ug;
    r := pg_temp.as_user(ud, format('select public.remove_workspace_member(%L)::text', uf));
    r := r || ' ' || (select (user_id = ud and workspace_id = ws)::text from public.finance_categories where id = cat_fw);
    out := out || pg_temp.expect('6e W com duas donas: D (a mais nova) remove F; Pets, que G usa, passa para D', r, 'ok  true');
    raise exception 'desfaz';
  exception when others then
    if sqlerrm <> 'desfaz' then out := out || format('FALHA 6e erro inesperado %s: %s', sqlstate, sqlerrm); end if;
  end;

  -- 7. A guarda, depois que F saiu (a despesa de F na compra de D, tx_fe, e a
  --    da compra privada de D, tx_fep, ficaram no W: são sobras de ex-membro).
  begin
    set local session_replication_role = replica;
    insert into public.finance_loan_borrowers (id, user_id, workspace_id, name) values (lb_f, uf, ws, 'Devedor de F');
    insert into public.finance_loans (id, user_id, workspace_id, borrower_id, principal, disbursed_on, status, requested_by)
      values (l_f, uf, ws, lb_f, 1000, sp, 'active', uf);
    insert into public.finance_loan_payments (id, user_id, workspace_id, loan_id, amount, date, reported_by) values
      (lp_f, uf, ws, l_f, 100, sp, uf), (lp_f2, uf, ws, l_f, 100, sp, uf), (lp_g, ug, ws, l_f, 100, sp, ug);
    insert into public.finance_loan_collaterals (id, user_id, workspace_id, loan_id, description) values (lc_f, uf, ws, l_f, 'Garantia');
    insert into public.finance_categories (id, user_id, workspace_id, name, type) values (cat_g, ug, ws, 'wsexit De G', 'expense');
    insert into public.finance_workspaces (id, name, owner_id) values (ws_other, 'wsexit outro W', uc);
    insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws_other, uc, 'owner');
    set local session_replication_role = origin;
    r := pg_temp.as_user(uf, 'select public.leave_workspace()::text');
    out := out || pg_temp.expect('7 F sai (o empréstimo dele tem pagamento de G: fica no W, com o devedor, os pagamentos e a garantia)',
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
    r := pg_temp.as_user(ud, pg_temp.n(format($q$update public.finance_loan_payments set note = 'D' where id = %L$q$, lp_f)));
    out := out || pg_temp.expect('7 cliente: (o RLS de pagamentos deixa D atualizar a nota: é por isso que as saídas (b) e (c) exigem o GUC)', r, 'ok 1');
    r := pg_temp.as_user(ug, pg_temp.n(format($q$update public.finance_categories set user_id = %L where id = %L$q$, ug, cat_x)));
    out := out || pg_temp.expect('7 cliente: G (membro; o RLS de categorias do W deixa) não se faz autor da categoria de X (ex-membro)', r, 'erro 42501: Somente o autor%');
    -- Sessão que nunca ligou o GUC: current_setting devolve NULL. A guarda é
    -- a mesma, lendo um GUC que ninguém ligou nesta sessão (o nome com o tag);
    -- sem o coalesce, o NULL desligava a exceção e a dona tirava a garantia.
    begin
      execute replace(pg_get_functiondef('public.finance_guard_workspace()'::regprocedure), 'akool.ws_release', 'akool.ws_release_' || tag);
      r := coalesce(current_setting('akool.ws_release_' || tag, true), 'NULL')
           || ' ' || pg_temp.as_user(ud, pg_temp.to_private('finance_loan_collaterals', lc_f));
      out := out || pg_temp.expect('7 cliente numa sessão que nunca ligou o GUC (NULL): a dona não tira do W a garantia do ex-membro', r, 'NULL erro 42501: Somente o autor%');
      raise exception 'desfaz';
    exception when others then
      if sqlerrm <> 'desfaz' then out := out || format('FALHA 7 erro inesperado %s: %s', sqlstate, sqlerrm); end if;
    end;
    -- Como DEFINER (postgres, sem RLS), com os claims e o GUC.
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), null, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona sem o GUC', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws_other::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC de outro workspace', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', uc, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: C (fora do W, dona de outro) com o GUC', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_gsh));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC na linha de G (membro ativo)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text,
                     format($q$update public.finance_transactions set workspace_id = %L where id = %L returning 'x'$q$, ws_other, tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC levando a sobra para outro workspace', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text,
                     format($q$update public.finance_transactions set workspace_id = null, user_id = %L where id = %L returning 'x'$q$, ud, tx_fe));
    out := out || pg_temp.expect('7 DEFINER: a dona com o GUC trocando o autor da sobra ao tirá-la do W', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER: JWT authenticated sem sub, com o GUC (o "is distinct from")', r, 'erro 42501: Somente o autor%');
    -- Saída (c): a troca de autor só para a dona, em categorias, contas e metas.
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), null, pg_temp.to_author('finance_categories', cat_x, ud));
    out := out || pg_temp.expect('7 DEFINER (c): a dona sem o GUC não se faz autora da categoria de X', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ug, 'role', 'authenticated'), ws::text, pg_temp.to_author('finance_categories', cat_x, ug))
         || ' | ' || pg_temp.try(jsonb_build_object('sub', ug, 'role', 'authenticated'), ws::text, pg_temp.to_author('finance_categories', cat_x, ud));
    out := out || pg_temp.expect('7 DEFINER (c): G (membro, não é dona) com o GUC não passa a categoria de X para si nem para D', r,
                                 'erro 42501: Somente o autor% | erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_author('finance_categories', cat_x, ug));
    out := out || pg_temp.expect('7 DEFINER (c): a dona com o GUC não passa a categoria de X para G', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_author('finance_transactions', tx_x, ud));
    out := out || pg_temp.expect('7 DEFINER (c): a dona com o GUC não se faz autora de um lançamento de X (só categorias, contas e metas)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_author('finance_categories', cat_g, ud));
    out := out || pg_temp.expect('7 DEFINER (c): a dona com o GUC não se faz autora da categoria de G (membro ativo)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text,
                     format($q$with u as (update public.finance_categories set user_id = %L, workspace_id = null where id = %L returning 1) select count(*)::text from u$q$, ud, cat_x));
    out := out || pg_temp.expect('7 DEFINER (c): a dona com o GUC não se faz autora da categoria de X E a tira do W (a (c) exige o workspace sem mudar)', r, 'erro 42501: Somente o autor%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_author('finance_categories', cat_x, ud));
    out := out || pg_temp.expect('7 DEFINER (c): a dona com o GUC se faz autora da categoria do ex-membro X (o caminho do remove)', r, 'ok 1');
    -- Saída (b).
    r := pg_temp.try(jsonb_build_object('sub', ug, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fep));
    out := out || pg_temp.expect('7 DEFINER (b): G (membro) com o GUC tira do W a sobra de F (a saída em cadeia no leave de G)', r, 'ok 1');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_loan_payments', lp_f));
    out := out || pg_temp.expect('7 DEFINER (b): com o GUC a saída vale em qualquer tabela (só o release o liga): a dona tira do W o pagamento do ex-membro F', r, 'ok 1');
    -- A ordem do release nos empréstimos: com o empréstimo já fora do W, o
    -- pagamento não sai mais (loan_is_owner falso para a dona).
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_loans', l_f))
         || ' | ' || pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_loan_payments', lp_f2));
    out := out || pg_temp.expect('7 DEFINER (b): o empréstimo antes do pagamento trava o pagamento (por isso o release leva os pagamentos primeiro)', r,
                                 'ok 1 | erro 42501: Devedor so pode%');
    r := pg_temp.try(jsonb_build_object('sub', ud, 'role', 'authenticated'), ws::text, pg_temp.to_private('finance_transactions', tx_fe));
    out := out || pg_temp.expect('7 DEFINER (b): a dona com o GUC tira do W a sobra de F (o caminho do remove)', r, 'ok 1');
    -- DELETE direto (sem as policies) e JWT sem sub pelo cliente.
    r := pg_temp.as_user(ug, pg_temp.n(format('delete from public.finance_workspace_members where user_id = %L', ug)))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_workspace_members where user_id = %L', ug)))
         || ' ' || pg_temp.as_user(ud, pg_temp.n(format('delete from public.finance_workspaces where id = %L', ws)));
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
     and p.proname in ('finance_category_free_name', 'finance_category_split', 'finance_category_ws_exit', 'finance_people_related',
                       'finance_workspace_reconcile', 'finance_workspace_release');
  out := out || pg_temp.expect('9 as 6 de private: search_path vazio, sem EXECUTE de cliente; só o gatilho de categorias é DEFINER', r,
                               'finance_category_free_name f search_path="" f | finance_category_split f search_path="" f | finance_category_ws_exit t search_path="" f | finance_people_related f search_path="" f | finance_workspace_reconcile f search_path="" f | finance_workspace_release f search_path="" f');
  select format('%s %s %s', p.prosecdef, position('private.finance_workspace_reconcile()' in p.prosrc) > 0,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))
    into r from pg_proc p where p.oid = 'public.restore_site_backup(jsonb)'::regprocedure;
  out := out || pg_temp.expect('9 o restore (DEFINER, sem EXECUTE de cliente) roda o reconcile no fim', r, 't t f');
  select format('%s | %s', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'finance_workspace_invites' and cmd in ('INSERT', 'ALL')),
                (select string_agg(format('%s %s', cmd, position('finance_goals' in qual) > 0), ' ' order by cmd)
                   from pg_policies where schemaname = 'public' and tablename = 'finance_goal_contributions' and cmd in ('UPDATE', 'DELETE')))
    into r;
  out := out || pg_temp.expect('9 sem policy de INSERT em convites (só o invite_member); UPDATE e DELETE de aporte pedem a meta visível', r, '0 | DELETE t UPDATE t');
  select (position('pg_advisory_xact_lock(hashtextextended(' in p.prosrc) > 0)::text into r
    from pg_proc p where p.oid = 'private.finance_workspace_release(uuid, uuid)'::regprocedure;
  out := out || pg_temp.expect('9 o release trava o W (pg_advisory_xact_lock): duas saídas no mesmo W não se cruzam (40P01)', r, 'true');
  select format('%s %s', count(*), bool_and(t.tgname < 'trg_finance_categories_ws_guard' and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE OF workspace_id ON public.finance_categories FOR EACH ROW%'))
    into r from pg_trigger t where t.tgfoid = 'private.finance_category_ws_exit()'::regprocedure and not t.tgisinternal;
  out := out || pg_temp.expect('9 gatilho de categorias: 1, BEFORE UPDATE OF workspace_id, antes da guarda', r, '1 t');
  select count(*)::text into r from pg_trigger t where t.tgfoid = 'public.finance_guard_workspace()'::regprocedure and not t.tgisinternal;
  out := out || pg_temp.expect('9 os 16 gatilhos ws_guard seguem na guarda', r, '16');
  select count(*)::text into r from pg_policies where schemaname = 'public' and tablename in ('finance_workspace_members', 'finance_workspaces') and cmd in ('DELETE', 'ALL');
  out := out || pg_temp.expect('9 sem policy de DELETE na filiação e no workspace', r, '0');
  select count(*)::text into r from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('authenticated', oid, 'execute');
  out := out || pg_temp.expect('9 as funções DEFINER de public para authenticated continuam 29 (sec012)', r, '29');

  raise exception using message = format(E'Saída do workspace bloco 1 (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;
