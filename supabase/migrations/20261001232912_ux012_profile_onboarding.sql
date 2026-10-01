-- UX-012: o tour "visto" (geral e por módulo) deixa de viver só no localStorage
-- do aparelho e passa a ficar no perfil, como jsonb módulo → data ISO em que foi
-- visto ({"welcome": "2026-10-01", "projects": "…"}). profiles usa grants POR
-- COLUNA para SELECT/UPDATE (ver 20260727170000_profile_avatar_column_grants):
-- coluna nova nasce sem grant, por isso os dois abaixo. anon não lê.
alter table public.profiles
  add column onboarding jsonb not null default '{}'::jsonb;

grant select (onboarding) on public.profiles to authenticated;
grant update (onboarding) on public.profiles to authenticated;
