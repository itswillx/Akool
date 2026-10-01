-- SEC-005: o pai de uma página só muda dentro das regras.
--
-- page_is_readable/page_is_writable dão acesso a quem é dono de QUALQUER
-- ancestral. Sem regra no parent_id, dava para:
--   1. um editor mover a página compartilhada para baixo de uma página dele
--      e, depois de revogado, continuar lendo e editando (vira dono de um
--      ancestral);
--   2. criar uma página pendurada no ID de uma página alheia, que passava a
--      aparecer para o dono daquela página.
-- Verificação: supabase/checks/sec005-page-parent.sql (transação desfeita).

-- 1. Mudança de pai: o novo pai tem de ser do mesmo dono da página e não pode
--    ser a própria página nem uma subpágina dela (um ciclo faria os CTEs
--    recursivos das checagens de RLS rodarem sem fim). Compara com
--    OLD.user_id: o prevent_page_ownership_transfer só restaura o user_id
--    depois deste gatilho (ordem alfabética), então NEW.user_id pode vir
--    trocado no mesmo update. Ir para a raiz (parent_id nulo) continua livre.
create or replace function private.guard_page_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só chamadas pela API; service_role e migrations (sem auth.uid()) passam.
  if (select auth.uid()) is null
     or new.parent_id is null
     or new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

  if exists (
    with recursive up as (
      select p.id, p.parent_id from public.pages p where p.id = new.parent_id
      union
      select p.id, p.parent_id from public.pages p join up on p.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'SEC-005: a página não pode ficar dentro dela mesma ou de uma subpágina dela'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.pages p where p.id = new.parent_id and p.user_id = old.user_id
  ) then
    raise exception 'SEC-005: a página só pode ir para dentro de outra página do mesmo dono'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_page_parent() from public, anon, authenticated;

drop trigger if exists guard_page_parent on public.pages;
create trigger guard_page_parent
  before update of parent_id on public.pages
  for each row execute function private.guard_page_parent();

-- 2. Criação: página filha só sob um pai em que se pode escrever (dono,
--    co-dono ou editor, pelo page_is_writable).
alter policy pages_insert on public.pages
  with check (
    (select auth.uid()) = user_id
    and (parent_id is null or public.page_is_writable(parent_id))
  );
