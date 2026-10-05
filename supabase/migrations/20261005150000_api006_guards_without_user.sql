-- API-006: a guarda de workspace das linhas financeiras deixa passar o
-- contexto sem usuário (restauração de backup pelo service_role, pg_cron,
-- migrations), como já fazem private.guard_page_parent e as guardas de
-- empréstimo.
--
-- Antes: is_workspace_member() lê auth.uid(), que é nulo sem usuário, então
-- todo INSERT de linha com workspace_id levantava 42501. A restauração de
-- backup roda numa transação só e não desliga gatilhos: parava na primeira
-- linha de workspace e desfazia tudo. O job de recorrentes (API-016) teria o
-- mesmo problema.
--
-- Regra (docs/api-arquitetura.md §1.5 e supabase/migrations/README.md): pula
-- só quando não há usuário e o papel do JWT não é de cliente. Sessão do app e
-- da API (akool_api) sempre tem sub; um JWT authenticated ou anon sem sub
-- continua conferido e cai no 42501. Fora o retorno no início, o corpo é o de
-- 20260708120000_sec_finance_workspace_integrity. O OID não muda, então os 16
-- gatilhos trg_*_ws_guard seguem apontando para esta função.

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

revoke all on function public.finance_guard_workspace() from public, anon, authenticated;
