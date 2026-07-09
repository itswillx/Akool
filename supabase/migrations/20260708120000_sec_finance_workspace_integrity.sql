-- SEC (P1): fechar brechas de integridade nos workspaces financeiros.
-- Modelo confirmado: colaboracao total (qualquer membro edita/exclui lancamentos do
-- workspace). Fechamos apenas: (a) INSERT em workspace do qual nao se e' membro,
-- (b) realocacao de linha para outro workspace / troca de user_id, (c) invitee
-- alterando campos alem do status.

-- ---------------------------------------------------------------------------
-- 1) INSERT precisa validar workspace_id quando presente.
--    As policies *_owner_all sao FOR ALL com WITH CHECK (user_id = auth.uid()),
--    o que permite inserir com workspace_id alheio. Trocamos por um trigger
--    BEFORE INSERT OR UPDATE que valida a realocacao/insercao de forma uniforme,
--    preservando as policies FOR ALL existentes (colaboracao total no UPDATE
--    continua via workspace_write).
-- ---------------------------------------------------------------------------

create or replace function public.finance_guard_workspace()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- INSERT: se aponta para um workspace, o autor precisa ser membro.
  if tg_op = 'INSERT' then
    if new.workspace_id is not null and not is_workspace_member(new.workspace_id) then
      raise exception 'Nao e membro do workspace %', new.workspace_id
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE: ninguem pode realocar a linha para outro workspace nem trocar o dono,
  -- exceto o proprio dono da linha (owner original).
  if tg_op = 'UPDATE' then
    if (new.workspace_id is distinct from old.workspace_id
        or new.user_id is distinct from old.user_id)
       and old.user_id <> auth.uid() then
      raise exception 'Somente o autor pode realocar o lancamento'
        using errcode = '42501';
    end if;
    -- Se realocar para um workspace, precisa ser membro do destino.
    if new.workspace_id is not null
       and new.workspace_id is distinct from old.workspace_id
       and not is_workspace_member(new.workspace_id) then
      raise exception 'Nao e membro do workspace de destino %', new.workspace_id
        using errcode = '42501';
    end if;
    return new;
  end if;

  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'finance_transactions','finance_budgets','finance_categories',
    'finance_goals','finance_accounts','finance_recurring'
  ] loop
    execute format('drop trigger if exists trg_%1$s_ws_guard on public.%1$s', t);
    execute format(
      'create trigger trg_%1$s_ws_guard before insert or update on public.%1$s
         for each row execute function public.finance_guard_workspace()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2) finance_workspace_invites: invitee so pode mudar o status, nao remapear
--    o convite para outro workspace/email/usuario.
-- ---------------------------------------------------------------------------
create or replace function public.finance_guard_invite_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Se quem edita NAO e' membro do workspace (ou seja, e' o invitee), congela campos.
  if not is_workspace_member(old.workspace_id) then
    if new.workspace_id is distinct from old.workspace_id
       or new.invited_email is distinct from old.invited_email
       or new.invited_user_id is distinct from old.invited_user_id then
      raise exception 'Convidado so pode alterar o status do convite'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wi_invitee_guard on public.finance_workspace_invites;
create trigger trg_wi_invitee_guard
  before update on public.finance_workspace_invites
  for each row execute function public.finance_guard_invite_update();

-- ---------------------------------------------------------------------------
-- 3) Consistencia: finance_recurring_entries sem leitura por workspace.
--    Adiciona workspace_read igual as demais tabelas (coluna workspace_id
--    existe via finance_recurring; entries herda pelo recurring_id).
-- ---------------------------------------------------------------------------
drop policy if exists workspace_read on public.finance_recurring_entries;
create policy workspace_read on public.finance_recurring_entries
  for select using (
    exists (
      select 1 from public.finance_recurring r
      where r.id = finance_recurring_entries.recurring_id
        and r.workspace_id is not null
        and is_workspace_member(r.workspace_id)
    )
  );

grant execute on function public.finance_guard_workspace() to authenticated;
grant execute on function public.finance_guard_invite_update() to authenticated;
