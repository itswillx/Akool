-- API-016: recorrentes no servidor. Os lançamentos do mês atual e do seguinte
-- e os orçamentos automáticos passam a nascer no banco (pg_cron às 00:05 de
-- São Paulo e a carga do app pela RPC), marcar como paga e pular viram uma
-- transação só e o banco fecha a pré-ocupação do mês por outra pessoa.
--
-- Antes:
--   * os lançamentos e os orçamentos automáticos só nasciam quando o navegador
--     abria Finanças (ensureRecurringEntries e useAutoRecurringBudgets); um
--     recorrente criado pelo banco ou pela API nunca ganhava conta a pagar;
--   * marcar como paga eram 3 gravações soltas no navegador (transação,
--     lançamento, desativação), sempre com transação pessoal, mesmo para o
--     recorrente do workspace;
--   * a chave era (recurring_id, due_date): mudar o dia criava um segundo
--     lançamento no mesmo mês;
--   * a geração parava em N lançamentos de qualquer status, mas a desativação
--     exigia N pagas: com uma parcela pulada, o recorrente nunca encerrava;
--   * a policy de INSERT dos lançamentos só conferia user_id: um membro do
--     workspace inseria um lançamento dele no recorrente do dono e "ocupava" o
--     mês, que sumia da tela do dono;
--   * o efeito do navegador duplicava orçamento de workspace (o retorno de um
--     insert já gravado era descartado quando a tela mudava no meio).
--
-- Levantamento na produção (07/10/2026, só contagens): 4 recorrentes ativos de
-- 1 pessoa, nenhum de workspace ou parcelado; 17 lançamentos (15 pendentes, 7
-- de meses passados); nenhuma duplicata no mês, pré-ocupação, transação alheia
-- ou orçamento de workspace duplicado. Backfill necessário: 0 lançamentos e 0
-- orçamentos, então a migration não grava dado (o cron cobre a primeira noite).
--
-- Decisões do usuário (07/10/2026): parcela pulada conta para encerrar;
-- orçamento automático apagado volta (como no app, sem coluna nova).
--
-- Mês visto na tela: o app antigo criava o orçamento automático do mês aberto,
-- qualquer que fosse (até de mês anterior à criação do recorrente). A RPC
-- recebe esse mês e cria só os orçamentos dele, a até 12 meses do mês atual,
-- nunca antes da criação do recorrente nem fora das parcelas de um parcelado.
-- Na janela (o mês do aparelho e o seguinte), o orçamento nasce nos mesmos
-- meses que a conta, mesmo quando São Paulo já virou o mês da criação.
--
-- Fica de fora: índice único por mês e CHECK de parcelas. Um backup antigo com
-- a duplicata do dia editado ou parcelas inválidas deixaria de restaurar (o
-- restore insere tudo numa transação).
--
-- Grants: finance_recurring_entries não tem grant por coluna hoje. O REVOKE de
-- UPDATE abaixo vem seguido do grant das 3 colunas que o app grava (cuidado do
-- supabase/migrations/README.md); o ensaio compara o attacl antes e depois.

-- ---------------------------------------------------------------------------
-- 1. Datas: o vencimento (dia limitado ao último do mês) e a data do aparelho
-- ---------------------------------------------------------------------------

create function private.finance_recurring_due_date(p_month date, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select m.d + (least(greatest(p_day, 1), extract(day from m.d + interval '1 month' - interval '1 day')::integer) - 1)
    from (select date_trunc('month', p_month::timestamp)::date as d) m
$$;

revoke execute on function private.finance_recurring_due_date(date, integer) from public, anon, authenticated;

-- A data do aparelho limitada a ±1 dia da referência (o hoje de São Paulo);
-- sem data, a referência. À parte e imutável para o harness provar o limite
-- com datas fixas, inclusive na virada do mês.
create function private.finance_clamp_today(p_today date, p_ref date)
returns date
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(p_today, p_ref), p_ref - 1), p_ref + 1)
$$;

revoke execute on function private.finance_clamp_today(date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Materialização: lançamentos e orçamentos automáticos
-- ---------------------------------------------------------------------------

-- Núcleo do cron e da RPC do app. p_user nulo é todo mundo (cron); preenchido,
-- só os recorrentes dessa pessoa. p_today decide os meses (o de p_today e o
-- seguinte), para o harness testar a virada do mês sem depender do relógio.
-- p_budget_month (o mês visto na tela, opcional) soma mais um mês só ao passo
-- dos orçamentos: nele nunca nasce lançamento. Quem chama limita o mês.
--
-- Lançamentos: cada recorrente ativo, travado (FOR NO KEY UPDATE, em ordem de
-- id, a mesma de quem paga), num sub-bloco próprio: um recorrente com problema
-- conta em `failed` e não derruba os outros. Já existe lançamento no mês → não
-- cria (por mês, não por data: mudar o dia não duplica). O teto de parcelas
-- conta os lançamentos de qualquer status (pulada conta).
--
-- Orçamentos (a regra do antigo missingAutoBudgets): despesa ativa, fixa, com
-- categoria e valor > 0; no workspace, só se o dono do recorrente for membro.
-- Um por (escopo, categoria, mês), do recorrente mais antigo; no workspace, o
-- mais antigo entre os de todos os membros, também quando uma pessoa chama (o
-- escopo entra se ela tem recorrente nele, e o orçamento sai em nome do dono
-- do mais antigo, como no cron). Fora da janela, nunca em mês anterior ao da
-- criação do recorrente (em São Paulo); na janela, nos meses em que o passo
-- dos lançamentos cria conta: com o aparelho a oeste de São Paulo ainda no
-- último dia do mês e o recorrente criado já no dia 1º em São Paulo, o mês do
-- aparelho também ganha. Parcelado só em mês com parcela: já lançada (pulada
-- conta) ou ainda por vir dentro do total, contada mês a mês depois da última
-- lançada. Sem nenhuma lançada (o recorrente de outro membro na chamada de uma
-- pessoa, em que o passo dos lançamentos só roda para os dela, ou um que
-- falhou), a primeira cai no 1º mês da janela, onde esse passo a cria: o
-- orçamento não depende de quem chama primeiro. Orçamento que já
-- existe bloqueia: no pessoal, o da própria pessoa; no workspace, o de
-- qualquer membro. Orçamento apagado volta (decisão do usuário). Cada escopo
-- num sub-bloco: falha conta em `budgets_failed` e não desfaz os lançamentos.
-- O pessoal fica protegido pelo UNIQUE (user_id, category_id, month); o do
-- workspace, por uma trava por workspace, tomadas em ordem (sem deadlock entre
-- o cron e o app).
--
-- Retorno: as contagens e, para uma pessoa, todos os lançamentos dela na
-- janela e todos os orçamentos dos meses tratados que ela enxerga (os
-- pessoais dela e os dos workspaces de que é membro, de qualquer membro),
-- criados agora ou antes: inclusive o que o cron ou outra aba criou. A carga
-- do app mescla por id.
create function private.finance_materialize_core(p_user uuid, p_today date, p_budget_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months          date[];
  v_budget_months   date[];
  v_until           date;
  v_rec             record;
  v_scope           record;
  v_month           date;
  v_count           integer;
  v_created         integer := 0;
  v_failed          integer := 0;
  v_budgets         jsonb := '[]'::jsonb;
  v_n               integer;
  v_budgets_created integer := 0;
  v_budgets_failed  integer := 0;
  v_entries         jsonb := '[]'::jsonb;
begin
  if p_today is null then
    raise exception 'Informe a data de referência' using errcode = '22023';
  end if;
  v_months := array[date_trunc('month', p_today::timestamp)::date,
                    (date_trunc('month', p_today::timestamp) + interval '1 month')::date];
  v_until := (v_months[2] + interval '1 month')::date;
  v_budget_months := v_months;
  if date_trunc('month', p_budget_month::timestamp)::date <> all (v_months) then
    v_budget_months := v_budget_months || date_trunc('month', p_budget_month::timestamp)::date;
  end if;

  for v_rec in
    select fr.id, fr.user_id, fr.day_of_month, fr.total_installments
      from public.finance_recurring fr
     where fr.active and (p_user is null or fr.user_id = p_user)
     order by fr.id
       for no key update
  loop
    begin
      select count(*) into v_count from public.finance_recurring_entries e where e.recurring_id = v_rec.id;
      foreach v_month in array v_months loop
        exit when v_rec.total_installments is not null and v_count >= v_rec.total_installments;
        if not exists (select 1 from public.finance_recurring_entries e
                        where e.recurring_id = v_rec.id
                          and e.due_date >= v_month and e.due_date < (v_month + interval '1 month')::date) then
          insert into public.finance_recurring_entries (user_id, recurring_id, due_date, status)
          values (v_rec.user_id, v_rec.id, private.finance_recurring_due_date(v_month, v_rec.day_of_month), 'pending')
          on conflict (recurring_id, due_date) do nothing;
          if found then
            v_count := v_count + 1;
            v_created := v_created + 1;
          end if;
        end if;
      end loop;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'API-016: recorrente % não materializou (%: %)', v_rec.id, sqlstate, sqlerrm;
    end;
  end loop;

  for v_scope in
    select distinct fr.workspace_id as ws, case when fr.workspace_id is null then fr.user_id end as owner_id
      from public.finance_recurring fr
     where fr.active and fr.type = 'expense' and not fr.is_variable
       and fr.category_id is not null and fr.amount > 0
       and (p_user is null or fr.user_id = p_user)
       and (fr.workspace_id is null
            or exists (select 1 from public.finance_workspace_members wm
                        where wm.workspace_id = fr.workspace_id and wm.user_id = fr.user_id))
     order by 1 nulls last, 2
  loop
    begin
      if v_scope.ws is not null then
        perform pg_advisory_xact_lock(hashtextextended('finance_auto_budget:' || v_scope.ws::text, 0));
      end if;
      with cand as (
        select distinct on (fr.category_id, mm.m)
               fr.user_id, fr.category_id, to_char(mm.m, 'YYYY-MM') as ym, fr.amount, fr.workspace_id
          from public.finance_recurring fr
         cross join unnest(v_budget_months) as mm(m)
         where fr.active and fr.type = 'expense' and not fr.is_variable
           and fr.category_id is not null and fr.amount > 0
           and (p_user is null or v_scope.ws is not null or fr.user_id = p_user)
           and fr.workspace_id is not distinct from v_scope.ws
           and (v_scope.ws is not null or fr.user_id = v_scope.owner_id)
           and (fr.workspace_id is null
                or exists (select 1 from public.finance_workspace_members wm
                            where wm.workspace_id = fr.workspace_id and wm.user_id = fr.user_id))
           and mm.m >= least(date_trunc('month', fr.created_at at time zone 'America/Sao_Paulo')::date, v_months[1])
           and (fr.total_installments is null
                or exists (select 1 from public.finance_recurring_entries e
                            where e.recurring_id = fr.id
                              and e.due_date >= mm.m and e.due_date < (mm.m + interval '1 month')::date)
                or (select mm.m > l.base
                           and l.n + (extract(year from mm.m) - extract(year from l.base)) * 12
                                   + extract(month from mm.m) - extract(month from l.base) <= fr.total_installments
                      from (select count(*) as n, coalesce(max(e.due_date), (v_months[1] - interval '1 month')::date) as base
                              from public.finance_recurring_entries e
                             where e.recurring_id = fr.id) l))
         order by fr.category_id, mm.m, fr.created_at, fr.id
      ), ins as (
        insert into public.finance_budgets (user_id, category_id, month, amount_limit, workspace_id)
        select c.user_id, c.category_id, c.ym, c.amount, c.workspace_id
          from cand c
         where not exists (select 1 from public.finance_budgets b
                            where b.month = c.ym and b.category_id = c.category_id
                              and b.workspace_id is not distinct from c.workspace_id
                              and (c.workspace_id is not null or b.user_id = c.user_id))
        on conflict (user_id, category_id, month) do nothing
        returning 1
      )
      select count(*) into v_n from ins;
      v_budgets_created := v_budgets_created + v_n;
    exception when others then
      v_budgets_failed := v_budgets_failed + 1;
      raise warning 'API-016: orçamentos automáticos de % não materializaram (%: %)',
        coalesce(v_scope.ws, v_scope.owner_id), sqlstate, sqlerrm;
    end;
  end loop;

  if p_user is not null then
    select coalesce(jsonb_agg(to_jsonb(e) order by e.due_date, e.id), '[]'::jsonb) into v_entries
      from public.finance_recurring_entries e
      join public.finance_recurring fr on fr.id = e.recurring_id and fr.user_id = p_user
     where e.user_id = p_user and e.due_date >= v_months[1] and e.due_date < v_until;
    select coalesce(jsonb_agg(to_jsonb(b) order by b.month, b.id), '[]'::jsonb) into v_budgets
      from public.finance_budgets b
     where b.month in (select to_char(mm.m, 'YYYY-MM') from unnest(v_budget_months) as mm(m))
       and ((b.workspace_id is null and b.user_id = p_user)
            or exists (select 1 from public.finance_workspace_members wm
                        where wm.workspace_id = b.workspace_id and wm.user_id = p_user));
  end if;

  return jsonb_build_object(
    'entries', v_entries,
    'budgets', v_budgets,
    'created', v_created,
    'failed', v_failed,
    'budgets_created', v_budgets_created,
    'budgets_failed', v_budgets_failed
  );
end;
$$;

revoke execute on function private.finance_materialize_core(uuid, date, date) from public, anon, authenticated;

-- O job do cron: todo mundo, no hoje de São Paulo. Falha avisa os admins
-- ativos (o WARNING por recorrente só fica no log do Postgres), no máximo uma
-- notificação por dia por admin, como o private.notify_stale_backup.
create function private.finance_materialize_all()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_res   jsonb;
  v_admin record;
begin
  v_res := private.finance_materialize_core(null, v_today);
  if (v_res ->> 'failed')::integer + (v_res ->> 'budgets_failed')::integer > 0 then
    for v_admin in
      select p.id from public.profiles p
       where p.role = 'admin' and coalesce(p.is_active, true)
         and not exists (
           select 1 from public.notifications n
            where n.user_id = p.id and n.type = 'finance_recurring_failed' and n.created_at > now() - interval '24 hours'
         )
    loop
      perform public._notify(
        v_admin.id,
        'finance_recurring_failed',
        'Recorrentes com falha',
        format('A geração de recorrentes de %s falhou em %s recorrente(s) e %s grupo(s) de orçamento. Detalhes nos avisos do log do banco.',
               to_char(v_today, 'DD/MM/YYYY'), v_res ->> 'failed', v_res ->> 'budgets_failed'),
        jsonb_build_object('date', v_today, 'failed', (v_res ->> 'failed')::integer, 'budgets_failed', (v_res ->> 'budgets_failed')::integer)
      );
    end loop;
  end if;
  return v_res - 'entries' - 'budgets';
end;
$$;

revoke execute on function private.finance_materialize_all() from public, anon, authenticated;

-- Chamada pelo app na carga de Finanças, depois de salvar um recorrente e ao
-- ver um mês fora da janela: só os recorrentes de quem chama. p_today é a data
-- do aparelho (a tela calcula mês e atraso no fuso dele), limitada a ±1 dia do
-- hoje de São Paulo (private.finance_clamp_today): cobre qualquer fuso real e
-- um relógio errado não gera mês distante. p_month é o mês visto na tela: soma
-- só os orçamentos automáticos dele (nunca lançamento), como o app fazia antes
-- no navegador, se estiver a até 12 meses do mês de São Paulo; mais longe, é
-- ignorado. SECURITY DEFINER porque o núcleo fica em private, sem EXECUTE para
-- clientes.
create function public.finance_materialize_recurring(p_today date default null, p_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_sp    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cur   date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_month date := date_trunc('month', p_month::timestamp)::date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_month < (v_cur - interval '12 months')::date or v_month > (v_cur + interval '12 months')::date then
    v_month := null;
  end if;
  return private.finance_materialize_core(v_uid, private.finance_clamp_today(p_today, v_sp), v_month);
end;
$$;

revoke execute on function public.finance_materialize_recurring(date, date) from public, anon;
grant execute on function public.finance_materialize_recurring(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Marcar como paga e pular: uma transação só
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: o RLS de quem chama vale (e as RESTRICTIVE do API-022
-- quando vierem). Só o dono do lançamento paga; outra pessoa, inclusive membro
-- do workspace, recebe "não encontrado". Trava o recorrente e depois o
-- lançamento (a ordem da materialização) e decide pelo status relido depois da
-- trava. Recorrente inativo é aceito: a Visão geral mostra os pendentes dele.
-- A transação herda o workspace do recorrente só se o dono ainda for membro;
-- senão fica pessoal, como era. Encerra quando pagas + puladas >= parcelas.
create function public.finance_mark_entry_paid(p_entry uuid, p_amount_cents bigint default null, p_date date default null, p_account uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_rec_id  uuid;
  v_rec     public.finance_recurring;
  v_entry   public.finance_recurring_entries;
  v_tx      public.finance_transactions;
  v_amount  bigint;
  v_account uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select e.recurring_id into v_rec_id
    from public.finance_recurring_entries e
   where e.id = p_entry and e.user_id = v_uid;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  select * into v_rec from public.finance_recurring fr where fr.id = v_rec_id and fr.user_id = v_uid for no key update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  select * into v_entry from public.finance_recurring_entries e
   where e.id = p_entry and e.user_id = v_uid and e.recurring_id = v_rec.id
     for update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;

  if v_entry.status = 'paid' then
    -- A transação pode ter sido apagada depois (FK ON DELETE SET NULL): vem nula.
    return jsonb_build_object(
      'entry', to_jsonb(v_entry),
      'transaction', (select to_jsonb(t) from public.finance_transactions t where t.id = v_entry.transaction_id),
      'recurring', to_jsonb(v_rec),
      'already_paid', true
    );
  end if;
  if v_entry.status = 'skipped' then
    raise exception 'Lançamento pulado não pode ser pago' using errcode = 'P0001', hint = 'akool';
  end if;

  -- As colunas são numeric, mas guardam centavos inteiros (README das migrations).
  v_amount := coalesce(p_amount_cents, round(v_rec.amount)::bigint);
  if v_amount is null or v_amount <= 0 then
    raise exception 'Informe o valor pago' using errcode = '22023', hint = 'akool';
  end if;
  if p_account is not null then
    if not exists (select 1 from public.finance_accounts a where a.id = p_account) then
      raise exception 'Conta não encontrada' using errcode = 'P0002';
    end if;
    v_account := p_account;
  else
    v_account := v_rec.account_id;
  end if;

  insert into public.finance_transactions (user_id, type, amount, description, date, account_id, category_id, workspace_id)
  values (v_uid, v_rec.type, v_amount, v_rec.description, coalesce(p_date, v_entry.due_date), v_account, v_rec.category_id,
          case when v_rec.workspace_id is not null and public.is_workspace_member(v_rec.workspace_id) then v_rec.workspace_id end)
  returning * into v_tx;

  update public.finance_recurring_entries e
     set status = 'paid', amount = v_amount, transaction_id = v_tx.id
   where e.id = v_entry.id
  returning * into v_entry;

  if v_rec.active and v_rec.total_installments is not null
     and (select count(*) from public.finance_recurring_entries e
           where e.recurring_id = v_rec.id and e.status in ('paid', 'skipped')) >= v_rec.total_installments then
    update public.finance_recurring fr set active = false where fr.id = v_rec.id returning * into v_rec;
  end if;

  return jsonb_build_object('entry', to_jsonb(v_entry), 'transaction', to_jsonb(v_tx), 'recurring', to_jsonb(v_rec), 'already_paid', false);
end;
$$;

revoke execute on function public.finance_mark_entry_paid(uuid, bigint, date, uuid) from public, anon;
grant execute on function public.finance_mark_entry_paid(uuid, bigint, date, uuid) to authenticated;

-- Mesmas travas e o mesmo encerramento. Já pulado devolve sem mudar; pago é recusado.
create function public.finance_skip_entry(p_entry uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_rec_id uuid;
  v_rec    public.finance_recurring;
  v_entry  public.finance_recurring_entries;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select e.recurring_id into v_rec_id
    from public.finance_recurring_entries e
   where e.id = p_entry and e.user_id = v_uid;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  select * into v_rec from public.finance_recurring fr where fr.id = v_rec_id and fr.user_id = v_uid for no key update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;
  select * into v_entry from public.finance_recurring_entries e
   where e.id = p_entry and e.user_id = v_uid and e.recurring_id = v_rec.id
     for update;
  if not found then
    raise exception 'Lançamento não encontrado' using errcode = 'P0002';
  end if;

  if v_entry.status = 'paid' then
    raise exception 'Lançamento já pago' using errcode = 'P0001', hint = 'akool';
  end if;
  if v_entry.status = 'pending' then
    update public.finance_recurring_entries e set status = 'skipped' where e.id = v_entry.id returning * into v_entry;
    if v_rec.active and v_rec.total_installments is not null
       and (select count(*) from public.finance_recurring_entries e
             where e.recurring_id = v_rec.id and e.status in ('paid', 'skipped')) >= v_rec.total_installments then
      update public.finance_recurring fr set active = false where fr.id = v_rec.id returning * into v_rec;
    end if;
  end if;

  return jsonb_build_object('entry', to_jsonb(v_entry), 'recurring', to_jsonb(v_rec));
end;
$$;

revoke execute on function public.finance_skip_entry(uuid) from public, anon;
grant execute on function public.finance_skip_entry(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Gatilho dos lançamentos: dono, transação e passagem para pago
-- ---------------------------------------------------------------------------

-- Regra dos gatilhos (docs/api-arquitetura.md §1.5): sem usuário (restore,
-- cron, migration) pula; valida só o que mudou.
--   * INSERT, ou recurring_id/user_id mudando: o recorrente tem de ser de
--     new.user_id (fecha a pré-ocupação do mês por outro membro). Recusa
--     genérica, sem dizer se o recorrente existe;
--   * transação nova (ou na passagem para pago): tem de ser de new.user_id;
--   * passagem para pago exige transação: o "atômico" vale para qualquer
--     cliente, não só para a RPC. Pago antigo sem transação (a transação foi
--     apagada) não é afetado: a regra só olha a passagem.
create function private.finance_recurring_entry_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to_paid boolean;
begin
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' or new.recurring_id is distinct from old.recurring_id or new.user_id is distinct from old.user_id then
    if not exists (select 1 from public.finance_recurring r where r.id = new.recurring_id and r.user_id = new.user_id) then
      raise exception 'Sem permissão para este recorrente' using errcode = '42501';
    end if;
  end if;

  v_to_paid := new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid');
  if new.transaction_id is not null
     and (tg_op = 'INSERT' or new.transaction_id is distinct from old.transaction_id or v_to_paid) then
    if not exists (select 1 from public.finance_transactions t where t.id = new.transaction_id and t.user_id = new.user_id) then
      raise exception 'Transação não encontrada' using errcode = '42501';
    end if;
  end if;
  if v_to_paid and new.transaction_id is null then
    raise exception 'Lançamento pago precisa da transação: use finance_mark_entry_paid' using errcode = '23514', hint = 'akool';
  end if;

  return new;
end;
$$;

revoke execute on function private.finance_recurring_entry_guard() from public, anon, authenticated;

create trigger finance_recurring_entries_guard
  before insert or update on public.finance_recurring_entries
  for each row execute function private.finance_recurring_entry_guard();

-- recurring_id, user_id e due_date não mudam pelo cliente; o app e as RPCs
-- só gravam estas três. O INSERT do app antigo (ON CONFLICT DO NOTHING) não
-- precisa de UPDATE, e o FOR UPDATE das RPCs INVOKER precisa de UPDATE em ao
-- menos uma coluna.
revoke update on public.finance_recurring_entries from authenticated;
grant update (status, amount, transaction_id) on public.finance_recurring_entries to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Dia editado: os pendentes do mês atual em diante vão para o dia novo
-- ---------------------------------------------------------------------------

-- Com a idempotência por mês, o pendente ficaria na data antiga e a Visão
-- geral o mostraria atrasado. Move os pendentes sem transação, do mês atual de
-- São Paulo em diante, um por vez: o que bateria em outro lançamento na data
-- nova fica onde está (o UNIQUE recusaria). Vale também sem usuário: é manter
-- a linha coerente, não validação (§1.5). SECURITY DEFINER porque due_date
-- está fora do grant de coluna.
create function private.finance_recurring_day_moved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_due   date;
begin
  for v_entry in
    select e.id, e.due_date
      from public.finance_recurring_entries e
     where e.recurring_id = new.id
       and e.status = 'pending'
       and e.transaction_id is null
       and e.due_date >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
     order by e.due_date, e.id
  loop
    v_due := private.finance_recurring_due_date(v_entry.due_date, new.day_of_month);
    continue when v_due = v_entry.due_date;
    update public.finance_recurring_entries e
       set due_date = v_due
     where e.id = v_entry.id
       and not exists (select 1 from public.finance_recurring_entries o where o.recurring_id = new.id and o.due_date = v_due);
  end loop;
  return null;
end;
$$;

revoke execute on function private.finance_recurring_day_moved() from public, anon, authenticated;

create trigger finance_recurring_day_moved
  after update of day_of_month on public.finance_recurring
  for each row
  when (old.day_of_month is distinct from new.day_of_month)
  execute function private.finance_recurring_day_moved();

-- ---------------------------------------------------------------------------
-- 6. Job diário: 03:05 UTC = 00:05 em São Paulo
-- ---------------------------------------------------------------------------

-- cron.schedule com o mesmo nome atualiza o job: a migration pode rodar de novo.
select cron.schedule('finance-recurring-materialize', '5 3 * * *', 'select private.finance_materialize_all()');
