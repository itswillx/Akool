-- API-028: vendas da Loja no servidor. O banco passa a garantir o que só o
-- navegador fazia (e nem tudo), e a venda com a receita vinculada vira uma
-- transação só, por RPC. Compras e produtos ficam para o API-037 (decisão do
-- usuário, 12/10).
--
-- Antes (reproduzido no staging, 12/10/2026, gravando direto nas tabelas como
-- authenticated):
--   * dinheiro sem CHECK: taxa, frete, preço e custo negativos entravam;
--   * a máquina de estados (saleTransitions.ts) só existia no navegador: venda
--     nova já "delivered" sem data, salto de negociando para entregue;
--   * o estoque só era conferido no seletor do modal: 3 unidades de um item
--     único com 1 em estoque, e reabrir uma cancelada cuja unidade já tinha
--     saído deixava o disponível negativo;
--   * nada conferia os ids referenciados (o FK ignora o RLS): um membro do
--     workspace punha item na venda PRIVADA de outra pessoa e apontava a conta
--     de alguém de fora, e o cliente e a receita privados da dona;
--   * a receita vinculada era criada, ressincronizada e apagada pelo navegador
--     em passos soltos, sem conferir as linhas afetadas (um DELETE barrado pelo
--     RLS devolvia 0 linhas sem erro), no workspace do painel e não no da venda;
--   * updated_at vinha do relógio do aparelho (touch()).
--
-- Depois:
--   * CHECK de dinheiro >= 0 nas 4 tabelas com valores
--     (finance_store_<t>_money_nonneg). Vale também sem usuário (restore). O
--     teto de 1e12 centavos fica só nas RPCs;
--   * updated_at do servidor (public.update_updated_at) em UPDATE nas 5
--     tabelas da Loja. O INSERT do restore guarda o valor do backup;
--   * public.store_product_figures(uuid[]) (SQL, INVOKER): comprado, vendido,
--     reservado, disponível e custo médio, a mesma conta do financeStoreCalc do
--     app (supabase/functions/_domain/fixtures/storeParity.json prende os dois);
--   * gatilhos SECURITY DEFINER em private, com predicado explícito (dono ou
--     membro do workspace, a mesma regra do RLS; P0002 igual para "não existe"
--     e "é de outra pessoa"). DEFINER porque o estoque é global: um INVOKER só
--     somaria as linhas visíveis, e B (membro) vende o produto do workspace
--     numa venda PRIVADA dele, invisível para A;
--       - private.store_sale_rules (venda): INSERT só em negociação, sem datas
--         nem receita; status só nos 10 pares de _domain/saleTransitions.ts,
--         com os carimbos de data; negociando ou cancelada com receita é
--         recusado; reabrir uma cancelada confere o estoque; sold_on
--         obrigatório na venda consumida e até amanhã em São Paulo;
--         delivered_on só na entregue, até amanhã em São Paulo e não antes do
--         sold_on (também quando é o sold_on que muda); cliente, conta e
--         receita do escopo do DONO da venda (e visíveis para quem grava);
--         receita só income e sem outro vínculo; trocar a receita por outra
--         dá P0001;
--       - private.store_sale_item_rules (item): o item não muda de venda nem
--         sai do workspace da venda; venda e produto visíveis e travados; o
--         item herda o workspace da venda se quem grava é membro; item único
--         vende 1; produto arquivado não entra; estoque global; nome em branco
--         vem do produto;
--   * o item segue a venda: nas policies de finance_store_sale_items, o
--     SELECT vale para o dono do item ou para quem vê a venda, e o UPDATE e o
--     DELETE só para quem vê a venda (sai o "membro do workspace do item").
--     Antes, uma venda visível podia ter itens invisíveis para quem a via (o
--     item de B na venda da A, depois que a A sai ou é removida do
--     workspace), e o líquido das RPCs, que são INVOKER, mudava conforme quem
--     chamava; e a venda que saía do workspace deixava no W o item de outra
--     pessoa, que os membros sem acesso à venda liam, repreçavam e apagavam;
--   * 8 RPCs SECURITY INVOKER (search_path vazio, só authenticated):
--     store_sale_create, store_sale_set_status, store_sale_update,
--     store_sale_items_add, store_sale_items_update, store_sale_items_remove,
--     store_sale_generate_income e store_sale_delete. A receita nasce no
--     workspace da venda quando quem chama é membro, acompanha valor, data e
--     conta da venda, e líquido <= 0 com receita é recusado. A receita de
--     outra pessoa (invisível para quem chama) só barra a chamada que muda o
--     que ela leva (líquido, data ou conta) ou que a apaga: editar uma nota
--     passa.
--
-- Regra dos gatilhos (docs/api-arquitetura.md §1.5): sem usuário (restore,
-- cron, SQL pelo MCP) pulam; com usuário validam só o que mudou. As regras
-- "sempre" (sold_on obrigatório, até amanhã, negociando sem data) só disparam
-- quando status ou sold_on mudam, e as da data de entrega quando status ou
-- delivered_on mudam (a de não ser antes da venda, também quando o sold_on
-- muda): as cascatas de SET NULL (apagar conta, cliente,
-- transação, produto ou workspace) disparam os gatilhos com o auth.uid() de
-- quem apagou e não podem travar numa venda antiga fora da regra. O mesmo
-- vale para o UPDATE de workspace_id que o card "Sair do workspace leva as
-- linhas da Loja" fará no leave_workspace, com uma ordem: primeiro as vendas
-- de quem sai, depois só os itens DELE nelas (where user_id = quem sai: com o
-- auth.uid() de quem sai, o ws_guard recusa realocar a linha de outra pessoa
-- com 42501). O item de outra pessoa na venda de quem sai fica com o
-- workspace antigo, mas segue a venda: só quem a vê o lê, altera e apaga, e o
-- autor do item ainda o lê. O item de quem sai que está na venda de outra
-- pessoa fica no workspace da venda (o gatilho recusa tirá-lo); quem vê a
-- venda continua vendo o item.
--
-- Erros (hint akool, menos o 42501 "not authenticated"): P0002 para venda,
-- item, produto, cliente, conta, categoria ou receita inexistente ou de outra
-- pessoa; 22023 para entrada inválida, sold_on ou delivered_on fora da regra,
-- item fora do workspace da venda, item único com mais de 1, produto
-- arquivado e líquido <= 0 com receita; P0001 para status
-- fora da máquina, estoque insuficiente, receita a remover antes de reabrir ou
-- cancelar, venda que já tem receita e receita em venda não vendida; 42501
-- quando a receita vinculada é de outra pessoa (apagar ou ressincronizar
-- devolveu 0 linhas: o RLS de finance_transactions barrou; a mensagem diz que
-- quem lançou a receita é quem a altera ou apaga, em Transações); 23514 dos
-- CHECKs.
-- Nos lotes de itens, o erro sai como "items/N: <mensagem>" (N a partir de 0)
-- com o SQLSTATE de origem, num BEGIN … EXCEPTION só (uma subtransação).
--
-- Grants: EXECUTE das 9 funções de public só para authenticated (o akool_api
-- herda pela §1.2). Nenhuma é DEFINER: o supabase/checks/sec012-grants.sql
-- continua com 40. As 5 de private não têm EXECUTE para clientes.
--
-- Levantamento na produção (12/10/2026, só contagens): 0 vendas, 1 produto, 1
-- compra e 1 cliente; nenhum valor negativo ou acima de 1e12, nenhum estado
-- inválido, nenhuma receita fora da regra, nenhuma referência fora do escopo,
-- nenhuma linha de quem saiu de workspace. Tudo 0: os CHECKs entram sem
-- conserto. O bloco 1 de supabase/checks/api028-store-sales.sql repete as
-- contagens (no staging, 0 linhas).
--
-- Riscos registrados:
--   * Ordem: aplicar depois da 20261005150000_api006 (guard sem usuário), já em
--     produção. O front do API-028 chama as RPCs: a migration vai antes do
--     merge (a cadeia 012 → 013 → 016 → 021 → 024 → 028).
--   * Janela entre o apply e o merge: os gatilhos valem para o front antigo,
--     que continua compatível (o harness repete as gravações dele), mas passa
--     a receber erro em: valor negativo digitado (23514), sold_on apagado na
--     venda vendida, venda acima do estoque com duas abas (o createSale passa e
--     o addSaleItems recusa: fica uma venda vazia no quadro), reabrir
--     cancelada sem estoque, data de venda depois de amanhã e receita com
--     líquido <= 0 (a CHECK amount > 0 de finance_transactions já recusava).
--   * Compras e produtos continuam gravados direto pelo app até o API-037,
--     então o 23514 do valor negativo vale para eles também depois do merge
--     (não só na janela). O front deste card desliga o Salvar com valor
--     negativo, desfaz a despesa lançada quando a compra é recusada e traduz o
--     erro; a compra com a despesa numa transação só é do API-037.
--   * CHECK e restore: um backup com valor negativo deixa de restaurar inteiro.
--     O levantamento deu 0, mas restore points antigos podem ter negativos.
--   * Deadlock: as RPCs travam a venda e depois os produtos em ordem de id; o
--     INSERT em lote do front antigo trava produto por linha, na ordem do
--     array. Um 40P01 é raro e vira 503 com retry na API.
--   * Limites: amount numeric(15,2) de finance_transactions estoura em 1e13
--     centavos, e quantity × preço é conferido só pelos tetos das RPCs (1e6
--     unidades, 1e12 centavos). Passar disso dá 22003 sem mensagem amigável.
--   * API-022 (RESTRICTIVE): as RPCs são INVOKER, então cancelar, reabrir e
--     excluir apagam uma linha de finance_transactions com o RLS de quem chama.
--     Com "DELETE exige Excluir", o token precisaria de financas.transacoes
--     com Excluir, contra a §7, que pede Escrever: a exceção para a receita
--     vinculada a uma venda é decisão do API-022. Apontar a conta e a
--     categoria exige ler financas.contas e financas.categorias.
--   * API-025 (lixeira): o api_undo_call reinsere como o usuário, e as regras
--     de INSERT recusam venda fora de negociação ou com data/receita, e o item
--     passa de novo pelo estoque. Desfazer a exclusão de uma venda vendida não
--     é suportado; desfazer uma chamada que apagou a receita a reinsere
--     desvinculada. O API-025 decide (por exemplo, um GUC ligado só por ele).
--   * API-048 (Loja leitura): store_product_figures é a base dos números; o
--     líquido e o lucro da venda ficam nos testes de _domain e no harness.
--   * API-052 (Loja escrita): versão otimista na venda (p_expected_updated_at)
--     fica para lá. A cascata SET NULL de uma receita apagada em Transações
--     também muda o updated_at da venda.
--   * Mudar uma assinatura depois exige DROP e CREATE e recarga do cache do
--     PostgREST. Finanças não está no realtime: outra aba só vê depois de
--     recarregar.

-- ---------------------------------------------------------------------------
-- 1. Dinheiro >= 0
-- ---------------------------------------------------------------------------

alter table public.finance_store_products
  add constraint finance_store_products_money_nonneg check (target_price >= 0);
alter table public.finance_store_purchases
  add constraint finance_store_purchases_money_nonneg check (unit_cost >= 0 and other_costs >= 0);
alter table public.finance_store_sales
  add constraint finance_store_sales_money_nonneg check (shipping_charged >= 0 and shipping_cost >= 0 and fees >= 0);
alter table public.finance_store_sale_items
  add constraint finance_store_sale_items_money_nonneg check (unit_price >= 0 and unit_cost_at_sale >= 0);

-- ---------------------------------------------------------------------------
-- 2. updated_at do servidor (só UPDATE: o INSERT do restore guarda o valor)
-- ---------------------------------------------------------------------------

create trigger finance_store_products_updated_at before update on public.finance_store_products
  for each row execute function public.update_updated_at();
create trigger finance_store_purchases_updated_at before update on public.finance_store_purchases
  for each row execute function public.update_updated_at();
create trigger finance_store_customers_updated_at before update on public.finance_store_customers
  for each row execute function public.update_updated_at();
create trigger finance_store_sales_updated_at before update on public.finance_store_sales
  for each row execute function public.update_updated_at();
create trigger finance_store_sale_items_updated_at before update on public.finance_store_sale_items
  for each row execute function public.update_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Números do produto (INVOKER: a conta da tela, sobre as linhas visíveis)
-- ---------------------------------------------------------------------------

-- O productStock e o averageUnitCost de _domain/financeStoreCalc.ts. Cotação
-- fica fora; vendido conta as vendas sold, shipped e delivered; reservado, as
-- em negociação; cancelada devolve. O custo médio é div(2t + q, 2q) em
-- numeric, o Math.round(t / q) do app para t >= 0 (o CHECK garante). Só os
-- produtos que quem chama enxerga, um por linha, em ordem de id.
create function public.store_product_figures(p_products uuid[])
returns table (product_id uuid, purchased bigint, sold bigint, reserved bigint, available bigint, avg_unit_cost bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select pr.id from public.finance_store_products pr where pr.id = any (p_products)
  ), bought as (
    select pu.product_id, sum(pu.quantity)::bigint as q, sum(pu.quantity::numeric * pu.unit_cost + pu.other_costs) as t
      from public.finance_store_purchases pu
     where pu.product_id in (select p.id from p) and pu.status <> 'quoting'
     group by pu.product_id
  ), moved as (
    select i.product_id,
           coalesce(sum(i.quantity) filter (where s.status in ('sold', 'shipped', 'delivered')), 0)::bigint as sold,
           coalesce(sum(i.quantity) filter (where s.status = 'negotiating'), 0)::bigint as reserved
      from public.finance_store_sale_items i
      join public.finance_store_sales s on s.id = i.sale_id
     where i.product_id in (select p.id from p)
     group by i.product_id
  )
  select p.id,
         coalesce(b.q, 0),
         coalesce(m.sold, 0),
         coalesce(m.reserved, 0),
         coalesce(b.q, 0) - coalesce(m.sold, 0) - coalesce(m.reserved, 0),
         case when coalesce(b.q, 0) > 0 then div(2 * b.t + b.q, 2 * b.q)::bigint else 0 end
    from p
    left join bought b on b.product_id = p.id
    left join moved m on m.product_id = p.id
   order by p.id
$$;

revoke execute on function public.store_product_figures(uuid[]) from public, anon;
grant execute on function public.store_product_figures(uuid[]) to authenticated;
comment on function public.store_product_figures(uuid[]) is
  'API-028: comprado (sem cotação), vendido (sold, shipped, delivered), reservado (negotiating), disponível e custo médio (Math.round do app, em inteiro) de cada produto que quem chama enxerga, sobre as linhas visíveis (INVOKER), como a tela. Base do API-048.';

-- ---------------------------------------------------------------------------
-- 4. Ajudantes dos gatilhos (private, sem EXECUTE para clientes)
-- ---------------------------------------------------------------------------

-- O predicado do RLS da Loja: dono da linha ou membro do workspace dela.
create function private.store_visible(p_user uuid, p_workspace uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_user = auth.uid() or (p_workspace is not null and public.is_workspace_member(p_workspace)), false)
$$;

-- Referência da venda (cliente, conta, receita): visível para quem grava e do
-- escopo do dono da venda (dele, ou de um workspace de que ele é membro). Sem
-- a 2ª parte, B poria o cliente privado dele na venda do workspace da A, que
-- ficaria com um id que não abre.
create function private.store_ref_ok(p_ref_user uuid, p_ref_workspace uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(private.store_visible(p_ref_user, p_ref_workspace)
                  and (p_ref_user = p_owner
                       or (p_ref_workspace is not null
                           and exists (select 1 from public.finance_workspace_members m
                                        where m.workspace_id = p_ref_workspace and m.user_id = p_owner))), false)
$$;

-- Estoque GLOBAL do produto: comprado (sem cotação) menos os itens das vendas
-- não canceladas, de qualquer dono. Só roda dentro dos gatilhos DEFINER, que
-- enxergam todas as linhas. Um BEFORE ROW vê as linhas anteriores do mesmo
-- INSERT de várias linhas, então o lote também é conferido.
create function private.store_product_available(p_product uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(pu.quantity) from public.finance_store_purchases pu
                    where pu.product_id = p_product and pu.status <> 'quoting'), 0)::bigint
       - coalesce((select sum(i.quantity) from public.finance_store_sale_items i
                     join public.finance_store_sales s on s.id = i.sale_id
                    where i.product_id = p_product and s.status <> 'cancelled'), 0)::bigint
$$;

revoke execute on function private.store_visible(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.store_ref_ok(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.store_product_available(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Gatilho da venda (BEFORE INSERT OR UPDATE)
-- ---------------------------------------------------------------------------

create function private.store_sale_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sp      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_owner   boolean := tg_op = 'UPDATE' and new.user_id is distinct from old.user_id;
  v_status  boolean := tg_op = 'UPDATE' and new.status is distinct from old.status;
  v_pid     uuid;
  v_need    bigint;
  v_avail   bigint;
  v_name    text;
  v_tx      record;
begin
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'negotiating' then
      raise exception 'Venda nova começa em negociação: avance o status depois (store_sale_set_status)'
        using errcode = '22023', hint = 'akool';
    end if;
    if new.sold_on is not null or new.delivered_on is not null or new.transaction_id is not null then
      raise exception 'Venda nova não tem data de venda, data de entrega nem receita' using errcode = '22023', hint = 'akool';
    end if;
  end if;

  if v_status then
    if (old.status, new.status) not in (('negotiating', 'sold'), ('sold', 'shipped'), ('shipped', 'delivered'),
                                         ('sold', 'negotiating'), ('shipped', 'sold'), ('delivered', 'shipped'),
                                         ('cancelled', 'negotiating'),
                                         ('negotiating', 'cancelled'), ('sold', 'cancelled'), ('shipped', 'cancelled')) then
      raise exception 'Mudança de status não permitida: % → %', old.status, new.status using errcode = 'P0001', hint = 'akool';
    end if;
    -- Carimbos: sold guarda a data (a que veio, a que já tinha ou hoje em São
    -- Paulo); só delivered tem data de entrega; negociação não tem data; a
    -- cancelada guarda as datas.
    if new.status = 'sold' then
      new.sold_on := coalesce(new.sold_on, old.sold_on, v_sp);
      new.delivered_on := null;
    elsif new.status = 'shipped' then
      new.delivered_on := null;
    elsif new.status = 'delivered' then
      new.delivered_on := coalesce(new.delivered_on, v_sp);
    elsif new.status = 'negotiating' then
      new.sold_on := null;
      new.delivered_on := null;
    end if;
    if new.status in ('negotiating', 'cancelled') and new.transaction_id is not null then
      raise exception 'Remova a receita vinculada antes de reabrir ou cancelar a venda' using errcode = 'P0001', hint = 'akool';
    end if;
    -- Reabrir uma cancelada devolve as unidades à venda: confere o estoque de
    -- cada produto (a venda ainda está cancelada na tabela, então não conta).
    if old.status = 'cancelled' then
      for v_pid, v_need in
        select i.product_id, sum(i.quantity)::bigint
          from public.finance_store_sale_items i
         where i.sale_id = new.id and i.product_id is not null
         group by i.product_id
         order by i.product_id
      loop
        select pr.name into v_name from public.finance_store_products pr where pr.id = v_pid for no key update;
        v_avail := private.store_product_available(v_pid);
        if v_need > v_avail then
          raise exception 'Estoque insuficiente para reabrir: % tem % disponível(is), a venda pede %', v_name, greatest(v_avail, 0), v_need
            using errcode = 'P0001', hint = 'akool';
        end if;
      end loop;
    end if;
  end if;

  -- Regras "sempre", só quando status ou data mudam: uma cascata de SET NULL
  -- numa venda antiga fora da regra não pode travar.
  if v_status or (tg_op = 'UPDATE' and new.sold_on is distinct from old.sold_on) then
    if new.status in ('sold', 'shipped', 'delivered') and new.sold_on is null then
      raise exception 'Venda vendida, enviada ou entregue precisa da data da venda' using errcode = '22023', hint = 'akool';
    end if;
    if new.status = 'negotiating' and new.sold_on is not null then
      raise exception 'Venda em negociação não tem data de venda' using errcode = '22023', hint = 'akool';
    end if;
    if new.sold_on is not null and (not isfinite(new.sold_on) or new.sold_on > v_sp + 1) then
      raise exception 'A data da venda (%) passa de amanhã em São Paulo (%)', new.sold_on, v_sp + 1
        using errcode = '22023', hint = 'akool';
    end if;
  end if;
  -- A data de entrega, quando ela ou o status mudam: só a venda entregue tem,
  -- finita e até amanhã em São Paulo (o carimbo da transição também passa por
  -- aqui).
  if v_status or (tg_op = 'UPDATE' and new.delivered_on is distinct from old.delivered_on) then
    if new.delivered_on is not null and new.status is distinct from 'delivered' then
      raise exception 'Só venda entregue tem data de entrega' using errcode = '22023', hint = 'akool';
    end if;
    if new.delivered_on is not null and (not isfinite(new.delivered_on) or new.delivered_on > v_sp + 1) then
      raise exception 'A data de entrega (%) passa de amanhã em São Paulo (%)', new.delivered_on, v_sp + 1
        using errcode = '22023', hint = 'akool';
    end if;
  end if;
  -- A entrega não é antes da venda, quando qualquer das duas datas ou o status
  -- mudam: numa entregue, levar o sold_on para depois da entrega também é
  -- recusado.
  if (v_status or (tg_op = 'UPDATE' and (new.delivered_on is distinct from old.delivered_on
                                          or new.sold_on is distinct from old.sold_on)))
     and new.delivered_on < new.sold_on then
    raise exception 'A data de entrega (%) é anterior à data da venda (%)', new.delivered_on, new.sold_on
      using errcode = '22023', hint = 'akool';
  end if;

  -- Referências: só a que mudou (ou todas, se o dono mudou), e nunca a nula.
  if new.customer_id is not null and (tg_op = 'INSERT' or v_owner or new.customer_id is distinct from old.customer_id) then
    if not exists (select 1 from public.finance_store_customers c
                    where c.id = new.customer_id and private.store_ref_ok(c.user_id, c.workspace_id, new.user_id)) then
      raise exception 'Cliente não encontrado' using errcode = 'P0002', hint = 'akool';
    end if;
  end if;
  if new.account_id is not null and (tg_op = 'INSERT' or v_owner or new.account_id is distinct from old.account_id) then
    if not exists (select 1 from public.finance_accounts a
                    where a.id = new.account_id and private.store_ref_ok(a.user_id, a.workspace_id, new.user_id)) then
      raise exception 'Conta não encontrada' using errcode = 'P0002', hint = 'akool';
    end if;
  end if;
  if new.transaction_id is not null and (tg_op = 'INSERT' or v_owner or new.transaction_id is distinct from old.transaction_id) then
    if old.transaction_id is not null and new.transaction_id is distinct from old.transaction_id then
      raise exception 'A venda já tem receita vinculada: remova a atual antes' using errcode = 'P0001', hint = 'akool';
    end if;
    if new.status not in ('sold', 'shipped', 'delivered') then
      raise exception 'Só venda vendida, enviada ou entregue tem receita' using errcode = 'P0001', hint = 'akool';
    end if;
    -- shared_with_user_id não serve: a receita é do dono ou do workspace dele.
    select t.user_id, t.workspace_id, t.type into v_tx from public.finance_transactions t where t.id = new.transaction_id;
    if not found or not private.store_ref_ok(v_tx.user_id, v_tx.workspace_id, new.user_id) then
      raise exception 'Receita não encontrada' using errcode = 'P0002', hint = 'akool';
    end if;
    if v_tx.type <> 'income' then
      raise exception 'A receita da venda tem de ser uma transação de receita (income)' using errcode = '22023', hint = 'akool';
    end if;
    if exists (select 1 from public.finance_store_sales s where s.transaction_id = new.transaction_id and s.id <> new.id)
       or exists (select 1 from public.finance_store_purchases pu where pu.transaction_id = new.transaction_id) then
      raise exception 'Esta transação já está vinculada a outra venda ou compra' using errcode = 'P0001', hint = 'akool';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.store_sale_rules() from public, anon, authenticated;

-- O nome ordena antes de finance_store_sales_updated_at e de
-- trg_finance_store_sales_ws_guard (os BEFORE rodam em ordem de nome).
create trigger finance_store_sales_rules
  before insert or update on public.finance_store_sales
  for each row execute function private.store_sale_rules();

-- ---------------------------------------------------------------------------
-- 6. Gatilho do item (BEFORE INSERT OR UPDATE)
-- ---------------------------------------------------------------------------

create function private.store_sale_item_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sale  record;
  v_prod  record;
  v_need  bigint;
  v_avail bigint;
begin
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.sale_id is distinct from old.sale_id then
    raise exception 'O item não muda de venda: remova este e adicione na outra' using errcode = '22023', hint = 'akool';
  end if;
  -- O item fica no workspace da venda: o autor (o único que o
  -- trg_finance_store_sale_items_ws_guard deixa) só pode trocar o workspace
  -- do item para o da venda. Passa o SET NULL de apagar o workspace, na ordem
  -- que for entre venda e item: o workspace antigo já não existe.
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id
     and new.workspace_id is distinct from (select s.workspace_id from public.finance_store_sales s where s.id = new.sale_id)
     and not (new.workspace_id is null and not exists (select 1 from public.finance_workspaces w where w.id = old.workspace_id)) then
    raise exception 'O item fica no workspace da venda: o workspace dele não muda sozinho' using errcode = '22023', hint = 'akool';
  end if;
  -- Nada de quantidade nem de produto mudou: preço, nome, o workspace igual
  -- ao da venda e o SET NULL do produto apagado passam sem conferência.
  if tg_op = 'UPDATE' and new.quantity is not distinct from old.quantity
     and (new.product_id is null or new.product_id is not distinct from old.product_id) then
    return new;
  end if;

  select s.id, s.workspace_id, s.status into v_sale
    from public.finance_store_sales s
   where s.id = new.sale_id and private.store_visible(s.user_id, s.workspace_id)
     for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  if tg_op = 'INSERT' then
    new.workspace_id := case when v_sale.workspace_id is not null and public.is_workspace_member(v_sale.workspace_id)
                             then v_sale.workspace_id end;
  end if;

  if new.product_id is null then
    return new;
  end if;
  select p.name, p.kind, p.archived into v_prod
    from public.finance_store_products p
   where p.id = new.product_id and private.store_visible(p.user_id, p.workspace_id)
     for no key update;
  if not found then
    raise exception 'Produto não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  if v_prod.kind = 'unique' and new.quantity > 1 then
    raise exception 'Item único vende 1 unidade: %', v_prod.name using errcode = '22023', hint = 'akool';
  end if;
  if v_prod.archived and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    raise exception 'Produto arquivado não entra em venda: %', v_prod.name using errcode = '22023', hint = 'akool';
  end if;
  if tg_op = 'INSERT' and coalesce(btrim(new.product_name), '') = '' then
    new.product_name := v_prod.name;
  end if;

  -- Venda cancelada não segura unidade: a conferência fica para quando reabrir.
  if v_sale.status <> 'cancelled' then
    v_need := new.quantity - case when tg_op = 'UPDATE' and old.product_id = new.product_id then old.quantity else 0 end;
    if v_need > 0 then
      v_avail := private.store_product_available(new.product_id);
      if v_need > v_avail then
        raise exception 'Estoque insuficiente: % tem % disponível(is)', v_prod.name, greatest(v_avail, 0)
          using errcode = 'P0001', hint = 'akool';
      end if;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.store_sale_item_rules() from public, anon, authenticated;

create trigger finance_store_sale_items_rules
  before insert or update on public.finance_store_sale_items
  for each row execute function private.store_sale_item_rules();

-- O item segue a venda. SELECT: o dono do item ou quem vê a venda; UPDATE e
-- DELETE: só quem vê a venda. Sem o "ou a venda é visível", uma venda visível
-- podia ter itens invisíveis para quem a via: B põe um item na venda da A no
-- W e a A sai do W (ou é removida); o item de B continua no W, e a A, dona da
-- venda, não o via nem o tirava. O líquido das RPCs (INVOKER) somava só o
-- visível, e a receita mudava de valor conforme quem chamava. Sem tirar o
-- "membro do workspace do item", a venda que sai do W (o UPDATE de
-- workspace_id do dono, que o ws_guard deixa) deixava lá o item de outra
-- pessoa, e um membro que já não via a venda o lia, mudava o preço (a receita
-- do dono saía com ele) e o apagava. O autor do item sem acesso à venda ainda
-- o lê, mas não o altera (pela RPC também não: P0002). O exists roda com o
-- RLS da venda, pela chave primária: não mostra nada que a venda já não
-- mostre. O INSERT continua só em nome próprio, e o gatilho do item confere a
-- venda. As cascatas de FK (apagar a venda, o produto) e as funções DEFINER
-- (leave_workspace, restore) não passam pelo RLS.
alter policy finance_store_sale_items_select on public.finance_store_sale_items
  using (((user_id = (select auth.uid()))
          or exists (select 1 from public.finance_store_sales s where s.id = finance_store_sale_items.sale_id)));
alter policy finance_store_sale_items_update on public.finance_store_sale_items
  using ((exists (select 1 from public.finance_store_sales s where s.id = finance_store_sale_items.sale_id)))
  with check ((exists (select 1 from public.finance_store_sales s where s.id = finance_store_sale_items.sale_id)));
alter policy finance_store_sale_items_delete on public.finance_store_sale_items
  using ((exists (select 1 from public.finance_store_sales s where s.id = finance_store_sale_items.sale_id)));

-- ---------------------------------------------------------------------------
-- 7. RPCs (SECURITY INVOKER: o RLS de quem chama vale)
-- ---------------------------------------------------------------------------

-- Campos da venda ({customer_id, channel, shipping_method, tracking_code,
-- expected_delivery_on, shipping_charged, shipping_cost, fees, account_id,
-- notes, attachments, sold_on}); só as chaves presentes mudam. Status, datas
-- de entrega, receita, workspace e dono têm caminho próprio. sold_on só na
-- venda consumida e nunca nulo. Dinheiro: inteiro de 0 a 1e12 centavos (nulo
-- vale 0). Texto nulo vale ''. A receita acompanha a venda: valor (o líquido,
-- que tem de ficar > 0), data (sold_on) e conta (que não pode sair enquanto
-- houver receita). Sem chave, não grava. A ressincronização da receita é a
-- mesma nas 4 RPCs que mexem no dinheiro (aqui e nas de item): a receita
-- visível é posta em dia quando difere da venda; a de outra pessoa
-- (invisível) só quando a chamada muda o líquido, a data ou a conta (v_moved),
-- e aí dá 42501. Sem mudança, a receita invisível sai como null e a chamada
-- passa: a nota da venda não fica presa à receita de quem saiu do workspace.
create function public.store_sale_update(p_sale uuid, p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_sale    public.finance_store_sales;
  v_before  public.finance_store_sales;
  v_key     text;
  v_num     numeric;
  v_net     numeric;
  v_moved   boolean;
  v_tx      public.finance_transactions;
  v_tx_json jsonb;
  v_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Envie os campos da venda como objeto' using errcode = '22023', hint = 'akool';
  end if;
  select k into v_key from jsonb_object_keys(p_patch) as k
   where k in ('status', 'delivered_on', 'transaction_id', 'workspace_id', 'user_id', 'items', 'id', 'created_at', 'updated_at')
   order by k limit 1;
  if found then
    raise exception 'chave "%" não muda por aqui: status e entrega por store_sale_set_status, receita por store_sale_generate_income, itens por store_sale_items_*; workspace, dono e versão não mudam', v_key
      using errcode = '22023', hint = 'akool';
  end if;
  select k into v_key from jsonb_object_keys(p_patch) as k
   where k not in ('customer_id', 'channel', 'shipping_method', 'tracking_code', 'expected_delivery_on',
                   'shipping_charged', 'shipping_cost', 'fees', 'account_id', 'notes', 'attachments', 'sold_on')
   order by k limit 1;
  if found then
    raise exception 'chave "%" não aceita (customer_id, channel, shipping_method, tracking_code, expected_delivery_on, shipping_charged, shipping_cost, fees, account_id, notes, attachments e sold_on)', left(v_key, 40)
      using errcode = '22023', hint = 'akool';
  end if;
  foreach v_key in array array['customer_id', 'account_id'] loop
    if coalesce(jsonb_typeof(p_patch -> v_key), 'null') not in ('string', 'null')
       or (jsonb_typeof(p_patch -> v_key) = 'string' and not pg_input_is_valid(p_patch ->> v_key, 'uuid')) then
      raise exception '% é um id (uuid) ou null', v_key using errcode = '22023', hint = 'akool';
    end if;
  end loop;
  if p_patch ? 'channel' and (jsonb_typeof(p_patch -> 'channel') is distinct from 'string'
                              or p_patch ->> 'channel' not in ('olx', 'mercado_livre', 'facebook', 'whatsapp', 'referral', 'in_person', 'other')) then
    raise exception 'channel é olx, mercado_livre, facebook, whatsapp, referral, in_person ou other' using errcode = '22023', hint = 'akool';
  end if;
  foreach v_key in array array['shipping_method', 'tracking_code', 'notes'] loop
    if coalesce(jsonb_typeof(p_patch -> v_key), 'null') not in ('string', 'null') then
      raise exception '% é texto ou null', v_key using errcode = '22023', hint = 'akool';
    end if;
  end loop;
  -- pg_input_is_valid (PG 16+) confere a data sem abrir subtransação.
  foreach v_key in array array['expected_delivery_on', 'sold_on'] loop
    if coalesce(jsonb_typeof(p_patch -> v_key), 'null') not in ('string', 'null')
       or (jsonb_typeof(p_patch -> v_key) = 'string'
           and ((p_patch ->> v_key) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not pg_input_is_valid(p_patch ->> v_key, 'date'))) then
      raise exception '% é uma data AAAA-MM-DD ou null', v_key using errcode = '22023', hint = 'akool';
    end if;
  end loop;
  -- IFs separados: o cast só roda sobre número.
  foreach v_key in array array['shipping_charged', 'shipping_cost', 'fees'] loop
    if coalesce(jsonb_typeof(p_patch -> v_key), 'null') not in ('number', 'null') then
      raise exception '% é um valor em centavos, inteiro, de 0 a 1000000000000', v_key using errcode = '22023', hint = 'akool';
    end if;
    if jsonb_typeof(p_patch -> v_key) = 'number' then
      v_num := (p_patch ->> v_key)::numeric;
      if v_num <> trunc(v_num) or v_num < 0 or v_num > 1000000000000 then
        raise exception '% é um valor em centavos, inteiro, de 0 a 1000000000000', v_key using errcode = '22023', hint = 'akool';
      end if;
    end if;
  end loop;
  if coalesce(jsonb_typeof(p_patch -> 'attachments'), 'null') not in ('array', 'null')
     or (jsonb_typeof(p_patch -> 'attachments') = 'array'
         and exists (select 1 from jsonb_array_elements(p_patch -> 'attachments') e where jsonb_typeof(e) <> 'object')) then
    raise exception 'attachments é uma lista de anexos {id, path, name, mime, size, uploaded_at} ou null' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_sale from public.finance_store_sales s where s.id = p_sale for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  v_before := v_sale;
  if p_patch ? 'sold_on' then
    if v_sale.status not in ('sold', 'shipped', 'delivered') then
      raise exception 'A data da venda só existe em venda vendida, enviada ou entregue' using errcode = '22023', hint = 'akool';
    end if;
    if jsonb_typeof(p_patch -> 'sold_on') is distinct from 'string' then
      raise exception 'Informe a data da venda' using errcode = '22023', hint = 'akool';
    end if;
  end if;
  if p_patch ? 'account_id' and jsonb_typeof(p_patch -> 'account_id') = 'null' and v_sale.transaction_id is not null then
    raise exception 'Venda com receita lançada precisa de uma conta: escolha outra ou remova a receita' using errcode = '22023', hint = 'akool';
  end if;

  if p_patch <> '{}'::jsonb then
    update public.finance_store_sales s set
      customer_id = case when p_patch ? 'customer_id' then (p_patch ->> 'customer_id')::uuid else s.customer_id end,
      channel = case when p_patch ? 'channel' then p_patch ->> 'channel' else s.channel end,
      shipping_method = case when p_patch ? 'shipping_method' then coalesce(p_patch ->> 'shipping_method', '') else s.shipping_method end,
      tracking_code = case when p_patch ? 'tracking_code' then coalesce(p_patch ->> 'tracking_code', '') else s.tracking_code end,
      expected_delivery_on = case when p_patch ? 'expected_delivery_on' then (p_patch ->> 'expected_delivery_on')::date else s.expected_delivery_on end,
      shipping_charged = case when p_patch ? 'shipping_charged' then coalesce((p_patch ->> 'shipping_charged')::numeric::bigint, 0) else s.shipping_charged end,
      shipping_cost = case when p_patch ? 'shipping_cost' then coalesce((p_patch ->> 'shipping_cost')::numeric::bigint, 0) else s.shipping_cost end,
      fees = case when p_patch ? 'fees' then coalesce((p_patch ->> 'fees')::numeric::bigint, 0) else s.fees end,
      account_id = case when p_patch ? 'account_id' then (p_patch ->> 'account_id')::uuid else s.account_id end,
      notes = case when p_patch ? 'notes' then coalesce(p_patch ->> 'notes', '') else s.notes end,
      attachments = case when jsonb_typeof(p_patch -> 'attachments') = 'array' then p_patch -> 'attachments'
                         when p_patch ? 'attachments' then '[]'::jsonb
                         else s.attachments end,
      sold_on = case when p_patch ? 'sold_on' then (p_patch ->> 'sold_on')::date else s.sold_on end
     where s.id = v_sale.id
    returning * into v_sale;
  end if;
  -- Os itens não mudam aqui: o líquido muda com o frete cobrado e a taxa.
  v_moved := v_sale.shipping_charged - v_sale.fees is distinct from v_before.shipping_charged - v_before.fees
             or v_sale.sold_on is distinct from v_before.sold_on or v_sale.account_id is distinct from v_before.account_id;

  if v_sale.transaction_id is not null then
    select coalesce(sum(i.quantity::numeric * i.unit_price), 0) + v_sale.shipping_charged - v_sale.fees into v_net
      from public.finance_store_sale_items i where i.sale_id = v_sale.id;
    select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
    -- A receita visível é posta em dia quando difere da venda; a invisível
    -- (de outra pessoa) só quando a chamada muda o líquido, a data ou a conta.
    if (v_tx.id is null and v_moved)
       or (v_tx.id is not null and (v_tx.amount <> v_net or v_tx.date is distinct from coalesce(v_sale.sold_on, v_tx.date)
                                    or v_tx.account_id is distinct from v_sale.account_id)) then
      if v_net <= 0 then
        raise exception 'O líquido da venda ficaria zero ou negativo com a receita lançada: remova a receita antes' using errcode = '22023', hint = 'akool';
      end if;
      update public.finance_transactions t
         set amount = v_net, date = coalesce(v_sale.sold_on, t.date), account_id = v_sale.account_id
       where t.id = v_sale.transaction_id
      returning * into v_tx;
      if not found then
        raise exception 'A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la (ou apagá-la em Transações)' using errcode = '42501', hint = 'akool';
      end if;
      v_changed := true;
    end if;
    v_tx_json := case when v_tx.id is not null then to_jsonb(v_tx) end;
  end if;

  return jsonb_build_object('sale', to_jsonb(v_sale), 'transaction', v_tx_json, 'transaction_changed', v_changed);
end;
$$;

revoke execute on function public.store_sale_update(uuid, jsonb) from public, anon;
grant execute on function public.store_sale_update(uuid, jsonb) to authenticated;
comment on function public.store_sale_update(uuid, jsonb) is
  'API-028: muda os campos da venda (customer_id, channel, shipping_method, tracking_code, expected_delivery_on, shipping_charged, shipping_cost, fees, account_id, notes, attachments e sold_on; só as chaves presentes) e ressincroniza a receita vinculada (valor = líquido > 0, data = sold_on, conta = a da venda); devolve {sale, transaction, transaction_changed}. status, delivered_on, transaction_id, workspace_id e user_id: 22023. sold_on só em venda consumida e não nulo. Dinheiro: inteiro de 0 a 1e12. Venda de outra pessoa: P0002; receita de outra pessoa: 42501 quando a chamada muda o líquido, a data ou a conta (sem mudança, passa com transaction null).';

-- De 1 a 100 itens {product_id, quantity (1 por padrão, até 1e6), unit_price
-- (centavos; sem ele, o target_price)}. Nome e custo médio são do servidor
-- (snapshot, store_product_figures). Trava a venda e depois os produtos em
-- ordem de id. Um BEGIN … EXCEPTION só, em volta do laço (como o API-024):
-- o erro com hint akool (as validações daqui e as dos gatilhos: estoque, item
-- único, arquivado, venda ou produto invisível) sai como "items/N: …". Não
-- mexe no updated_at da venda; ressincroniza a receita.
create function public.store_sale_items_add(p_sale uuid, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_sale    public.finance_store_sales;
  v_item    jsonb;
  v_i       integer;
  v_key     text;
  v_pid     uuid;
  v_qty     integer;
  v_num     numeric;
  v_price   bigint;
  v_prod    record;
  v_cost    bigint;
  v_state   text;
  v_msg     text;
  v_hint    text;
  v_line    numeric;
  v_net     numeric;
  v_moved   boolean := false;
  v_tx      public.finance_transactions;
  v_tx_json jsonb;
  v_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'items é uma lista de 1 a 100 itens {product_id, quantity, unit_price}' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_sale from public.finance_store_sales s where s.id = p_sale for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  perform 1 from public.finance_store_products p
   where p.id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(p_items) e
                   where jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'product_id') = 'string'
                     and pg_input_is_valid(e ->> 'product_id', 'uuid'))
   order by p.id
     for no key update;

  begin
    for v_item, v_i in select t.e, (t.n - 1)::integer from jsonb_array_elements(p_items) with ordinality as t(e, n) loop
      if jsonb_typeof(v_item) <> 'object' then
        raise exception 'o item é um objeto {product_id, quantity, unit_price}' using errcode = '22023', hint = 'akool';
      end if;
      select k into v_key from jsonb_object_keys(v_item) as k where k not in ('product_id', 'quantity', 'unit_price') order by k limit 1;
      if found then
        raise exception 'chave "%" não aceita (product_id, quantity e unit_price: nome e custo vêm do produto)', left(v_key, 40)
          using errcode = '22023', hint = 'akool';
      end if;
      if jsonb_typeof(v_item -> 'product_id') is distinct from 'string' or not pg_input_is_valid(v_item ->> 'product_id', 'uuid') then
        raise exception 'product_id é o id (uuid) do produto' using errcode = '22023', hint = 'akool';
      end if;
      v_pid := (v_item ->> 'product_id')::uuid;
      v_qty := 1;
      if coalesce(jsonb_typeof(v_item -> 'quantity'), 'null') not in ('number', 'null') then
        raise exception 'quantity é um inteiro de 1 a 1000000' using errcode = '22023', hint = 'akool';
      end if;
      if jsonb_typeof(v_item -> 'quantity') = 'number' then
        v_num := (v_item ->> 'quantity')::numeric;
        if v_num <> trunc(v_num) or v_num < 1 or v_num > 1000000 then
          raise exception 'quantity é um inteiro de 1 a 1000000' using errcode = '22023', hint = 'akool';
        end if;
        v_qty := v_num::integer;
      end if;
      v_price := null;
      if coalesce(jsonb_typeof(v_item -> 'unit_price'), 'null') not in ('number', 'null') then
        raise exception 'unit_price é um valor em centavos, inteiro, de 0 a 1000000000000' using errcode = '22023', hint = 'akool';
      end if;
      if jsonb_typeof(v_item -> 'unit_price') = 'number' then
        v_num := (v_item ->> 'unit_price')::numeric;
        if v_num <> trunc(v_num) or v_num < 0 or v_num > 1000000000000 then
          raise exception 'unit_price é um valor em centavos, inteiro, de 0 a 1000000000000' using errcode = '22023', hint = 'akool';
        end if;
        v_price := v_num::bigint;
      end if;

      select p.name, p.target_price into v_prod from public.finance_store_products p where p.id = v_pid;
      if not found then
        raise exception 'Produto não encontrado' using errcode = 'P0002', hint = 'akool';
      end if;
      select f.avg_unit_cost into v_cost from public.store_product_figures(array[v_pid]) f;

      insert into public.finance_store_sale_items (user_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost_at_sale)
      values (v_uid, v_sale.id, v_pid, v_prod.name, v_qty, coalesce(v_price, v_prod.target_price), coalesce(v_cost, 0))
      returning quantity::numeric * unit_price into v_line;
      v_moved := v_moved or v_line <> 0;
    end loop;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    if v_hint is distinct from 'akool' then
      raise;
    end if;
    raise exception using message = format('items/%s: %s', v_i, v_msg), errcode = v_state, hint = 'akool';
  end;

  if v_sale.transaction_id is not null then
    select coalesce(sum(i.quantity::numeric * i.unit_price), 0) + v_sale.shipping_charged - v_sale.fees into v_net
      from public.finance_store_sale_items i where i.sale_id = v_sale.id;
    select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
    -- A receita visível é posta em dia quando difere da venda; a invisível
    -- (de outra pessoa) só quando a chamada muda o líquido, a data ou a conta.
    if (v_tx.id is null and v_moved)
       or (v_tx.id is not null and (v_tx.amount <> v_net or v_tx.date is distinct from coalesce(v_sale.sold_on, v_tx.date)
                                    or v_tx.account_id is distinct from v_sale.account_id)) then
      if v_net <= 0 then
        raise exception 'O líquido da venda ficaria zero ou negativo com a receita lançada: remova a receita antes' using errcode = '22023', hint = 'akool';
      end if;
      update public.finance_transactions t
         set amount = v_net, date = coalesce(v_sale.sold_on, t.date), account_id = v_sale.account_id
       where t.id = v_sale.transaction_id
      returning * into v_tx;
      if not found then
        raise exception 'A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la (ou apagá-la em Transações)' using errcode = '42501', hint = 'akool';
      end if;
      v_changed := true;
    end if;
    v_tx_json := case when v_tx.id is not null then to_jsonb(v_tx) end;
  end if;

  return jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb)
                from public.finance_store_sale_items i where i.sale_id = v_sale.id),
    'transaction', v_tx_json,
    'transaction_changed', v_changed);
end;
$$;

revoke execute on function public.store_sale_items_add(uuid, jsonb) from public, anon;
grant execute on function public.store_sale_items_add(uuid, jsonb) to authenticated;
comment on function public.store_sale_items_add(uuid, jsonb) is
  'API-028: põe de 1 a 100 itens {product_id, quantity (1 a 1e6, padrão 1), unit_price (centavos; padrão o target_price)} na venda, tudo ou nada; nome e custo médio do produto são do servidor; ressincroniza a receita sem mexer no updated_at da venda. Devolve {sale, items (todos da venda), transaction, transaction_changed}. Erro: "items/N: …" (N a partir de 0) com o SQLSTATE de origem: estoque P0001, item único e arquivado 22023, produto invisível P0002.';

-- Venda nova em negociação, com os itens, numa chamada: {campos da venda
-- (os do store_sale_update, sem sold_on), workspace_id, items: 1 a 100}.
-- Reaproveita as duas RPCs acima, então os erros são os delas.
create function public.store_sale_create(p_sale jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_res jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_sale) is distinct from 'object' then
    raise exception 'Envie a venda como objeto {campos da venda, workspace_id, items}' using errcode = '22023', hint = 'akool';
  end if;
  if coalesce(jsonb_typeof(p_sale -> 'workspace_id'), 'null') not in ('string', 'null')
     or (jsonb_typeof(p_sale -> 'workspace_id') = 'string' and not pg_input_is_valid(p_sale ->> 'workspace_id', 'uuid')) then
    raise exception 'workspace_id é um id (uuid) ou null' using errcode = '22023', hint = 'akool';
  end if;
  if jsonb_typeof(p_sale -> 'items') is distinct from 'array' or jsonb_array_length(p_sale -> 'items') not between 1 and 100 then
    raise exception 'items é uma lista de 1 a 100 itens {product_id, quantity, unit_price}' using errcode = '22023', hint = 'akool';
  end if;

  insert into public.finance_store_sales (user_id, workspace_id)
  values (v_uid, (p_sale ->> 'workspace_id')::uuid)
  returning id into v_id;
  perform public.store_sale_update(v_id, p_sale - 'workspace_id' - 'items');
  v_res := public.store_sale_items_add(v_id, p_sale -> 'items');
  return jsonb_build_object('sale', v_res -> 'sale', 'items', v_res -> 'items');
end;
$$;

revoke execute on function public.store_sale_create(jsonb) from public, anon;
grant execute on function public.store_sale_create(jsonb) to authenticated;
comment on function public.store_sale_create(jsonb) is
  'API-028: cria a venda em negociação com os itens, tudo ou nada; devolve {sale, items}. Chaves: customer_id, channel, shipping_method, tracking_code, expected_delivery_on, shipping_charged, shipping_cost, fees, account_id, notes, attachments, workspace_id e items (1 a 100 {product_id, quantity, unit_price}). Os erros são os de store_sale_update e store_sale_items_add ("items/N: …").';

-- Muda um item: quantity (1 a 1e6) e/ou unit_price (0 a 1e12). Produto, nome
-- e custo do item não mudam (remova e adicione). Trava a venda e o produto;
-- ressincroniza a receita sem mexer no updated_at da venda.
create function public.store_sale_items_update(p_item uuid, p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_sale_id uuid;
  v_pid     uuid;
  v_sale    public.finance_store_sales;
  v_key     text;
  v_num     numeric;
  v_qty     integer;
  v_price   bigint;
  v_line    numeric;
  v_net     numeric;
  v_moved   boolean;
  v_tx      public.finance_transactions;
  v_tx_json jsonb;
  v_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Envie {quantity, unit_price}' using errcode = '22023', hint = 'akool';
  end if;
  select k into v_key from jsonb_object_keys(p_patch) as k where k not in ('quantity', 'unit_price') order by k limit 1;
  if found then
    raise exception 'chave "%" não aceita (quantity e unit_price: produto, nome e custo do item não mudam)', left(v_key, 40)
      using errcode = '22023', hint = 'akool';
  end if;
  if coalesce(jsonb_typeof(p_patch -> 'quantity'), 'null') not in ('number', 'null') then
    raise exception 'quantity é um inteiro de 1 a 1000000' using errcode = '22023', hint = 'akool';
  end if;
  if jsonb_typeof(p_patch -> 'quantity') = 'number' then
    v_num := (p_patch ->> 'quantity')::numeric;
    if v_num <> trunc(v_num) or v_num < 1 or v_num > 1000000 then
      raise exception 'quantity é um inteiro de 1 a 1000000' using errcode = '22023', hint = 'akool';
    end if;
    v_qty := v_num::integer;
  end if;
  if coalesce(jsonb_typeof(p_patch -> 'unit_price'), 'null') not in ('number', 'null') then
    raise exception 'unit_price é um valor em centavos, inteiro, de 0 a 1000000000000' using errcode = '22023', hint = 'akool';
  end if;
  if jsonb_typeof(p_patch -> 'unit_price') = 'number' then
    v_num := (p_patch ->> 'unit_price')::numeric;
    if v_num <> trunc(v_num) or v_num < 0 or v_num > 1000000000000 then
      raise exception 'unit_price é um valor em centavos, inteiro, de 0 a 1000000000000' using errcode = '22023', hint = 'akool';
    end if;
    v_price := v_num::bigint;
  end if;

  select i.sale_id, i.product_id into v_sale_id, v_pid from public.finance_store_sale_items i where i.id = p_item;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  select * into v_sale from public.finance_store_sales s where s.id = v_sale_id for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  perform 1 from public.finance_store_products p where p.id = v_pid for no key update;
  -- O valor da linha antes (a venda já está travada): o líquido muda se ele mudar.
  select i.quantity::numeric * i.unit_price into v_line from public.finance_store_sale_items i where i.id = p_item;

  update public.finance_store_sale_items i
     set quantity = coalesce(v_qty, i.quantity), unit_price = coalesce(v_price, i.unit_price)
   where i.id = p_item
  returning i.sale_id, i.quantity::numeric * i.unit_price into v_sale_id, v_num;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  v_moved := v_num is distinct from v_line;

  if v_sale.transaction_id is not null then
    select coalesce(sum(i.quantity::numeric * i.unit_price), 0) + v_sale.shipping_charged - v_sale.fees into v_net
      from public.finance_store_sale_items i where i.sale_id = v_sale.id;
    select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
    -- A receita visível é posta em dia quando difere da venda; a invisível
    -- (de outra pessoa) só quando a chamada muda o líquido, a data ou a conta.
    if (v_tx.id is null and v_moved)
       or (v_tx.id is not null and (v_tx.amount <> v_net or v_tx.date is distinct from coalesce(v_sale.sold_on, v_tx.date)
                                    or v_tx.account_id is distinct from v_sale.account_id)) then
      if v_net <= 0 then
        raise exception 'O líquido da venda ficaria zero ou negativo com a receita lançada: remova a receita antes' using errcode = '22023', hint = 'akool';
      end if;
      update public.finance_transactions t
         set amount = v_net, date = coalesce(v_sale.sold_on, t.date), account_id = v_sale.account_id
       where t.id = v_sale.transaction_id
      returning * into v_tx;
      if not found then
        raise exception 'A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la (ou apagá-la em Transações)' using errcode = '42501', hint = 'akool';
      end if;
      v_changed := true;
    end if;
    v_tx_json := case when v_tx.id is not null then to_jsonb(v_tx) end;
  end if;

  return jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb)
                from public.finance_store_sale_items i where i.sale_id = v_sale.id),
    'transaction', v_tx_json,
    'transaction_changed', v_changed);
end;
$$;

revoke execute on function public.store_sale_items_update(uuid, jsonb) from public, anon;
grant execute on function public.store_sale_items_update(uuid, jsonb) to authenticated;
comment on function public.store_sale_items_update(uuid, jsonb) is
  'API-028: muda quantity (1 a 1e6) e/ou unit_price (0 a 1e12) de um item e ressincroniza a receita, sem mexer no updated_at da venda; devolve {sale, items, transaction, transaction_changed}. Outras chaves: 22023. Item ou venda inexistente ou de outra pessoa: P0002. Estoque: P0001; item único com mais de 1: 22023.';

-- Tira um item. Remover o último é permitido (decisão do usuário), mas não com
-- receita lançada se o líquido ficar <= 0.
create function public.store_sale_items_remove(p_item uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_sale_id uuid;
  v_sale    public.finance_store_sales;
  v_line    numeric;
  v_net     numeric;
  v_moved   boolean;
  v_tx      public.finance_transactions;
  v_tx_json jsonb;
  v_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select i.sale_id into v_sale_id from public.finance_store_sale_items i where i.id = p_item;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  select * into v_sale from public.finance_store_sales s where s.id = v_sale_id for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  delete from public.finance_store_sale_items i where i.id = p_item returning i.sale_id, i.quantity::numeric * i.unit_price into v_sale_id, v_line;
  if not found then
    raise exception 'Item não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  v_moved := v_line <> 0;

  if v_sale.transaction_id is not null then
    select coalesce(sum(i.quantity::numeric * i.unit_price), 0) + v_sale.shipping_charged - v_sale.fees into v_net
      from public.finance_store_sale_items i where i.sale_id = v_sale.id;
    select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
    -- A receita visível é posta em dia quando difere da venda; a invisível
    -- (de outra pessoa) só quando a chamada muda o líquido, a data ou a conta.
    if (v_tx.id is null and v_moved)
       or (v_tx.id is not null and (v_tx.amount <> v_net or v_tx.date is distinct from coalesce(v_sale.sold_on, v_tx.date)
                                    or v_tx.account_id is distinct from v_sale.account_id)) then
      if v_net <= 0 then
        raise exception 'O líquido da venda ficaria zero ou negativo com a receita lançada: remova a receita antes' using errcode = '22023', hint = 'akool';
      end if;
      update public.finance_transactions t
         set amount = v_net, date = coalesce(v_sale.sold_on, t.date), account_id = v_sale.account_id
       where t.id = v_sale.transaction_id
      returning * into v_tx;
      if not found then
        raise exception 'A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la (ou apagá-la em Transações)' using errcode = '42501', hint = 'akool';
      end if;
      v_changed := true;
    end if;
    v_tx_json := case when v_tx.id is not null then to_jsonb(v_tx) end;
  end if;

  return jsonb_build_object(
    'sale', to_jsonb(v_sale),
    'items', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at, i.id), '[]'::jsonb)
                from public.finance_store_sale_items i where i.sale_id = v_sale.id),
    'transaction', v_tx_json,
    'transaction_changed', v_changed);
end;
$$;

revoke execute on function public.store_sale_items_remove(uuid) from public, anon;
grant execute on function public.store_sale_items_remove(uuid) to authenticated;
comment on function public.store_sale_items_remove(uuid) is
  'API-028: tira um item e ressincroniza a receita, sem mexer no updated_at da venda; devolve {sale, items, transaction, transaction_changed}. Remover o último é permitido; com receita, líquido <= 0 dá 22023. Item ou venda inexistente ou de outra pessoa: P0002.';

-- Receita depois do fato, idempotente: venda consumida, com conta e data,
-- líquido > 0; já vinculada devolve a existente (created = false). Categoria
-- opcional (visível e de receita). A receita nasce em nome de quem chama, no
-- workspace da venda se ele é membro (como o API-016).
create function public.store_sale_generate_income(p_sale uuid, p_category uuid default null, p_description text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_sale public.finance_store_sales;
  v_type text;
  v_net  numeric;
  v_desc text;
  v_tx   public.finance_transactions;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_sale from public.finance_store_sales s where s.id = p_sale for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  if v_sale.status not in ('sold', 'shipped', 'delivered') then
    raise exception 'Só venda vendida, enviada ou entregue gera receita' using errcode = 'P0001', hint = 'akool';
  end if;
  if v_sale.transaction_id is not null then
    select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
    return jsonb_build_object('sale', to_jsonb(v_sale), 'transaction', case when v_tx.id is not null then to_jsonb(v_tx) end, 'created', false);
  end if;
  if v_sale.account_id is null then
    raise exception 'A venda precisa de uma conta para lançar a receita' using errcode = '22023', hint = 'akool';
  end if;
  if not exists (select 1 from public.finance_accounts a where a.id = v_sale.account_id) then
    raise exception 'Conta não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  if p_category is not null then
    select c.type into v_type from public.finance_categories c where c.id = p_category;
    if not found then
      raise exception 'Categoria não encontrada' using errcode = 'P0002', hint = 'akool';
    end if;
    if v_type is distinct from 'income' then
      raise exception 'A categoria da receita tem de ser de receita (income)' using errcode = '22023', hint = 'akool';
    end if;
  end if;
  if v_sale.sold_on is null then
    raise exception 'Venda vendida, enviada ou entregue precisa da data da venda' using errcode = '22023', hint = 'akool';
  end if;
  select coalesce(sum(i.quantity::numeric * i.unit_price), 0) + v_sale.shipping_charged - v_sale.fees,
         string_agg(i.product_name, ', ' order by i.created_at, i.id)
    into v_net, v_desc
    from public.finance_store_sale_items i where i.sale_id = v_sale.id;
  if v_net <= 0 then
    raise exception 'O líquido da venda é zero ou negativo: não há receita para lançar' using errcode = '22023', hint = 'akool';
  end if;
  v_desc := coalesce(nullif(btrim(p_description), ''), 'Venda: ' || coalesce(v_desc, ''));

  insert into public.finance_transactions (user_id, account_id, category_id, type, amount, description, date, workspace_id)
  values (v_uid, v_sale.account_id, p_category, 'income', v_net, v_desc, v_sale.sold_on,
          case when v_sale.workspace_id is not null and public.is_workspace_member(v_sale.workspace_id) then v_sale.workspace_id end)
  returning * into v_tx;
  update public.finance_store_sales s set transaction_id = v_tx.id where s.id = v_sale.id returning * into v_sale;

  return jsonb_build_object('sale', to_jsonb(v_sale), 'transaction', to_jsonb(v_tx), 'created', true);
end;
$$;

revoke execute on function public.store_sale_generate_income(uuid, uuid, text) from public, anon;
grant execute on function public.store_sale_generate_income(uuid, uuid, text) to authenticated;
comment on function public.store_sale_generate_income(uuid, uuid, text) is
  'API-028: lança a receita de uma venda vendida, enviada ou entregue (valor = líquido > 0, data = sold_on, conta da venda, no workspace da venda se quem chama é membro) e grava o vínculo; idempotente: já vinculada devolve a existente com created = false. Devolve {sale, transaction, created}. Status fora: P0001; sem conta, líquido <= 0 ou categoria que não é de receita: 22023; venda, conta ou categoria invisível: P0002.';

-- Transição do pipeline com a receita, numa transação. Mesmo status devolve
-- sem mudar. Reabrir ou cancelar apaga a receita antes (0 linhas: é de outra
-- pessoa, 42501, e quem a lançou é quem a apaga, em Transações). sold ganha
-- sold_on = p_sold_on (vindo de negociação ou de enviada), a que já tinha ou
-- o dia do aparelho (p_today, a até 1 dia de São Paulo; nulo vale o de São
-- Paulo). Se a data muda numa venda com receita (enviada de volta para
-- vendida com p_sold_on), a data da receita vai junto na mesma transação (de
-- outra pessoa: 42501) e transaction_changed é true. delivered ganha
-- delivered_on = esse dia. Com p_create_income, lança a receita
-- (store_sale_generate_income). Os pares e os carimbos são do gatilho
-- private.store_sale_rules.
create function public.store_sale_set_status(
  p_sale uuid,
  p_status text,
  p_create_income boolean default false,
  p_sold_on date default null,
  p_category uuid default null,
  p_description text default null,
  p_today date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_sp      date := (now() at time zone 'America/Sao_Paulo')::date;
  v_today   date := coalesce(p_today, (now() at time zone 'America/Sao_Paulo')::date);
  v_sale    public.finance_store_sales;
  v_sold_on date;
  v_tx      public.finance_transactions;
  v_res     jsonb;
  v_changed boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  -- Comparação, não subtração (como no API-024): ±infinity dá 22023.
  if p_today is not null and p_today not between v_sp - 1 and v_sp + 1 then
    raise exception 'Data de hoje (%) a mais de 1 dia do hoje de São Paulo (%): mande o dia do aparelho ou nada', p_today, v_sp
      using errcode = '22023', hint = 'akool';
  end if;
  if p_status is null or p_status not in ('negotiating', 'sold', 'shipped', 'delivered', 'cancelled') then
    raise exception 'status é negotiating, sold, shipped, delivered ou cancelled' using errcode = '22023', hint = 'akool';
  end if;
  if coalesce(p_create_income, false) and p_status not in ('sold', 'shipped', 'delivered') then
    raise exception 'Receita só em venda vendida, enviada ou entregue' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_sale from public.finance_store_sales s where s.id = p_sale for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;

  if v_sale.status <> p_status then
    if p_status in ('negotiating', 'cancelled') and v_sale.transaction_id is not null then
      delete from public.finance_transactions t where t.id = v_sale.transaction_id returning * into v_tx;
      if not found then
        raise exception 'A receita vinculada é de outra pessoa: peça a quem a lançou para apagá-la em Transações e tente de novo' using errcode = '42501', hint = 'akool';
      end if;
      v_changed := true;
    end if;
    v_sold_on := v_sale.sold_on;
    update public.finance_store_sales s
       set status = p_status,
           sold_on = case when p_status = 'sold' then coalesce(p_sold_on, s.sold_on, v_today) else s.sold_on end,
           delivered_on = case when p_status = 'delivered' then coalesce(s.delivered_on, v_today) else s.delivered_on end,
           transaction_id = case when p_status in ('negotiating', 'cancelled') then null else s.transaction_id end
     where s.id = v_sale.id
    returning * into v_sale;
    -- De enviada para vendida com outra data: a receita acompanha a data.
    if v_sale.transaction_id is not null and v_sale.sold_on is distinct from v_sold_on then
      select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
      if v_tx.id is null or v_tx.date is distinct from v_sale.sold_on then
        update public.finance_transactions t set date = v_sale.sold_on where t.id = v_sale.transaction_id returning * into v_tx;
        if not found then
          raise exception 'A receita vinculada é de outra pessoa: só quem a lançou pode alterá-la (ou apagá-la em Transações)' using errcode = '42501', hint = 'akool';
        end if;
        v_changed := true;
      end if;
    end if;
  end if;

  if coalesce(p_create_income, false) and v_sale.transaction_id is null then
    v_res := public.store_sale_generate_income(v_sale.id, p_category, p_description);
    return jsonb_build_object('sale', v_res -> 'sale', 'transaction', v_res -> 'transaction', 'transaction_changed', true);
  end if;
  v_tx := null;
  if v_sale.transaction_id is not null then
    select * into v_tx from public.finance_transactions t where t.id = v_sale.transaction_id;
  end if;
  return jsonb_build_object('sale', to_jsonb(v_sale), 'transaction', case when v_tx.id is not null then to_jsonb(v_tx) end,
                            'transaction_changed', v_changed);
end;
$$;

revoke execute on function public.store_sale_set_status(uuid, text, boolean, date, uuid, text, date) from public, anon;
grant execute on function public.store_sale_set_status(uuid, text, boolean, date, uuid, text, date) to authenticated;
comment on function public.store_sale_set_status(uuid, text, boolean, date, uuid, text, date) is
  'API-028: muda o status pelos 10 pares do pipeline (fora deles, P0001), numa transação com a receita: reabrir ou cancelar apaga a receita (de outra pessoa: 42501); sold ganha sold_on (p_sold_on, a que já tinha ou o dia de hoje), e a data da receita acompanha (de outra pessoa: 42501; transaction_changed true); delivered ganha delivered_on; com p_create_income lança a receita (store_sale_generate_income). p_today é o dia do aparelho, a até 1 dia de São Paulo (fora: 22023). Mesmo status não grava. Devolve {sale, transaction, transaction_changed}.';

-- Apaga a receita (0 linhas: é de outra pessoa, 42501, e quem a lançou é quem
-- a apaga, em Transações) e depois a venda (os
-- itens vão em cascata). Devolve os anexos para o cliente apagar do Storage
-- depois do banco: o Storage não tem cascata.
create function public.store_sale_delete(p_sale uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_sale public.finance_store_sales;
  v_tx   boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_sale from public.finance_store_sales s where s.id = p_sale for no key update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;
  if v_sale.transaction_id is not null then
    delete from public.finance_transactions t where t.id = v_sale.transaction_id;
    if not found then
      raise exception 'A receita vinculada é de outra pessoa: peça a quem a lançou para apagá-la em Transações e tente de novo' using errcode = '42501', hint = 'akool';
    end if;
    v_tx := true;
  end if;
  delete from public.finance_store_sales s where s.id = v_sale.id;
  if not found then
    raise exception 'Venda não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;

  return jsonb_build_object('sale_id', v_sale.id, 'transaction_deleted', v_tx, 'attachments', coalesce(v_sale.attachments, '[]'::jsonb));
end;
$$;

revoke execute on function public.store_sale_delete(uuid) from public, anon;
grant execute on function public.store_sale_delete(uuid) to authenticated;
comment on function public.store_sale_delete(uuid) is
  'API-028: apaga a receita vinculada e depois a venda (itens em cascata); devolve {sale_id, transaction_deleted, attachments}, para quem chama apagar os anexos do Storage depois. Venda de outra pessoa: P0002; receita de outra pessoa: 42501.';
