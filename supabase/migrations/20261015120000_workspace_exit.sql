-- Saída do workspace: sair (leave_workspace) ou ser removido
-- (remove_workspace_member) leva as linhas da pessoa, inclusive as da Loja, os
-- fornecedores e os empréstimos; o que outras pessoas usam fica no workspace e
-- passa para a dona; e a dona consegue remover quem tem lançamentos.
--
-- Antes (reproduzido no staging em DO desfeito, 14 e 15/10/2026):
--   * leave_workspace e remove_workspace_member (baseline, DEFINER,
--     search_path=public) anulavam o workspace_id de só 6 tabelas. Produtos,
--     compras, vendas, itens, clientes e fornecedores de quem saiu continuavam
--     visíveis e editáveis para os outros membros: um membro editou o cliente
--     de quem saiu e apagou o fornecedor dele. Clientes são dados de terceiros.
--     Os empréstimos e os devedores (terceiros) também ficavam;
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
--     ex-membro: o SET NULL da cascata passava pela guarda com o uid dela, e o
--     pagamento de empréstimo de ex-membro, pelo trg_loan_payment_guard;
--   * as policies wm_owner_delete e finance_workspaces_delete deixavam apagar a
--     filiação ou o workspace direto pelo PostgREST, sem limpeza nenhuma (e um
--     W ficava sem dona, ou sem membros);
--   * a receita (ou despesa) que um membro lançou na venda (ou compra) de
--     outra pessoa virava privada dele ao sair, e a dona ficava travada com
--     42501 na própria venda; o caso simétrico também travava;
--   * shared_with_user_id apontando para quem saiu travava a edição da linha
--     pelo próprio dono (WITH CHECK do SEC-013: profile_is_related), no W e no
--     privado, nos dois sentidos;
--   * as categorias e contas do W continuavam em nome de quem saiu: ele (pelo
--     PostgREST) ou a exclusão da conta dele apagava a categoria e, em
--     cascata, os orçamentos dos membros;
--   * os convites pendentes que quem saiu enviou continuavam valendo, e
--     qualquer membro gravava convite direto (policy wi_member_insert, sem
--     conferir invited_by nem passar pelo limite do invite_member), inclusive
--     em nome de outra pessoa;
--   * quem saiu continuava alterando e apagando os próprios aportes numa meta
--     do W que ele já não vê (policies de aporte só com user_id), e mudava o
--     acumulado que os membros veem.
--
-- Depois:
--   * public.finance_guard_workspace(): create or replace (mesmo OID, os 16
--     trg_*_ws_guard continuam nela), DEFINER, search_path=public, sem EXECUTE
--     para clientes. "<>" vira "is distinct from" (JWT de cliente sem sub cai
--     na guarda, não só no RLS). No UPDATE de linha de outra pessoa, três
--     saídas estreitas:
--       (a) workspace → privado, mesmo autor, e o workspace antigo já não
--           existe (o SET NULL de apagá-lo), sem GUC;
--       (b) workspace → privado, mesmo autor, com o GUC transacional
--           akool.ws_release igual ao workspace antigo, o autor já não é
--           membro dele e quem grava é membro (a dona no remove; quem sai, na
--           saída em cadeia do leave e, se é a última pessoa, nos empréstimos
--           de ex-membros);
--       (c) a troca de autor que passa para a dona o que fica no W: só em
--           categorias, contas e metas, com o mesmo GUC, workspace sem mudar,
--           autor que já não é membro e o novo autor sendo quem grava e dona
--           do W (o remove).
--     Só private.finance_workspace_release liga o GUC (e desliga ao
--     terminar); nenhum cliente o liga pelo PostgREST. Numa sessão que nunca o
--     ligou, current_setting devolve NULL: a guarda compara com coalesce, e
--     NULL não vira "passa";
--   * private.finance_workspace_release(p_user, p_workspace) (INVOKER,
--     search_path vazio, sem EXECUTE para clientes; roda dentro das DEFINER e
--     do reconcile). Começa com pg_advisory_xact_lock por workspace (duas
--     saídas no mesmo W com shared_with cruzado travariam linhas em ordem
--     oposta). Tira do workspace o que é de quem sai (linhas que ele criou,
--     user_id), nesta ordem: as vendas dele (desvinculando a receita de outra
--     pessoa, que fica no W como lançamento comum); os itens dele nessas
--     vendas; os produtos dele e depois as compras dele (desvinculando a
--     despesa de outra pessoa); clientes e fornecedores; as transações dele,
--     menos as ligadas a venda ou compra de OUTRA pessoa que continua membro
--     (mesmo que a venda ou compra seja privada: a receita segue a venda, como
--     o item já segue no API-028). A receita ou despesa desvinculada que é de
--     quem já não é membro (saída em cadeia) vai para o privado do autor, a
--     não ser que uma venda ou compra de quem continua membro a use.
--     Depois: orçamentos e recorrentes; as metas sem aporte de outra pessoa
--     (a meta com dinheiro dos outros fica no W, e os aportes de quem sai vão
--     para uma cópia privada dela); os empréstimos dele sem pagamento nem
--     garantia de outra pessoa, com os pagamentos e as garantias, e os
--     devedores dele que nenhum empréstimo que fica usa (pagamentos antes do
--     empréstimo: o trg_loan_payment_guard só deixa mexer no pagamento com o
--     empréstimo no W); as categorias do W que só ele usa (nenhuma transação,
--     orçamento ou recorrente de outra pessoa, nem linha que fica no W, aponta
--     para elas); as contas que nenhuma linha de outra pessoa nem linha que
--     fica no W usa. As categorias que ficam no W e que as linhas privadas
--     dele usam ganham uma cópia pessoal dele (private.finance_category_split),
--     para onde essas linhas passam: sem isso, um membro que apagasse a
--     categoria do W levaria em cascata os orçamentos privados dele. O que fica
--     no W (categorias, contas e metas) passa para a dona (num W com duas
--     donas, a que remove); no leave da dona, para o sucessor, já promovido; o
--     compartilhamento que quem sai fez da meta que passa é apagado. Sem dona
--     (a última pessoa), nada muda de autor, e os empréstimos de ex-membros
--     que ainda estão no W vão para o privado dos autores, assim como as
--     cópias de categoria das linhas privadas dos outros. Por fim limpa
--     shared_with_user_id entre quem sai e cada outra pessoa, nas linhas do W
--     e nas privadas, nos dois sentidos, quando as duas não têm outro vínculo
--     (private.finance_people_related: a regra do profile_is_related, entre
--     duas pessoas, sem auth.uid() e sem o workspace que está sendo deixado).
--     A venda ou compra PRIVADA de quem sai ligada a receita ou despesa de
--     outra pessoa no W também é desvinculada;
--   * private.finance_category_ws_exit() (gatilho finance_categories_ws_exit,
--     BEFORE UPDATE OF workspace_id em finance_categories, DEFINER, search_path
--     vazio, sem EXECUTE): na ida de um workspace para o privado, se o autor já
--     tem categoria pessoal com o mesmo nome e tipo, renomeia para "Nome (nome
--     do W)", ou "Nome (workspace)" quando o W já sumiu, com número até ficar
--     único ("Nome (Casa 2)"). A regra do nome fica em
--     private.finance_category_free_name, que a cópia de categoria também usa
--     (um INSERT não passa pelo gatilho). É padrão da linha: vale também sem
--     usuário (cascata, exclusão de conta, restore). O nome ordena antes de
--     trg_finance_categories_ws_guard;
--   * remove_workspace_member e leave_workspace: create or replace, DEFINER,
--     search_path vazio (tudo qualificado, inclusive public._notify), mesmas
--     mensagens e grants. Começam com SELECT ... FOR UPDATE na filiação de
--     quem chama, o que serializa sair × remover e as duas abas da mesma
--     pessoa. O remove apaga a filiação primeiro ("User is not a member of
--     this workspace" quando já não há), apaga os convites pendentes que o
--     removido enviou, chama o release (saídas (b) e (c)) e notifica. O leave
--     passa a posse como antes (o sucessor travado FOR UPDATE), apaga os
--     convites pendentes de quem sai, chama o release e então apaga a
--     filiação. A última pessoa: release, as categorias dela que ficaram vão
--     para o privado ainda com o nome do W, e o W é apagado (a cascata leva
--     as outras sobras de ex-membros pela saída (a) e pelo gatilho de
--     categorias; os convites vão em cascata);
--   * sem as policies wm_owner_delete e finance_workspaces_delete (sem REVOKE
--     de tabela): a filiação só sai pelas RPCs e o W só é apagado pelo leave
--     da última pessoa (ou pelo reconcile, quando já não tem membros). O app
--     não usa esses caminhos (só lê as duas tabelas);
--   * sem a policy wi_member_insert (sem REVOKE de tabela): convite só pelo
--     invite_member (DEFINER, com o limite do SEC-016 e invited_by = quem
--     chama). O app não grava convite direto;
--   * finance_goal_contributions_update e _delete: além do autor, a meta tem de
--     continuar visível para ele (a mesma regra do INSERT: dono, membro do W ou
--     share do dono). Quem saiu já não altera nem apaga o aporte que deixou
--     numa meta do W;
--   * private.finance_workspace_reconcile() (INVOKER, sem EXECUTE para
--     clientes; rodar sem usuário): apaga o W sem membros (a cascata leva tudo
--     para o privado dos autores); no W com membros e sem dona, promove o
--     membro mais antigo (o critério do leave); aplica o release a cada
--     (pessoa, workspace) com linha no W e sem filiação (empréstimos
--     inclusive), a cada ex-membro com linha privada numa categoria do W, e a
--     cada par de pessoas com linha privada compartilhada sem outro vínculo;
--     apaga os convites pendentes de quem já não é membro; e desvincula a
--     receita ou despesa fora do escopo do dono da venda ou compra (de outra
--     pessoa, privada ou num W de que o dono não é membro). Roda uma vez no fim
--     desta migration (backfill) e no fim de todo restore_site_backup;
--   * public.restore_site_backup(jsonb): create or replace com o mesmo corpo,
--     DEFINER e grants (só service_role), e o reconcile no fim, na mesma
--     transação; as contagens vão no resumo, na chave workspace_reconcile. Um
--     backup anterior a esta migration traria de volta as sobras de quem saiu.
--
-- Regra dos gatilhos (supabase/migrations/README.md, "Gatilhos que dependem
-- do usuário"): a guarda continua pulando sem usuário, e as saídas (b) e (c)
-- exigem o GUC. Os gatilhos do API-028 (store_sale_rules,
-- store_sale_item_rules) não mudam: o ensaio provou que aceitam o UPDATE só de
-- workspace_id e o transaction_id → null do release.
--
-- Erros: os mesmos de antes (P0001 em inglês das RPCs de workspace; 42501 da
-- guarda). O app traduz em src/lib/data/financeWorkspace.ts, inclusive o
-- "Invite not found" do convite que a saída de quem convidou apagou.
--
-- Grants: a guarda segue sem EXECUTE para clientes; leave e remove só para
-- authenticated (o create or replace mantém o ACL); o restore, só para
-- service_role. As 6 funções de private não têm EXECUTE para clientes. Nenhuma
-- função DEFINER nova em public: o supabase/checks/sec012-grants.sql continua
-- com 29.
--
-- Levantamento na produção: AINDA NÃO RODOU (o classificador barrou leituras
-- na produção). Roda antes do apply, só contagens: o bloco 0 de
-- supabase/checks/workspace-exit.sql (workspaces e membros; linhas no W de
-- quem não é membro, por tabela, que o backfill resolve; categorias do W com
-- gêmea pessoal; referências cruzadas; vendas e compras travadas hoje; W sem
-- membros e W sem dona; metas do W com dinheiro de outra pessoa; pares de
-- linhas privadas compartilhadas sem vínculo; convites pendentes de quem já
-- saiu). O resultado entra neste cabeçalho. O de 12/10 (Loja) deu 0 vendas, 1
-- produto, 1 compra e 1 cliente, e nenhuma linha de quem saiu.
--
-- Riscos registrados:
--   * Ordem: depois da 20261015100000_remove_api_and_queue (o harness confere
--     29 DEFINER, número que só vale depois dela) e, portanto, da
--     20261012120000_api028_store_sales_server (regra do item e policies de
--     item que seguem a venda). O front desta correção só vai para a main
--     depois do apply.
--   * Empréstimos: o empréstimo de quem sai com pagamento ou garantia de outra
--     pessoa fica no W, com o autor (sem card; a tela de empréstimos saiu do
--     app, e as tabelas e as guardas continuam no banco), e o devedor que ele
--     usa também. Quem saiu ainda o altera pelo PostgREST. Na saída da última
--     pessoa tudo vai para o privado dos autores; só um pagamento no W de um
--     empréstimo que já está fora dele (o autor o tirou pelo PostgREST) ainda
--     trava a saída dela (42501 "Devedor so pode anexar comprovante…"; o app
--     mostra finance_workspace_error_loans).
--   * Contas: a conta de quem sai que outra pessoa usou uma vez (ou que a
--     receita ou a meta dele que fica no W usa) passa INTEIRA para a dona,
--     com o saldo inicial dele: some da lista dele, o saldo dela no W passa a
--     ser o saldo inicial mais só as linhas que ficam, e a dona pode apagá-la,
--     deixando em NULL o account_id dos lançamentos e recorrentes privados
--     dele (o recorrente dele continua lançando nessa conta enquanto ela
--     existir). Dar a conta original a quem sai e ao W uma cópia muda a
--     decisão aprovada e espera o OK do usuário.
--   * Categorias semeadas: quando a criadora sai, as que ninguém mais usou
--     vão com ela (renomeadas com o nome do W), e o W fica só com as que os
--     outros usam.
--   * Exclusão de conta (admin-ops delete_user, DELETE em auth.users) de quem
--     ainda é membro não passa pela saída: a da dona apaga o W
--     (finance_workspaces.owner_id ON DELETE CASCADE), e as categorias de quem
--     é excluído levam em cascata os orçamentos dos outros membros. Fechar
--     isso (gatilho em auth.users ou RPC do admin-ops antes do deleteUser)
--     espera o OK do usuário. Quem já saiu não tem mais nada no W para levar.
--   * Loja (fora do front desde o #43; as tabelas e o release continuam): a
--     compra de quem fica some em cascata quando o produto é apagado (por quem
--     saiu, que continua autor dele, ou por qualquer membro) ou quando a conta
--     de quem saiu é excluída; nessa exclusão, a venda de quem fica perde o
--     item e a receita de quem saiu. O item de quem fica com produto de quem
--     saiu: mudar a quantidade dá P0002 (o produto ficou privado). O vínculo
--     da compra com a despesa (transaction_id) não tem regra no banco.
--   * Convites: um convite que um membro gravou direto antes desta migration,
--     em nome de outra pessoa, não se distingue de um feito pelo invite_member;
--     o backfill só apaga os de quem já não é membro.
--   * Corrida: uma linha que outra sessão insere no W entre o release e o
--     commit (MVCC) fica no W, como já acontecia; o reconcile só a resolve
--     quando roda (backfill e restore).
--   * As linhas movidas da Loja ganham updated_at novo (gatilhos do 028).
--   * Quem saiu continua autor da receita ou despesa que ficou no W, ligada a
--     venda ou compra de quem fica: ele ainda a lê e altera em Transações; se
--     tirá-la do W, a dona volta a ver o 42501 da "receita de outra pessoa"
--     nas RPCs da venda.
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
declare
  v_release boolean;
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
  -- o autor). Exceções, todas na linha de quem já não é membro:
  --   (a) workspace → privado, mesmo autor, e o workspace antigo já não
  --       existe: o SET NULL de apagá-lo, também na sobra de quem saiu antes
  --       (o item e a receita na venda de outra pessoa ficam no W de propósito);
  --   (b) workspace → privado, mesmo autor, durante o release: o GUC
  --       akool.ws_release vale este workspace, o autor já não é membro dele e
  --       quem grava é membro (a dona no remove; quem sai, ao levar a receita
  --       desvinculada de um ex-membro);
  --   (c) o que fica no W passa para a dona: só categorias, contas e metas,
  --       durante o release, workspace sem mudar, e o novo autor é quem grava
  --       e é a dona do W (o remove).
  -- Cliente não liga o GUC, então o RLS que deixa o membro atualizar linhas de
  -- outra pessoa (pagamentos e garantias de empréstimo, categorias do W) não
  -- chega às exceções. Numa sessão que nunca ligou o GUC, current_setting
  -- devolve NULL: sem o coalesce, o NULL desligava a exceção do IF.
  if tg_op = 'UPDATE' then
    if (new.workspace_id is distinct from old.workspace_id
        or new.user_id is distinct from old.user_id)
       and old.user_id is distinct from auth.uid() then
      v_release := old.workspace_id is not null
                   and coalesce(current_setting('akool.ws_release', true), '') = old.workspace_id::text
                   and not exists (select 1 from public.finance_workspace_members m
                                    where m.workspace_id = old.workspace_id and m.user_id = old.user_id)
                   and public.is_workspace_member(old.workspace_id);
      if not ((new.workspace_id is null
               and old.workspace_id is not null
               and new.user_id is not distinct from old.user_id
               and not exists (select 1 from public.finance_workspaces w where w.id = old.workspace_id))
              or (v_release
                  and new.workspace_id is null
                  and new.user_id is not distinct from old.user_id)
              or (v_release
                  and tg_table_name in ('finance_categories', 'finance_accounts', 'finance_goals')
                  and new.workspace_id is not distinct from old.workspace_id
                  and new.user_id is not distinct from auth.uid()
                  and exists (select 1 from public.finance_workspace_members m
                               where m.workspace_id = old.workspace_id and m.user_id = auth.uid()
                                 and m.role = 'owner'))) then
        raise exception 'Somente o autor pode realocar o lancamento'
          using errcode = '42501';
      end if;
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
-- p_b, sem contar o workspace p_except_workspace (o que está sendo deixado;
-- null conta todos). Se a regra de lá mudar, esta muda junto.
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
  'Saída do workspace: a regra de public.profile_is_related entre duas pessoas, sem auth.uid() e sem o workspace informado (null conta todos). Só roda dentro do release e do reconcile.';

-- ---------------------------------------------------------------------------
-- 3. Categorias: o nome livre no privado e a cópia pessoal
-- ---------------------------------------------------------------------------

-- O nome que uma categoria de p_workspace pode ter no privado de p_user:
-- "Nome" se ele não tem a pessoal igual (nome e tipo), senão "Nome (nome do
-- W)", ou "Nome (workspace)" quando o W já sumiu, com número até ficar único
-- ("Nome (Casa 2)"). A UNIQUE NULLS NOT DISTINCT (user_id, name, type,
-- workspace_id) dava 23505 sem isso.
create function private.finance_category_free_name(p_user uuid, p_name text, p_type text, p_workspace uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_suffix text;
  v_name text;
  v_n integer := 1;
begin
  if not exists (select 1 from public.finance_categories c
                  where c.user_id = p_user and c.workspace_id is null
                    and c.name = p_name and c.type = p_type) then
    return p_name;
  end if;
  select nullif(btrim(w.name), '') into v_suffix from public.finance_workspaces w where w.id = p_workspace;
  v_suffix := coalesce(v_suffix, 'workspace');
  v_name := format('%s (%s)', p_name, v_suffix);
  while exists (select 1 from public.finance_categories c
                 where c.user_id = p_user and c.workspace_id is null
                   and c.name = v_name and c.type = p_type) loop
    v_n := v_n + 1;
    v_name := format('%s (%s %s)', p_name, v_suffix, v_n);
  end loop;
  return v_name;
end;
$$;

revoke execute on function private.finance_category_free_name(uuid, text, text, uuid) from public, anon, authenticated;
comment on function private.finance_category_free_name(uuid, text, text, uuid) is
  'Saída do workspace: o nome livre no privado de p_user para uma categoria de p_workspace ("Nome", "Nome (nome do W)" ou "Nome (W 2)"). Usada pelo gatilho finance_categories_ws_exit e pela cópia de private.finance_category_split.';

-- As categorias de p_workspace que as linhas PRIVADAS de p_user (transações,
-- orçamentos, recorrentes) usam ganham uma cópia pessoal dele (nome, tipo, cor
-- e ícone; o nome pela regra acima), e essas linhas passam para a cópia. Sem
-- isso elas apontam para uma categoria que ele não vê, e quem apaga a do W
-- (qualquer membro, ou a exclusão da conta do autor) leva em cascata os
-- orçamentos dele. Com p_own falso, as categorias do próprio p_user ficam de
-- fora (vão para o privado dele). Sempre uma categoria nova: reaproveitar a
-- pessoal de mesmo nome estoura a UNIQUE (user_id, category_id, month) do
-- orçamento do mesmo mês. Devolve quantas cópias criou.
create function private.finance_category_split(p_user uuid, p_workspace uuid, p_own boolean)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_cat record;
  v_copy uuid;
  v_n integer := 0;
begin
  for v_cat in
    select c.id, c.name, c.type, c.color, c.icon
      from public.finance_categories c
     where c.workspace_id = p_workspace
       and (p_own or c.user_id <> p_user)
       and (exists (select 1 from public.finance_transactions x
                     where x.category_id = c.id and x.user_id = p_user and x.workspace_id is null)
            or exists (select 1 from public.finance_budgets x
                        where x.category_id = c.id and x.user_id = p_user and x.workspace_id is null)
            or exists (select 1 from public.finance_recurring x
                        where x.category_id = c.id and x.user_id = p_user and x.workspace_id is null))
     order by c.name, c.type, c.id
  loop
    insert into public.finance_categories (user_id, workspace_id, name, type, color, icon)
    values (p_user, null, private.finance_category_free_name(p_user, v_cat.name, v_cat.type, p_workspace),
            v_cat.type, v_cat.color, v_cat.icon)
    returning id into v_copy;
    update public.finance_transactions x set category_id = v_copy
     where x.category_id = v_cat.id and x.user_id = p_user and x.workspace_id is null;
    update public.finance_budgets x set category_id = v_copy
     where x.category_id = v_cat.id and x.user_id = p_user and x.workspace_id is null;
    update public.finance_recurring x set category_id = v_copy
     where x.category_id = v_cat.id and x.user_id = p_user and x.workspace_id is null;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function private.finance_category_split(uuid, uuid, boolean) from public, anon, authenticated;
comment on function private.finance_category_split(uuid, uuid, boolean) is
  'Saída do workspace: cria para p_user uma cópia pessoal de cada categoria de p_workspace que as linhas privadas dele usam (com p_own falso, só as de outros autores) e passa essas linhas para a cópia. Só roda dentro do release.';

-- ---------------------------------------------------------------------------
-- 4. O que sai do workspace com a pessoa, e o que fica com a dona
-- ---------------------------------------------------------------------------

create function private.finance_workspace_release(p_user uuid, p_workspace uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_heir uuid;
  v_last boolean;
  v_unlinked uuid[];
  v_loans uuid[];
  v_goal record;
  v_copy uuid;
  v_person record;
begin
  if p_user is null or p_workspace is null then
    return;
  end if;
  -- Um release por vez em cada workspace: duas saídas (ou saída × remoção)
  -- com shared_with cruzado travariam as linhas em ordem oposta (40P01). Não
  -- trava as linhas do W para os INSERTs dos membros.
  perform pg_advisory_xact_lock(hashtextextended('akool.ws_release:' || p_workspace::text, 0));
  -- Saídas (b) e (c) da guarda: só para este workspace e só até o fim desta função.
  perform set_config('akool.ws_release', p_workspace::text, true);

  -- Quem fica com o que é de quem sai e continua no W: a dona (no leave da
  -- dona, o sucessor, já promovido). Num W com duas donas (legado), a que
  -- remove: a saída (c) exige que o novo autor seja quem grava. Sem dona (a
  -- última pessoa), ninguém herda e o autor não muda.
  select m.user_id into v_heir
    from public.finance_workspace_members m
   where m.workspace_id = p_workspace and m.role = 'owner' and m.user_id <> p_user
   order by coalesce(m.user_id = auth.uid(), false) desc, m.joined_at asc, m.id asc
   limit 1;
  -- A última pessoa: ninguém mais é membro (no leave dela).
  v_last := not exists (select 1 from public.finance_workspace_members m
                         where m.workspace_id = p_workspace and m.user_id <> p_user);

  -- A receita ou despesa de OUTRA pessoa que os passos 1 e 3 desvinculam (o
  -- passo 5b leva para o privado a de quem já não é membro).
  select coalesce(array_agg(t.id), '{}') into v_unlinked
    from public.finance_transactions t
   where t.user_id <> p_user
     and (exists (select 1 from public.finance_store_sales s
                   where s.transaction_id = t.id and s.user_id = p_user
                     and (s.workspace_id = p_workspace or (s.workspace_id is null and t.workspace_id = p_workspace)))
          or exists (select 1 from public.finance_store_purchases pu
                      where pu.transaction_id = t.id and pu.user_id = p_user
                        and (pu.workspace_id = p_workspace or (pu.workspace_id is null and t.workspace_id = p_workspace))));

  -- 1. Vendas de quem sai, primeiro (a regra do item do API-028 depende do
  --    workspace da venda). A receita de OUTRA pessoa é desvinculada no mesmo
  --    UPDATE e fica no W como lançamento comum; a venda PRIVADA de quem sai
  --    com receita de outra pessoa no W também.
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
  --    de OUTRA pessoa que continua membro do W, privada ou não: ela segue a
  --    venda, como o item.
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

  -- 5b. Saída em cadeia: a receita ou despesa desvinculada nos passos 1 e 3
  --     que é de quem já não é membro (lançada na venda de quem sai agora)
  --     vai para o privado do autor, em vez de ficar solta no W. Fica a que
  --     outra venda ou compra de quem continua membro usa: o transaction_id
  --     da compra não tem regra no banco, e um membro que ligasse a compra
  --     dele à receita de um ex-membro na venda da dona a empurraria para fora
  --     ao sair (a dona voltaria a ver 42501 na venda).
  update public.finance_transactions t
     set workspace_id = null
   where t.id = any(v_unlinked) and t.workspace_id = p_workspace
     and not exists (select 1 from public.finance_workspace_members m
                      where m.workspace_id = p_workspace and m.user_id = t.user_id)
     and not exists (select 1 from public.finance_store_sales s
                      where s.transaction_id = t.id and s.user_id <> p_user
                        and exists (select 1 from public.finance_workspace_members m
                                     where m.workspace_id = p_workspace and m.user_id = s.user_id))
     and not exists (select 1 from public.finance_store_purchases pu
                      where pu.transaction_id = t.id and pu.user_id <> p_user
                        and exists (select 1 from public.finance_workspace_members m
                                     where m.workspace_id = p_workspace and m.user_id = pu.user_id));

  -- 6. Orçamentos e recorrentes, como antes. Metas: só as sem aporte de
  --    outra pessoa; quem sai não leva meta com dinheiro dos outros.
  update public.finance_budgets b
     set workspace_id = null
   where b.user_id = p_user and b.workspace_id = p_workspace;
  update public.finance_recurring r
     set workspace_id = null
   where r.user_id = p_user and r.workspace_id = p_workspace;
  update public.finance_goals g
     set workspace_id = null
   where g.user_id = p_user and g.workspace_id = p_workspace
     and not exists (select 1 from public.finance_goal_contributions c
                      where c.goal_id = g.id and c.user_id <> p_user);

  -- 6a. A meta dele que fica no W passa para a dona (passo 9): os aportes dele
  --     vão para uma cópia privada da meta (sem conta), e no W ficam só os dos
  --     outros. Sem isso, um aporte de 0,01 de outro membro bastava para a
  --     dona ficar com a meta e poder apagá-la, com os aportes dele em cascata.
  if v_heir is not null then
    for v_goal in
      select g.id, g.name, g.icon, g.color, g.target_amount, g.deadline, g.status
        from public.finance_goals g
       where g.user_id = p_user and g.workspace_id = p_workspace
         and exists (select 1 from public.finance_goal_contributions c where c.goal_id = g.id and c.user_id = p_user)
       order by g.id
    loop
      insert into public.finance_goals (user_id, workspace_id, name, icon, color, target_amount, deadline, status)
      values (p_user, null, v_goal.name, v_goal.icon, v_goal.color, v_goal.target_amount, v_goal.deadline, v_goal.status)
      returning id into v_copy;
      update public.finance_goal_contributions c
         set goal_id = v_copy
       where c.goal_id = v_goal.id and c.user_id = p_user;
    end loop;
  end if;

  -- 6b. Empréstimos (devedores são terceiros): o empréstimo dele sem pagamento
  --     nem garantia de outra pessoa vai com ele, com os pagamentos e as
  --     garantias; o devedor dele vai junto quando nenhum empréstimo que fica
  --     no W, nem de outra pessoa, o usa. Os pagamentos primeiro: o
  --     trg_loan_payment_guard só deixa mexer no pagamento enquanto o
  --     empréstimo está no W (loan_is_owner).
  select coalesce(array_agg(l.id), '{}') into v_loans
    from public.finance_loans l
   where l.user_id = p_user and l.workspace_id = p_workspace
     and not exists (select 1 from public.finance_loan_payments x where x.loan_id = l.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_loan_collaterals x where x.loan_id = l.id and x.user_id <> p_user);
  update public.finance_loan_payments x
     set workspace_id = null
   where x.loan_id = any(v_loans) and x.workspace_id = p_workspace;
  update public.finance_loan_collaterals x
     set workspace_id = null
   where x.loan_id = any(v_loans) and x.workspace_id = p_workspace;
  update public.finance_loans l
     set workspace_id = null
   where l.id = any(v_loans);
  update public.finance_loan_borrowers b
     set workspace_id = null
   where b.user_id = p_user and b.workspace_id = p_workspace
     and not exists (select 1 from public.finance_loans l
                      where l.borrower_id = b.id and (l.user_id <> p_user or l.workspace_id = p_workspace));
  -- A última pessoa leva também o que ex-membros deixaram (com ela ainda
  --    membro, a saída (b) e o loan_is_owner deixam), na mesma ordem: senão
  --    o SET NULL de apagar o W esbarra no trg_loan_payment_guard.
  if v_last then
    update public.finance_loan_payments x set workspace_id = null where x.workspace_id = p_workspace;
    update public.finance_loan_collaterals x set workspace_id = null where x.workspace_id = p_workspace;
    update public.finance_loans x set workspace_id = null where x.workspace_id = p_workspace;
    update public.finance_loan_borrowers x set workspace_id = null where x.workspace_id = p_workspace;
  end if;

  -- 7. As categorias do W que só ele usa vão com ele (o gatilho
  --    finance_categories_ws_exit renomeia na colisão). Ficam as que uma
  --    transação, orçamento ou recorrente de outra pessoa usa, ou que a
  --    transação dele que ficou no W (passo 5) usa.
  update public.finance_categories c
     set workspace_id = null
   where c.user_id = p_user and c.workspace_id = p_workspace
     and not exists (select 1 from public.finance_transactions x
                      where x.category_id = c.id and (x.user_id <> p_user or x.workspace_id = p_workspace))
     and not exists (select 1 from public.finance_budgets x
                      where x.category_id = c.id and (x.user_id <> p_user or x.workspace_id = p_workspace))
     and not exists (select 1 from public.finance_recurring x
                      where x.category_id = c.id and (x.user_id <> p_user or x.workspace_id = p_workspace));

  -- 8. As contas dele que nenhuma linha de outra pessoa usa, nem a transação,
  --    a meta ou o empréstimo dele que ficou no W. A que fica passa inteira
  --    para a dona no passo 9, com o saldo inicial dele (riscos, no cabeçalho).
  update public.finance_accounts a
     set workspace_id = null
   where a.user_id = p_user and a.workspace_id = p_workspace
     and not exists (select 1 from public.finance_transactions x
                      where x.account_id = a.id and (x.user_id <> p_user or x.workspace_id = p_workspace))
     and not exists (select 1 from public.finance_recurring x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_goals x
                      where x.account_id = a.id and (x.user_id <> p_user or x.workspace_id = p_workspace))
     and not exists (select 1 from public.finance_store_sales x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_store_purchases x where x.account_id = a.id and x.user_id <> p_user)
     and not exists (select 1 from public.finance_loans x
                      where x.account_id = a.id and (x.user_id <> p_user or x.workspace_id = p_workspace))
     and not exists (select 1 from public.finance_loan_payments x
                      where x.account_id = a.id and (x.user_id <> p_user or x.workspace_id = p_workspace));

  -- 8b. As categorias que ficam no W e que as linhas privadas dele usam: uma
  --     cópia pessoal dele, para onde essas linhas passam (inclusive as dele
  --     que ficam e vão para a dona; sem herdeiro, as dele vão para o privado
  --     dele com o W). Na última pessoa, o mesmo para cada outra pessoa com
  --     linha privada numa categoria do W de outro autor: as dela vão para o
  --     privado dela, e as de ex-membros, para o deles, na cascata.
  perform private.finance_category_split(p_user, p_workspace, v_heir is not null);
  if v_last then
    for v_person in
      select distinct x.user_id
        from public.finance_categories c
        cross join lateral (select t.user_id from public.finance_transactions t
                             where t.category_id = c.id and t.workspace_id is null
                            union
                            select b.user_id from public.finance_budgets b
                             where b.category_id = c.id and b.workspace_id is null
                            union
                            select r.user_id from public.finance_recurring r
                             where r.category_id = c.id and r.workspace_id is null) x
       where c.workspace_id = p_workspace and x.user_id <> c.user_id and x.user_id <> p_user
       order by x.user_id
    loop
      perform private.finance_category_split(v_person.user_id, p_workspace, false);
    end loop;
  end if;

  -- 9. O que ficou no W (categorias, contas e metas) passa para a dona: quem
  --    saiu já não altera nem apaga essas linhas, e a exclusão da conta dele
  --    não as leva (nem, em cascata, os orçamentos dos membros). O
  --    compartilhamento que ele fez da meta que passa é apagado: a dona não o
  --    apagaria (é dele) nem recompartilharia com a mesma pessoa (UNIQUE), e
  --    o parceiro dele não veria a meta da dona.
  if v_heir is not null then
    delete from public.finance_goal_shares s
     using public.finance_goals g
     where g.id = s.goal_id and g.user_id = p_user and g.workspace_id = p_workspace and s.owner_id = p_user;
    update public.finance_categories c
       set user_id = v_heir
     where c.user_id = p_user and c.workspace_id = p_workspace;
    update public.finance_accounts a
       set user_id = v_heir
     where a.user_id = p_user and a.workspace_id = p_workspace;
    update public.finance_goals g
       set user_id = v_heir
     where g.user_id = p_user and g.workspace_id = p_workspace;
  end if;

  -- 10. shared_with_user_id entre quem sai e outra pessoa, nas linhas do W e
  --     nas privadas, nos dois sentidos, quando as duas não têm outro vínculo.
  --     Sem isso o WITH CHECK do SEC-013 trava a edição da linha pelo próprio
  --     dono, e quem saiu continua lendo a linha do outro.
  update public.finance_transactions t
     set shared_with_user_id = null
   where t.shared_with_user_id = p_user and t.user_id <> p_user
     and (t.workspace_id = p_workspace or t.workspace_id is null)
     and not private.finance_people_related(t.user_id, p_user, p_workspace);
  update public.finance_transactions t
     set shared_with_user_id = null
   where t.user_id = p_user and t.shared_with_user_id is not null and t.shared_with_user_id <> p_user
     and (t.workspace_id = p_workspace or t.workspace_id is null)
     and not private.finance_people_related(p_user, t.shared_with_user_id, p_workspace);
  update public.finance_budgets b
     set shared_with_user_id = null
   where b.shared_with_user_id = p_user and b.user_id <> p_user
     and (b.workspace_id = p_workspace or b.workspace_id is null)
     and not private.finance_people_related(b.user_id, p_user, p_workspace);
  update public.finance_budgets b
     set shared_with_user_id = null
   where b.user_id = p_user and b.shared_with_user_id is not null and b.shared_with_user_id <> p_user
     and (b.workspace_id = p_workspace or b.workspace_id is null)
     and not private.finance_people_related(p_user, b.shared_with_user_id, p_workspace);

  perform set_config('akool.ws_release', '', true);
end;
$$;

revoke execute on function private.finance_workspace_release(uuid, uuid) from public, anon, authenticated;
comment on function private.finance_workspace_release(uuid, uuid) is
  'Saída do workspace: tira do W as linhas de p_user (Loja, fornecedores, transações, orçamentos, recorrentes, metas sem dinheiro dos outros, empréstimos sem pagamento ou garantia dos outros, categorias e contas que só ele usa), mantém a receita ou despesa ligada a venda ou compra de quem continua membro, desvincula a de outra pessoa (e leva para o privado a de ex-membro que nenhuma venda ou compra de membro usa), põe numa cópia privada os aportes dele na meta que fica, dá a ele cópia pessoal das categorias do W que as linhas privadas dele usam, passa para a dona as categorias, contas e metas que ficam (apagando o share dele dessas metas) e limpa o shared_with sem outro vínculo. Na última pessoa, leva também os empréstimos de ex-membros e as cópias de categoria dos outros. Trava o W (advisory) e liga akool.ws_release (saídas (b) e (c) da guarda) até o fim. Só roda dentro de leave_workspace, remove_workspace_member e finance_workspace_reconcile.';

-- ---------------------------------------------------------------------------
-- 5. Categoria que vai para o privado com o nome de uma pessoal: renomeia
-- ---------------------------------------------------------------------------

create function private.finance_category_ws_exit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Padrão da linha, não validação: vale também sem usuário (cascata de
  -- apagar o workspace, exclusão de conta, restore).
  if new.workspace_id is not null or old.workspace_id is null then
    return new;
  end if;
  new.name := private.finance_category_free_name(new.user_id, new.name, new.type, old.workspace_id);
  return new;
end;
$$;

revoke execute on function private.finance_category_ws_exit() from public, anon, authenticated;
comment on function private.finance_category_ws_exit() is
  'Saída do workspace: gatilho BEFORE UPDATE OF workspace_id em finance_categories. Na ida de um workspace para o privado, renomeia para "Nome (nome do W)" (ou "(workspace)" quando o W já sumiu, com número até ficar único) se o autor já tem a pessoal igual (private.finance_category_free_name): a UNIQUE NULLS NOT DISTINCT (user_id, name, type, workspace_id) dava 23505. Vale também sem usuário.';

-- O nome ordena antes de trg_finance_categories_ws_guard (os BEFORE rodam em
-- ordem de nome).
create trigger finance_categories_ws_exit
  before update of workspace_id on public.finance_categories
  for each row execute function private.finance_category_ws_exit();

-- ---------------------------------------------------------------------------
-- 6. Remover membro e sair (create or replace: mesmos grants e mensagens)
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
  -- A filiação sai primeiro: as saídas (b) e (c) da guarda exigem o autor fora
  -- do W. Se quem sai foi mais rápido (leave em curso), o DELETE espera e não acha.
  delete from public.finance_workspace_members where workspace_id = v_ws and user_id = p_user_id;
  if not found then raise exception 'User is not a member of this workspace'; end if;
  -- Os convites pendentes que ele mandou não valem mais (senão ele volta por
  -- outra conta, e a dona não tem como cancelar).
  delete from public.finance_workspace_invites
   where workspace_id = v_ws and invited_by = p_user_id and status = 'pending';
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
      -- A última pessoa: as linhas dela saem (e os empréstimos e as cópias de
      -- categoria dos ex-membros, no release), as categorias dela que ficaram
      -- (usadas por ex-membros) vão para o privado ainda com o nome do W (o
      -- gatilho renomeia na colisão) e o W é apagado. As outras sobras de
      -- ex-membros saem na cascata (saída (a)); os convites, em cascata.
      perform private.finance_workspace_release(v_uid, v_ws);
      update public.finance_categories set workspace_id = null where user_id = v_uid and workspace_id = v_ws;
      delete from public.finance_workspaces where id = v_ws;
      return;
    end if;
    -- O sucessor vira dono antes do release: é ele quem fica com o que é da
    -- dona e continua no W.
    update public.finance_workspace_members set role = 'owner' where id = v_next.id;
    update public.finance_workspaces set owner_id = v_next.user_id where id = v_ws;
  end if;
  select name into v_ws_name from public.finance_workspaces where id = v_ws;
  select coalesce(display_name, email) into v_leaver_name from public.profiles where id = v_uid;
  -- Os convites pendentes que ela mandou não valem mais.
  delete from public.finance_workspace_invites
   where workspace_id = v_ws and invited_by = v_uid and status = 'pending';
  -- Com a filiação ainda presente: quem grava é o autor; só a receita
  -- desvinculada de um ex-membro usa a saída (b).
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
-- 7. Sem atalho: a filiação, o workspace e o convite só pelas RPCs
-- ---------------------------------------------------------------------------

drop policy if exists wm_owner_delete on public.finance_workspace_members;
drop policy if exists finance_workspaces_delete on public.finance_workspaces;
-- Com a wi_member_insert, qualquer membro gravava convite direto com
-- invited_by de outra pessoa (a dona, por exemplo): a saída de quem gravou não
-- o apagava, e ele voltava ao W por outra conta. O invite_member (DEFINER)
-- grava invited_by = quem chama e passa pelo limite do SEC-016.
drop policy if exists wi_member_insert on public.finance_workspace_invites;

-- ---------------------------------------------------------------------------
-- 8. Aportes: o autor só mexe no aporte de uma meta que ele ainda vê
-- ---------------------------------------------------------------------------

-- A mesma visibilidade da policy de INSERT (dono, membro do W ou share do
-- dono). Sem ela, quem saiu do W alterava ou apagava o próprio aporte numa
-- meta que ficou no W (inclusive uma que sempre foi da dona) e mudava o
-- acumulado que os membros veem.
alter policy finance_goal_contributions_update on public.finance_goal_contributions
  using (user_id = (select auth.uid())
         and exists (select 1 from public.finance_goals g
                      where g.id = finance_goal_contributions.goal_id
                        and (g.user_id = (select auth.uid())
                             or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
                             or exists (select 1 from public.finance_goal_shares fgs
                                         where fgs.goal_id = g.id and fgs.shared_with_user_id = (select auth.uid())
                                           and fgs.owner_id = g.user_id))))
  with check (user_id = (select auth.uid()));
alter policy finance_goal_contributions_delete on public.finance_goal_contributions
  using (user_id = (select auth.uid())
         and exists (select 1 from public.finance_goals g
                      where g.id = finance_goal_contributions.goal_id
                        and (g.user_id = (select auth.uid())
                             or (g.workspace_id is not null and public.is_workspace_member(g.workspace_id))
                             or exists (select 1 from public.finance_goal_shares fgs
                                         where fgs.goal_id = g.id and fgs.shared_with_user_id = (select auth.uid())
                                           and fgs.owner_id = g.user_id))));

-- ---------------------------------------------------------------------------
-- 9. Sobras de quem já saiu (backfill agora e no fim de todo restore)
-- ---------------------------------------------------------------------------

create function private.finance_workspace_reconcile()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_pair record;
  v_ws record;
  v_next public.finance_workspace_members%rowtype;
  v_deleted integer;
  v_owners integer := 0;
  v_pairs integer := 0;
  v_invites integer;
  v_sales integer;
  v_purchases integer;
begin
  -- 1. W sem membros (a última pessoa saiu pelo DELETE direto da filiação):
  --    é apagado, como no leave da última pessoa. A cascata leva tudo para o
  --    privado dos autores (saída (a) e o gatilho de categorias).
  delete from public.finance_workspaces w
   where not exists (select 1 from public.finance_workspace_members m where m.workspace_id = w.id);
  get diagnostics v_deleted = row_count;

  -- 2. W com membros e sem dona (a dona saiu pelo DELETE direto): o membro
  --    mais antigo vira dono, no mesmo critério do leave_workspace.
  for v_ws in
    select w.id from public.finance_workspaces w
     where not exists (select 1 from public.finance_workspace_members m
                        where m.workspace_id = w.id and m.role = 'owner')
     order by w.id
  loop
    select * into v_next from public.finance_workspace_members m
     where m.workspace_id = v_ws.id
     order by m.joined_at asc, m.id asc
     limit 1
     for update;
    update public.finance_workspace_members set role = 'owner' where id = v_next.id;
    update public.finance_workspaces set owner_id = v_next.user_id where id = v_ws.id;
    v_owners := v_owners + 1;
  end loop;

  -- 3. Cada (pessoa, workspace) com linha no W sem filiação: as sobras do
  --    leave e do remove antigos, do DELETE direto da filiação e de um restore
  --    antigo (empréstimos inclusive). Entram também o ex-membro com linha
  --    privada numa categoria do W (a cópia pessoal do release) e o
  --    shared_with, para a limpeza do passo 10 do release, inclusive o de
  --    linha privada entre duas pessoas sem vínculo (o par é a pessoa e o W
  --    da outra).
  for v_pair in
    select distinct r.user_id, r.workspace_id
      from (select x.user_id, x.workspace_id from public.finance_transactions x
            union all select x.shared_with_user_id, x.workspace_id from public.finance_transactions x where x.shared_with_user_id is not null
            union all select x.user_id, x.workspace_id from public.finance_budgets x
            union all select x.shared_with_user_id, x.workspace_id from public.finance_budgets x where x.shared_with_user_id is not null
            union all select x.user_id, x.workspace_id from public.finance_accounts x
            union all select x.user_id, x.workspace_id from public.finance_categories x
            union all select x.user_id, x.workspace_id from public.finance_goals x
            union all select x.user_id, x.workspace_id from public.finance_recurring x
            union all select x.user_id, x.workspace_id from public.finance_store_products x
            union all select x.user_id, x.workspace_id from public.finance_store_purchases x
            union all select x.user_id, x.workspace_id from public.finance_store_sales x
            union all select x.user_id, x.workspace_id from public.finance_store_sale_items x
            union all select x.user_id, x.workspace_id from public.finance_store_customers x
            union all select x.user_id, x.workspace_id from public.finance_suppliers x
            union all select x.user_id, x.workspace_id from public.finance_loan_borrowers x
            union all select x.user_id, x.workspace_id from public.finance_loans x
            union all select x.user_id, x.workspace_id from public.finance_loan_payments x
            union all select x.user_id, x.workspace_id from public.finance_loan_collaterals x
            union all
            select x.user_id, c.workspace_id
              from public.finance_categories c
              join public.finance_transactions x on x.category_id = c.id and x.workspace_id is null
             where c.workspace_id is not null
            union all
            select x.user_id, c.workspace_id
              from public.finance_categories c
              join public.finance_budgets x on x.category_id = c.id and x.workspace_id is null
             where c.workspace_id is not null
            union all
            select x.user_id, c.workspace_id
              from public.finance_categories c
              join public.finance_recurring x on x.category_id = c.id and x.workspace_id is null
             where c.workspace_id is not null
            union all
            select p.who, m.workspace_id
              from (select x.user_id as a, x.shared_with_user_id as b from public.finance_transactions x
                     where x.workspace_id is null and x.shared_with_user_id is not null and x.shared_with_user_id <> x.user_id
                    union
                    select x.user_id, x.shared_with_user_id from public.finance_budgets x
                     where x.workspace_id is null and x.shared_with_user_id is not null and x.shared_with_user_id <> x.user_id) s
              cross join lateral (values (s.a, s.b), (s.b, s.a)) as p(who, other)
              join public.finance_workspace_members m on m.user_id = p.other
             where not private.finance_people_related(s.a, s.b, null)) r
     where r.workspace_id is not null
       and not exists (select 1 from public.finance_workspace_members m
                        where m.workspace_id = r.workspace_id and m.user_id = r.user_id)
     order by r.workspace_id, r.user_id
  loop
    perform private.finance_workspace_release(v_pair.user_id, v_pair.workspace_id);
    v_pairs := v_pairs + 1;
  end loop;

  -- 4. Os convites pendentes de quem já não é membro do W não valem mais.
  delete from public.finance_workspace_invites i
   where i.status = 'pending'
     and not exists (select 1 from public.finance_workspace_members m
                      where m.workspace_id = i.workspace_id and m.user_id = i.invited_by);
  get diagnostics v_invites = row_count;

  -- 5. A receita ou despesa fora do escopo do dono da venda ou compra (de
  --    outra pessoa e fora de um W de que o dono é membro: a privada de um
  --    ex-membro, que travava a dona com 42501) é desvinculada. Nada volta ao W.
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

  return jsonb_build_object('workspaces_deleted', v_deleted, 'owners_promoted', v_owners, 'pairs', v_pairs,
                            'invites_deleted', v_invites, 'sales_unlinked', v_sales, 'purchases_unlinked', v_purchases);
end;
$$;

revoke execute on function private.finance_workspace_reconcile() from public, anon, authenticated;
comment on function private.finance_workspace_reconcile() is
  'Saída do workspace: apaga o W sem membros, promove o membro mais antigo no W sem dona, aplica private.finance_workspace_release a cada (pessoa, workspace) com linha no W e sem filiação (e ao ex-membro com linha privada numa categoria do W, e aos pares com linha privada compartilhada sem vínculo), apaga os convites pendentes de quem já não é membro e desvincula a receita ou despesa fora do escopo do dono da venda ou compra. Devolve as contagens. Roda sem usuário: no backfill da migration workspace_exit e no fim de public.restore_site_backup.';

-- ---------------------------------------------------------------------------
-- 10. Restaurar backup: o mesmo corpo da 20260822215051_rel004 e o reconcile
-- ---------------------------------------------------------------------------

-- Um backup anterior a esta migration traz de volta as sobras de quem saiu
-- (linhas no W sem filiação, W sem dona ou sem membros, convites e vendas
-- travadas). O reconcile roda no fim, na mesma transação e sem usuário (o
-- site-backup chama como service_role), e as contagens vão no resumo; o
-- site-backup só grava o resumo no audit (rows_restored).
create or replace function public.restore_site_backup(p_tables jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  restore_order text[] := array[
    'profiles', 'invite_codes', 'pages', 'page_shares', 'note_contents',
    'drawing_contents', 'todos', 'project_boards', 'project_columns',
    'project_cards', 'project_shares', 'finance_workspaces',
    'finance_workspace_members', 'finance_accounts', 'finance_categories',
    'finance_budgets', 'finance_goals', 'finance_goal_shares',
    'finance_recurring', 'finance_transactions', 'finance_goal_contributions',
    'finance_recurring_entries', 'finance_workspace_invites',
    'finance_suppliers', 'finance_store_customers', 'finance_store_products',
    'finance_store_purchases', 'finance_store_sales',
    'finance_store_sale_items',
    'finance_loan_borrowers', 'finance_loans', 'finance_loan_payments',
    'finance_loan_collaterals',
    'notifications', 'quick_notes',
    'study_topics', 'study_cards', 'study_logs'
  ];
  tbl text;
  affected int;
  summary jsonb := '{}'::jsonb;
begin
  -- Clear in reverse dependency order.
  for i in reverse array_length(restore_order, 1)..1 loop
    execute format('DELETE FROM %I', restore_order[i]);
  end loop;

  -- Insert in forward (dependency) order.
  foreach tbl in array restore_order loop
    if p_tables ? tbl and jsonb_array_length(p_tables -> tbl) > 0 then
      execute format(
        'INSERT INTO %I SELECT * FROM jsonb_populate_recordset(null::%I, $1)',
        tbl, tbl
      ) using (p_tables -> tbl);
      get diagnostics affected = row_count;
    else
      affected := 0;
    end if;
    summary := summary || jsonb_build_object(tbl, affected);
  end loop;

  -- Saída do workspace: as sobras de quem já saiu, num backup antigo.
  summary := summary || jsonb_build_object('workspace_reconcile', private.finance_workspace_reconcile());

  return summary;
end;
$$;

revoke all on function public.restore_site_backup(jsonb) from public, anon, authenticated;
grant execute on function public.restore_site_backup(jsonb) to service_role;

-- Backfill: sem usuário, as guardas e as regras do API-028 pulam.
do $backfill$
declare
  v_result jsonb;
begin
  v_result := private.finance_workspace_reconcile();
  raise notice 'workspace_exit backfill: %', v_result;
end
$backfill$;
