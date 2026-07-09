-- SEC (P0): mover ai_api_key/ai_provider de profiles para tabela fechada profile_secrets.
-- Motivo: a policy profiles_authenticated_select = USING(true) expunha a chave de IA
-- em texto plano a qualquer usuario autenticado via /rest/v1/profiles.

create table public.profile_secrets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ai_provider text,
  ai_api_key text,
  updated_at timestamptz not null default now()
);

alter table public.profile_secrets enable row level security;
-- Sem policies: acesso apenas via service role / funcoes SECURITY DEFINER.
revoke all on table public.profile_secrets from anon, authenticated;

-- Migrar dados existentes
insert into public.profile_secrets (user_id, ai_provider, ai_api_key)
select id, ai_provider, ai_api_key
from public.profiles
where (ai_api_key is not null and ai_api_key <> '') or ai_provider is not null;

-- Recriar RPC para gravar na nova tabela (mantem profiles.ai_has_key para a UI)
create or replace function public.set_ai_credentials(p_provider text, p_api_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_api_key is not null and trim(p_api_key) <> '' then
    insert into profile_secrets (user_id, ai_provider, ai_api_key, updated_at)
    values (auth.uid(), p_provider, trim(p_api_key), now())
    on conflict (user_id) do update
      set ai_provider = excluded.ai_provider,
          ai_api_key  = excluded.ai_api_key,
          updated_at  = now();
    update profiles set ai_has_key = true where id = auth.uid();
  else
    update profile_secrets
      set ai_provider = p_provider, updated_at = now()
      where user_id = auth.uid();
  end if;
end;
$$;

grant execute on function public.set_ai_credentials(text, text) to authenticated;

-- Remover coluna sensivel e trigger de sincronizacao antigo
drop trigger if exists trg_profiles_sync_ai_has_key on public.profiles;
drop function if exists public.fn_sync_ai_has_key();
alter table public.profiles drop column if exists ai_api_key;
alter table public.profiles drop column if exists ai_provider;
