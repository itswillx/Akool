-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260812145848).
-- SQL idêntico ao aplicado em produção (md5 3a444870e50d9872c6d642a55e00a451); não editar.

create or replace function public.try_cast_uuid(p_text text)
returns uuid
language plpgsql
stable
set search_path to ''
as $function$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$function$;