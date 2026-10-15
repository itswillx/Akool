-- API-028: vendas da Loja no servidor (migration
-- 20261012120000_api028_store_sales_server).
--
-- Dois blocos, cada um numa transação desfeita (terminam em RAISE EXCEPTION
-- com o resultado; nada fica gravado). Cada linha sai "ok" ou "FALHA", e a
-- última conta as "ok" (N/N ok). Rode cada bloco numa chamada própria; o
-- bloco 1 tem duas partes (o mesmo preâmbulo e as mesmas fixtures; a 2ª
-- começa no marcador "parte 2"), que o ensaio roda em chamadas separadas
-- quando o texto passa do tamanho de uma chamada.
--
-- Bloco 1 (staging e ensaio na produção): começa pelo levantamento (só
-- contagens) e segue com pessoas descartáveis A (dona), B e G (membros do
-- workspace W da A) e C (de fora), e D (dona do W3), E, F e H (membros do
-- W3) para quem sai do workspace. Cobre:
--   * paridade JS ⇄ SQL: o JSON entre parity:begin e parity:end é o
--     supabase/functions/_domain/fixtures/storeParity.json (o
--     storeParity.test.ts confere), e store_product_figures, o lucro, o
--     capital parado e o mês batem com os números dele. O líquido da linha de
--     paridade é a conta do harness; o das RPCs é conferido no fluxo da seção
--     8, numa venda com frete pago (shipping_cost), que não entra no líquido;
--   * os 4 CHECKs de dinheiro, o updated_at do servidor nas 5 tabelas;
--   * INSERT só em negociação; os 25 pares de status pelo gatilho, com os
--     carimbos de data; a data de entrega (só na entregue, até amanhã, não
--     antes da venda, também quando é o sold_on da entregue que muda, pelo
--     UPDATE direto e pelo store_sale_update, com o hint akool);
--   * visibilidade e escopo das referências (cliente, conta e receita do dono
--     da venda), inclusive B vendendo o produto do workspace numa venda
--     PRIVADA, com A tentando vender a mesma unidade de novo;
--   * item único, estoque simples e em lote, arquivado, reabrir sem estoque;
--   * o fluxo pelas RPCs com a receita (valor, data, conta, categoria e
--     workspace), itens ressincronizando sem mexer na venda (xmin), líquido
--     <= 0, a data da receita ao voltar para vendida com outra data, receita
--     de outra pessoa (a nota e o item a 0 passam; mudar o líquido pelo
--     update ou pelos itens, a data ou a conta, cancelar e excluir dão
--     42501), os erros de entrada;
--   * o item segue a venda: a dona removida do workspace
--     (remove_workspace_member) ou o dono que sai (leave_workspace) vê e soma
--     os itens dos outros na receita; o item não sai do workspace da venda.
--     Desde a saída do workspace (20261015120000_workspace_exit), a venda
--     vai com quem sai para o privado, a receita que um membro lançou na
--     venda de quem fica continua no W (a dona altera a data e cancela sem
--     42501) e remover quem tem linha financeira no W passa; o harness
--     próprio dela é o supabase/checks/workspace-exit.sql;
--   * cascatas de SET NULL sobre uma venda antiga fora da regra (conta,
--     cliente, transação, produto, workspace, nas duas ordens entre venda e
--     item, o workspace apagado como no leave_workspace da última pessoa) e o
--     leave_workspace de verdade, depois do qual o item de outra pessoa na
--     venda que saiu do W some para os membros, e o autor dele só o lê;
--   * INSERT sem usuário (restore, cron) e JWT authenticated sem sub;
--   * compatibilidade com o front antigo, repetindo as gravações dele;
--   * estrutura: 9 funções INVOKER em public, 5 em private sem EXECUTE para
--     clientes, gatilhos, CHECKs, as 3 policies de item que seguem a venda,
--     as 29 DEFINER do sec012 inalteradas (eram 40 até a remoção da API v1,
--     20261015100000_remove_api_and_queue).
--
-- Bloco 2 (SÓ STAGING): o restore de verdade (ele apaga as tabelas antes de
-- inserir) com linhas da Loja, uma venda antiga fora da regra inclusive. Só
-- com o opt-in na sessão:
--   select set_config('akool.api028_full_restore', 'staging', false);
--
-- A concorrência (duas sessões vendendo a mesma unidade) fica no roteiro
-- manual do staging: o gatilho trava o produto (FOR NO KEY UPDATE) antes de
-- contar o estoque.
--
-- Como rodar: MCP execute_sql ou SQL editor, como postgres, depois da
-- migration (ou, no ensaio, com o corpo da migration no começo do bloco).

do $bloco1$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  ud uuid := gen_random_uuid();
  ue uuid := gen_random_uuid();
  uf uuid := gen_random_uuid();
  uh uuid := gen_random_uuid();
  ug uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  ws2 uuid := gen_random_uuid();
  ws3 uuid := gen_random_uuid();
  ws5 uuid := gen_random_uuid();
  acc_a uuid := gen_random_uuid();
  acc_a2 uuid := gen_random_uuid();
  acc_w uuid := gen_random_uuid();
  acc_b uuid := gen_random_uuid();
  acc_c uuid := gen_random_uuid();
  acc_leg uuid := gen_random_uuid();
  acc_w3 uuid := gen_random_uuid();
  acc_e uuid := gen_random_uuid();
  acc_f uuid := gen_random_uuid();
  cat_in uuid := gen_random_uuid();
  cat_out uuid := gen_random_uuid();
  cat_c uuid := gen_random_uuid();
  cust_a uuid := gen_random_uuid();
  cust_w uuid := gen_random_uuid();
  cust_b uuid := gen_random_uuid();
  cust_leg uuid := gen_random_uuid();
  tx_a uuid := gen_random_uuid();
  tx_a2 uuid := gen_random_uuid();
  tx_exp uuid := gen_random_uuid();
  tx_b uuid := gen_random_uuid();
  tx_leg uuid := gen_random_uuid();
  p_unique uuid := gen_random_uuid();
  p_stock uuid := gen_random_uuid();
  p_arch uuid := gen_random_uuid();
  p_crit uuid := gen_random_uuid();
  p_pairs uuid := gen_random_uuid();
  p_flow uuid := gen_random_uuid();
  p_flow2 uuid := gen_random_uuid();
  p_compat uuid := gen_random_uuid();
  p_leg uuid := gen_random_uuid();
  p_c uuid := gen_random_uuid();
  p_w3 uuid := gen_random_uuid();
  s_w uuid := gen_random_uuid();
  s_priv uuid := gen_random_uuid();
  s_tx uuid := gen_random_uuid();
  s_tx2 uuid := gen_random_uuid();
  s_lot uuid := gen_random_uuid();
  s_us uuid := gen_random_uuid();
  s_cu uuid := gen_random_uuid();
  s_c2 uuid := gen_random_uuid();
  s_canc uuid := gen_random_uuid();
  s_foreign uuid := gen_random_uuid();
  s_zero uuid := gen_random_uuid();
  s_leg uuid := gen_random_uuid();
  s_bw uuid := gen_random_uuid();
  s_del uuid := gen_random_uuid();
  s_shp uuid := gen_random_uuid();
  s_ws5 uuid := gen_random_uuid();
  s_ws5b uuid := gen_random_uuid();
  s_e uuid;
  s_d uuid;
  s_f uuid;
  s_d2 uuid;
  i_ws5 uuid := gen_random_uuid();
  i_ws5b uuid := gen_random_uuid();
  i_f uuid;
  i_for uuid := gen_random_uuid();
  i_for2 uuid := gen_random_uuid();
  i_for0 uuid;
  i_abw uuid;
  i_lot uuid := gen_random_uuid();
  i_canc uuid := gen_random_uuid();
  i_zero uuid := gen_random_uuid();
  i_leg uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  sp date := (now() at time zone 'America/Sao_Paulo')::date;
  -- parity:begin
  parity jsonb := $parity${
    "products": [
      { "key": "gpu", "kind": "unique", "name": "RTX 3070", "target_price": 250000, "archived": false },
      { "key": "ssd", "kind": "stock", "name": "SSD 1 TB", "target_price": 40000, "archived": false },
      { "key": "half", "kind": "stock", "name": "Cabo (meio exato)", "target_price": 0, "archived": false },
      { "key": "third", "kind": "stock", "name": "Pasta (terços)", "target_price": 0, "archived": false },
      { "key": "quote", "kind": "stock", "name": "Só cotação", "target_price": 0, "archived": false },
      { "key": "old", "kind": "stock", "name": "Fonte arquivada", "target_price": 0, "archived": true },
      { "key": "big", "kind": "stock", "name": "Lote grande", "target_price": 0, "archived": false }
    ],
    "purchases": [
      { "product": "gpu", "quantity": 1, "unit_cost": 180000, "other_costs": 2500, "status": "received" },
      { "product": "ssd", "quantity": 10, "unit_cost": 25000, "other_costs": 1500, "status": "received" },
      { "product": "ssd", "quantity": 5, "unit_cost": 27000, "other_costs": 0, "status": "purchased" },
      { "product": "ssd", "quantity": 4, "unit_cost": 99999, "other_costs": 0, "status": "quoting" },
      { "product": "half", "quantity": 2, "unit_cost": 2, "other_costs": 1, "status": "received" },
      { "product": "third", "quantity": 3, "unit_cost": 0, "other_costs": 200, "status": "received" },
      { "product": "quote", "quantity": 2, "unit_cost": 5000, "other_costs": 0, "status": "quoting" },
      { "product": "old", "quantity": 1, "unit_cost": 1000, "other_costs": 0, "status": "received" },
      { "product": "big", "quantity": 1000, "unit_cost": 1000000000000, "other_costs": 999, "status": "received" }
    ],
    "sales": [
      { "key": "s_neg", "status": "negotiating", "sold_on": null, "shipping_charged": 0, "shipping_cost": 0, "fees": 0 },
      { "key": "s_sold", "status": "sold", "sold_on": "2026-09-10", "shipping_charged": 3000, "shipping_cost": 2500, "fees": 4000 },
      { "key": "s_ship", "status": "shipped", "sold_on": "2026-09-28", "shipping_charged": 0, "shipping_cost": 1500, "fees": 1000 },
      { "key": "s_deliv", "status": "delivered", "sold_on": "2026-08-31", "shipping_charged": 2000, "shipping_cost": 0, "fees": 500 },
      { "key": "s_canc", "status": "cancelled", "sold_on": "2026-09-15", "shipping_charged": 0, "shipping_cost": 0, "fees": 0 },
      { "key": "s_zero", "status": "sold", "sold_on": "2026-09-30", "shipping_charged": 0, "shipping_cost": 0, "fees": 500 }
    ],
    "items": [
      { "sale": "s_neg", "product": "ssd", "quantity": 2, "unit_price": 40000, "unit_cost_at_sale": 25767 },
      { "sale": "s_sold", "product": "gpu", "quantity": 1, "unit_price": 250000, "unit_cost_at_sale": 182500 },
      { "sale": "s_sold", "product": "ssd", "quantity": 3, "unit_price": 38000, "unit_cost_at_sale": 25767 },
      { "sale": "s_ship", "product": "ssd", "quantity": 1, "unit_price": 41000, "unit_cost_at_sale": 25767 },
      { "sale": "s_ship", "product": "big", "quantity": 10, "unit_price": 1000000000000, "unit_cost_at_sale": 1000000000001 },
      { "sale": "s_deliv", "product": "half", "quantity": 1, "unit_price": 10, "unit_cost_at_sale": 3 },
      { "sale": "s_deliv", "product": null, "quantity": 1, "unit_price": 1000, "unit_cost_at_sale": 0 },
      { "sale": "s_canc", "product": "ssd", "quantity": 4, "unit_price": 39000, "unit_cost_at_sale": 25767 },
      { "sale": "s_canc", "product": "third", "quantity": 3, "unit_price": 500, "unit_cost_at_sale": 67 },
      { "sale": "s_zero", "product": "quote", "quantity": 1, "unit_price": 0, "unit_cost_at_sale": 0 }
    ],
    "expected": {
      "figures": {
        "gpu": { "purchased": 1, "sold": 1, "reserved": 0, "available": 0, "avg_unit_cost": 182500 },
        "ssd": { "purchased": 15, "sold": 4, "reserved": 2, "available": 9, "avg_unit_cost": 25767 },
        "half": { "purchased": 2, "sold": 1, "reserved": 0, "available": 1, "avg_unit_cost": 3 },
        "third": { "purchased": 3, "sold": 0, "reserved": 0, "available": 3, "avg_unit_cost": 67 },
        "quote": { "purchased": 0, "sold": 1, "reserved": 0, "available": -1, "avg_unit_cost": 0 },
        "old": { "purchased": 1, "sold": 0, "reserved": 0, "available": 1, "avg_unit_cost": 1000 },
        "big": { "purchased": 1000, "sold": 10, "reserved": 0, "available": 990, "avg_unit_cost": 1000000000001 }
      },
      "sales": {
        "s_neg": { "items_total": 80000, "revenue": 80000, "net": 80000, "profit": 28466 },
        "s_sold": { "items_total": 364000, "revenue": 367000, "net": 363000, "profit": 100699 },
        "s_ship": { "items_total": 10000000041000, "revenue": 10000000041000, "net": 10000000040000, "profit": 12723 },
        "s_deliv": { "items_total": 1010, "revenue": 3010, "net": 2510, "profit": 2507 },
        "s_canc": { "items_total": 157500, "revenue": 157500, "net": 157500, "profit": 54231 },
        "s_zero": { "items_total": 0, "revenue": 0, "net": -500, "profit": -500 }
      },
      "stock_capital": 990000000233097,
      "month": { "ym": "2026-09", "revenue": 10000000408000, "cost": 10000000295078, "profit": 112922, "count": 3 }
    },
    "transitions": [
      ["negotiating", "sold"],
      ["sold", "shipped"],
      ["shipped", "delivered"],
      ["sold", "negotiating"],
      ["shipped", "sold"],
      ["delivered", "shipped"],
      ["cancelled", "negotiating"],
      ["negotiating", "cancelled"],
      ["sold", "cancelled"],
      ["shipped", "cancelled"]
    ]
  }$parity$;
  -- parity:end
  ids jsonb := '{}';
  v jsonb;
  w jsonb;
  st text[] := array['negotiating', 'sold', 'shipped', 'delivered', 'cancelled'];
  f text;
  t text;
  sid uuid;
  exp text;
  ok_count int;
  bad text;
  x0 text;
  n int;
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
    perform set_config('request.jwt.claims', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  -- O as_user com o hint do erro: 'erro <sqlstate> [<hint>]: <mensagem>'.
  create function pg_temp.as_user_hint(p_uid uuid, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
    v_hint text;
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    execute p_sql into v_res;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return format('erro %s [%s]: %s', sqlstate, v_hint, sqlerrm);
  end;
  $f$;

  create function pg_temp.as_role(p_role text, p_claims jsonb, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql into v_res;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  -- Como postgres, com os claims dados (null = sem usuário: restore, cron).
  create function pg_temp.try(p_claims jsonb, p_sql text)
  returns text
  language plpgsql
  as $f$
  declare
    v_res text;
  begin
    perform set_config('request.jwt.claims', coalesce(p_claims::text, ''), true);
    execute p_sql into v_res;
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
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 200))
  $f$;

  -- O jsonb de uma resposta "ok {...}" (null se deu erro).
  create function pg_temp.res(p_got text)
  returns jsonb
  language sql
  as $f$
    select case when p_got like 'ok {%' or p_got like 'ok [%' then substr(p_got, 4)::jsonb end
  $f$;

  -- O texto montado de uma resposta, ou a resposta crua quando ela deu erro.
  create function pg_temp.or_err(p_shown text, p_got text)
  returns text
  language sql
  as $f$
    select case when p_got like 'ok %' then p_shown else p_got end
  $f$;

  create function pg_temp.xmin_of(p_sale uuid)
  returns text
  language sql
  as $f$
    select s.xmin::text from public.finance_store_sales s where s.id = p_sale
  $f$;

  -- 0. Levantamento (só contagens), antes das pessoas de teste.
  select format('%s %s',
                (select count(*) from public.finance_store_products where target_price < 0)
                + (select count(*) from public.finance_store_purchases where unit_cost < 0 or other_costs < 0)
                + (select count(*) from public.finance_store_sales where shipping_charged < 0 or shipping_cost < 0 or fees < 0)
                + (select count(*) from public.finance_store_sale_items where unit_price < 0 or unit_cost_at_sale < 0),
                (select count(*) from public.finance_store_products where target_price > 1000000000000)
                + (select count(*) from public.finance_store_purchases where greatest(unit_cost, other_costs) > 1000000000000)
                + (select count(*) from public.finance_store_sales where greatest(shipping_charged, shipping_cost, fees) > 1000000000000)
                + (select count(*) from public.finance_store_sale_items where greatest(unit_price, unit_cost_at_sale) > 1000000000000))
    into r;
  out := out || pg_temp.expect('levantamento: valores negativos e acima de 1e12', r, '0 0');
  select format('%s %s %s %s %s %s',
                (select count(*) from public.finance_store_sales where status in ('sold', 'shipped', 'delivered') and sold_on is null),
                (select count(*) from public.finance_store_sales where status = 'negotiating' and (sold_on is not null or delivered_on is not null)),
                (select count(*) from public.finance_store_sales where sold_on is not null and (not isfinite(sold_on) or sold_on > sp + 1)),
                (select count(*) from public.finance_store_sales where status in ('negotiating', 'cancelled') and transaction_id is not null),
                (select count(*) from public.finance_store_sales s join public.finance_transactions t on t.id = s.transaction_id where t.type <> 'income'),
                (select count(*) from (select transaction_id from public.finance_store_sales where transaction_id is not null group by 1 having count(*) > 1) x)
                + (select count(*) from public.finance_store_sales s where s.transaction_id is not null
                     and exists (select 1 from public.finance_store_purchases pu where pu.transaction_id = s.transaction_id)))
    into r;
  out := out || pg_temp.expect('levantamento: consumida sem data, negociando com data, data futura, receita em negociando/cancelada, receita que não é income, receita com 2 vínculos', r, '0 0 0 0 0 0');
  select count(*)::text into r from public.finance_store_sales
   where delivered_on is not null and (status <> 'delivered' or not isfinite(delivered_on) or delivered_on > sp + 1 or delivered_on < sold_on);
  out := out || pg_temp.expect('levantamento: data de entrega fora da regra (fora da entregue, infinita, futura ou antes da venda)', r, '0');
  select format('%s %s %s %s',
                (select count(*) from public.finance_store_sales s join public.finance_store_customers k on k.id = s.customer_id
                  where k.user_id <> s.user_id and not (k.workspace_id is not null and exists (
                    select 1 from public.finance_workspace_members m where m.workspace_id = k.workspace_id and m.user_id = s.user_id))),
                (select count(*) from public.finance_store_sales s join public.finance_accounts ac on ac.id = s.account_id
                  where ac.user_id <> s.user_id and not (ac.workspace_id is not null and exists (
                    select 1 from public.finance_workspace_members m where m.workspace_id = ac.workspace_id and m.user_id = s.user_id))),
                (select count(*) from public.finance_store_sales s join public.finance_transactions t on t.id = s.transaction_id
                  where t.user_id <> s.user_id and not (t.workspace_id is not null and exists (
                    select 1 from public.finance_workspace_members m where m.workspace_id = t.workspace_id and m.user_id = s.user_id))),
                (select count(*) from public.finance_store_sale_items i join public.finance_store_sales s on s.id = i.sale_id
                  where s.user_id <> i.user_id and not (s.workspace_id is not null and exists (
                    select 1 from public.finance_workspace_members m where m.workspace_id = s.workspace_id and m.user_id = i.user_id))))
    into r;
  out := out || pg_temp.expect('levantamento: cliente, conta e receita fora do escopo do dono, item em venda alheia', r, '0 0 0 0');
  -- O item segue a venda: quem só o via pelo workspace do item (diferente do
  -- da venda) deixa de vê-lo. Diferente de 0, confira essas linhas antes.
  select count(*)::text into r from public.finance_store_sale_items i join public.finance_store_sales s on s.id = i.sale_id
   where i.workspace_id is not null and i.workspace_id is distinct from s.workspace_id;
  out := out || pg_temp.expect('levantamento: item num workspace diferente do da venda (os membros só dele deixam de vê-lo)', r, '0');
  select format('%s %s',
                (select count(*) from public.finance_store_products p where private.store_product_available(p.id) < 0),
                (select count(*) from public.finance_store_sale_items i join public.finance_store_products p on p.id = i.product_id
                  where p.kind = 'unique' and i.quantity > 1))
    into r;
  out := out || pg_temp.expect('levantamento: produto com disponível negativo (global) e item único com mais de 1', r, '0 0');
  select format('produtos=%s compras=%s clientes=%s vendas=%s itens=%s com receita=%s em workspace=%s',
                (select count(*) from public.finance_store_products), (select count(*) from public.finance_store_purchases),
                (select count(*) from public.finance_store_customers), (select count(*) from public.finance_store_sales),
                (select count(*) from public.finance_store_sale_items),
                (select count(*) from public.finance_store_sales where transaction_id is not null),
                (select count(*) from public.finance_store_sales where workspace_id is not null))
    into r;
  out := out || pg_temp.expect('levantamento (informativo)', r, '%');

  -- Fixtures sem gatilhos. W é da A, com B membro. W2 também é da A, sem
  -- membros (finance_workspace_members tem UNIQUE em user_id: a pessoa está
  -- em um workspace só). Os produtos de W são da A. As vendas e itens fora da
  -- regra são o "legado".
  set local session_replication_role = replica;
  insert into auth.users (id, email) values
    (a, format('api028-a-%s@example.invalid', tag)), (b, format('api028-b-%s@example.invalid', tag)), (c, format('api028-c-%s@example.invalid', tag)),
    (ud, format('api028-d-%s@example.invalid', tag)), (ue, format('api028-e-%s@example.invalid', tag)), (uf, format('api028-f-%s@example.invalid', tag)),
    (ug, format('api028-g-%s@example.invalid', tag)), (uh, format('api028-h-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api028-a-%s@example.invalid', tag), 'A', 'standard', true, 0),
    (b, format('api028-b-%s@example.invalid', tag), 'B', 'standard', true, 0),
    (c, format('api028-c-%s@example.invalid', tag), 'C', 'standard', true, 0),
    (ud, format('api028-d-%s@example.invalid', tag), 'D', 'standard', true, 0),
    (ue, format('api028-e-%s@example.invalid', tag), 'E', 'standard', true, 0),
    (uf, format('api028-f-%s@example.invalid', tag), 'F', 'standard', true, 0),
    (ug, format('api028-g-%s@example.invalid', tag), 'G', 'standard', true, 0),
    (uh, format('api028-h-%s@example.invalid', tag), 'H', 'standard', true, 0);
  -- W3 é da D, com E, F e H membros: quem sai do workspace (seção 8b). W5 é da
  -- A, sem membros: o SET NULL de apagar o workspace (seção 10), inclusive
  -- num item legado do W5 cuja venda está no W (a ordem "item primeiro"). G
  -- é membro do W sem venda nem item: quem deixa de ver o item quando a venda
  -- sai do W (seção 10).
  insert into public.finance_workspaces (id, name, owner_id) values (ws, 'api028 W', a), (ws2, 'api028 W2', a), (ws3, 'api028 W3', ud), (ws5, 'api028 W5', a);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, a, 'owner'), (ws, b, 'member'), (ws, ug, 'member'),
    (ws3, ud, 'owner'), (ws3, ue, 'member'), (ws3, uf, 'member'), (ws3, uh, 'member');
  insert into public.finance_accounts (id, user_id, workspace_id, name, type) values
    (acc_a, a, null, 'A', 'checking'), (acc_a2, a, null, 'A2', 'checking'), (acc_w, a, ws, 'W', 'checking'),
    (acc_b, b, null, 'B', 'checking'), (acc_c, c, null, 'C', 'checking'), (acc_leg, a, null, 'Legado', 'checking'),
    (acc_w3, ud, ws3, 'W3', 'checking'), (acc_e, ue, null, 'E', 'checking'), (acc_f, uf, null, 'F', 'checking');
  insert into public.finance_categories (id, user_id, workspace_id, name, type) values
    (cat_in, a, null, 'api028 vendas', 'income'), (cat_out, a, null, 'api028 despesa', 'expense'), (cat_c, c, null, 'api028 C', 'income');
  insert into public.finance_store_customers (id, user_id, workspace_id, name) values
    (cust_a, a, null, 'Cliente A'), (cust_w, a, ws, 'Cliente W'), (cust_b, b, null, 'Cliente B'), (cust_leg, a, null, 'Cliente legado');
  insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date, account_id) values
    (tx_a, a, null, 'income', 1000, 'api028', sp, acc_a), (tx_a2, a, null, 'income', 1000, 'api028', sp, acc_a),
    (tx_exp, a, null, 'expense', 1000, 'api028', sp, acc_a), (tx_b, b, null, 'income', 5000, 'api028 B', sp, acc_b),
    (tx_leg, a, null, 'expense', 1000, 'api028 legado', sp, acc_leg);
  insert into public.finance_store_products (id, user_id, workspace_id, kind, name, target_price, archived, updated_at) values
    (p_unique, a, ws, 'unique', 'GPU harness', 300000, false, '2020-01-01'),
    (p_stock, a, ws, 'stock', 'SSD harness', 40000, false, '2020-01-01'),
    (p_arch, a, ws, 'stock', 'Arquivado harness', 0, true, '2020-01-01'),
    (p_crit, a, ws, 'unique', 'GPU do workspace', 0, false, '2020-01-01'),
    (p_pairs, a, ws, 'stock', 'Pares harness', 1000, false, '2020-01-01'),
    (p_flow, a, ws, 'stock', 'Fluxo harness', 30000, false, '2020-01-01'),
    (p_flow2, a, ws, 'stock', 'Fluxo 2 harness', 0, false, '2020-01-01'),
    (p_compat, a, ws, 'stock', 'Compat harness', 20000, false, '2020-01-01'),
    (p_leg, a, ws2, 'stock', 'Legado harness', 0, false, '2020-01-01'),
    (p_c, c, null, 'unique', 'De C', 0, false, '2020-01-01'),
    (p_w3, ud, ws3, 'stock', 'W3 harness', 10000, false, '2020-01-01');
  insert into public.finance_store_purchases (user_id, workspace_id, product_id, quantity, unit_cost, other_costs, date, status, updated_at) values
    (a, ws, p_unique, 1, 200000, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_stock, 6, 25000, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_stock, 4, 26000, 0, '2026-09-02', 'received', '2020-01-01'),
    (a, ws, p_arch, 5, 1000, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_crit, 1, 50000, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_pairs, 100, 500, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_flow, 5, 20000, 1000, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_flow2, 4, 10000, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws, p_compat, 3, 15000, 0, '2026-09-01', 'received', '2020-01-01'),
    (a, ws2, p_leg, 1, 1000, 0, '2026-09-01', 'received', '2020-01-01'),
    (c, null, p_c, 1, 1000, 0, '2026-09-01', 'received', '2020-01-01'),
    (ud, ws3, p_w3, 10, 5000, 0, '2026-09-01', 'received', '2020-01-01');
  insert into public.finance_store_sales (id, user_id, workspace_id, status, sold_on, delivered_on, account_id, customer_id, transaction_id,
                                          shipping_charged, fees, updated_at) values
    (s_w, a, ws, 'negotiating', null, null, null, null, null, 0, 0, '2020-01-01'),
    (s_priv, a, null, 'negotiating', null, null, null, null, null, 0, 0, '2020-01-01'),
    (s_tx, a, ws, 'sold', sp - 1, null, acc_w, null, null, 0, 0, '2020-01-01'),
    (s_tx2, a, ws, 'sold', sp - 1, null, acc_w, null, null, 0, 0, '2020-01-01'),
    (s_lot, a, ws, 'negotiating', null, null, null, null, null, 0, 0, '2020-01-01'),
    (s_us, a, ws, 'sold', sp - 5, null, null, null, null, 0, 0, '2020-01-01'),
    (s_cu, a, ws, 'cancelled', sp - 6, null, null, null, null, 0, 0, '2020-01-01'),
    (s_c2, a, ws, 'cancelled', null, null, null, null, null, 0, 0, '2020-01-01'),
    (s_canc, a, ws, 'cancelled', null, null, null, null, null, 0, 0, '2020-01-01'),
    (s_foreign, a, ws, 'sold', sp - 2, null, acc_w, null, tx_b, 0, 0, '2020-01-01'),
    (s_zero, a, ws, 'sold', sp - 2, null, acc_w, null, null, 0, 500, '2020-01-01'),
    -- Legado fora da regra: entregue sem data, receita que é despesa, cliente e
    -- conta da A, no W2.
    (s_leg, a, ws2, 'delivered', null, null, acc_leg, cust_leg, tx_leg, 0, 0, '2020-01-01'),
    -- De B no workspace (o leave_workspace de B, na seção 10, tira o workspace dela).
    (s_bw, b, ws, 'negotiating', null, null, null, null, null, 0, 0, '2020-01-01'),
    -- Entregue e enviada, para a data de entrega (seção 5b).
    (s_del, a, ws, 'delivered', sp - 3, sp - 1, null, null, null, 0, 0, '2020-01-01'),
    (s_shp, a, ws, 'shipped', sp - 3, null, null, null, null, 0, 0, '2020-01-01'),
    -- No W5 com o item no W5; e no W com um item legado no W5 (seção 10).
    (s_ws5, a, ws5, 'negotiating', null, null, null, null, null, 0, 0, '2020-01-01'),
    (s_ws5b, a, ws, 'negotiating', null, null, null, null, null, 0, 0, '2020-01-01');
  insert into public.finance_store_sale_items (id, user_id, workspace_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost_at_sale, updated_at) values
    (gen_random_uuid(), a, ws, s_tx, p_pairs, 'Pares', 1, 10000, 500, '2020-01-01'),
    (gen_random_uuid(), a, ws, s_tx2, p_pairs, 'Pares', 1, 10000, 500, '2020-01-01'),
    (gen_random_uuid(), a, ws, s_us, p_unique, 'GPU', 1, 300000, 200000, '2020-01-01'),
    (gen_random_uuid(), a, ws, s_cu, p_unique, 'GPU', 1, 300000, 200000, '2020-01-01'),
    (gen_random_uuid(), a, ws, s_c2, p_pairs, 'Pares', 1, 1000, 500, '2020-01-01'),
    (i_canc, a, ws, s_canc, p_stock, 'SSD', 1, 1000, 500, '2020-01-01'),
    (i_for, a, ws, s_foreign, p_pairs, 'Pares', 1, 5000, 500, '2020-01-01'),
    (i_zero, a, ws, s_zero, p_pairs, 'Pares', 1, 0, 0, '2020-01-01'),
    -- 3 unidades de um produto com 1 comprada.
    (i_leg, a, ws2, s_leg, p_leg, 'Legado', 3, 1000, 0, '2020-01-01'),
    (gen_random_uuid(), b, ws, s_bw, p_pairs, 'Pares', 1, 1000, 500, '2020-01-01'),
    (i_ws5, a, ws5, s_ws5, null, 'Sem produto', 1, 1000, 0, '2020-01-01'),
    (i_ws5b, a, ws5, s_ws5b, null, 'Sem produto', 1, 1000, 0, '2020-01-01');
  -- Paridade: as linhas do JSON, todas da A e privadas.
  select jsonb_object_agg(k, gen_random_uuid()) into ids
    from (select e ->> 'key' as k from jsonb_array_elements(parity -> 'products') e
          union all select e ->> 'key' from jsonb_array_elements(parity -> 'sales') e) x;
  insert into public.finance_store_products (id, user_id, kind, name, target_price, archived)
  select (ids ->> (e ->> 'key'))::uuid, a, e ->> 'kind', e ->> 'name', (e ->> 'target_price')::bigint, (e ->> 'archived')::boolean
    from jsonb_array_elements(parity -> 'products') e;
  insert into public.finance_store_purchases (user_id, product_id, quantity, unit_cost, other_costs, date, status)
  select a, (ids ->> (e ->> 'product'))::uuid, (e ->> 'quantity')::int, (e ->> 'unit_cost')::bigint, (e ->> 'other_costs')::bigint, '2026-09-01', e ->> 'status'
    from jsonb_array_elements(parity -> 'purchases') e;
  insert into public.finance_store_sales (id, user_id, status, sold_on, shipping_charged, shipping_cost, fees)
  select (ids ->> (e ->> 'key'))::uuid, a, e ->> 'status', (e ->> 'sold_on')::date, (e ->> 'shipping_charged')::bigint,
         (e ->> 'shipping_cost')::bigint, (e ->> 'fees')::bigint
    from jsonb_array_elements(parity -> 'sales') e;
  insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost_at_sale)
  select a, (ids ->> (e ->> 'sale'))::uuid, (ids ->> (e ->> 'product'))::uuid, coalesce(e ->> 'product', 'apagado'), (e ->> 'quantity')::int,
         (e ->> 'unit_price')::bigint, (e ->> 'unit_cost_at_sale')::bigint
    from jsonb_array_elements(parity -> 'items') e;
  set local session_replication_role = origin;

  -- 1. Paridade JS ⇄ SQL.
  r := pg_temp.as_user(a, format($q$select jsonb_agg(to_jsonb(f))::text from public.store_product_figures(%L::uuid[]) f$q$,
                                  (select array_agg((ids ->> (e ->> 'key'))::uuid) from jsonb_array_elements(parity -> 'products') e)));
  select jsonb_object_agg(e ->> 'key', (select (fg - 'product_id') from jsonb_array_elements(pg_temp.res(r)) fg
                                         where fg ->> 'product_id' = ids ->> (e ->> 'key')))
    into v from jsonb_array_elements(parity -> 'products') e;
  out := out || pg_temp.expect('paridade: store_product_figures (como A) = expected.figures do storeParity.json',
                               case when v = parity -> 'expected' -> 'figures' then 'igual' else coalesce(v::text, r) end, 'igual');
  w := v;
  select jsonb_object_agg(s.k, jsonb_build_object(
           'items_total', coalesce(m.items_total, 0), 'revenue', coalesce(m.items_total, 0) + s.shipping_charged,
           'net', coalesce(m.items_total, 0) + s.shipping_charged - s.fees,
           'profit', coalesce(m.items_total, 0) + s.shipping_charged - s.fees - s.shipping_cost - coalesce(m.cost, 0)))
    into v
    from (select e ->> 'key' as k, x.* from jsonb_array_elements(parity -> 'sales') e
            join public.finance_store_sales x on x.id = (ids ->> (e ->> 'key'))::uuid) s
    left join lateral (select sum(i.quantity::numeric * i.unit_price) as items_total, sum(i.quantity::numeric * i.unit_cost_at_sale) as cost
                         from public.finance_store_sale_items i where i.sale_id = s.id) m on true;
  out := out || pg_temp.expect('paridade: itens, receita, líquido e lucro (a conta deste harness; o líquido das RPCs é conferido na seção 8) = expected.sales',
                               case when v = parity -> 'expected' -> 'sales' then 'igual' else v::text end, 'igual');
  select sum(case when (w -> (e ->> 'key') ->> 'available')::numeric > 0
                  then (w -> (e ->> 'key') ->> 'available')::numeric * (w -> (e ->> 'key') ->> 'avg_unit_cost')::numeric else 0 end)::text
    into r
    from jsonb_array_elements(parity -> 'products') e
   where not (e ->> 'archived')::boolean;
  out := out || pg_temp.expect('paridade: capital parado (disponível > 0 × custo médio, sem arquivado) = expected.stock_capital',
                               r, (parity -> 'expected' ->> 'stock_capital'));
  select jsonb_build_object('ym', parity -> 'expected' -> 'month' ->> 'ym',
                            'revenue', sum(z.items_total + x.shipping_charged),
                            'cost', sum(x.shipping_cost + x.fees + z.cost),
                            'profit', sum(z.items_total + x.shipping_charged - x.fees - x.shipping_cost - z.cost),
                            'count', count(*))
    into v
    from public.finance_store_sales x
    join lateral (select coalesce(sum(i.quantity::numeric * i.unit_price), 0) as items_total, coalesce(sum(i.quantity::numeric * i.unit_cost_at_sale), 0) as cost
                    from public.finance_store_sale_items i where i.sale_id = x.id) z on true
   where x.id in (select (ids ->> (e ->> 'key'))::uuid from jsonb_array_elements(parity -> 'sales') e)
     and x.status in ('sold', 'shipped', 'delivered') and to_char(x.sold_on, 'YYYY-MM') = parity -> 'expected' -> 'month' ->> 'ym';
  out := out || pg_temp.expect('paridade: resultado do mês = expected.month',
                               case when v = parity -> 'expected' -> 'month' then 'igual' else v::text end, 'igual');

  -- 2. CHECKs de dinheiro (valem também sem usuário).
  r := pg_temp.as_user(a, format($q$update public.finance_store_products set target_price = -1 where id = %L$q$, p_stock));
  out := out || pg_temp.expect('produto com preço negativo', r, 'erro 23514: %finance_store_products_money_nonneg%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_purchases set other_costs = -1 where product_id = %L$q$, p_stock));
  out := out || pg_temp.expect('compra com frete negativo', r, 'erro 23514: %finance_store_purchases_money_nonneg%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set fees = -500 where id = %L$q$, s_w));
  out := out || pg_temp.expect('venda com taxa negativa', r, 'erro 23514: %finance_store_sales_money_nonneg%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sale_items set unit_price = -1 where id = %L$q$, i_zero));
  out := out || pg_temp.expect('item com preço negativo', r, 'erro 23514: %finance_store_sale_items_money_nonneg%');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_name, unit_cost_at_sale) values (%L, %L, 'x', -1)$q$, a, s_w));
  out := out || pg_temp.expect('sem usuário (restore) o CHECK também vale', r, 'erro 23514: %finance_store_sale_items_money_nonneg%');

  -- 3. updated_at do servidor nas 5 tabelas (o valor mandado é ignorado).
  select format('%s %s %s %s %s',
                (select updated_at = now() from public.finance_store_products where id = p_stock),
                (select bool_and(updated_at = '2020-01-01'::timestamptz) from public.finance_store_purchases where product_id = p_stock),
                (select updated_at = '2020-01-01'::timestamptz from public.finance_store_sales where id = s_w),
                (select updated_at = '2020-01-01'::timestamptz from public.finance_store_sale_items where id = i_zero),
                (select count(*) from public.finance_store_customers where id = cust_w))
    into r;
  out := out || pg_temp.expect('antes: as fixtures guardam o updated_at de 2020 (o UPDATE recusado não gravou)', r, 'f t t t 1');
  r := pg_temp.as_user(a, format($q$
    with p as (update public.finance_store_products set notes = 'x', updated_at = '2000-01-01' where id = %1$L returning updated_at = now() as ok),
         pu as (update public.finance_store_purchases set notes = 'x', updated_at = '2000-01-01' where product_id = %1$L returning updated_at = now() as ok),
         k as (update public.finance_store_customers set notes = 'x', updated_at = '2000-01-01' where id = %2$L returning updated_at = now() as ok),
         s as (update public.finance_store_sales set notes = 'x', updated_at = '2000-01-01' where id = %3$L returning updated_at = now() as ok),
         i as (update public.finance_store_sale_items set unit_price = 1, updated_at = '2000-01-01' where id = %4$L returning updated_at = now() as ok)
    select format('%%s %%s %%s %%s %%s', (select bool_and(ok) from p), (select bool_and(ok) from pu), (select bool_and(ok) from k),
                  (select bool_and(ok) from s), (select bool_and(ok) from i))$q$, p_stock, cust_w, s_w, i_zero));
  out := out || pg_temp.expect('UPDATE com updated_at do aparelho: o servidor grava now() (produto, compra, cliente, venda, item)', r, 'ok t t t t t');

  -- 4. INSERT de venda: só em negociação, sem datas nem receita.
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sales (user_id, status) values (%L, 'sold')$q$, a));
  out := out || pg_temp.expect('venda nova já vendida', r, 'erro 22023: Venda nova começa em negociação%');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sales (user_id, sold_on) values (%L, %L)$q$, a, sp));
  out := out || pg_temp.expect('venda nova com data de venda', r, 'erro 22023: Venda nova não tem data de venda%');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sales (user_id, transaction_id) values (%L, %L)$q$, a, tx_a));
  out := out || pg_temp.expect('venda nova com receita', r, 'erro 22023: Venda nova não tem data de venda%');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sales (user_id, workspace_id, customer_id, account_id) values (%L, %L, %L, %L) returning status$q$, a, ws, cust_w, acc_w));
  out := out || pg_temp.expect('venda nova em negociação, com cliente e conta do workspace', r, 'ok negotiating');

  -- 5. Os 25 pares pelo gatilho, com os carimbos (sold guarda a data; só
  -- delivered tem entrega; negociação sem datas; cancelada guarda).
  ok_count := 0;
  bad := '';
  foreach f in array st loop
    foreach t in array st loop
      sid := gen_random_uuid();
      set local session_replication_role = replica;
      insert into public.finance_store_sales (id, user_id, workspace_id, status, sold_on, delivered_on)
      values (sid, a, ws, f, case when f <> 'negotiating' then sp - 2 end, case when f = 'delivered' then sp - 1 end);
      insert into public.finance_store_sale_items (user_id, workspace_id, sale_id, product_id, product_name, quantity)
      values (a, ws, sid, p_pairs, 'Pares', 1);
      set local session_replication_role = origin;
      r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = %L where id = %L
                                        returning status || ' ' || coalesce(sold_on::text, '-') || ' ' || coalesce(delivered_on::text, '-')$q$, t, sid));
      if f = t or exists (select 1 from jsonb_array_elements(parity -> 'transitions') p where p ->> 0 = f and p ->> 1 = t) then
        exp := 'ok ' || t || ' '
               || case when t = 'negotiating' then '-'
                       when t = 'sold' and f = 'negotiating' then sp::text
                       when f = 'negotiating' then '-'
                       else (sp - 2)::text end
               || ' '
               || case when t = 'delivered' and f = 'delivered' then (sp - 1)::text
                       when t = 'delivered' then sp::text
                       when t = 'cancelled' and f = 'delivered' then (sp - 1)::text
                       else '-' end;
      else
        exp := format('erro P0001: Mudança de status não permitida: %s → %s', f, t);
      end if;
      if r = exp then
        ok_count := ok_count + 1;
      else
        bad := bad || format(' [%s→%s: %s ≠ %s]', f, t, r, exp);
      end if;
    end loop;
  end loop;
  out := out || pg_temp.expect('os 25 pares: os 10 da tabela (e o mesmo status) passam com os carimbos, os outros 10 dão P0001',
                               ok_count::text || '/25' || bad, '25/25');

  -- 5b. Data de entrega, quando ela ou o status mudam: só na entregue, finita,
  -- até amanhã em São Paulo e não antes da data da venda (esta, também quando
  -- é o sold_on da entregue que muda).
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set delivered_on = 'infinity' where id = %L returning status || ' ' || coalesce(delivered_on::text, '-')$q$, s_w));
  out := out || pg_temp.expect('venda em negociação com data de entrega (UPDATE direto)', r, 'erro 22023: Só venda entregue tem data de entrega');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set delivered_on = %L where id = %L returning status || ' ' || coalesce(delivered_on::text, '-')$q$, sp - 1, s_shp));
  out := out || pg_temp.expect('venda enviada com data de entrega', r, 'erro 22023: Só venda entregue tem data de entrega');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set delivered_on = %L where id = %L returning status || ' ' || coalesce(delivered_on::text, '-')$q$, sp + 2, s_del));
  out := out || pg_temp.expect('entregue com data de entrega depois de amanhã', r, 'erro 22023: A data de entrega (%) passa de amanhã em São Paulo%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set delivered_on = '-infinity' where id = %L returning status || ' ' || coalesce(delivered_on::text, '-')$q$, s_del));
  out := out || pg_temp.expect('entregue com data de entrega infinita', r, 'erro 22023: A data de entrega (-infinity) passa de amanhã%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set delivered_on = %L where id = %L returning status || ' ' || coalesce(delivered_on::text, '-')$q$, sp - 5, s_del));
  out := out || pg_temp.expect('entregue antes da data da venda', r, 'erro 22023: A data de entrega (%) é anterior à data da venda (%)');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = 'delivered', delivered_on = '3000-01-01' where id = %L returning status || ' ' || coalesce(delivered_on::text, '-')$q$, s_shp));
  out := out || pg_temp.expect('enviada → entregue com data de entrega no ano 3000', r, 'erro 22023: A data de entrega (3000-01-01) passa de amanhã%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set delivered_on = %L where id = %L returning delivered_on::text$q$, sp, s_del));
  out := out || pg_temp.expect('entregue com data de entrega hoje', r, 'ok ' || sp::text);
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set sold_on = %L where id = %L returning sold_on::text$q$, sp + 1, s_del));
  out := out || pg_temp.expect('entregue: sold_on para depois da entrega (UPDATE direto)', r,
                               format('erro 22023: A data de entrega (%s) é anterior à data da venda (%s)', sp, sp + 1));
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set sold_on = %L where id = %L returning sold_on::text$q$, sp, s_del));
  out := out || pg_temp.expect('entregue: sold_on no mesmo dia da entrega passa', r, 'ok ' || sp::text);
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'delivered', p_today => %L)::text$q$, s_shp, sp));
  out := out || pg_temp.expect('enviada → entregue pela RPC: o carimbo é o dia do aparelho', coalesce(pg_temp.res(r) -> 'sale' ->> 'delivered_on', r), sp::text);

  -- 6. Visibilidade e escopo das referências.
  r := pg_temp.as_user(b, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name) values (%L, %L, %L, 'x')$q$, b, s_priv, p_pairs));
  out := out || pg_temp.expect('B põe item na venda PRIVADA da A', r, 'erro P0002: Venda não encontrada');
  r := pg_temp.as_user(c, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name) values (%L, %L, %L, 'x')$q$, c, s_w, p_c));
  out := out || pg_temp.expect('C põe item na venda do workspace', r, 'erro P0002: Venda não encontrada');
  r := pg_temp.as_user(b, format($q$update public.finance_store_sales set account_id = %L where id = %L$q$, acc_c, s_w));
  out := out || pg_temp.expect('B aponta a conta de C (de fora)', r, 'erro P0002: Conta não encontrada');
  r := pg_temp.as_user(b, format($q$update public.finance_store_sales set account_id = %L where id = %L$q$, acc_b, s_w));
  out := out || pg_temp.expect('B aponta a conta privada dele na venda da A (fora do escopo da dona)', r, 'erro P0002: Conta não encontrada');
  r := pg_temp.as_user(b, format($q$update public.finance_store_sales set customer_id = %L where id = %L$q$, cust_b, s_w));
  out := out || pg_temp.expect('B aponta o cliente privado dele na venda da A', r, 'erro P0002: Cliente não encontrado');
  r := pg_temp.as_user(b, format($q$update public.finance_store_sales set customer_id = %L where id = %L$q$, cust_a, s_w));
  out := out || pg_temp.expect('B aponta o cliente privado da A (invisível para ele)', r, 'erro P0002: Cliente não encontrado');
  r := pg_temp.as_user(b, format($q$update public.finance_store_sales set customer_id = %L, account_id = %L where id = %L returning 'ok'$q$, cust_w, acc_w, s_w));
  out := out || pg_temp.expect('B aponta cliente e conta do workspace', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set account_id = %L where id = %L returning 'ok'$q$, acc_a, s_w));
  out := out || pg_temp.expect('A aponta a conta privada dela na venda do workspace', r, 'ok ok');
  r := pg_temp.as_user(b, format($q$update public.finance_store_sales set transaction_id = %L where id = %L$q$, tx_a, s_tx));
  out := out || pg_temp.expect('B vincula a receita privada da A', r, 'erro P0002: Receita não encontrada');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set transaction_id = %L where id = %L$q$, tx_b, s_tx));
  out := out || pg_temp.expect('A vincula a receita privada de B (invisível para ela)', r, 'erro P0002: Receita não encontrada');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set transaction_id = %L where id = %L$q$, tx_exp, s_tx));
  out := out || pg_temp.expect('A vincula uma despesa', r, 'erro 22023: A receita da venda tem de ser uma transação de receita (income)');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set transaction_id = %L where id = %L$q$, tx_a, s_w));
  out := out || pg_temp.expect('receita em venda em negociação', r, 'erro P0001: Só venda vendida, enviada ou entregue tem receita');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set transaction_id = %L where id = %L returning 'ok'$q$, tx_a, s_tx));
  out := out || pg_temp.expect('A vincula a própria receita', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set transaction_id = %L where id = %L$q$, tx_a2, s_tx));
  out := out || pg_temp.expect('trocar a receita por outra (o duplo clique do generateSaleIncome antigo)', r, 'erro P0001: A venda já tem receita vinculada%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set transaction_id = %L where id = %L$q$, tx_a, s_tx2));
  out := out || pg_temp.expect('a mesma receita em outra venda', r, 'erro P0001: Esta transação já está vinculada a outra venda ou compra');
  -- O caso da crítica: B, com o painel no modo pessoal, vende numa venda
  -- PRIVADA a única unidade do produto de W. O item fica privado (herda da
  -- venda) e some para A, mas o estoque do gatilho é global.
  r := pg_temp.as_user(b, format($q$with s as (insert into public.finance_store_sales (user_id, workspace_id) values (%1$L, null) returning id)
    insert into public.finance_store_sale_items (user_id, workspace_id, sale_id, product_id, product_name) select %1$L, %2$L, s.id, %3$L, '' from s
    returning coalesce(workspace_id::text, 'privado') || ' ' || product_name$q$, b, ws, p_crit));
  out := out || pg_temp.expect('B vende o produto do workspace numa venda privada (item herda o workspace nulo, nome vem do produto)', r, 'ok privado GPU do workspace');
  r := pg_temp.as_user(a, format($q$select available::text from public.store_product_figures(array[%L]::uuid[])$q$, p_crit));
  out := out || pg_temp.expect('A, pela conta INVOKER da tela, ainda vê 1 disponível', r, 'ok 1');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name) values (%L, %L, %L, 'x')$q$, a, s_w, p_crit));
  out := out || pg_temp.expect('A tenta vender a mesma unidade: o estoque global recusa', r, 'erro P0001: Estoque insuficiente: GPU do workspace tem 0 disponível(is)');

  -- 7. Estoque, item único, arquivado.
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name, quantity) values (%L, %L, %L, 'x', 2)$q$, a, s_w, p_unique));
  out := out || pg_temp.expect('item único com 2 unidades', r, 'erro 22023: Item único vende 1 unidade: GPU harness');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name, quantity) values (%1$L, %2$L, %3$L, 'x', 6), (%1$L, %2$L, %3$L, 'x', 5)$q$, a, s_lot, p_stock));
  out := out || pg_temp.expect('lote de 6 + 5 com 10 em estoque (o 2º vê o 1º do mesmo INSERT)', r, 'erro P0001: Estoque insuficiente: SSD harness tem 4 disponível(is)');
  r := pg_temp.as_user(a, format($q$with i as (insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name, quantity) values (%1$L, %2$L, %3$L, 'x', 6), (%1$L, %2$L, %3$L, 'x', 4) returning 1) select count(*)::text from i$q$, a, s_lot, p_stock));
  out := out || pg_temp.expect('lote de 6 + 4 com 10 em estoque', r, 'ok 2');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name) values (%L, %L, %L, 'x')$q$, a, s_w, p_stock));
  out := out || pg_temp.expect('mais 1 com o estoque zerado', r, 'erro P0001: Estoque insuficiente: SSD harness tem 0 disponível(is)');
  select id::text into r from public.finance_store_sale_items where sale_id = s_lot and quantity = 6;
  i_lot := r::uuid;
  r := pg_temp.as_user(a, format($q$update public.finance_store_sale_items set quantity = 7 where id = %L$q$, i_lot));
  out := out || pg_temp.expect('aumentar a quantidade além do estoque', r, 'erro P0001: Estoque insuficiente%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sale_items set quantity = 5 where id = %L returning quantity::text$q$, i_lot));
  out := out || pg_temp.expect('diminuir a quantidade', r, 'ok 5');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sale_items set quantity = 50 where id = %L returning quantity::text$q$, i_canc));
  out := out || pg_temp.expect('quantidade em venda cancelada não segura estoque', r, 'ok 50');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = 'negotiating' where id = %L$q$, s_canc));
  out := out || pg_temp.expect('reabrir a cancelada com 50 e só 1 disponível', r, 'erro P0001: Estoque insuficiente para reabrir: SSD harness tem 1 disponível(is), a venda pede 50');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = 'negotiating' where id = %L$q$, s_cu));
  out := out || pg_temp.expect('reabrir a cancelada cuja unidade única saiu em outra venda', r, 'erro P0001: Estoque insuficiente para reabrir: GPU harness tem 0%');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = 'negotiating' where id = %L returning status$q$, s_c2));
  out := out || pg_temp.expect('reabrir a cancelada com estoque', r, 'ok negotiating');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name) values (%L, %L, %L, 'x')$q$, a, s_w, p_arch));
  out := out || pg_temp.expect('produto arquivado em venda', r, 'erro 22023: Produto arquivado não entra em venda: Arquivado harness');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name) values (%L, %L, %L, 'x')$q$, a, s_w, p_c));
  out := out || pg_temp.expect('produto de C', r, 'erro P0002: Produto não encontrado');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sale_items set sale_id = %L where id = %L$q$, s_w, i_lot));
  out := out || pg_temp.expect('item muda de venda', r, 'erro 22023: O item não muda de venda%');

  -- parte 2

  -- 8. O fluxo pelas RPCs (A, venda do workspace). O frete pago
  -- (shipping_cost) é custo da venda e não entra no líquido da receita: com
  -- 10,00 de frete pago, um líquido que o descontasse sairia 10,00 menor em
  -- cada valor abaixo.
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object(
         'customer_id', cust_w, 'channel', 'olx', 'account_id', acc_w, 'shipping_charged', 2000, 'shipping_cost', 1000, 'fees', 500, 'workspace_id', ws,
         'notes', 'harness', 'attachments', '[]'::jsonb,
         'items', jsonb_build_array(jsonb_build_object('product_id', p_flow),
                                    jsonb_build_object('product_id', p_flow2, 'quantity', 2, 'unit_price', 15000)))));
  v := pg_temp.res(r);
  sid := (v -> 'sale' ->> 'id')::uuid;
  out := out || pg_temp.expect('create: venda em negociação no workspace, com cliente, conta e dinheiro (frete cobrado, frete pago, taxa)',
                               pg_temp.or_err(format('%s %s %s %s %s %s %s', v -> 'sale' ->> 'status', v -> 'sale' ->> 'workspace_id' = ws::text,
                                               v -> 'sale' ->> 'customer_id' = cust_w::text, v -> 'sale' ->> 'account_id' = acc_w::text,
                                               v -> 'sale' ->> 'shipping_charged', v -> 'sale' ->> 'shipping_cost', v -> 'sale' ->> 'fees'), r),
                               'negotiating t t t 2000 1000 500');
  out := out || pg_temp.expect('create: itens com nome, preço padrão (target_price), custo médio e workspace da venda (snapshots do servidor)',
                               coalesce((select string_agg(format('%s %s %s %s %s', e ->> 'product_name', e ->> 'quantity', e ->> 'unit_price', e ->> 'unit_cost_at_sale',
                                                                  e ->> 'workspace_id' = ws::text), ', ' order by e ->> 'product_name')
                                           from jsonb_array_elements(v -> 'items') e), r),
                               'Fluxo 2 harness 2 15000 10000 t, Fluxo harness 1 30000 20200 t');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'sold', true, %L, %L, 'Venda: harness', %L)::text$q$, sid, sp - 1, cat_in, sp));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('vendida com receita: valor = líquido (itens + frete cobrado - taxa, sem o frete pago), data, conta, categoria, workspace da venda, dono, tipo',
                               pg_temp.or_err(format('%s %s %s %s %s %s %s %s %s %s', v -> 'sale' ->> 'status', v -> 'sale' ->> 'sold_on' = (sp - 1)::text,
                                               (v -> 'transaction' ->> 'amount')::numeric::bigint, v -> 'transaction' ->> 'date' = (sp - 1)::text,
                                               v -> 'transaction' ->> 'account_id' = acc_w::text, v -> 'transaction' ->> 'category_id' = cat_in::text,
                                               v -> 'transaction' ->> 'workspace_id' = ws::text, v -> 'transaction' ->> 'user_id' = a::text,
                                               v -> 'transaction' ->> 'type', v ->> 'transaction_changed'), r),
                               'sold t 61500 t t t t t income true');
  w := v -> 'transaction';
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped')::text$q$, sid));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('enviada: a receita fica (mesmo id) e transaction_changed é false',
                               pg_temp.or_err(format('%s %s %s', v -> 'sale' ->> 'status', v -> 'transaction' ->> 'id' = w ->> 'id', v ->> 'transaction_changed'), r), 'shipped t false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'delivered', p_today => %L)::text$q$, sid, sp));
  out := out || pg_temp.expect('entregue: delivered_on = o dia do aparelho', coalesce(pg_temp.res(r) -> 'sale' ->> 'delivered_on', r), sp::text);
  r := pg_temp.as_user_hint(a, format($q$select public.store_sale_update(%L, %L::jsonb)::text$q$, sid, jsonb_build_object('sold_on', sp + 1)));
  out := out || pg_temp.expect('entregue: store_sale_update do sold_on para depois da entrega dá 22023 com hint akool', r,
                               format('erro 22023 [akool]: A data de entrega (%s) é anterior à data da venda (%s)', sp, sp + 1));
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped')::text$q$, sid));
  out := out || pg_temp.expect('volta para enviada: sem data de entrega',
                               pg_temp.or_err(format('%s %s', pg_temp.res(r) -> 'sale' ->> 'status', coalesce(pg_temp.res(r) -> 'sale' ->> 'delivered_on', 'null')), r), 'shipped null');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'sold')::text$q$, sid));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('volta para vendida: a data e a receita ficam',
                               pg_temp.or_err(format('%s %s %s', v -> 'sale' ->> 'sold_on' = (sp - 1)::text, v -> 'transaction' ->> 'id' = w ->> 'id', v ->> 'transaction_changed'), r), 't t false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'sold')::text$q$, sid));
  out := out || pg_temp.expect('mesmo status: devolve sem mudar', coalesce(pg_temp.res(r) ->> 'transaction_changed', r), 'false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped')::text$q$, sid));
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'sold', p_sold_on => %L)::text$q$, sid, sp - 2));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('enviada → vendida com outra data: a receita vai para a data nova (transaction_changed true)',
                               pg_temp.or_err(format('%s %s %s %s', v -> 'sale' ->> 'sold_on' = (sp - 2)::text, v -> 'transaction' ->> 'date' = (sp - 2)::text,
                                               (select date = sp - 2 from public.finance_transactions where id = (w ->> 'id')::uuid), v ->> 'transaction_changed'), r),
                               't t t true');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"fees": 1500}')::text$q$, sid));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('update das taxas: a receita acompanha o líquido', pg_temp.or_err(format('%s %s', (v -> 'transaction' ->> 'amount')::numeric::bigint, v ->> 'transaction_changed'), r), '60500 true');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, %L::jsonb)::text$q$, sid, jsonb_build_object('account_id', acc_a, 'sold_on', sp - 3)));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('update da conta e da data: a receita vai junto',
                               pg_temp.or_err(format('%s %s', v -> 'transaction' ->> 'account_id' = acc_a::text, v -> 'transaction' ->> 'date' = (sp - 3)::text), r), 't t');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"notes": "só nota"}')::text$q$, sid));
  out := out || pg_temp.expect('update sem mexer em dinheiro: a receita não muda', coalesce(pg_temp.res(r) ->> 'transaction_changed', r), 'false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"account_id": null}')::text$q$, sid));
  out := out || pg_temp.expect('tirar a conta de venda com receita', r, 'erro 22023: Venda com receita lançada precisa de uma conta%');
  x0 := pg_temp.xmin_of(sid);
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, sid, jsonb_build_array(jsonb_build_object('product_id', p_flow, 'unit_price', 10000))));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('items_add: receita ressincronizada, 3 itens',
                               pg_temp.or_err(format('%s %s %s', (v -> 'transaction' ->> 'amount')::numeric::bigint, v ->> 'transaction_changed', jsonb_array_length(v -> 'items')), r), '70500 true 3');
  out := out || pg_temp.expect('items_add não grava a venda (xmin igual)', (pg_temp.xmin_of(sid) = x0)::text, 'true');
  select e ->> 'id' into r from jsonb_array_elements(v -> 'items') e where e ->> 'unit_price' = '10000';
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_update(%L, '{"unit_price": 12000, "quantity": 2}')::text$q$, r));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('items_update: preço e quantidade, receita ressincronizada', coalesce((v -> 'transaction' ->> 'amount')::numeric::bigint::text, r), '84500');
  out := out || pg_temp.expect('items_update não grava a venda (xmin igual)', (pg_temp.xmin_of(sid) = x0)::text, 'true');
  select e ->> 'id' into r from jsonb_array_elements(v -> 'items') e where e ->> 'unit_price' = '12000';
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_update(%L, '{"quantity": 5}')::text$q$, r));
  out := out || pg_temp.expect('items_update além do estoque', r, 'erro P0001: Estoque insuficiente: Fluxo harness tem 2 disponível(is)');
  select e ->> 'id' into r from jsonb_array_elements(v -> 'items') e where e ->> 'unit_price' = '12000';
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_remove(%L)::text$q$, r));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('items_remove: receita ressincronizada', pg_temp.or_err(format('%s %s', (v -> 'transaction' ->> 'amount')::numeric::bigint, jsonb_array_length(v -> 'items')), r), '60500 2');
  out := out || pg_temp.expect('items_remove não grava a venda (xmin igual)', (pg_temp.xmin_of(sid) = x0)::text, 'true');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"fees": 100000}')::text$q$, sid));
  out := out || pg_temp.expect('taxa que zera o líquido com receita lançada', r, 'erro 22023: O líquido da venda ficaria zero ou negativo%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'negotiating')::text$q$, sid));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('volta para negociação: a receita é apagada e as datas somem',
                               pg_temp.or_err(format('%s %s %s %s %s', v -> 'sale' ->> 'status', coalesce(v -> 'sale' ->> 'sold_on', 'null'), coalesce(v ->> 'transaction', 'null'),
                                               v ->> 'transaction_changed', (select count(*) from public.finance_transactions where id = (w ->> 'id')::uuid)), r),
                               'negotiating null null true 0');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'sold', p_today => %L)::text$q$, sid, sp));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('vendida sem receita: sold_on = o dia do aparelho',
                               pg_temp.or_err(format('%s %s', v -> 'sale' ->> 'sold_on' = sp::text, coalesce(v ->> 'transaction', 'null')), r), 't null');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L, %L)::text$q$, sid, cat_in));
  v := pg_temp.res(r);
  w := v -> 'transaction';
  out := out || pg_temp.expect('generate_income: cria (created true, valor = líquido, descrição padrão com os itens)',
                               pg_temp.or_err(format('%s %s %s', v ->> 'created', (w ->> 'amount')::numeric::bigint, w ->> 'description'), r), 'true 60500 Venda: Fluxo%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L)::text$q$, sid));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('generate_income de novo: idempotente (created false, a mesma receita)',
                               pg_temp.or_err(format('%s %s %s', v ->> 'created', v -> 'transaction' ->> 'id' = w ->> 'id',
                                               (select count(*) from public.finance_transactions t where t.description like 'Venda: Fluxo%' and t.user_id = a)), r), 'false t 1');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'cancelled')::text$q$, sid));
  out := out || pg_temp.expect('cancela: a receita é apagada',
                               pg_temp.or_err(format('%s %s', pg_temp.res(r) ->> 'transaction_changed', (select count(*) from public.finance_transactions where id = (w ->> 'id')::uuid)), r), 'true 0');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'negotiating')::text$q$, sid));
  out := out || pg_temp.expect('reabre a cancelada (há estoque)', coalesce(pg_temp.res(r) -> 'sale' ->> 'status', r), 'negotiating');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, %L::jsonb)::text$q$, sid, jsonb_build_object('attachments', jsonb_build_array(jsonb_build_object('id', 'f1', 'path', a::text || '/x.png')))));
  r := pg_temp.as_user(a, format($q$select public.store_sale_delete(%L)::text$q$, sid));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('delete: devolve os anexos para o Storage; venda e itens somem',
                               pg_temp.or_err(format('%s %s %s %s', v ->> 'transaction_deleted', v -> 'attachments' -> 0 ->> 'path' = a::text || '/x.png',
                                               (select count(*) from public.finance_store_sales where id = sid), (select count(*) from public.finance_store_sale_items where sale_id = sid)), r),
                               'false t 0 0');
  -- Venda com receita: o delete apaga a receita.
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('account_id', acc_w, 'workspace_id', ws,
         'items', jsonb_build_array(jsonb_build_object('product_id', p_flow, 'unit_price', 5000)))));
  sid := (pg_temp.res(r) -> 'sale' ->> 'id')::uuid;
  -- B (membro) opera a venda da A: a receita sai em nome dele, no workspace.
  r := pg_temp.as_user(b, format($q$select public.store_sale_set_status(%L, 'sold', true, p_today => %L)::text$q$, sid, sp));
  w := pg_temp.res(r) -> 'transaction';
  out := out || pg_temp.expect('B vende a venda da A com receita: em nome de B, no workspace, visível para A',
                               pg_temp.or_err(format('%s %s %s', w ->> 'user_id' = b::text, w ->> 'workspace_id' = ws::text,
                                               pg_temp.as_user(a, format($q$select count(*)::text from public.finance_transactions where id = %L$q$, w ->> 'id'))), r),
                               't t ok 1');
  r := pg_temp.as_user(a, format($q$select public.store_sale_delete(%L)::text$q$, sid));
  out := out || pg_temp.expect('delete de venda com receita (de B, no workspace): a receita some',
                               pg_temp.or_err(format('%s %s', pg_temp.res(r) ->> 'transaction_deleted', (select count(*) from public.finance_transactions where id = (w ->> 'id')::uuid)), r), 'true 0');
  -- Receita de outra pessoa (privada de B) numa venda antiga da A: o que
  -- não mexe no dinheiro passa; mudar o que a receita leva (o líquido pelo
  -- update ou pelos itens, a data, a conta), cancelar e excluir dão 42501,
  -- com quem precisa agir na mensagem.
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'cancelled')::text$q$, s_foreign));
  out := out || pg_temp.expect('cancelar com a receita privada de outra pessoa', r, 'erro 42501: A receita vinculada é de outra pessoa: peça a quem a lançou para apagá-la em Transações%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"fees": 10}')::text$q$, s_foreign));
  out := out || pg_temp.expect('ressincronizar a receita de outra pessoa', r, 'erro 42501: A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_delete(%L)::text$q$, s_foreign));
  out := out || pg_temp.expect('excluir com a receita de outra pessoa', r, 'erro 42501: A receita vinculada é de outra pessoa: peça a quem a lançou para apagá-la em Transações%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"notes": "só a nota"}')::text$q$, s_foreign));
  out := out || pg_temp.expect('nota em venda com receita alheia: passa, sem receita na resposta',
                               pg_temp.or_err(format('%s %s %s', pg_temp.res(r) -> 'sale' ->> 'notes', coalesce(pg_temp.res(r) ->> 'transaction', 'null'),
                                               pg_temp.res(r) ->> 'transaction_changed'), r), 'só a nota null false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_update(%L, '{"unit_price": 5000}')::text$q$, i_for));
  out := out || pg_temp.expect('item com o mesmo valor em venda com receita alheia: passa',
                               pg_temp.or_err(format('%s %s', coalesce(pg_temp.res(r) ->> 'transaction', 'null'), pg_temp.res(r) ->> 'transaction_changed'), r), 'null false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_update(%L, '{"unit_price": 6000}')::text$q$, i_for));
  out := out || pg_temp.expect('item com outro valor em venda com receita alheia', r, 'erro 42501: A receita vinculada é de outra pessoa: só quem a lançou%');
  -- Um 2º item com preço (como postgres, sem gatilhos): tirar o de 50,00, o
  -- único, zeraria o líquido e daria o 22023 antes de chegar à receita.
  set local session_replication_role = replica;
  insert into public.finance_store_sale_items (id, user_id, workspace_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost_at_sale, updated_at)
  values (i_for2, a, ws, s_foreign, p_pairs, 'Pares', 1, 1000, 500, '2020-01-01');
  set local session_replication_role = origin;
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, s_foreign, jsonb_build_array(jsonb_build_object('product_id', p_pairs, 'unit_price', 1000))));
  out := out || pg_temp.expect('items_add de um item com preço em venda com receita alheia', r, 'erro 42501: A receita vinculada é de outra pessoa: só quem a lançou%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, s_foreign, jsonb_build_array(jsonb_build_object('product_id', p_pairs, 'unit_price', 0))));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('items_add de um item a 0 em venda com receita alheia: passa, sem receita',
                               pg_temp.or_err(format('%s %s', coalesce(v ->> 'transaction', 'null'), v ->> 'transaction_changed'), r), 'null false');
  select (e ->> 'id')::uuid into i_for0 from jsonb_array_elements(v -> 'items') e where e ->> 'unit_price' = '0';
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_remove(%L)::text$q$, i_for0));
  out := out || pg_temp.expect('items_remove do item a 0: passa, sem receita',
                               pg_temp.or_err(format('%s %s', coalesce(pg_temp.res(r) ->> 'transaction', 'null'), pg_temp.res(r) ->> 'transaction_changed'), r), 'null false');
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_remove(%L)::text$q$, i_for2));
  out := out || pg_temp.expect('items_remove de um item com preço (sobra o de 50,00)', r, 'erro 42501: A receita vinculada é de outra pessoa: só quem a lançou%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, %L::jsonb)::text$q$, s_foreign, jsonb_build_object('sold_on', sp - 3)));
  out := out || pg_temp.expect('update da data da venda com receita alheia', r, 'erro 42501: A receita vinculada é de outra pessoa: só quem a lançou%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, %L::jsonb)::text$q$, s_foreign, jsonb_build_object('account_id', acc_a)));
  out := out || pg_temp.expect('update da conta (uma conta privada da A) com receita alheia', r, 'erro 42501: A receita vinculada é de outra pessoa: só quem a lançou%');
  out := out || pg_temp.expect('nada mudou na venda, na receita nem nos itens (status, data e conta da venda; valor, data e conta da receita; os 2 itens com preço)',
                               format('%s %s %s | %s %s %s | %s', (select status from public.finance_store_sales where id = s_foreign),
                                      (select sold_on = sp - 2 from public.finance_store_sales where id = s_foreign),
                                      (select account_id = acc_w from public.finance_store_sales where id = s_foreign),
                                      (select amount::bigint from public.finance_transactions where id = tx_b),
                                      (select date = sp from public.finance_transactions where id = tx_b),
                                      (select account_id = acc_b from public.finance_transactions where id = tx_b),
                                      (select string_agg(unit_price::text, ' ' order by unit_price) from public.finance_store_sale_items where sale_id = s_foreign)),
                               'sold t t | 5000 t t | 1000 5000');

  -- 8b. Quem sai do workspace (W3: D dona, E, F e H membros), só pelo app.
  -- Removida (remove_workspace_member): E, dona da venda, continua vendo o
  -- item que F pôs nela, e a receita soma os dois. Desde a saída do
  -- workspace (workspace_exit), a venda de E vai com ela para o privado; o
  -- item de F fica no W3 e segue a venda (F deixa de ver a venda).
  r := pg_temp.as_user(ue, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('account_id', acc_e, 'workspace_id', ws3,
         'items', jsonb_build_array(jsonb_build_object('product_id', p_w3, 'unit_price', 10000)))));
  s_e := (pg_temp.res(r) -> 'sale' ->> 'id')::uuid;
  r := pg_temp.as_user(uf, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, s_e, jsonb_build_array(jsonb_build_object('product_id', p_w3, 'unit_price', 20000))));
  out := out || pg_temp.expect('F (membro) põe um item de 200,00 na venda de E: o item fica no W3',
                               coalesce((select string_agg(e ->> 'workspace_id', ' ') from jsonb_array_elements(pg_temp.res(r) -> 'items') e), r), ws3::text || ' ' || ws3::text);
  select id into i_f from public.finance_store_sale_items where sale_id = s_e and user_id = uf;
  r := pg_temp.as_user(uf, format($q$update public.finance_store_sale_items set workspace_id = null where id = %L$q$, i_f));
  out := out || pg_temp.expect('F tira o workspace do próprio item na venda do W3 (UPDATE direto)', r, 'erro 22023: O item fica no workspace da venda%');
  r := pg_temp.as_user(ud, format($q$select public.remove_workspace_member(%L)::text$q$, ue));
  out := out || pg_temp.expect('D remove E do W3: a venda de E vai para o privado, o item de F fica no W3',
                               r || ' ' || format('%s %s', (select workspace_id is null from public.finance_store_sales where id = s_e),
                                                  (select workspace_id = ws3 from public.finance_store_sale_items where id = i_f)), 'ok  t t');
  r := pg_temp.as_user(ue, format($q$select count(*)::text from public.finance_store_sale_items where sale_id = %L$q$, s_e));
  out := out || pg_temp.expect('E, fora do W3, vê os 2 itens da própria venda', r, 'ok 2');
  r := pg_temp.as_user(c, format($q$select count(*)::text from public.finance_store_sale_items where sale_id = %L$q$, s_e))
       || ' ' || pg_temp.as_user(b, format($q$select count(*)::text from public.finance_store_sale_items where sale_id = %L$q$, s_e));
  out := out || pg_temp.expect('C (de fora) e B (de outro workspace) não veem os itens da venda de E', r, 'ok 0 ok 0');
  r := pg_temp.as_user(ue, format($q$select public.store_sale_set_status(%L, 'sold', true, p_today => %L)::text$q$, s_e, sp));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('E vende com receita: o valor soma o item de F (300,00), em nome de E, privada',
                               pg_temp.or_err(format('%s %s %s', (v -> 'transaction' ->> 'amount')::numeric::bigint, v -> 'transaction' ->> 'user_id' = ue::text,
                                               coalesce(v -> 'transaction' ->> 'workspace_id', 'null')), r), '30000 t null');
  r := pg_temp.as_user(uf, format($q$select public.store_sale_update(%L, '{}')::text$q$, s_e))
       || ' | ' || pg_temp.as_user(uf, format($q$select count(*)::text from public.finance_store_sale_items where id = %L$q$, i_f));
  out := out || pg_temp.expect('F não vê mais a venda privada de E (P0002), mas ainda lê o próprio item', r, 'erro P0002: Venda não encontrada | ok 1');
  r := pg_temp.as_user(ue, format($q$select public.store_sale_items_remove(%L)::text$q$, i_f));
  v := pg_temp.res(r);
  out := out || pg_temp.expect('E tira o item de F da própria venda: a receita volta a 100,00',
                               pg_temp.or_err(format('%s %s %s', (v -> 'transaction' ->> 'amount')::numeric::bigint, v ->> 'transaction_changed', jsonb_array_length(v -> 'items')), r),
                               '10000 true 1');
  -- Saída (leave_workspace): F lança a receita da venda de D no W3 e a do
  -- próprio negócio, com um item de D, e sai. A receita de F na venda de D
  -- fica no W3, seguindo a venda, como o item: D muda a data e cancela sem
  -- depender de F.
  r := pg_temp.as_user(ud, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('account_id', acc_w3, 'workspace_id', ws3,
         'items', jsonb_build_array(jsonb_build_object('product_id', p_w3, 'unit_price', 15000)))));
  s_d := (pg_temp.res(r) -> 'sale' ->> 'id')::uuid;
  r := pg_temp.as_user(uf, format($q$select public.store_sale_set_status(%L, 'sold', true, p_today => %L)::text$q$, s_d, sp));
  w := pg_temp.res(r) -> 'transaction';
  r := pg_temp.as_user(uf, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('account_id', acc_f, 'workspace_id', ws3,
         'items', jsonb_build_array(jsonb_build_object('product_id', p_w3, 'unit_price', 10000)))));
  s_f := (pg_temp.res(r) -> 'sale' ->> 'id')::uuid;
  r := pg_temp.as_user(ud, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, s_f, jsonb_build_array(jsonb_build_object('product_id', p_w3, 'unit_price', 20000))));
  r := pg_temp.as_user(uf, $q$select public.leave_workspace()::text$q$);
  out := out || pg_temp.expect('F sai do W3 (leave_workspace): a receita que F lançou na venda de D fica no W3, em nome de F; a venda de F vai para o privado',
                               r || ' ' || coalesce((select (workspace_id = ws3) || ' ' || (user_id = uf) from public.finance_transactions where id = (w ->> 'id')::uuid), 'sem receita')
                               || ' ' || coalesce((select (workspace_id is null)::text from public.finance_store_sales where id = s_f), 'sem venda'),
                               'ok  true true true');
  r := pg_temp.as_user(uf, format($q$select public.store_sale_set_status(%L, 'sold', true, p_today => %L)::text$q$, s_f, sp));
  out := out || pg_temp.expect('F, fora do W3, vende a própria venda com receita: o valor soma o item de D (300,00)',
                               coalesce((pg_temp.res(r) -> 'transaction' ->> 'amount')::numeric::bigint::text, r), '30000');
  r := pg_temp.as_user(ud, format($q$select public.store_sale_update(%L, '{"notes": "nota da D"}')::text$q$, s_d));
  out := out || pg_temp.expect('D edita a nota da venda com a receita de quem saiu: passa, e D vê a receita',
                               pg_temp.or_err(format('%s %s %s', pg_temp.res(r) -> 'sale' ->> 'notes', pg_temp.res(r) -> 'transaction' ->> 'id' = w ->> 'id',
                                               pg_temp.res(r) ->> 'transaction_changed'), r), 'nota da D t false');
  r := pg_temp.as_user(ud, format($q$select public.store_sale_items_update(%L, '{"quantity": 1}')::text$q$,
                                  (select id from public.finance_store_sale_items where sale_id = s_d)));
  out := out || pg_temp.expect('D grava o item sem mudar o valor: passa', coalesce(pg_temp.res(r) ->> 'transaction_changed', r), 'false');
  r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'shipped')::text$q$, s_d));
  r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'sold', p_sold_on => %L)::text$q$, s_d, sp - 1));
  out := out || pg_temp.expect('D volta para vendida com outra data: a data da receita de F acompanha (sem 42501)',
                               pg_temp.or_err(format('%s %s', pg_temp.res(r) -> 'transaction' ->> 'date', pg_temp.res(r) ->> 'transaction_changed'), r),
                               format('%s true', sp - 1));
  r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_d));
  out := out || pg_temp.expect('D cancela: a receita de F, no W3, é apagada (sem 42501)',
                               r || ' ' || (select count(*) from public.finance_transactions where id = (w ->> 'id')::uuid), 'ok cancelled 0');
  -- Remoção (remove_workspace_member) de quem lançou a receita da venda da
  -- dona: antes da workspace_exit dava 42501 ("Somente o autor pode
  -- realocar o lancamento"). Agora H sai e a receita fica no W3.
  r := pg_temp.as_user(ud, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('account_id', acc_w3, 'workspace_id', ws3,
         'items', jsonb_build_array(jsonb_build_object('product_id', p_w3, 'unit_price', 12000)))));
  s_d2 := (pg_temp.res(r) -> 'sale' ->> 'id')::uuid;
  r := pg_temp.as_user(uh, format($q$select public.store_sale_set_status(%L, 'sold', true, p_today => %L)::text$q$, s_d2, sp));
  w := pg_temp.res(r) -> 'transaction';
  r := pg_temp.as_user(ud, format($q$select public.remove_workspace_member(%L)::text$q$, uh));
  out := out || pg_temp.expect('D remove H, que lançou a receita da venda de D no W3: H sai e a receita fica no W3',
                               r || ' | ' || (select count(*) from public.finance_workspace_members where workspace_id = ws3 and user_id = uh)
                               || ' ' || coalesce((select (workspace_id = ws3)::text from public.finance_transactions where id = (w ->> 'id')::uuid), 'sem receita'),
                               'ok  | 0 true');
  r := pg_temp.as_user(ud, format($q$select public.store_sale_set_status(%L, 'cancelled') -> 'sale' ->> 'status'$q$, s_d2));
  out := out || pg_temp.expect('D cancela a venda com a receita de H (apagada no W3)',
                               r || ' ' || (select count(*) from public.finance_transactions where id = (w ->> 'id')::uuid), 'ok cancelled 0');

  -- 9. Erros de entrada e de regra das RPCs.
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped', p_today => %L)::text$q$, s_tx2, sp + 2));
  out := out || pg_temp.expect('p_today a 2 dias de São Paulo', r, 'erro 22023: Data de hoje%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped', p_today => 'infinity')::text$q$, s_tx2));
  out := out || pg_temp.expect('p_today infinito', r, 'erro 22023: Data de hoje%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'paid')::text$q$, s_tx2));
  out := out || pg_temp.expect('status desconhecido', r, 'erro 22023: status é negotiating%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'delivered')::text$q$, s_w));
  out := out || pg_temp.expect('salto pela RPC', r, 'erro P0001: Mudança de status não permitida: negotiating → delivered');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'sold', p_sold_on => %L)::text$q$, s_w, sp + 2));
  out := out || pg_temp.expect('data de venda depois de amanhã', r, 'erro 22023: A data da venda%passa de amanhã%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'cancelled', true)::text$q$, s_w));
  out := out || pg_temp.expect('receita pedida numa transição que não vende', r, 'erro 22023: Receita só em venda vendida%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L)::text$q$, s_us));
  out := out || pg_temp.expect('receita sem conta na venda', r, 'erro 22023: A venda precisa de uma conta%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L, %L)::text$q$, s_tx2, cat_out));
  out := out || pg_temp.expect('receita com categoria de despesa', r, 'erro 22023: A categoria da receita tem de ser de receita%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L, %L)::text$q$, s_tx2, cat_c));
  out := out || pg_temp.expect('receita com a categoria de C', r, 'erro P0002: Categoria não encontrada');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L)::text$q$, s_zero));
  out := out || pg_temp.expect('receita com líquido <= 0 (item a 0, taxa de 5,00)', r, 'erro 22023: O líquido da venda é zero ou negativo%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L)::text$q$, s_w));
  out := out || pg_temp.expect('receita em venda em negociação', r, 'erro P0001: Só venda vendida, enviada ou entregue gera receita');
  r := pg_temp.as_user(a, format($q$select public.store_sale_generate_income(%L)::text$q$, s_tx2));
  out := out || pg_temp.expect('generate_income: data, conta e líquido da venda antiga', pg_temp.or_err(format('%s %s', pg_temp.res(r) ->> 'created',
                               (pg_temp.res(r) -> 'transaction' ->> 'amount')::numeric::bigint), r), 'true 10000');
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_remove(%L)::text$q$,
                                  (select id from public.finance_store_sale_items where sale_id = s_tx2)));
  out := out || pg_temp.expect('tirar o último item com receita (líquido 0)', r, 'erro 22023: O líquido da venda ficaria zero ou negativo%');
  r := pg_temp.as_user(a, format($q$select jsonb_array_length(public.store_sale_items_remove(%L) -> 'items')::text$q$, i_zero));
  out := out || pg_temp.expect('tirar o último item sem receita é permitido', r, 'ok 0');
  r := pg_temp.as_user(a, $q$select public.store_sale_create('{"items": [], "channel": "olx"}')::text$q$);
  out := out || pg_temp.expect('create sem itens', r, 'erro 22023: items é uma lista de 1 a 100%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('items',
         (select jsonb_agg(jsonb_build_object('product_id', p_pairs)) from generate_series(1, 101)))));
  out := out || pg_temp.expect('create com 101 itens', r, 'erro 22023: items é uma lista de 1 a 100%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('status', 'sold', 'items', jsonb_build_array(jsonb_build_object('product_id', p_pairs)))));
  out := out || pg_temp.expect('create com status', r, 'erro 22023: chave "status" não muda por aqui%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('frete', 1, 'items', jsonb_build_array(jsonb_build_object('product_id', p_pairs)))));
  out := out || pg_temp.expect('create com chave desconhecida', r, 'erro 22023: chave "frete" não aceita%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('fees', -1, 'items', jsonb_build_array(jsonb_build_object('product_id', p_pairs)))));
  out := out || pg_temp.expect('create com taxa negativa (antes do CHECK)', r, 'erro 22023: fees é um valor em centavos%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('fees', 1000000000001, 'items', jsonb_build_array(jsonb_build_object('product_id', p_pairs)))));
  out := out || pg_temp.expect('create com taxa acima de 1e12', r, 'erro 22023: fees é um valor em centavos%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('fees', 1.5, 'items', jsonb_build_array(jsonb_build_object('product_id', p_pairs)))));
  out := out || pg_temp.expect('create com taxa fracionária', r, 'erro 22023: fees é um valor em centavos%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('items', jsonb_build_array(
         jsonb_build_object('product_id', p_pairs), jsonb_build_object('product_id', p_pairs, 'product_name', 'x')))));
  out := out || pg_temp.expect('create: item com chave a mais (nome e custo vêm do produto)', r, 'erro 22023: items/1: chave "product_name" não aceita%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', p_c)))));
  out := out || pg_temp.expect('create: produto de C', r, 'erro P0002: items/0: Produto não encontrado');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('workspace_id', ws, 'items', jsonb_build_array(
         jsonb_build_object('product_id', p_flow2, 'quantity', 2), jsonb_build_object('product_id', p_flow2, 'quantity', 3)))));
  out := out || pg_temp.expect('create: o 2º item passa do estoque (tudo ou nada)', r, 'erro P0001: items/1: Estoque insuficiente: Fluxo 2 harness tem 2 disponível(is)');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', p_unique, 'quantity', 2)))));
  out := out || pg_temp.expect('create: item único com 2', r, 'erro 22023: items/0: Item único vende 1 unidade%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('items', jsonb_build_array(jsonb_build_object('product_id', p_pairs, 'quantity', 0)))));
  out := out || pg_temp.expect('create: quantidade 0', r, 'erro 22023: items/0: quantity é um inteiro de 1 a 1000000');
  r := pg_temp.as_user(a, format($q$select public.store_sale_create(%L::jsonb)::text$q$, jsonb_build_object('sold_on', sp, 'items', jsonb_build_array(jsonb_build_object('product_id', p_pairs)))));
  out := out || pg_temp.expect('create com sold_on', r, 'erro 22023: A data da venda só existe em venda vendida%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"status": "sold"}')::text$q$, s_w));
  out := out || pg_temp.expect('update com status', r, 'erro 22023: chave "status" não muda por aqui%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"expected_delivery_on": "2026-02-30"}')::text$q$, s_w));
  out := out || pg_temp.expect('update com data inválida', r, 'erro 22023: expected_delivery_on é uma data AAAA-MM-DD ou null');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"channel": "loja"}')::text$q$, s_w));
  out := out || pg_temp.expect('update com canal desconhecido', r, 'erro 22023: channel é olx%');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"sold_on": null}')::text$q$, s_us));
  out := out || pg_temp.expect('update tirando a data da venda vendida', r, 'erro 22023: Informe a data da venda');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"shipping_method": "PAC", "expected_delivery_on": null, "attachments": null}')::text$q$, s_w));
  out := out || pg_temp.expect('update com nulos: entrega prevista nula e anexos []',
                               pg_temp.or_err(format('%s %s %s', pg_temp.res(r) -> 'sale' ->> 'shipping_method', coalesce(pg_temp.res(r) -> 'sale' ->> 'expected_delivery_on', 'null'),
                                               pg_temp.res(r) -> 'sale' -> 'attachments'), r), 'PAC null []');
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_update(%L, '{"product_id": null}')::text$q$, i_lot));
  out := out || pg_temp.expect('items_update com product_id', r, 'erro 22023: chave "product_id" não aceita%');
  r := pg_temp.as_user(c, format($q$select public.store_sale_items_remove(%L)::text$q$, i_lot));
  out := out || pg_temp.expect('C tira item da venda da A', r, 'erro P0002: Item não encontrado');
  r := pg_temp.as_user(c, format($q$select public.store_sale_set_status(%L, 'cancelled')::text$q$, s_w));
  out := out || pg_temp.expect('C muda o status da venda da A', r, 'erro P0002: Venda não encontrada');
  r := pg_temp.as_user(c, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, s_w, jsonb_build_array(jsonb_build_object('product_id', p_c))));
  out := out || pg_temp.expect('C põe item pela RPC', r, 'erro P0002: Venda não encontrada');
  r := pg_temp.as_user(c, format($q$select count(*)::text from public.store_product_figures(array[%L]::uuid[])$q$, p_stock));
  out := out || pg_temp.expect('C não vê os números do produto da A', r, 'ok 0');
  calls := array[
    $q$select public.store_sale_create('{"items": [{"product_id": "00000000-0000-0000-0000-000000000000"}]}')::text$q$,
    format($q$select public.store_sale_set_status(%L, 'sold')::text$q$, s_w),
    format($q$select public.store_sale_update(%L, '{}')::text$q$, s_w),
    format($q$select public.store_sale_items_add(%L, '[{"product_id": "00000000-0000-0000-0000-000000000000"}]')::text$q$, s_w),
    format($q$select public.store_sale_items_update(%L, '{}')::text$q$, i_lot),
    format($q$select public.store_sale_items_remove(%L)::text$q$, i_lot),
    format($q$select public.store_sale_generate_income(%L)::text$q$, s_tx2),
    format($q$select public.store_sale_delete(%L)::text$q$, s_w)];
  select count(*) filter (where pg_temp.try(null, x) = 'erro 42501: not authenticated')::text || '/' || count(*) into r from unnest(calls) x;
  out := out || pg_temp.expect('sem usuário: 42501 nas 8 RPCs', r, '8/8');
  calls := calls || format($q$select count(*)::text from public.store_product_figures(array[%L]::uuid[])$q$, p_stock);
  select count(*) filter (where pg_temp.as_role('anon', jsonb_build_object('role', 'anon'), x) like 'erro 42501: permission denied for function%')::text || '/' || count(*) into r from unnest(calls) x;
  out := out || pg_temp.expect('anon sem EXECUTE nas 9', r, '9/9');

  -- 10. Cascatas de SET NULL sobre a venda antiga fora da regra (entregue sem
  -- data, receita que é despesa, item acima do estoque): nada trava.
  r := pg_temp.as_user(a, format($q$with d as (delete from public.finance_store_customers where id = %L returning 1) select count(*)::text from d$q$, cust_leg));
  out := out || pg_temp.expect('apagar o cliente da venda legada', r, 'ok 1');
  r := pg_temp.as_user(a, format($q$with d as (delete from public.finance_accounts where id = %L returning 1) select count(*)::text from d$q$, acc_leg));
  out := out || pg_temp.expect('apagar a conta da venda legada', r, 'ok 1');
  r := pg_temp.as_user(a, format($q$with d as (delete from public.finance_transactions where id = %L returning 1) select count(*)::text from d$q$, tx_leg));
  out := out || pg_temp.expect('apagar a "receita" da venda legada', r, 'ok 1');
  r := pg_temp.as_user(a, format($q$with d as (delete from public.finance_store_products where id = %L returning 1) select count(*)::text from d$q$, p_leg));
  out := out || pg_temp.expect('apagar o produto do item legado', r, 'ok 1');
  -- O workspace só é apagado pelo leave_workspace da última pessoa (DEFINER,
  -- com o auth.uid() dela; a workspace_exit tirou a policy de DELETE): o mesmo
  -- DELETE como postgres, com os claims de A.
  r := pg_temp.try(jsonb_build_object('sub', a, 'role', 'authenticated'),
                   format($q$with d as (delete from public.finance_workspaces where id = %L returning 1) select count(*)::text from d$q$, ws2));
  out := out || pg_temp.expect('apagar o workspace da venda legada (como o leave_workspace da última pessoa)', r, 'ok 1');
  select format('%s %s %s %s %s %s %s', status, coalesce(sold_on::text, 'null'), customer_id is null, account_id is null, transaction_id is null, workspace_id is null,
                (select product_id is null and quantity = 3 from public.finance_store_sale_items where id = i_leg))
    into r from public.finance_store_sales where id = s_leg;
  out := out || pg_temp.expect('a venda legada continua como era, só com as referências nulas', r, 'delivered null t t t t t');
  -- O SET NULL de apagar o workspace chega à venda e ao item na ordem dos
  -- gatilhos de FK (no staging, a venda antes). O item legado do W5 numa
  -- venda do W recebe o SET NULL com a venda num workspace que existe: é a
  -- ordem "item primeiro", que a regra do item deixa passar.
  r := pg_temp.try(jsonb_build_object('sub', a, 'role', 'authenticated'),
                   format($q$with d as (delete from public.finance_workspaces where id = %L returning 1) select count(*)::text from d$q$, ws5));
  out := out || pg_temp.expect('apagar o W5: o SET NULL passa na venda e no item do W5, e no item legado do W5 numa venda do W',
                               r || ' ' || format('%s %s %s %s', (select workspace_id is null from public.finance_store_sales where id = s_ws5),
                                                  (select workspace_id is null from public.finance_store_sale_items where id = i_ws5),
                                                  (select workspace_id is null from public.finance_store_sale_items where id = i_ws5b),
                                                  (select workspace_id = ws from public.finance_store_sales where id = s_ws5b)),
                               'ok 1 t t t t');
  -- B sai do W (leave_workspace): primeiro as vendas de quem sai,
  -- depois só os itens dele nelas (o item de quem sai na venda de outra
  -- pessoa fica, e o ws_guard recusa realocar o item de outra pessoa na venda
  -- dele). Antes, A (membro do W) põe um item na venda de B pelo app: ele
  -- fica no W quando a venda vai para o privado, e segue a venda.
  r := pg_temp.as_user(a, format($q$select public.store_sale_items_add(%L, %L::jsonb)::text$q$, s_bw, jsonb_build_array(jsonb_build_object('product_id', p_pairs, 'unit_price', 20000))));
  select (e ->> 'id')::uuid into i_abw from jsonb_array_elements(pg_temp.res(r) -> 'items') e where e ->> 'user_id' = a::text;
  out := out || pg_temp.expect('A (membro) põe um item de 200,00 na venda de B no W', coalesce((select workspace_id = ws from public.finance_store_sale_items where id = i_abw)::text, r), 'true');
  r := pg_temp.as_user(b, $q$select public.leave_workspace()::text$q$);
  out := out || pg_temp.expect('B sai do W (leave_workspace)', r, 'ok ');
  out := out || pg_temp.expect('depois: a venda de B e o item dele no privado, o item de A ainda no W',
                               format('%s %s %s', (select workspace_id is null from public.finance_store_sales where id = s_bw),
                                      (select bool_and(workspace_id is null) from public.finance_store_sale_items where sale_id = s_bw and user_id = b),
                                      (select workspace_id = ws from public.finance_store_sale_items where id = i_abw)), 't t t');
  r := pg_temp.as_user(ug, format($q$select count(*)::text from public.finance_store_sale_items where id = %L$q$, i_abw))
       || ' ' || pg_temp.as_user(ug, format($q$with u as (update public.finance_store_sale_items set unit_price = 1, product_name = 'G' where id = %L returning 1) select count(*)::text from u$q$, i_abw))
       || ' ' || pg_temp.as_user(ug, format($q$with d as (delete from public.finance_store_sale_items where id = %L returning 1) select count(*)::text from d$q$, i_abw));
  out := out || pg_temp.expect('G (membro do W, não vê a venda privada de B) não lê, não altera nem apaga o item de A (UPDATE e DELETE diretos)', r, 'ok 0 ok 0 ok 0');
  r := pg_temp.as_user(a, format($q$select count(*)::text from public.finance_store_sale_items where id = %L$q$, i_abw))
       || ' ' || pg_temp.as_user(a, format($q$with u as (update public.finance_store_sale_items set unit_price = 1 where id = %L returning 1) select count(*)::text from u$q$, i_abw))
       || ' ' || pg_temp.as_user(a, format($q$with d as (delete from public.finance_store_sale_items where id = %L returning 1) select count(*)::text from d$q$, i_abw))
       || ' ' || pg_temp.as_user(a, format($q$select public.store_sale_items_update(%L, '{"unit_price": 1}')::text$q$, i_abw));
  out := out || pg_temp.expect('A, autora do item, sem acesso à venda: lê o item, mas não o altera nem o apaga (direto ou pela RPC)', r,
                               'ok 1 ok 0 ok 0 erro P0002: Venda não encontrada');
  r := pg_temp.as_user(b, format($q$select public.store_sale_items_update(%L, '{"unit_price": 21000}')::text$q$, i_abw));
  out := out || pg_temp.expect('B, dono da venda, vê os 2 itens e muda o de A pela RPC; o nome e o preço só mudaram por B',
                               pg_temp.or_err(format('%s %s', jsonb_array_length(pg_temp.res(r) -> 'items'),
                                                     (select product_name || ' ' || unit_price from public.finance_store_sale_items where id = i_abw)), r),
                               '2 Pares harness 21000');

  -- 11. Sem usuário (restore, cron) e JWT sem sub.
  sid := gen_random_uuid();
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.finance_store_sales (id, user_id, workspace_id, status, sold_on, transaction_id, updated_at)
    values (%L, %L, %L, 'delivered', %L, %L, '2020-01-02') returning (updated_at = '2020-01-02'::timestamptz)::text$q$, sid, a, ws, sp + 30, tx_a2));
  out := out || pg_temp.expect('service_role sem sub (restore): venda entregue com data futura e receita entra, com o updated_at do backup', r, 'ok true');
  r := pg_temp.try(jsonb_build_object('role', 'service_role'), format($q$insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name, quantity) values (%L, %L, %L, 'x', 99) returning 'ok'$q$, a, s_w, p_unique));
  out := out || pg_temp.expect('service_role: item acima do estoque entra (o restore não valida)', r, 'ok ok');
  r := pg_temp.try(null, format($q$update public.finance_store_sales set status = 'negotiating' where id = %L returning status$q$, sid));
  out := out || pg_temp.expect('sem claims (SQL pelo MCP): o salto passa', r, 'ok negotiating');
  r := pg_temp.as_role('authenticated', jsonb_build_object('role', 'authenticated'), format($q$insert into public.finance_store_sales (user_id) values (%L)$q$, a));
  out := out || pg_temp.expect('JWT authenticated sem sub continua conferido (RLS)', r, 'erro 42501%');

  -- 12. Compatibilidade: as gravações do front antigo, depois do apply.
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sales (customer_id, channel, shipping_method, tracking_code, expected_delivery_on,
    shipping_charged, shipping_cost, fees, account_id, notes, attachments, user_id, workspace_id)
    values (%L, 'olx', '', '', null, 0, 0, 0, %L, '', '[]', %L, %L) returning id::text$q$, cust_w, acc_w, a, ws));
  out := out || pg_temp.expect('front antigo: createSale', r, 'ok %');
  sid := substr(r, 4)::uuid;
  r := pg_temp.as_user(a, format($q$with i as (insert into public.finance_store_sale_items (sale_id, product_id, product_name, quantity, unit_price, unit_cost_at_sale, user_id, workspace_id)
    values (%1$L, %2$L, 'Compat harness', 1, 20000, 15000, %3$L, null), (%1$L, %2$L, 'Compat harness', 1, 20000, 15000, %3$L, null) returning workspace_id)
    select count(*) filter (where workspace_id = %4$L)::text from i$q$, sid, p_compat, a, ws));
  out := out || pg_temp.expect('front antigo: addSaleItems em lote com o workspace do painel (o item herda o da venda)', r, 'ok 2');
  r := pg_temp.as_user(a, format($q$insert into public.finance_transactions (user_id, account_id, category_id, type, amount, description, date, shared_with_user_id, workspace_id)
    values (%L, %L, null, 'income', 40000, 'Venda', %L, null, null) returning id::text$q$, a, acc_w, sp));
  out := out || pg_temp.expect('front antigo: setSaleStatus vendida com receita, 1º o insert da receita (no workspace do painel)', r, 'ok %');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales s set status = 'sold', sold_on = %L, delivered_on = null, transaction_id = %L, updated_at = '2000-01-01'
     where s.id = %L returning (s.updated_at = now())::text$q$, sp, substr(r, 4), sid));
  out := out || pg_temp.expect('front antigo: depois o update da venda (o updated_at do aparelho vira o do servidor)', r, 'ok true');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sale_items set unit_price = 21000, updated_at = '2000-01-01' where sale_id = %L returning 'ok'$q$, sid));
  out := out || pg_temp.expect('front antigo: updateSaleItem com touch()', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$update public.finance_transactions set amount = 42000, date = %L where id = (select transaction_id from public.finance_store_sales where id = %L) returning 'ok'$q$, sp, sid));
  out := out || pg_temp.expect('front antigo: syncSaleTx', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set notes = 'x', sold_on = %L, updated_at = '2000-01-01' where id = %L returning 'ok'$q$, sp - 1, sid));
  out := out || pg_temp.expect('front antigo: updateSale', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$delete from public.finance_transactions where id = (select transaction_id from public.finance_store_sales where id = %L) returning 'ok'$q$, sid));
  out := out || pg_temp.expect('front antigo: reabrir, 1º apaga a receita', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = 'negotiating', sold_on = null, delivered_on = null, transaction_id = null, updated_at = '2000-01-01'
     where id = %L returning status$q$, sid));
  out := out || pg_temp.expect('front antigo: reabrir, depois o update', r, 'ok negotiating');
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales set status = 'sold', sold_on = %L, delivered_on = null where id = %L returning status$q$, sp, sid));
  out := out || pg_temp.expect('front antigo: vendida sem receita', r, 'ok sold');
  r := pg_temp.as_user(a, format($q$insert into public.finance_transactions (user_id, account_id, category_id, type, amount, description, date, shared_with_user_id, workspace_id)
    values (%L, %L, null, 'income', 42000, 'Venda', %L, null, %L) returning id::text$q$, a, acc_w, sp, ws));
  r := pg_temp.as_user(a, format($q$update public.finance_store_sales s set transaction_id = %L, updated_at = '2000-01-01' where s.id = %L returning 'ok'$q$, substr(r, 4), sid));
  out := out || pg_temp.expect('front antigo: generateSaleIncome (insert da receita e depois o update)', r, 'ok ok');
  r := pg_temp.as_user(a, format($q$with i as (delete from public.finance_store_sale_items where sale_id = %L and unit_price = 21000 returning 1) select count(*)::text from i$q$, sid));
  out := out || pg_temp.expect('front antigo: removeSaleItem', r, 'ok 2');
  select transaction_id::text into x0 from public.finance_store_sales where id = sid;
  r := pg_temp.as_user(a, format($q$delete from public.finance_store_sales where id = %L returning 'ok'$q$, sid));
  r := r || ' ' || pg_temp.as_user(a, format($q$delete from public.finance_transactions where id = %L returning 'ok'$q$, x0));
  out := out || pg_temp.expect('front antigo: deleteSale (a linha e depois a receita)', r, 'ok ok ok ok');
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sales (user_id, workspace_id) values (%L, %L) returning id::text$q$, a, ws));
  sid := substr(r, 4)::uuid;
  r := pg_temp.as_user(a, format($q$insert into public.finance_store_sale_items (sale_id, product_id, product_name, quantity, user_id) values (%L, %L, 'Compat harness', 4, %L)$q$, sid, p_compat, a));
  out := out || pg_temp.expect('janela: createSale passa e o addSaleItems acima do estoque é recusado (fica a venda vazia)',
                               r || ' / vazia: ' || (select count(*) from public.finance_store_sales s where s.id = sid
                                                     and not exists (select 1 from public.finance_store_sale_items i where i.sale_id = s.id)),
                               'erro P0001: Estoque insuficiente: Compat harness tem 3 disponível(is) / vazia: 1');

  -- 13. Estrutura e grants.
  select format('%s %s %s %s %s %s',
                count(*),
                count(*) filter (where not p.prosecdef and p.proconfig = array['search_path=""']),
                count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')),
                count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE')),
                count(*) filter (where exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g where g.grantee = 0)),
                count(*) filter (where obj_description(p.oid, 'pg_proc') like 'API-028%'))
    into r
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'store\_%';
  out := out || pg_temp.expect('9 funções store_* em public: INVOKER, search_path vazio, anon 0, authenticated 9, PUBLIC 0, COMMENT 9', r, '9 9 0 9 0 9');
  select format('%s %s %s', count(*), count(*) filter (where p.prosecdef),
                count(*) filter (where has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE')
                                    or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g where g.grantee = 0)))
    into r
    from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname like 'store\_%';
  out := out || pg_temp.expect('5 funções em private (2 gatilhos DEFINER), sem EXECUTE para clientes', r, '5 2 0');
  select string_agg(tgname, ', ' order by tgname collate "C") into r from pg_trigger
   where not tgisinternal and tgrelid::regclass::text like '%finance_store_%' and tgname not like 'trg\_%';
  out := out || pg_temp.expect('gatilhos novos', r, 'finance_store_customers_updated_at, finance_store_products_updated_at, finance_store_purchases_updated_at, '
                                                    'finance_store_sale_items_rules, finance_store_sale_items_updated_at, finance_store_sales_rules, finance_store_sales_updated_at');
  select count(*)::text into r from pg_constraint where conname like 'finance\_store\_%\_money\_nonneg' and contype = 'c';
  out := out || pg_temp.expect('4 CHECKs de dinheiro', r, '4');
  select format('%s %s %s %s %s %s',
                count(*) filter (where cmd in ('SELECT', 'UPDATE', 'DELETE') and qual like '%EXISTS%finance_store_sales s%finance_store_sale_items.sale_id%'),
                count(*) filter (where cmd = 'UPDATE' and with_check like '%EXISTS%finance_store_sales s%finance_store_sale_items.sale_id%'),
                count(*) filter (where cmd = 'INSERT' and with_check = '(user_id = ( SELECT auth.uid() AS uid))'),
                count(*) filter (where cmd = 'SELECT' and qual like '(%user_id = ( SELECT auth.uid() AS uid)%'),
                count(*) filter (where cmd in ('UPDATE', 'DELETE') and (qual like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')),
                count(*) filter (where cmd <> 'INSERT' and (qual like '%is_workspace_member%' or coalesce(with_check, '') like '%is_workspace_member%')))
    into r
    from pg_policies where schemaname = 'public' and tablename = 'finance_store_sale_items';
  out := out || pg_temp.expect('policies de item: o item segue a venda (SELECT: o dono do item ou a venda visível; UPDATE, com o WITH CHECK, e DELETE: só a venda visível; nenhuma pelo workspace do item); INSERT só em nome próprio',
                               r, '3 1 1 1 0 0');
  select count(*)::text into r from pg_proc where pronamespace = 'public'::regnamespace and prosecdef and has_function_privilege('authenticated', oid, 'execute');
  out := out || pg_temp.expect('as funções DEFINER de public para authenticated continuam 29 (sec012, depois da remoção da API v1)', r, '29');

  raise exception using message = format(E'API-028 bloco 1: vendas da Loja (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco1$;

do $bloco2$
declare
  a uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  acc uuid := gen_random_uuid();
  cust uuid := gen_random_uuid();
  p uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  tx uuid := gen_random_uuid();
  tag text := substr(md5(random()::text), 1, 6);
  sp date := (now() at time zone 'America/Sao_Paulo')::date;
  payload jsonb;
  summary jsonb;
  r text;
  out text[] := array[]::text[];
begin
  if coalesce(current_setting('akool.api028_full_restore', true), '') <> 'staging' then
    raise exception 'API-028 bloco 2: só no staging, com set_config(''akool.api028_full_restore'', ''staging'', false) na mesma sessão';
  end if;

  create function pg_temp.expect(p_label text, p_got text, p_like text)
  returns text
  language sql
  as $f$
    select format('%s %s → %s', case when p_got like p_like then 'ok   ' else 'FALHA' end, p_label, left(p_got, 200))
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
    perform set_config('request.jwt.claims', '', true);
    return 'ok ' || coalesce(v_res, '');
  exception when others then
    return format('erro %s: %s', sqlstate, sqlerrm);
  end;
  $f$;

  -- Uma venda entregue com receita no workspace e uma antiga fora da regra
  -- (vendida sem data, 2 unidades de um produto com 1 comprada), com os
  -- updated_at do backup.
  set local session_replication_role = replica;
  insert into auth.users (id, email) values (a, format('api028-r-%s@example.invalid', tag));
  insert into public.profiles (id, email, display_name, role, is_active, invite_slots_remaining) values
    (a, format('api028-r-%s@example.invalid', tag), 'R', 'standard', true, 0);
  insert into public.finance_workspaces (id, name, owner_id) values (ws, 'api028 restore', a);
  insert into public.finance_workspace_members (workspace_id, user_id, role) values (ws, a, 'owner');
  insert into public.finance_accounts (id, user_id, workspace_id, name, type) values (acc, a, ws, 'R', 'checking');
  insert into public.finance_transactions (id, user_id, workspace_id, type, amount, description, date, account_id) values
    (tx, a, ws, 'income', 30000, 'Venda: restore', sp - 10, acc);
  insert into public.finance_store_customers (id, user_id, workspace_id, name, updated_at) values (cust, a, ws, 'Cliente R', '2020-01-01');
  insert into public.finance_store_products (id, user_id, workspace_id, kind, name, target_price, updated_at) values (p, a, ws, 'stock', 'Restore', 30000, '2020-01-01');
  insert into public.finance_store_purchases (user_id, workspace_id, product_id, quantity, unit_cost, other_costs, date, status, updated_at) values
    (a, ws, p, 1, 10000, 0, '2026-09-01', 'received', '2020-01-01');
  insert into public.finance_store_sales (id, user_id, workspace_id, customer_id, status, sold_on, delivered_on, account_id, transaction_id, updated_at) values
    (s1, a, ws, cust, 'delivered', sp - 10, sp - 5, acc, tx, '2020-01-03'),
    (s2, a, ws, null, 'sold', null, null, null, null, '2020-01-04');
  insert into public.finance_store_sale_items (user_id, workspace_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost_at_sale, updated_at) values
    (a, ws, s1, p, 'Restore', 1, 30000, 10000, '2020-01-05'),
    (a, ws, s2, p, 'Restore', 2, 30000, 10000, '2020-01-06');
  set local session_replication_role = origin;

  payload := jsonb_build_object(
    'profiles', (select jsonb_agg(to_jsonb(t)) from public.profiles t where t.id = a),
    'finance_workspaces', (select jsonb_agg(to_jsonb(t)) from public.finance_workspaces t where t.id = ws),
    'finance_workspace_members', (select jsonb_agg(to_jsonb(t)) from public.finance_workspace_members t where t.workspace_id = ws),
    'finance_accounts', (select jsonb_agg(to_jsonb(t)) from public.finance_accounts t where t.id = acc),
    'finance_transactions', (select jsonb_agg(to_jsonb(t)) from public.finance_transactions t where t.id = tx),
    'finance_store_customers', (select jsonb_agg(to_jsonb(t)) from public.finance_store_customers t where t.id = cust),
    'finance_store_products', (select jsonb_agg(to_jsonb(t)) from public.finance_store_products t where t.id = p),
    'finance_store_purchases', (select jsonb_agg(to_jsonb(t)) from public.finance_store_purchases t where t.product_id = p),
    'finance_store_sales', (select jsonb_agg(to_jsonb(t)) from public.finance_store_sales t where t.id in (s1, s2)),
    'finance_store_sale_items', (select jsonb_agg(to_jsonb(t)) from public.finance_store_sale_items t where t.sale_id in (s1, s2))
  );

  -- Como a edge function site-backup chama: service_role, sem usuário.
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin
    summary := public.restore_site_backup(payload);
    out := out || pg_temp.expect('restauração conclui (vendas, itens, compras, produtos, clientes)',
                                 format('%s %s %s %s %s', summary ->> 'finance_store_sales', summary ->> 'finance_store_sale_items', summary ->> 'finance_store_purchases',
                                        summary ->> 'finance_store_products', summary ->> 'finance_store_customers'), '2 2 1 1 1');
    select format('%s %s %s %s', s.status, s.transaction_id = tx, s.delivered_on = sp - 5, s.updated_at = '2020-01-03'::timestamptz) into r
      from public.finance_store_sales s where s.id = s1;
    out := out || pg_temp.expect('venda entregue volta com a receita, as datas e o updated_at do backup', r, 'delivered t t t');
    select format('%s %s %s', s.status, coalesce(s.sold_on::text, 'null'), (select sum(quantity) from public.finance_store_sale_items i where i.sale_id = s2)) into r
      from public.finance_store_sales s where s.id = s2;
    out := out || pg_temp.expect('venda antiga fora da regra volta igual (vendida sem data, 2 unidades com 1 comprada)', r, 'sold null 2');
    select format('%s %s %s', (select updated_at = '2020-01-05'::timestamptz from public.finance_store_sale_items where sale_id = s1),
                  (select updated_at = '2020-01-01'::timestamptz from public.finance_store_products where id = p),
                  (select updated_at = '2020-01-01'::timestamptz from public.finance_store_customers where id = cust)) into r;
    out := out || pg_temp.expect('itens, produto e cliente com o updated_at do backup', r, 't t t');
  exception when others then
    out := out || format('FALHA restauração → erro %s: %s', sqlstate, sqlerrm);
  end;
  perform set_config('request.jwt.claims', '', true);

  -- Depois do restore, a dona opera pelas RPCs.
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped')::text$q$, s1));
  out := out || pg_temp.expect('depois do restore: volta a entregue para enviada pela RPC', coalesce((r::text like 'ok {%' and substr(r, 4)::jsonb -> 'sale' ->> 'status' = 'shipped')::text, r), 'true');
  r := pg_temp.as_user(a, format($q$select public.store_sale_update(%L, '{"fees": 1000}')::text$q$, s1));
  out := out || pg_temp.expect('depois do restore: a receita restaurada acompanha a taxa', coalesce((substr(r, 4)::jsonb -> 'transaction' ->> 'amount')::numeric::bigint::text, r), '29000');
  r := pg_temp.as_user(a, format($q$select public.store_sale_set_status(%L, 'shipped')::text$q$, s2));
  out := out || pg_temp.expect('a venda antiga sem data não avança sem a data (regra quando o status muda)', r, 'erro 22023: Venda vendida, enviada ou entregue precisa da data da venda');

  raise exception using message = format(E'API-028 bloco 2: restauração no staging (tudo desfeito)\n%s\n%s/%s ok', array_to_string(out, E'\n'),
                                         (select count(*) from unnest(out) l where l like 'ok%'), cardinality(out));
end
$bloco2$;
