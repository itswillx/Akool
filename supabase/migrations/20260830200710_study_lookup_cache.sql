-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260830200710).
-- SQL idêntico ao aplicado em produção (md5 f7198ecfe01f95a5cd0e78f5336bea17); não editar.

create table if not exists public.study_lookup_cache (
  provider   text        not null,
  action     text        not null,
  cache_key  text        not null,
  payload    jsonb       not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  hits       integer     not null default 0,
  primary key (provider, action, cache_key)
);

create index if not exists study_lookup_cache_expires_idx
  on public.study_lookup_cache (expires_at);

alter table public.study_lookup_cache enable row level security;

revoke all on table public.study_lookup_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.study_lookup_cache to service_role;

comment on table public.study_lookup_cache is
  'Cache compartilhado de buscas em APIs publicas sem chave (edge function study-lookup). Acesso apenas via service_role; RLS deny-all para anon/authenticated.';

create or replace function public.study_lookup_cache_prune()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deleted integer;
begin
  delete from public.study_lookup_cache
  where expires_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.study_lookup_cache_prune() from public, anon, authenticated;
grant execute on function public.study_lookup_cache_prune() to service_role;