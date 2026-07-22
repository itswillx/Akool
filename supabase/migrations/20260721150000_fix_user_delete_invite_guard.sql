-- FIX: excluir usuario em auth.users falhava com "Convidado so pode alterar o
-- status do convite". A FK finance_workspace_invites.invited_user_id e' ON
-- DELETE SET NULL; o UPDATE interno do cascade dispara trg_wi_invitee_guard e,
-- sem JWT (dashboard/admin API/service role), is_workspace_member() retorna
-- false -> o guard trata o sistema como invitee e aborta o DELETE inteiro.
-- O guard passa a ignorar contextos de sistema (auth.uid() null): requests de
-- usuarios finais sempre tem JWT, e o acesso anonimo direto ja e' barrado por
-- RLS antes do trigger.

create or replace function public.finance_guard_invite_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Contexto de sistema (FK cascade de exclusao de usuario, dashboard, service
  -- role, migracoes): sem JWT nao ha invitee a conter — deixa passar.
  if auth.uid() is null then
    return new;
  end if;

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
