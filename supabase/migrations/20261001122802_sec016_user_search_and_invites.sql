-- SEC-016: enumeração residual de usuários.
--   * search_users_for_share: e-mail COMPLETO acha qualquer perfil (é assim
--     que se convida alguém novo); TRECHO de nome/e-mail só acha quem já se
--     relaciona com você (profile_is_related). Antes, 3 letras listavam a base.
--   * invite_member: não revela mais se o e-mail existe nem se a pessoa já tem
--     workspace (o aceite, accept_workspace_invite, continua recusando quem já
--     tem); convite pendente repetido devolve o mesmo id; limite de 20 convites
--     por hora por pessoa.
-- Mesma assinatura e retorno: os grants existentes continuam valendo.

create or replace function public.search_users_for_share(p_term text)
 returns table(id uuid, display_name text, email text, avatar_emoji text, avatar_color text, avatar_url text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid  uuid := auth.uid();
  v_term text;
  v_rl   record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  select * into v_rl
  from private.rate_limit_touch('user_search:uid', v_uid::text, 40, 60);

  if v_rl.just_tripped then
    begin
      insert into public.audit_log
        (actor_id, actor_label, action, target_type, target_id, details, success, error_message)
      values
        (v_uid, null, 'rate_limit_tripped', 'user_search', v_uid::text,
         jsonb_build_object(
           'bucket',         'user_search:uid',
           'limit',          40,
           'window_seconds', 60
         ),
         false, 'enumeracao de profiles suspeita');
    exception when others then
      null;
    end;
  end if;

  if not v_rl.allowed then
    perform private.raise_rate_limited(v_rl.retry_after,
      'Muitas buscas em sequencia. Aguarde alguns segundos.');
  end if;

  if p_term is null or length(trim(p_term)) < 3 then
    return;
  end if;

  -- E-mail completo: match exato, em qualquer perfil.
  if trim(p_term) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return query
      select p.id, p.display_name, p.email, p.avatar_emoji, p.avatar_color, p.avatar_url
      from public.profiles p
      where p.id <> v_uid
        and lower(p.email) = lower(trim(p_term))
      limit 1;
    return;
  end if;

  v_term := replace(replace(replace(trim(p_term), '\', '\\'), '%', '\%'), '_', '\_');

  -- Trecho: só entre quem já se relaciona com você.
  return query
    select p.id, p.display_name, p.email, p.avatar_emoji, p.avatar_color, p.avatar_url
    from public.profiles p
    where p.id <> v_uid
      and public.profile_is_related(p.id)
      and (p.email ilike '%' || v_term || '%' escape '\'
           or p.display_name ilike '%' || v_term || '%' escape '\')
    order by p.display_name nulls last
    limit 6;
end;
$function$;

create or replace function public.invite_member(p_workspace_id uuid, p_email text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_invite_id uuid;
  v_invited_uid uuid;
  v_ws_name text;
  v_inviter_name text;
  v_rl record;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  -- Check caller is member of this workspace
  if not exists (select 1 from finance_workspace_members where workspace_id = p_workspace_id and user_id = v_uid) then
    raise exception 'Not a member of this workspace';
  end if;

  -- SEC-016: convidar e-mails em sequência servia para descobrir quem existe.
  select * into v_rl from private.rate_limit_touch('workspace_invite:uid', v_uid::text, 20, 3600);
  if not v_rl.allowed then
    perform private.raise_rate_limited(v_rl.retry_after, 'Muitos convites em sequencia. Tente mais tarde.');
  end if;

  -- SEC-016: convite pendente repetido devolve o mesmo, sem erro que revele algo.
  select id into v_invite_id
  from finance_workspace_invites
  where workspace_id = p_workspace_id and invited_email = v_email and status = 'pending'
  limit 1;
  if v_invite_id is not null then return v_invite_id; end if;

  -- SEC-016: não diz mais se o e-mail tem conta nem se já está num workspace;
  -- quem já está é recusado ao aceitar (accept_workspace_invite).
  select id into v_invited_uid from auth.users where email = v_email;

  -- Get workspace name and inviter name for notification
  select name into v_ws_name from finance_workspaces where id = p_workspace_id;
  select coalesce(display_name, email) into v_inviter_name from profiles where id = v_uid;
  -- Create invite
  insert into finance_workspace_invites (workspace_id, invited_by, invited_email, invited_user_id, status)
  values (p_workspace_id, v_uid, v_email, v_invited_uid, 'pending')
  returning id into v_invite_id;
  -- Notify the invited user if they exist
  if v_invited_uid is not null then
    perform _notify(
      v_invited_uid,
      'workspace_invite',
      coalesce(v_inviter_name, 'Alguém') || ' convidou você para "' || coalesce(v_ws_name, 'Família') || '"',
      'Você recebeu um convite para compartilhar finanças.',
      jsonb_build_object('workspace_id', p_workspace_id, 'invite_id', v_invite_id, 'actor_id', v_uid)
    );
  end if;
  return v_invite_id;
end;
$function$;
