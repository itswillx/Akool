-- API-064 + API-065: sair do workspace (ou ser removido) leva as linhas da
-- Loja e os fornecedores, e a dona consegue remover quem tem lançamentos. Uma
-- migration só para os dois cards (decisão 1 do plano do lote 07): os dois
-- redefinem as mesmas funções, e o 065 sozinho deixaria a Loja no workspace.
--
-- Antes (reproduzido no staging em DO desfeito, 14/10/2026; relatórios da
-- avaliação e da crítica do lote 07):
--   * leave_workspace e remove_workspace_member (baseline, DEFINER,
--     search_path=public) anulavam o workspace_id de só 6 tabelas. Produtos,
--     compras, vendas, itens, clientes e fornecedores de quem saiu continuavam
--     visíveis e editáveis para os outros membros: um membro editou o cliente
--     de quem saiu e apagou o fornecedor dele. Clientes são dados de terceiros;
--   * o remove_workspace_member dava 42501 ("Somente o autor pode realocar o
--     lancamento") sempre que o membro tinha linha nas 6 tabelas: ele anula o
--     workspace com o auth.uid() da dona, e o finance_guard_workspace (API-006)
--     só deixa o autor realocar;
--   * a criadora do workspace não saía nem o apagava (23505): as 12 categorias
--     que o create_workspace semeia têm os nomes das pessoais, e a UNIQUE NULLS
--     NOT DISTINCT (user_id, name, type, workspace_id) estourava ao jogá-las
--     para o privado. Vale para o leave com membros, para o leave sozinha e
--     para a cascata de apagar o workspace (e para o escopo do CategoryModal);
--   * a última pessoa não apagava o workspace quando sobrava linha de
--     ex-membro: o SET NULL da cascata passava pela guarda com o uid dela;
--   * as policies wm_owner_delete e finance_workspaces_delete deixavam apagar a
--     filiação ou o workspace direto pelo PostgREST, sem limpeza nenhuma;
--   * a receita (ou despesa) que um membro lançou na venda (ou compra) de
--     outra pessoa virava privada dele ao sair, e a dona ficava travada com
--     42501 na própria venda; o caso simétrico também travava;
--   * shared_with_user_id apontando para quem saiu travava a edição da linha
--     da própria dona (WITH CHECK do SEC-013: profile_is_related).
--
-- Depois:
--   * public.finance_guard_workspace(): create or replace (mesmo OID, os 16
--     trg_*_ws_guard continuam nela), DEFINER, search_path=public, sem EXECUTE
--     para clientes. "<>" vira "is distinct from" (JWT de cliente sem sub cai
--     na guarda, não só no RLS). No UPDATE, duas saídas estreitas, só para a
--     linha que vai de um workspace para o privado com o mesmo autor:
--       (a) o workspace antigo já não existe (o SET NULL de apagá-lo), sem GUC;
--       (b) o GUC transacional akool.ws_release vale o workspace antigo (só
--           private.finance_workspace_release o liga, e desliga ao terminar),
--           o autor já não é membro dele e quem grava é a dona (filiação com
--           role 'owner', a mesma regra do remove). Nenhum cliente liga o GUC:
--           nem pelas tabelas cujo RLS deixa o membro atualizar a linha de
--           outra pessoa (finance_loan_payments e finance_loan_collaterals);
--   * private.finance_workspace_release(p_user, p_workspace) (INVOKER,
--     search_path vazio, sem EXECUTE para clientes; roda dentro das DEFINER e
--     do reconcile). Tira do workspace o que é de quem sai (linhas que ele
--     criou, user_id), nesta ordem: as vendas dele (desvinculando a receita de
--     outra pessoa, que fica no W como lançamento comum); os itens dele nessas
--     vendas; os produtos dele e depois as compras dele (desvinculando a
--     despesa de outra pessoa); clientes e fornecedores; as transações dele,
--     menos as ligadas a venda ou compra de OUTRA pessoa que continua membro
--     (mesmo que a venda ou compra seja privada: a receita segue a venda, como
--     o item já segue no API-028); orçamentos, metas e recorrentes; as contas
--     dele que nenhuma linha de outra pessoa usa. As categorias do workspace
--     ficam (decisão 3: o histórico dos outros não perde categoria). Por fim
--     limpa shared_with_user_id = quem sai nas linhas de outras pessoas que
--     ficam no W, quando as duas pessoas não têm outro vínculo
--     (private.finance_people_related: a regra do profile_is_related, entre
--     duas pessoas, sem auth.uid() e sem o workspace que está sendo deixado).
--     A venda ou compra PRIVADA de quem sai ligada a receita ou despesa de
--     outra pessoa no W também é desvinculada (decisão 5). Empréstimos não
--     mudam (decisão 11, card API-067);
--   * private.finance_category_ws_exit() (gatilho finance_categories_ws_exit,
--     BEFORE UPDATE OF workspace_id em finance_categories, DEFINER, search_path
--     vazio, sem EXECUTE): na ida de um workspace para o privado, se o autor já
--     tem categoria pessoal com o mesmo nome e tipo, renomeia para "Nome (nome
--     do W)", ou "Nome (workspace)" quando o W já sumiu, com número até ficar
--     único ("Nome (Casa 2)"). É padrão da linha: vale também sem usuário
--     (cascata, exclusão de conta, restore). O nome ordena antes de
--     trg_finance_categories_ws_guard;
--   * remove_workspace_member e leave_workspace: create or replace, DEFINER,
--     search_path vazio (tudo qualificado, inclusive public._notify), mesmas
--     mensagens e grants. Começam com SELECT ... FOR UPDATE na filiação de
--     quem chama, o que serializa sair × remover e as duas abas da mesma
--     pessoa. O remove apaga a filiação primeiro ("User is not a member of
--     this workspace" quando já não há), chama o release (saída (b)) e
--     notifica. O leave passa a posse como antes (o sucessor travado FOR
--     UPDATE), chama o release e então apaga a filiação. A última pessoa:
--     release, as categorias dela vão para o privado ainda com o nome do W, e
--     o W é apagado (a cascata leva as sobras de ex-membros pela saída (a) e
--     pelo gatilho de categorias);
--   * sem as policies wm_owner_delete e finance_workspaces_delete (sem REVOKE
--     de tabela): a filiação só sai pelas RPCs e o W só é apagado pelo leave
--     da última pessoa. O app não usa esses caminhos (só lê as duas tabelas);
--   * private.finance_workspace_reconcile() (INVOKER, sem EXECUTE para
--     clientes): aplica o release a cada (pessoa, workspace) com linha no W e
--     sem filiação, e desvincula a receita ou despesa fora do escopo do dono da
--     venda ou compra (de outra pessoa, privada ou num W de que o dono não é
--     membro). Roda uma vez no fim desta migration (backfill, sem usuário) e
--     serve para depois de um restore de backup antigo.
--
-- Regra dos gatilhos (docs/api-arquitetura.md §1.5): a guarda continua
-- pulando sem usuário, e as saídas (a) e (b) só valem para workspace → null
-- com o mesmo autor. Os gatilhos do API-028 (store_sale_rules,
-- store_sale_item_rules) não mudam: o ensaio provou que aceitam o UPDATE só de
-- workspace_id e o transaction_id → null do release.
--
-- Erros: os mesmos de antes (P0001 em inglês das RPCs de workspace; 42501 da
-- guarda). O app traduz em src/lib/data/financeWorkspace.ts.
--
-- Grants: a guarda segue sem EXECUTE para clientes; leave e remove só para
-- authenticated (o create or replace mantém o ACL). As 4 funções de private
-- não têm EXECUTE para clientes. Nenhuma função DEFINER nova em public: o
-- supabase/checks/sec012-grants.sql continua com 40.
--
-- Levantamento na produção: AINDA NÃO RODOU (o classificador barrou leituras
-- na produção). Roda antes do apply, só contagens: a seção 0 do bloco 1 de
-- supabase/checks/api064-workspace-exit.sql (workspaces e membros; linhas no W
-- de quem não é membro, por tabela, que o backfill resolve; categorias do W
-- com gêmea pessoal; referências cruzadas; vendas e compras travadas hoje;
-- dona inconsistente). O resultado entra neste cabeçalho. O de 12/10 (API-028)
-- deu 0 vendas, 1 produto, 1 compra e 1 cliente, e nenhuma linha de quem saiu.
--
-- Riscos registrados:
--   * Ordem: depois da 20261012120000_api028 (regra do item e policies de item
--     que seguem a venda). Em produção, a cadeia 012 → 013 → 016 → 021 → 024
--     → 028 → esta → 037. O front deste lote só vai para a main depois do
--     apply.
--   * Corrida: uma linha que quem sai insere entre o DELETE da filiação e o
--     commit (MVCC) fica no W, como já acontecia; o reconcile a resolve.
--   * As linhas movidas ganham updated_at novo (gatilhos do 028): a versão
--     otimista do API-052 verá conflito numa edição aberta durante a saída.
--   * Quem saiu continua autor da receita ou despesa que ficou no W (decisão
--     4): ele ainda a lê e altera em Transações; se tirá-la do W, a dona volta
--     a ver o 42501 da "receita de outra pessoa" nas RPCs da venda.
--   * O item de quem fica com produto de quem saiu: mudar a quantidade dá
--     P0002 (o produto ficou privado). A compra da dona de um produto de quem
--     saiu fica sem produto na tela e sai do capital parado (decisão 2; o
--     API-037 decide apagar produto com compra de outra pessoa).
--   * Empréstimos (4 tabelas, devedores são terceiros) continuam no W depois
--     da saída: card API-067. O trg_loan_payment_guard não deixa a saída (b)
--     tirar pagamentos do W.
--   * Finanças não está no realtime: os outros membros só deixam de ver as
--     linhas de quem saiu depois de recarregar.

-- ---------------------------------------------------------------------------
-- 1. A guarda de workspace (create or replace: mesmo OID nos 16 gatilhos)
-- ---------------------------------------------------------------------------

create or replace function public.finance_guard_workspace()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Sem usuário (restauração, cron, migration): não há de quem conferir a filiação.
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  -- INSERT: se aponta para um workspace, o autor precisa ser membro.
  if tg_op = 'INSERT' then
    if new.workspace_id is not null and not public.is_workspace_member(new.workspace_id) then
      raise exception 'Nao e membro do workspace %', new.workspace_id
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: só o autor realoca a linha ou troca o dono (um JWT sem sub não é
  -- o autor). Exceção, só para workspace → privado com o mesmo autor:
  --   (a) o workspace antigo já não existe: o SET NULL de apagá-lo, também na
  --       sobra de quem saiu antes (o item e a receita na venda de outra
  --       pessoa ficam no W de propósito);
  --   (b) private.finance_workspace_release ligou akool.ws_release para este
  --       workspace, o autor já não é membro dele e quem grava é a dona: o
  --       remove_workspace_member, que apaga a filiação antes. Cliente não liga
  --       o GUC, então o RLS que deixa o membro atualizar linhas de outra
  --       pessoa (pagamentos e garantias de empréstimo) não chega aqui.
  if tg_op = 'UPDATE' then
    if (new.workspace_id is distinct from old.workspace_id
        or new.user_id is distinct from old.user_id)
       and old.user_id is distinct from auth.uid()
       and not (new.workspace_id is null
                and old.workspace_id is not null
                and new.user_id is not distinct from old.user_id
                and (not exists (select 1 from public.finance_workspaces w where w.id = old.workspace_id)
                     or (current_setting('akool.ws_release', true) = old.workspace_id::text
                         and not exists (select 1 from public.finance_workspace_members m
                                          where m.workspace_id = old.workspace_id and m.user_id = old.user_id)
                         and exists (select 1 from public.finance_workspace_members m
                                      where m.workspace_id = old.workspace_id and m.user_id = auth.uid()
                                        and m.role = 'owner')))) then
      raise exception 'Somente o autor pode realocar o lancamento'
        using errcode = '42501';
    end if;
    -- Se realocar para um workspace, precisa ser membro do destino.
    if new.workspace_id is not null
       and new.workspace_id is distinct from old.workspace_id
       and not public.is_workspace_member(new.workspace_id) then
      raise exception 'Nao e membro do workspace de destino %', new.workspace_id
        using errcode = '42501';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.finance_guard_workspace() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Vínculo entre duas pessoas (a regra do profile_is_related, sem auth.uid())
-- ---------------------------------------------------------------------------

-- O mesmo OR de public.profile_is_related (api012_goals_fixes), entre p_a e
-- p_b, sem contar o workspace p_except_workspace (o que está sendo deixado).
-- Se a regra de lá mudar, esta muda junto.
create function private.finance_people_related(p_a uuid, p_b uuid, p_except_workspace uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_a = p_b, false)
    or exists (select 1 from public.page_shares s
                where (s.owner_id = p_a and s.shared_with_user_id = p_b)
                   or (s.shared_with_user_id = p_a and s.owner_id = p_b))
    or exists (select 1 from public.project_shares s
                where (s.owner_id = p_a and s.shared_with_user_id = p_b)
                   or (s.shared_with_user_id = p_a and s.owner_id = p_b))
    or exists (select 1 from public.finance_goal_shares s
                 join public.finance_goals g on g.id = s.goal_id and g.user_id = s.owner_id
                where (s.owner_id = p_a and s.shared_with_user_id = p_b)
                   or (s.shared_with_user_id = p_a and s.owner_id = p_b))
    or exists (select 1 from public.finance_workspace_members m1
                 join public.finance_workspace_members m2 on m1.workspace_id = m2.workspace_id
                where m1.user_id = p_a and m2.user_id = p_b
                  and m1.workspace_id is distinct from p_except_workspace)
    or exists (select 1 from public.finance_loan_borrowers b
                where (b.user_id = p_a and b.borrower_user_id = p_b)
                   or (b.borrower_user_id = p_a and b.user_id = p_b))
$$;

revoke execute on function private.finance_people_related(uuid, uuid, uuid) from public, anon, authenticated;
comment on function private.finance_people_related(uuid, uuid, uuid) is
  'API-064: a regra de public.profile_is_related entre duas pessoas, sem auth.uid() e sem o workspace informado. Só roda dentro de private.finance_workspace_release.';

-- ---------------------------------------------------------------------------
-- 3. O que sai do workspace com a pessoa
-- ---------------------------------------------------------------------------

create function private.finance_workspace_release(p_user uuid, p_workspace uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_user is null or p_workspace is null then
    return;
  end if;
  -- Saída (b) da guarda: só para este workspace e só até o fim desta função.
  perform set_config('akool.ws_release', p_workspace::text, true);

  -- 1. Vendas de quem sai, primeiro (a regra do item do API-028 depende do
  --    workspace da venda). A receita de OUTRA pessoa é desvinculada no mesmo
  --    UPDATE e fica no W como lançamento comum (decisão 5); a venda PRIVADA de
  --    quem sai com receita de outra pessoa no W também.
  update public.finance_store_sales s
     set workspace_id = null,
         transaction_id = case when exists (select 1 from public.finance_transactions t
                                             where t.id = s.transaction_id and t.user_id <> p_user)
                               then null else s.transaction_id end
   where s.user_id = p_user and s.workspace_id = p_workspace;
  update public.finance_store_sales s
     set transaction_id = null
   where s.user_id = p_user and s.workspace_id is null
     and exists (select 1 from public.finance_transactions t
                  where t.id = s.transaction_id and t.user_id <> p_user and t.workspace_id = p_workspace);

  -- 2. Os itens de quem sai nas vendas que já não estão no W (as dele e as de
  --    quem saiu antes). O item dele na venda de quem fica, fica (segue a
  --    venda); o item de outra pessoa na venda dele também fica, com o
  --    workspace antigo, e segue a venda.
  update public.finance_store_sale_items i
     set workspace_id = null
    from public.finance_store_sales s
   where s.id = i.sale_id and s.workspace_id is null
     and i.user_id = p_user and i.workspace_id = p_workspace;

  -- 3. Os produtos dele e só então as compras dele (a despesa de outra pessoa
  --    é desvinculada, como a receita).
  update public.finance_store_products p
     set workspace_id = null
   where p.user_id = p_user and p.workspace_id = p_workspace;
  update public.finance_store_purchases pu
     set workspace_id = null,
         transaction_id = case when exists (select 1 from public.finance_transactions t
                                             where t.id = pu.transaction_id and t.user_id <> p_user)
                               then null else pu.transaction_id end
   where pu.user_id = p_user and pu.workspace_id = p_workspace;
  update public.finance_store_purchases pu
     set transaction_id = null
   where pu.user_id = p_user and pu.workspace_id is null
     and exists (select 1 from public.finance_transactions t
                  where t.id = pu.transaction_id and t.user_id <> p_user and t.workspace_id = p_workspace);

  -- 4. Clientes e fornecedores.
  update public.finance_store_customers c
     set workspace_id = null
   where c.user_id = p_user and c.workspace_id = p_workspace;
  update public.finance_suppliers f
     set workspace_id = null
   where f.user_id = p_user and f.workspace_id = p_workspace;

  -- 5. As transações dele, menos a receita ou despesa ligada a venda ou compra
  --    de OUTRA pessoa que continua membro do W, privada ou não (decisão 4).
  update public.finance_transactions t
     set workspace_id = null
   where t.user_id = p_user and t.workspace_id = p_workspace
     and not exists (select 1 from public.finance_store_sales s
                      where s.transaction_id = t.id and s.user_id <> p_user
                        and exists (select 1 from public.finance_workspace_members m
                                     where m.workspace_id = p_workspace and m.user_id = s.user_id))
     and not exists (select 1 from public.finance_store_purchases pu
                      where pu.transaction_id = t.id and pu.user_id <> p_user
                        and exists (select 1 from public.finance_workspace_members m
                                     where m.workspace_id = p_workspace and m.user_id = pu.user_id));

  -- 6. Orçamentos, metas e recorrentes, como antes.
  update public.finance_budgets b
     set workspace_id = null
   where b.user_id = p_user and b.workspace_id = p_workspace;
  update public.finance_goals g
     set workspace_id = null
   where g.user_id = p_user and g.workspace_id = p_workspace;
  update public.finance_recurring r
     set workspace_id = null
   where r.user_id = p_user and r.workspace_id = p_workspace;

  -- 7. As contas dele que nenhuma linha de outra pessoa usa (decisão 3: o
  --    saldo dos outros não muda). As categorias do W ficam no W.
  update public.finance_accounts a
     set workspace_id = null
   where a.user_id = p_user and a.workspace_id = p_workspace
     and not exists (select 1 from public.finance_transactions x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_recurring x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_goals x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_store_sales x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_store_purchases x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_loans x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_loan_payments x where x.account_id = a.id and x.user_id <> p_user);

  -- 8. shared_with_user_id = quem sai, nas linhas de outras pessoas que ficam
  --    no W, quando as duas não têm outro vínculo (decisão 10). Sem isso o
  --    WITH CHECK do SEC-013 trava a edição da linha pelo próprio dono.
  update public.finance_transactions t
     set shared_with_user_id = null
   where t.shared_with_user_id = p_user and t.user_id <> p_user and t.workspace_id = p_workspace
     and not private.finance_people_related(t.user_id, p_user, p_workspace);
  update public.finance_budgets b
     set shared_with_user_id = null
   where b.shared_with_user_id = p_user and b.user_id <> p_user and b.workspace_id = p_workspace
     and not private.finance_people_related(b.user_id, p_user, p_workspace);

  perform set_config('akool.ws_release', '', true);
end;
$$;

revoke execute on function private.finance_workspace_release(uuid, uuid) from public, anon, authenticated;
comment on function private.finance_workspace_release(uuid, uuid) is
  'API-064/065: tira do workspace as linhas de p_user (Loja, fornecedores, transações, orçamentos, metas, recorrentes e contas sem uso de outra pessoa), mantém as categorias e a receita ou despesa ligada a venda ou compra de quem continua membro, desvincula a de outra pessoa e limpa o shared_with sem outro vínculo. Liga akool.ws_release (saída (b) da guarda) e desliga no fim. Só roda dentro de leave_workspace, remove_workspace_member e finance_workspace_reconcile.';

-- ---------------------------------------------------------------------------
-- 4. Categoria que vai para o privado com o nome de uma pessoal: renomeia
-- ---------------------------------------------------------------------------

create function private.finance_category_ws_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suffix text;
  v_name text;
  v_n integer := 1;
begin
  -- Padrão da linha, não validação: vale também sem usuário (cascata de
  -- apagar o workspace, exclusão de conta, restore).
  if new.workspace_id is not null or old.workspace_id is null then
    return new;
  end if;
  if not exists (select 1 from public.finance_categories c
                  where c.user_id = new.user_id and c.workspace_id is null
                    and c.name = new.name and c.type = new.type and c.id <> new.id) then
    return new;
  end if;
  select nullif(btrim(w.name), '') into v_suffix from public.finance_workspaces w where w.id = old.workspace_id;
  v_suffix := coalesce(v_suffix, 'workspace');
  v_name := format('%s (%s)', new.name, v_suffix);
  while exists (select 1 from public.finance_categories c
                 where c.user_id = new.user_id and c.workspace_id is null
                   and c.name = v_name and c.type = new.type and c.id <> new.id) loop
    v_n := v_n + 1;
    v_name := format('%s (%s %s)', new.name, v_suffix, v_n);
  end loop;
  new.name := v_name;
  return new;
end;
$$;

revoke execute on function private.finance_category_ws_exit() from public, anon, authenticated;
comment on function private.finance_category_ws_exit() is
  'API-064: gatilho BEFORE UPDATE OF workspace_id em finance_categories. Na ida de um workspace para o privado, renomeia para "Nome (nome do W)" (ou "(workspace)" quando o W já sumiu, com número até ficar único) se o autor já tem a pessoal igual: a UNIQUE NULLS NOT DISTINCT (user_id, name, type, workspace_id) dava 23505. Vale também sem usuário.';

-- O nome ordena antes de trg_finance_categories_ws_guard (os BEFORE rodam em
-- ordem de nome).
create trigger finance_categories_ws_exit
  before update of workspace_id on public.finance_categories
  for each row execute function private.finance_category_ws_exit();

-- ---------------------------------------------------------------------------
-- 5. Remover membro e sair (create or replace: mesmos grants e mensagens)
-- ---------------------------------------------------------------------------

create or replace function public.remove_workspace_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_my_membership public.finance_workspace_members%rowtype;
  v_ws uuid;
  v_ws_name text;
  v_remover_name text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  -- Trava a filiação de quem remove: serializa com o leave e com outra aba.
  select * into v_my_membership from public.finance_workspace_members where user_id = v_uid for update;
  if v_my_membership.id is null then raise exception 'Not in a workspace'; end if;
  if v_my_membership.role <> 'owner' then raise exception 'Only the owner can remove members'; end if;
  if p_user_id = v_uid then raise exception 'Cannot remove yourself'; end if;
  v_ws := v_my_membership.workspace_id;
  -- A filiação sai primeiro: a saída (b) da guarda exige o autor fora do W.
  -- Se quem sai foi mais rápido (leave em curso), o DELETE espera e não acha.
  delete from public.finance_workspace_members where workspace_id = v_ws and user_id = p_user_id;
  if not found then raise exception 'User is not a member of this workspace'; end if;
  select name into v_ws_name from public.finance_workspaces where id = v_ws;
  select coalesce(display_name, email) into v_remover_name from public.profiles where id = v_uid;
  perform private.finance_workspace_release(p_user_id, v_ws);
  perform public._notify(
    p_user_id,
    'member_left',
    coalesce(v_remover_name, 'O administrador') || ' removeu você de "' || coalesce(v_ws_name, 'Família') || '"',
    'Você foi removido do workspace.',
    jsonb_build_object('workspace_id', v_ws, 'actor_id', v_uid)
  );
end;
$$;

create or replace function public.leave_workspace()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_membership public.finance_workspace_members%rowtype;
  v_next public.finance_workspace_members%rowtype;
  v_ws uuid;
  v_ws_name text;
  v_leaver_name text;
  v_member record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  -- Trava a própria filiação: um remove concorrente espera e não acha mais ninguém.
  select * into v_membership from public.finance_workspace_members where user_id = v_uid for update;
  if v_membership.id is null then raise exception 'Not in a workspace'; end if;
  v_ws := v_membership.workspace_id;
  if v_membership.role = 'owner' then
    -- A posse vai para o membro mais antigo (travado: se ele estiver saindo, o
    -- próximo é escolhido depois do commit dele).
    select * into v_next from public.finance_workspace_members
     where workspace_id = v_ws and user_id <> v_uid
     order by joined_at asc, id asc
     limit 1
     for update;
    if v_next.id is null then
      -- A última pessoa: as linhas dela saem, as categorias dela vão para o
      -- privado ainda com o nome do W (o gatilho renomeia na colisão) e o W é
      -- apagado. As sobras de ex-membros saem na cascata (saída (a)).
      perform private.finance_workspace_release(v_uid, v_ws);
      update public.finance_categories set workspace_id = null where user_id = v_uid and workspace_id = v_ws;
      delete from public.finance_workspaces where id = v_ws;
      return;
    end if;
    update public.finance_workspace_members set role = 'owner' where id = v_next.id;
    update public.finance_workspaces set owner_id = v_next.user_id where id = v_ws;
  end if;
  select name into v_ws_name from public.finance_workspaces where id = v_ws;
  select coalesce(display_name, email) into v_leaver_name from public.profiles where id = v_uid;
  -- Com a filiação ainda presente: quem grava é o autor, a saída (b) não entra.
  perform private.finance_workspace_release(v_uid, v_ws);
  delete from public.finance_workspace_members where id = v_membership.id;
  for v_member in select user_id from public.finance_workspace_members where workspace_id = v_ws and user_id <> v_uid
  loop
    perform public._notify(
      v_member.user_id,
      'member_left',
      coalesce(v_leaver_name, 'Alguém') || ' saiu de "' || coalesce(v_ws_name, 'Família') || '"',
      'Um membro saiu do workspace.',
      jsonb_build_object('workspace_id', v_ws, 'actor_id', v_uid)
    );
  end loop;
end;
$$;

revoke execute on function public.remove_workspace_member(uuid) from public, anon;
revoke execute on function public.leave_workspace() from public, anon;
grant execute on function public.remove_workspace_member(uuid) to authenticated;
grant execute on function public.leave_workspace() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sem atalho: a filiação e o workspace só saem pelas RPCs
-- ---------------------------------------------------------------------------

drop policy if exists wm_owner_delete on public.finance_workspace_members;
drop policy if exists finance_workspaces_delete on public.finance_workspaces;

-- ---------------------------------------------------------------------------
-- 7. Sobras de quem já saiu (backfill agora e depois de um restore antigo)
-- ---------------------------------------------------------------------------

create function private.finance_workspace_reconcile()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_pair record;
  v_pairs integer := 0;
  v_sales integer;
  v_purchases integer;
begin
  -- Cada (pessoa, workspace) com linha no W sem filiação: as sobras do leave e
  -- do remove antigos, do DELETE direto da filiação e de um restore antigo. O
  -- shared_with entra para a limpeza do passo 8 do release.
  for v_pair in
    select distinct r.user_id, r.workspace_id
      from (select x.user_id, x.workspace_id from public.finance_transactions x
            union all select x.shared_with_user_id, x.workspace_id from public.finance_transactions x where x.shared_with_user_id is not null
            union all select x.user_id, x.workspace_id from public.finance_budgets x
            union all select x.shared_with_user_id, x.workspace_id from public.finance_budgets x where x.shared_with_user_id is not null
            union all select x.user_id, x.workspace_id from public.finance_accounts x
            union all select x.user_id, x.workspace_id from public.finance_goals x
            union all select x.user_id, x.workspace_id from public.finance_recurring x
            union all select x.user_id, x.workspace_id from public.finance_store_products x
            union all select x.user_id, x.workspace_id from public.finance_store_purchases x
            union all select x.user_id, x.workspace_id from public.finance_store_sales x
            union all select x.user_id, x.workspace_id from public.finance_store_sale_items x
            union all select x.user_id, x.workspace_id from public.finance_store_customers x
            union all select x.user_id, x.workspace_id from public.finance_suppliers x) r
     where r.workspace_id is not null
       and not exists (select 1 from public.finance_workspace_members m
                        where m.workspace_id = r.workspace_id and m.user_id = r.user_id)
     order by r.workspace_id, r.user_id
  loop
    perform private.finance_workspace_release(v_pair.user_id, v_pair.workspace_id);
    v_pairs := v_pairs + 1;
  end loop;

  -- A receita ou despesa fora do escopo do dono da venda ou compra (de outra
  -- pessoa e fora de um W de que o dono é membro: a privada de um ex-membro,
  -- que travava a dona com 42501) é desvinculada. Nada volta ao W.
  update public.finance_store_sales s
     set transaction_id = null
    from public.finance_transactions t
   where t.id = s.transaction_id and t.user_id <> s.user_id
     and not (t.workspace_id is not null
              and exists (select 1 from public.finance_workspace_members m
                           where m.workspace_id = t.workspace_id and m.user_id = s.user_id));
  get diagnostics v_sales = row_count;
  update public.finance_store_purchases pu
     set transaction_id = null
    from public.finance_transactions t
   where t.id = pu.transaction_id and t.user_id <> pu.user_id
     and not (t.workspace_id is not null
              and exists (select 1 from public.finance_workspace_members m
                           where m.workspace_id = t.workspace_id and m.user_id = pu.user_id));
  get diagnostics v_purchases = row_count;

  return jsonb_build_object('pairs', v_pairs, 'sales_unlinked', v_sales, 'purchases_unlinked', v_purchases);
end;
$$;

revoke execute on function private.finance_workspace_reconcile() from public, anon, authenticated;
comment on function private.finance_workspace_reconcile() is
  'API-064: aplica private.finance_workspace_release a cada (pessoa, workspace) com linha no W e sem filiação e desvincula a receita ou despesa fora do escopo do dono da venda ou compra. Devolve {pairs, sales_unlinked, purchases_unlinked}. Rodar como postgres, sem usuário, depois de um restore de backup antigo.';

-- Backfill: sem usuário, as guardas e as regras do API-028 pulam.
do $backfill$
declare
  v_result jsonb;
begin
  v_result := private.finance_workspace_reconcile();
  raise notice 'API-064 backfill: %', v_result;
end
$backfill$;
