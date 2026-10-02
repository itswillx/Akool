-- DEV-005: retrato do schema para detectar mudança feita fora do repositório
-- (painel, SQL avulso). A MESMA consulta roda no CI (scripts/supabase-drift.mjs,
-- pela Management API) e pelo MCP (execute_sql) para regravar
-- supabase/schema-snapshot.json depois de cada migration. Corpos e ACLs entram
-- como md5: o arquivo fica pequeno e qualquer mudança aparece.
-- Objetos de extensões ficam de fora.
select jsonb_build_object(
  'tables', (
    select coalesce(jsonb_object_agg(format('%s.%s', n.nspname, c.relname),
      jsonb_build_object('kind', c.relkind, 'rls', c.relrowsecurity, 'acl', md5(coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x), '')))), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  ),
  'columns', (
    select coalesce(jsonb_object_agg(format('%s.%s.%s', table_schema, table_name, column_name),
      concat_ws(' ', data_type, case when is_nullable = 'NO' then 'not null' end, 'default ' || column_default)), '{}')
    from information_schema.columns
    where table_schema in ('public', 'private')
  ),
  'policies', (
    select coalesce(jsonb_object_agg(format('%s.%s.%s', schemaname, tablename, policyname),
      md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check))), '{}')
    from pg_policies
    where schemaname in ('public', 'private', 'storage')
  ),
  'functions', (
    select coalesce(jsonb_object_agg(format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
      -- DEV-002: a definição entra normalizada (sem comentários, minúscula,
      -- espaços colapsados): a mesma função chega à produção pelo MCP e ao
      -- staging pela API com comentários e caixa diferentes, e isso não é drift.
      md5(concat_ws('|',
        lower(regexp_replace(regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')),
        -- A ordem dos itens da ACL depende da ordem histórica dos grants: ordenada, não é drift.
        coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), '')))), '{}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  ),
  'triggers', (
    select coalesce(jsonb_object_agg(format('%s.%s.%s', n.nspname, c.relname, t.tgname), md5(pg_get_triggerdef(t.oid))), '{}')
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname in ('public', 'private', 'storage', 'auth')
      and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')
  ),
  'buckets', (
    select coalesce(jsonb_object_agg(id, jsonb_build_object('public', public, 'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types)), '{}')
    from storage.buckets
  ),
  'cron', (
    select coalesce(jsonb_object_agg(jobname, jsonb_build_object('schedule', schedule, 'command', md5(command), 'active', active)), '{}')
    from cron.job
  )
) as snapshot;
