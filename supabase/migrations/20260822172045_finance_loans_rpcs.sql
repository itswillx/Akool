-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260822172045).
-- SQL idêntico ao aplicado em produção (md5 1f344b15fc2951489c2cf8cf6ffd0195); não editar.

-- RPCs do submodulo Emprestimos + o ramo novo de profile_is_related.
-- Ver supabase/migrations/20260822130000_finance_loans_rpcs.sql para o
-- cabecalho completo. ATENCAO: dentro de SECURITY DEFINER a RLS esta
-- DESLIGADA -- cada checagem de posse escrita a mao e' a unica coisa entre
-- isto e um IDOR.

CREATE OR REPLACE FUNCTION public.loan_link_borrower(p_borrower_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid   uuid := auth.uid();
  v_b     finance_loan_borrowers%rowtype;
  v_actor text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_user_id is null then raise exception 'Usuario invalido' using errcode = '22023'; end if;

  select * into v_b from finance_loan_borrowers where id = p_borrower_id;
  if v_b.id is null then
    raise exception 'Devedor nao encontrado' using errcode = '42501';
  end if;
  if not (v_b.user_id = v_uid
          or (v_b.workspace_id is not null and is_workspace_member(v_b.workspace_id))) then
    raise exception 'Nao e o credor deste cadastro' using errcode = '42501';
  end if;
  if p_user_id = v_b.user_id then
    raise exception 'O credor nao pode ser o proprio devedor' using errcode = '22023';
  end if;
  if v_b.borrower_user_id is not null then
    raise exception 'Desvincule antes de vincular outro usuario' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'Usuario nao encontrado' using errcode = '42501';
  end if;

  begin
    update finance_loan_borrowers
       set borrower_user_id = p_user_id, linked_at = now(), updated_at = now()
     where id = p_borrower_id;
  exception when unique_violation then
    raise exception 'Este usuario ja e um devedor cadastrado seu' using errcode = '23505';
  end;

  select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
  perform _notify(
    p_user_id, 'loan_borrower_linked',
    coalesce(v_actor, 'Alguem') || ' vinculou voce como devedor',
    'Voce passa a acompanhar os emprestimos dessa pessoa pelo financeiro.',
    jsonb_build_object('borrower_id', p_borrower_id, 'actor_id', v_uid));
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_request(
  p_borrower_id     uuid,
  p_principal       bigint,
  p_monthly_rate_bp integer DEFAULT 1500,
  p_disbursed_on    date DEFAULT current_date,
  p_due_date        date DEFAULT NULL,
  p_purpose         text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid       uuid := auth.uid();
  v_b         finance_loan_borrowers%rowtype;
  v_is_lender boolean;
  v_status    text;
  v_ws        uuid;
  v_loan_id   uuid;
  v_target    uuid;
  v_actor     text;
  v_rl        record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_principal is null or p_principal <= 0 then
    raise exception 'Valor invalido' using errcode = '22023'; end if;
  if p_monthly_rate_bp is null or p_monthly_rate_bp < 0 or p_monthly_rate_bp > 10000 then
    raise exception 'Taxa invalida' using errcode = '22023'; end if;
  if p_disbursed_on is null then
    raise exception 'Data de desembolso obrigatoria' using errcode = '22023'; end if;
  if p_due_date is not null and p_due_date < p_disbursed_on then
    raise exception 'Vencimento anterior ao desembolso' using errcode = '22023'; end if;

  select * into v_rl from private.rate_limit_touch('loan_request:uid', v_uid::text, 20, 3600);
  if not v_rl.allowed then perform private.raise_rate_limited(v_rl.retry_after); end if;

  select * into v_b from finance_loan_borrowers where id = p_borrower_id;
  if v_b.id is null then
    raise exception 'Devedor nao encontrado' using errcode = '42501'; end if;

  v_is_lender := v_b.user_id = v_uid
                 or (v_b.workspace_id is not null and is_workspace_member(v_b.workspace_id));
  if not v_is_lender and v_b.borrower_user_id is distinct from v_uid then
    raise exception 'Sem acesso a este cadastro de devedor' using errcode = '42501';
  end if;

  -- Credor propondo a devedor SEM conta vinculada: nao ha contraparte para
  -- aprovar, entao ja nasce ativo (emprestimo de papel).
  v_status := case when v_is_lender and v_b.borrower_user_id is null
                   then 'active' else 'requested' end;

  -- Quando quem pede e' o DEVEDOR, a linha nasce fora do workspace: aqui dentro
  -- auth.uid() continua sendo o dele, e finance_guard_workspace() exige
  -- is_workspace_member(new.workspace_id) no INSERT. O credor adota o workspace
  -- na aprovacao.
  v_ws := case when v_is_lender then v_b.workspace_id else null end;

  insert into finance_loans (
    user_id, workspace_id, borrower_id, principal, monthly_rate_bp,
    disbursed_on, due_date, status, requested_by, purpose, approved_by, responded_at)
  values (
    v_b.user_id, v_ws, p_borrower_id, p_principal, p_monthly_rate_bp,
    p_disbursed_on, p_due_date, v_status, v_uid, coalesce(p_purpose, ''),
    case when v_status = 'active' then v_uid end,
    case when v_status = 'active' then now() end)
  returning id into v_loan_id;

  if v_status = 'requested' then
    v_target := case when v_is_lender then v_b.borrower_user_id else v_b.user_id end;
    select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
    perform _notify(
      v_target, 'loan_requested',
      coalesce(v_actor, 'Alguem') || ' enviou uma proposta de emprestimo',
      'Ha um pedido de emprestimo aguardando sua resposta.',
      jsonb_build_object('loan_id', v_loan_id, 'borrower_id', p_borrower_id,
                         'actor_id', v_uid, 'amount', p_principal));
  end if;

  return v_loan_id;
end;
$$;

CREATE OR REPLACE FUNCTION public._loan_responder_guard(p_loan_id uuid)
RETURNS finance_loans LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := auth.uid();
  v_l   finance_loans%rowtype;
  v_b   finance_loan_borrowers%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select * into v_l from finance_loans where id = p_loan_id;
  if v_l.id is null then
    raise exception 'Emprestimo nao encontrado' using errcode = '42501'; end if;
  if v_l.status <> 'requested' then
    raise exception 'Este pedido nao esta mais pendente' using errcode = '42501'; end if;

  -- A checagem mais importante do modulo. Sem ela, quem pede aprova sozinho.
  if v_uid = v_l.requested_by then
    raise exception 'Voce nao pode responder ao proprio pedido' using errcode = '42501';
  end if;

  select * into v_b from finance_loan_borrowers where id = v_l.borrower_id;

  -- Responde sempre o LADO OPOSTO ao de quem pediu. O discriminante e' o
  -- devedor vinculado, e nao requested_by = user_id: um co-membro do workspace
  -- do credor tambem propoe, e ai requested_by <> user_id sem que o pedido
  -- tenha vindo do devedor.
  if v_b.borrower_user_id is not distinct from v_l.requested_by then
    if not (v_l.user_id = v_uid
            or (v_l.workspace_id is not null and is_workspace_member(v_l.workspace_id))
            or (v_b.workspace_id is not null and is_workspace_member(v_b.workspace_id))) then
      raise exception 'Este pedido nao e seu' using errcode = '42501';
    end if;
  else
    if v_b.borrower_user_id is distinct from v_uid then
      raise exception 'Este pedido nao e seu' using errcode = '42501';
    end if;
  end if;

  return v_l;
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_approve(
  p_loan_id uuid,
  p_disbursed_on date DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid   uuid := auth.uid();
  v_l     finance_loans%rowtype;
  v_b     finance_loan_borrowers%rowtype;
  v_date  date;
  v_actor text;
begin
  v_l := public._loan_responder_guard(p_loan_id);
  select * into v_b from finance_loan_borrowers where id = v_l.borrower_id;

  v_date := coalesce(p_disbursed_on, v_l.disbursed_on);
  if v_l.due_date is not null and v_l.due_date < v_date then
    raise exception 'Vencimento anterior ao desembolso' using errcode = '22023';
  end if;

  update finance_loans
     set status = 'active',
         approved_by = v_uid,
         responded_at = now(),
         disbursed_on = v_date,
         -- Adocao do workspace: quando o DEVEDOR pediu, a linha nasceu com
         -- workspace_id nulo. So o dono original consegue realoca-la
         -- (finance_guard_workspace barra o co-membro), entao e' best-effort.
         workspace_id = case
           when workspace_id is null and v_b.workspace_id is not null and v_l.user_id = v_uid
           then v_b.workspace_id else workspace_id end,
         updated_at = now()
   where id = p_loan_id;

  select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
  perform _notify(
    v_l.requested_by, 'loan_approved',
    coalesce(v_actor, 'Alguem') || ' aprovou o emprestimo',
    'O emprestimo esta ativo e o saldo ja aparece na sua tela.',
    jsonb_build_object('loan_id', p_loan_id, 'actor_id', v_uid, 'amount', v_l.principal));
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_reject(p_loan_id uuid, p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid    uuid := auth.uid();
  v_l      finance_loans%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor  text;
begin
  v_l := public._loan_responder_guard(p_loan_id);

  update finance_loans
     set status = 'rejected',
         approved_by = v_uid,
         responded_at = now(),
         notes = case when v_reason = '' then notes
                      when notes = '' then 'Recusado: ' || v_reason
                      else notes || E'\n' || 'Recusado: ' || v_reason end,
         updated_at = now()
   where id = p_loan_id;

  select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
  perform _notify(
    v_l.requested_by, 'loan_rejected',
    coalesce(v_actor, 'Alguem') || ' recusou o pedido de emprestimo',
    case when v_reason = '' then 'O pedido foi recusado.' else v_reason end,
    jsonb_build_object('loan_id', p_loan_id, 'actor_id', v_uid));
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_cancel_request(p_loan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid    uuid := auth.uid();
  v_l      finance_loans%rowtype;
  v_b      finance_loan_borrowers%rowtype;
  v_target uuid;
  v_actor  text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select * into v_l from finance_loans where id = p_loan_id;
  if v_l.id is null then
    raise exception 'Emprestimo nao encontrado' using errcode = '42501'; end if;
  if v_l.status <> 'requested' then
    raise exception 'Este pedido nao esta mais pendente' using errcode = '42501'; end if;
  if v_l.requested_by <> v_uid then
    raise exception 'Somente quem pediu pode cancelar' using errcode = '42501'; end if;

  update finance_loans
     set status = 'cancelled', responded_at = now(), updated_at = now()
   where id = p_loan_id;

  select * into v_b from finance_loan_borrowers where id = v_l.borrower_id;
  v_target := case when v_b.borrower_user_id is not distinct from v_uid
                   then v_l.user_id else v_b.borrower_user_id end;
  if v_target is not null then
    select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
    perform _notify(
      v_target, 'loan_rejected',
      coalesce(v_actor, 'Alguem') || ' cancelou o pedido de emprestimo',
      'O pedido foi retirado antes de ser respondido.',
      jsonb_build_object('loan_id', p_loan_id, 'actor_id', v_uid));
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_report_payment(
  p_loan_id uuid,
  p_amount  bigint,
  p_date    date DEFAULT current_date,
  p_method  text DEFAULT 'other',
  p_note    text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid     uuid := auth.uid();
  v_l       finance_loans%rowtype;
  v_b       finance_loan_borrowers%rowtype;
  v_pay_id  uuid;
  v_actor   text;
  v_rl      record;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Valor invalido' using errcode = '22023'; end if;
  if p_date is null or p_date > current_date then
    raise exception 'Data invalida' using errcode = '22023'; end if;
  if p_method is null or p_method not in ('pix','cash','transfer','card','other') then
    raise exception 'Forma de pagamento invalida' using errcode = '22023'; end if;

  select * into v_rl from private.rate_limit_touch('loan_report_payment:uid', v_uid::text, 30, 3600);
  if not v_rl.allowed then perform private.raise_rate_limited(v_rl.retry_after); end if;

  select * into v_l from finance_loans where id = p_loan_id;
  if v_l.id is null then
    raise exception 'Emprestimo nao encontrado' using errcode = '42501'; end if;
  select * into v_b from finance_loan_borrowers where id = v_l.borrower_id;

  -- SO o devedor vinculado. O credor insere direto pela policy de INSERT.
  if v_b.borrower_user_id is distinct from v_uid then
    raise exception 'Somente o devedor informa pagamento por aqui' using errcode = '42501';
  end if;
  if v_l.status <> 'active' then
    raise exception 'Emprestimo nao esta ativo' using errcode = '42501'; end if;

  -- workspace_id NULL de proposito: aqui dentro auth.uid() continua sendo o do
  -- devedor, e finance_guard_workspace() exigiria que ele fosse membro do
  -- workspace do credor. O SELECT do filho keia em loan_is_visible().
  insert into finance_loan_payments (
    user_id, workspace_id, loan_id, amount, date, method, note, status, reported_by)
  values (
    v_l.user_id, null, p_loan_id, p_amount, p_date, p_method, coalesce(p_note, ''),
    'pending', v_uid)
  returning id into v_pay_id;

  select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
  perform _notify(
    v_l.user_id, 'loan_payment_reported',
    coalesce(v_actor, 'Alguem') || ' informou um pagamento',
    'Ha um pagamento aguardando sua confirmacao.',
    jsonb_build_object('loan_id', p_loan_id, 'payment_id', v_pay_id,
                       'actor_id', v_uid, 'amount', p_amount));

  -- O id volta porque o AttachmentField precisa dele para montar o path do
  -- comprovante: nao da para anexar e criar no mesmo submit.
  return v_pay_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_confirm_payment(p_payment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid   uuid := auth.uid();
  v_p     finance_loan_payments%rowtype;
  v_actor text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select * into v_p from finance_loan_payments where id = p_payment_id;
  if v_p.id is null then
    raise exception 'Pagamento nao encontrado' using errcode = '42501'; end if;
  if v_p.status <> 'pending' then
    raise exception 'Este pagamento ja foi respondido' using errcode = '42501'; end if;
  if not public.loan_is_owner(v_p.loan_id) then
    raise exception 'Somente o credor confirma pagamento' using errcode = '42501'; end if;

  -- NAO mexe no status do emprestimo: quitacao e' derivada em loanCalc.ts, e
  -- reimplementar o ledger em plpgsql criaria uma segunda fonte de verdade.
  update finance_loan_payments
     set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(), updated_at = now()
   where id = p_payment_id;

  select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
  perform _notify(
    v_p.reported_by, 'loan_payment_confirmed',
    coalesce(v_actor, 'Alguem') || ' confirmou seu pagamento',
    'O valor ja foi abatido do seu saldo devedor.',
    jsonb_build_object('loan_id', v_p.loan_id, 'payment_id', p_payment_id,
                       'actor_id', v_uid, 'amount', v_p.amount));
end;
$$;

CREATE OR REPLACE FUNCTION public.loan_reject_payment(p_payment_id uuid, p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid    uuid := auth.uid();
  v_p      finance_loan_payments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor  text;
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '42501'; end if;

  select * into v_p from finance_loan_payments where id = p_payment_id;
  if v_p.id is null then
    raise exception 'Pagamento nao encontrado' using errcode = '42501'; end if;
  if v_p.status <> 'pending' then
    raise exception 'Este pagamento ja foi respondido' using errcode = '42501'; end if;
  if not public.loan_is_owner(v_p.loan_id) then
    raise exception 'Somente o credor responde a um reporte' using errcode = '42501'; end if;

  update finance_loan_payments
     set status = 'rejected',
         confirmed_by = v_uid,
         confirmed_at = now(),
         note = case when v_reason = '' then note
                     when note = '' then 'Recusado: ' || v_reason
                     else note || E'\n' || 'Recusado: ' || v_reason end,
         updated_at = now()
   where id = p_payment_id;

  select coalesce(display_name, email) into v_actor from profiles where id = v_uid;
  perform _notify(
    v_p.reported_by, 'loan_payment_rejected',
    coalesce(v_actor, 'Alguem') || ' nao reconheceu o pagamento informado',
    case when v_reason = '' then 'O reporte foi recusado.' else v_reason end,
    jsonb_build_object('loan_id', v_p.loan_id, 'payment_id', p_payment_id, 'actor_id', v_uid));
end;
$$;

-- Grants explicitos. _loan_responder_guard fica FORA: como _notify, so pode ser
-- chamada de dentro das SECURITY DEFINER acima.

REVOKE EXECUTE ON FUNCTION public._loan_responder_guard(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.loan_link_borrower(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_request(uuid, bigint, integer, date, date, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_approve(uuid, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_reject(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_cancel_request(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_report_payment(uuid, bigint, date, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_confirm_payment(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.loan_reject_payment(uuid, text) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.loan_link_borrower(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_request(uuid, bigint, integer, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_approve(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_reject(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_cancel_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_report_payment(uuid, bigint, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_confirm_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.loan_reject_payment(uuid, text) TO authenticated;

-- profile_is_related ganha o ramo dos emprestimos. CREATE OR REPLACE de CORPO
-- INTEIRO: as cinco clausulas abaixo sao copia VERBATIM de
-- 20260708150000_sec_profiles_search.sql:14-28. Perder qualquer uma delas
-- quebra nome e avatar em metas, paginas e boards -- EM SILENCIO.
--
-- O ramo novo olha finance_loan_borrowers, e nao finance_loans: a notificacao
-- de vinculo chega ANTES de existir qualquer emprestimo.

CREATE OR REPLACE FUNCTION public.profile_is_related(p_other uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' STABLE AS $$
  select
    p_other = auth.uid()
    or exists (select 1 from page_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from project_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from finance_goal_shares s
        where (s.owner_id = auth.uid() and s.shared_with_user_id = p_other)
           or (s.shared_with_user_id = auth.uid() and s.owner_id = p_other))
    or exists (select 1 from finance_workspace_members m1
        join finance_workspace_members m2 on m1.workspace_id = m2.workspace_id
        where m1.user_id = auth.uid() and m2.user_id = p_other)
    or exists (select 1 from finance_loan_borrowers b
        where (b.user_id = auth.uid() and b.borrower_user_id = p_other)
           or (b.borrower_user_id = auth.uid() and b.user_id = p_other));
$$;

GRANT EXECUTE ON FUNCTION public.profile_is_related(uuid) TO authenticated;