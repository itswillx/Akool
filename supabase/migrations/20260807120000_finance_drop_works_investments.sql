-- Remove os submódulos "Obras" e "Investimentos" do financeiro.
--
-- Obras é MIGRADA para Metas antes de sumir: cada `finance_projects` vira uma
-- `finance_goals` e cada gasto vira uma `finance_goal_contributions`. As duas
-- famílias guardam CENTAVOS (bigint de um lado, numeric do outro), então a
-- migração é cópia de valor — nenhuma conversão.
--
-- O que não sobrevive: etapas, itens a comprar, cotações, fornecedores (só o
-- nome, colado na nota da contribuição) e o vínculo gasto↔transação. Nada some
-- do fluxo de caixa: os gastos já existiam como `finance_transactions`, e
-- contribuição de meta não entra em `accountBalance`.
--
-- Investimentos é dropado direto: as duas tabelas estão vazias.
--
-- Backup em `supabase/backups/20260807_obras_investimentos.json`. O bucket
-- `project-expense-files` NÃO é apagado aqui — o único anexo é a foto de uma
-- nota fiscal e não há outra cópia dela.

do $mig$
declare
  v_projects int;
  v_goals int;
  v_expense_total bigint;
  v_contrib_total numeric;
begin
  -- O trigger `finance_guard_workspace` chama `is_workspace_member()`, que sai
  -- de `auth.uid()`. Numa migration não existe JWT, então a obra compartilhada
  -- seria rejeitada. Desligar o trigger é preferível a forjar
  -- `request.jwt.claims`: o DO inteiro é uma statement só, então se qualquer
  -- linha abaixo falhar o ALTER também é revertido e o trigger volta sozinho.
  alter table finance_goals disable trigger trg_finance_goals_ws_guard;

  -- INSERT ... SELECT ... RETURNING não devolve colunas da origem, e a ligação
  -- obra→meta é justamente o que as contribuições precisam. O id vem daqui.
  drop table if exists pg_temp._goal_map;
  create temp table _goal_map on commit drop as
  select p.id as project_id, gen_random_uuid() as goal_id from finance_projects p;

  insert into finance_goals (
    id, user_id, workspace_id, name, icon, color,
    target_amount, deadline, account_id, status, created_at
  )
  select
    m.goal_id, p.user_id, p.workspace_id, p.name, p.icon, p.color,
    p.budget_total,
    -- `deadline` é NOT NULL e obra pode não ter prazo; um ano da criação é o
    -- palpite menos arbitrário disponível.
    coalesce(p.target_end_on, (p.created_at at time zone 'utc')::date + 365),
    null,
    case p.status
      when 'done' then 'completed'
      when 'cancelled' then 'cancelled'
      -- planning, active e paused: a obra ainda está de pé.
      else 'active'
    end,
    p.created_at
  from finance_projects p
  join _goal_map m on m.project_id = p.id;

  insert into finance_goal_contributions (goal_id, user_id, amount, note, date, created_at)
  select
    m.goal_id, e.user_id, e.amount,
    -- O nome do fornecedor é a única coisa que sobrevive de finance_suppliers.
    e.description || coalesce(' · ' || s.name, ''),
    e.date, e.created_at
  from finance_project_expenses e
  join _goal_map m on m.project_id = e.project_id
  left join finance_suppliers s on s.id = e.supplier_id;

  alter table finance_goals enable trigger trg_finance_goals_ws_guard;

  -- Conferência antes dos DROPs: nada de perder dinheiro em silêncio.
  select count(*) into v_projects from finance_projects;
  select count(*) into v_goals from _goal_map;
  select coalesce(sum(amount), 0) into v_expense_total from finance_project_expenses;
  select coalesce(sum(c.amount), 0) into v_contrib_total
  from finance_goal_contributions c
  join _goal_map m on m.goal_id = c.goal_id;

  if v_goals <> v_projects then
    raise exception 'Migração incompleta: % obras, % metas criadas', v_projects, v_goals;
  end if;
  if v_contrib_total <> v_expense_total then
    raise exception 'Soma divergente: gastos %, contribuições %', v_expense_total, v_contrib_total;
  end if;
end
$mig$;

drop table if exists
  finance_project_quotes,
  finance_project_items,
  finance_project_expenses,
  finance_project_stages,
  finance_projects,
  finance_suppliers,
  finance_investment_movements,
  finance_investments
cascade;

-- Depois das tabelas: as policies das filhas (que derivavam a visibilidade da
-- obra) dependem desta função, e caem junto com elas.
drop function if exists finance_project_visible(uuid);
