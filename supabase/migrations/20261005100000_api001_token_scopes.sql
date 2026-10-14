-- API-001: escopos por subseção no token pessoal (docs/api-arquitetura.md §6 e
-- Apêndice A).
--
-- * private.api_scope_catalog: cópia do catálogo canônico de
--   supabase/functions/_api/catalog.ts (catalogParity.test.ts compara os dois).
-- * api_tokens.scopes guarda o nível por subseção
--   ({"secao.subsecao": "read|write|delete"}, sem chave = Nenhum);
--   api_tokens.last_client, quem usou o token por último.
-- * create_api_token ganha p_scopes (nulo = preset legado, o do /fila) e as
--   regras de §6. A versão de 2 argumentos sai aqui mesmo, para o PostgREST não
--   ficar com duas candidatas (PGRST203) na chamada da tela atual.
-- * update_api_token_scopes, revoke_all_my_api_tokens e delete_api_token: só o
--   dono e só de sessão do app (recusam claims com akool_api).
-- * resolve_api_token_v2 (só service_role): dono, token, e-mail e escopos
--   efetivos. A v1 fica até o API-061.
-- * Os tokens ativos passam para o preset legado, sem projetos.validacao.
--
-- api_tokens vive de grants por coluna: nenhum REVOKE de tabela aqui.

-- ---------------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------------

create table private.api_scope_catalog (
  key        text primary key check (key ~ '^[a-z]+\.[a-z_]+$'),
  section    text not null,
  label      text not null,
  max_level  text not null check (max_level in ('read', 'write', 'delete')),
  admin_only boolean not null default false
);

alter table private.api_scope_catalog enable row level security;
revoke all on private.api_scope_catalog from public, anon, authenticated;

insert into private.api_scope_catalog (key, section, label, max_level, admin_only) values
  ('perfil.dados', 'perfil', 'Perfil › Dados e preferências', 'write', false),
  ('perfil.notificacoes', 'perfil', 'Perfil › Notificações', 'delete', false),
  ('perfil.convites', 'perfil', 'Perfil › Convites', 'write', false),
  ('documentos.paginas', 'documentos', 'Documentos › Páginas', 'delete', false),
  ('documentos.notas', 'documentos', 'Documentos › Conteúdo de notas', 'write', false),
  ('documentos.desenhos', 'documentos', 'Documentos › Desenhos', 'write', false),
  ('documentos.tarefas', 'documentos', 'Documentos › Tarefas (listas)', 'delete', false),
  ('documentos.notas_rapidas', 'documentos', 'Documentos › Notas rápidas', 'delete', false),
  ('estudos.conteudo', 'estudos', 'Estudos › Tópicos e roteiros', 'delete', false),
  ('estudos.progresso', 'estudos', 'Estudos › Progresso (checkpoints e quiz)', 'write', false),
  ('estudos.diario', 'estudos', 'Estudos › Diário', 'delete', false),
  ('projetos.quadros', 'projetos', 'Projetos › Quadros e colunas', 'delete', false),
  ('projetos.cards', 'projetos', 'Projetos › Cards', 'delete', false),
  ('projetos.fila', 'projetos', 'Projetos › Fila de desenvolvimento', 'write', false),
  ('projetos.validacao', 'projetos', 'Projetos › Validação (aprovar/reprovar)', 'write', false),
  ('financas.transacoes', 'financas', 'Finanças › Transações', 'delete', false),
  ('financas.contas', 'financas', 'Finanças › Contas', 'delete', false),
  ('financas.categorias', 'financas', 'Finanças › Categorias', 'delete', false),
  ('financas.orcamentos_metas', 'financas', 'Finanças › Orçamentos e metas', 'delete', false),
  ('financas.recorrentes', 'financas', 'Finanças › Recorrentes', 'delete', false),
  ('financas.loja', 'financas', 'Finanças › Loja', 'delete', false),
  ('financas.emprestimos', 'financas', 'Finanças › Empréstimos', 'delete', false),
  ('compartilhamento.pessoas', 'compartilhamento', 'Compartilhamento › Pessoas e conteúdo compartilhado', 'delete', false),
  ('admin.usuarios', 'admin', 'Administração › Usuários', 'read', true),
  ('admin.convites', 'admin', 'Administração › Convites e cotas', 'read', true),
  ('admin.auditoria', 'admin', 'Administração › Auditoria', 'read', true),
  ('admin.backups', 'admin', 'Administração › Backups', 'read', true);

-- ---------------------------------------------------------------------------
-- 2. Funções auxiliares (private, sem EXECUTE para ninguém além do dono)
-- ---------------------------------------------------------------------------

create or replace function private.api_level_rank(p_level text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_level when 'read' then 1 when 'write' then 2 when 'delete' then 3 else 0 end
$$;

-- O que o /fila usa. Igual a LEGACY_SCOPES em _api/catalog.ts.
create or replace function private.api_legacy_scopes()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"projetos.quadros": "read", "projetos.cards": "read", "projetos.fila": "write"}'::jsonb
$$;

-- Forma de api_tokens.scopes (CHECK). O catálogo é conferido nas funções,
-- porque CHECK não pode depender de outra tabela.
create or replace function private.api_scopes_shape_ok(p_scopes jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_scopes) = 'object'
     and not exists (
       select 1
         from jsonb_each(p_scopes) as e(key, value)
        where e.key !~ '^[a-z]+\.[a-z_]+$'
           or jsonb_typeof(e.value) <> 'string'
           or (e.value #>> '{}') not in ('read', 'write', 'delete')
     )
$$;

-- Confere escopos contra o catálogo e devolve o jsonb limpo ("none" sai).
-- A primeira falha vira exceção com mensagem para a pessoa.
create or replace function private.api_validate_scopes(p_scopes jsonb, p_is_admin boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_entry record;
  v_cat   record;
  v_level text;
  v_out   jsonb := '{}'::jsonb;
begin
  if p_scopes is null or jsonb_typeof(p_scopes) <> 'object' then
    raise exception 'Permissões devem ser um objeto {"secao.subsecao": "read", "write" ou "delete"}' using errcode = '22023';
  end if;

  for v_entry in select e.key, e.value from jsonb_each(p_scopes) as e(key, value) order by e.key loop
    select c.max_level, c.admin_only, c.label into v_cat
      from private.api_scope_catalog c
     where c.key = v_entry.key;
    if not found then
      raise exception 'Subseção inexistente: %', v_entry.key using errcode = '22023';
    end if;
    v_level := case when jsonb_typeof(v_entry.value) = 'string' then v_entry.value #>> '{}' end;
    if v_level = 'none' then
      continue;
    end if;
    if v_level is null or v_level not in ('read', 'write', 'delete') then
      raise exception 'Nível inválido em %: use read, write ou delete', v_entry.key using errcode = '22023';
    end if;
    if private.api_level_rank(v_level) > private.api_level_rank(v_cat.max_level) then
      raise exception '% aceita no máximo %', v_cat.label, v_cat.max_level using errcode = '22023';
    end if;
    if v_cat.admin_only and not coalesce(p_is_admin, false) then
      raise exception '% é só para administradores', v_cat.label using errcode = '42501';
    end if;
    v_out := v_out || jsonb_build_object(v_entry.key, v_level);
  end loop;

  return v_out;
end;
$$;

-- Quem gerencia tokens: a pessoa logada no app. Uma chamada feita com um token
-- da API (claim akool_api, a partir do API-010) não cria, edita nem apaga token.
create or replace function private.api_token_app_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(auth.jwt(), '{}'::jsonb) ? 'akool_api' then
    raise exception 'Tokens só são criados, editados e excluídos pelo app, em Configurações → API' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Regras que dependem do nível: validade máxima e segundo fator.
create or replace function private.api_token_policy(p_uid uuid, p_scopes jsonb, p_expires_at timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_write boolean := exists (select 1 from jsonb_each_text(p_scopes) as e(key, value) where e.value in ('write', 'delete'));
  v_admin boolean := exists (select 1 from jsonb_object_keys(p_scopes) as k(key) where k.key like 'admin.%');
begin
  if v_admin and p_expires_at > now() + interval '30 days' then
    raise exception 'Token com Administração vale no máximo 30 dias' using errcode = '22023';
  end if;
  if v_write and p_expires_at > now() + interval '90 days' then
    raise exception 'Token com Escrever ou Excluir vale no máximo 90 dias' using errcode = '22023';
  end if;
  if (v_write or v_admin)
     and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2'
     and exists (select 1 from auth.mfa_factors f where f.user_id = p_uid and f.status = 'verified') then
    raise exception 'Confirme o segundo fator (MFA) antes de dar Escrever, Excluir ou Administração a um token' using errcode = '42501';
  end if;
end;
$$;

-- Trilha de admin.* (formato do SEC-018).
create or replace function private.api_token_audit_admin(p_uid uuid, p_token uuid, p_prefix text, p_event text, p_before jsonb, p_after jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_before jsonb := coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(p_before, '{}'::jsonb)) as e(key, value) where e.key like 'admin.%'), '{}'::jsonb);
  v_after  jsonb := coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(coalesce(p_after, '{}'::jsonb)) as e(key, value) where e.key like 'admin.%'), '{}'::jsonb);
begin
  if v_before = v_after then
    return;
  end if;
  insert into public.audit_log (actor_id, actor_label, action, target_type, target_id, details, success)
  values (p_uid, (select p.email from public.profiles p where p.id = p_uid), 'api_token_admin_scopes', 'api_token', p_token::text,
          jsonb_build_object('event', p_event, 'prefix', p_prefix, 'before', v_before, 'after', v_after), true);
end;
$$;

revoke execute on function private.api_level_rank(text) from public;
revoke execute on function private.api_legacy_scopes() from public;
revoke execute on function private.api_scopes_shape_ok(jsonb) from public;
revoke execute on function private.api_validate_scopes(jsonb, boolean) from public;
revoke execute on function private.api_token_app_user() from public;
revoke execute on function private.api_token_policy(uuid, jsonb, timestamptz) from public;
revoke execute on function private.api_token_audit_admin(uuid, uuid, text, text, jsonb, jsonb) from public;

-- ---------------------------------------------------------------------------
-- 3. Colunas novas e migração dos tokens ativos
-- ---------------------------------------------------------------------------

alter table public.api_tokens
  add column scopes jsonb not null default '{}'::jsonb,
  add column last_client text;

alter table public.api_tokens
  add constraint api_tokens_scopes_shape check (private.api_scopes_shape_ok(scopes)),
  add constraint api_tokens_last_client_len check (char_length(last_client) <= 120);

-- Por coluna, como as outras: o hash e o dono continuam fora.
grant select (scopes, last_client) on public.api_tokens to authenticated;

update public.api_tokens
   set scopes = private.api_legacy_scopes()
 where revoked_at is null and expires_at > now();

-- ---------------------------------------------------------------------------
-- 4. Criar, editar, revogar todos e excluir (sessão do app)
-- ---------------------------------------------------------------------------

drop function public.create_api_token(text, integer);

create function public.create_api_token(p_name text default 'Token', p_expires_in_days integer default 90, p_scopes jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := private.api_token_app_user();
  v_days    integer := coalesce(p_expires_in_days, 90);
  v_scopes  jsonb;
  v_token   text;
  v_prefix  text;
  v_id      uuid;
  v_expires timestamptz;
begin
  v_scopes := case when p_scopes is null then private.api_legacy_scopes()
                   else private.api_validate_scopes(p_scopes, public.is_admin()) end;
  if v_scopes = '{}'::jsonb then
    raise exception 'Escolha ao menos uma permissão para o token' using errcode = '22023';
  end if;
  if v_days not in (7, 30, 90, 365) then
    raise exception 'Validade deve ser de 7, 30, 90 ou 365 dias' using errcode = '22023';
  end if;
  v_expires := now() + make_interval(days => v_days);
  perform private.api_token_policy(v_uid, v_scopes, v_expires);

  -- Uma criação por vez por pessoa, para o limite valer.
  perform pg_advisory_xact_lock(hashtext('api_tokens:' || v_uid::text));
  if (select count(*) from public.api_tokens t
       where t.user_id = v_uid and t.revoked_at is null and t.expires_at > now()) >= 20 then
    raise exception 'Limite de 20 tokens ativos. Revogue ou exclua um antes de gerar outro.' using errcode = 'P0001';
  end if;

  -- gen_random_uuid usa pg_strong_random: 2 UUIDs v4 = 244 bits aleatórios.
  v_token := 'akool_pat_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_prefix := left(v_token, 14);

  insert into public.api_tokens (user_id, name, token_hash, prefix, expires_at, scopes)
  values (
    v_uid,
    left(coalesce(nullif(trim(p_name), ''), 'Token'), 80),
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    v_prefix,
    v_expires,
    v_scopes
  )
  returning id into v_id;

  perform private.api_token_audit_admin(v_uid, v_id, v_prefix, 'create', null, v_scopes);

  return jsonb_build_object('id', v_id, 'token', v_token, 'prefix', v_prefix, 'expires_at', v_expires, 'scopes', v_scopes);
end;
$$;

-- Troca as permissões de um token ativo. O segredo não muda.
create or replace function public.update_api_token_scopes(p_id uuid, p_scopes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := private.api_token_app_user();
  v_token  record;
  v_scopes jsonb;
begin
  select t.id, t.prefix, t.scopes, t.expires_at into v_token
    from public.api_tokens t
   where t.id = p_id and t.user_id = v_uid and t.revoked_at is null and t.expires_at > now()
   for update;
  if not found then
    raise exception 'Token não encontrado, revogado ou expirado' using errcode = 'P0002';
  end if;

  v_scopes := private.api_validate_scopes(p_scopes, public.is_admin());
  if v_scopes = '{}'::jsonb then
    raise exception 'Escolha ao menos uma permissão. Para desligar o token, revogue.' using errcode = '22023';
  end if;
  perform private.api_token_policy(v_uid, v_scopes, v_token.expires_at);

  update public.api_tokens set scopes = v_scopes where id = v_token.id;
  perform private.api_token_audit_admin(v_uid, v_token.id, v_token.prefix, 'update', v_token.scopes, v_scopes);

  return jsonb_build_object('id', v_token.id, 'scopes', v_scopes);
end;
$$;

-- Revoga todos os tokens ativos da pessoa. Devolve quantos.
create or replace function public.revoke_all_my_api_tokens()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.api_token_app_user();
  v_n   integer;
begin
  update public.api_tokens
     set revoked_at = now()
   where user_id = v_uid and revoked_at is null and expires_at > now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Apaga o token em qualquer estado. Ativo, ele para de funcionar na hora:
-- resolve_api_token(_v2) não acha mais a linha.
create or replace function public.delete_api_token(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.api_token_app_user();
begin
  delete from public.api_tokens where id = p_id and user_id = v_uid;
  if not found then
    raise exception 'Token não encontrado' using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Resolução para as edges (service_role)
-- ---------------------------------------------------------------------------

-- Token válido → dono, token, e-mail e escopos efetivos; senão null. Conta
-- banida ou desativada (profiles.is_active, como o app faz no login) não
-- passa. admin.* sai de quem deixou de ser admin. last_used_at e last_client
-- são regravados no máximo a cada 60 s.
create or replace function public.resolve_api_token_v2(p_hash text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    record;
  v_scopes jsonb;
begin
  select t.id, t.user_id, t.name, t.prefix, t.scopes, t.expires_at, t.last_used_at, u.email, p.role, p.is_active
    into v_row
    from public.api_tokens t
    join auth.users u on u.id = t.user_id
    left join public.profiles p on p.id = t.user_id
   where t.token_hash = p_hash
     and t.revoked_at is null
     and t.expires_at > now()
     and (u.banned_until is null or u.banned_until <= now());
  if not found or v_row.is_active is false then
    return null;
  end if;

  if v_row.last_used_at is null or v_row.last_used_at < now() - interval '60 seconds' then
    update public.api_tokens
       set last_used_at = now(),
           last_client = coalesce(left(nullif(trim(p_client), ''), 120), last_client)
     where id = v_row.id;
  end if;

  v_scopes := case when v_row.role = 'admin' then v_row.scopes
                   else coalesce((select jsonb_object_agg(e.key, e.value)
                                    from jsonb_each(v_row.scopes) as e(key, value)
                                   where e.key not like 'admin.%'), '{}'::jsonb) end;

  return jsonb_build_object(
    'user_id', v_row.user_id,
    'token_id', v_row.id,
    'name', v_row.name,
    'prefix', v_row.prefix,
    'email', v_row.email,
    'scopes', v_scopes,
    'expires_at', v_row.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants (RPC nova nasce com EXECUTE para PUBLIC: revogar à mão)
-- ---------------------------------------------------------------------------

revoke execute on function public.create_api_token(text, integer, jsonb) from public, anon;
grant execute on function public.create_api_token(text, integer, jsonb) to authenticated;
revoke execute on function public.update_api_token_scopes(uuid, jsonb) from public, anon;
grant execute on function public.update_api_token_scopes(uuid, jsonb) to authenticated;
revoke execute on function public.revoke_all_my_api_tokens() from public, anon;
grant execute on function public.revoke_all_my_api_tokens() to authenticated;
revoke execute on function public.delete_api_token(uuid) from public, anon;
grant execute on function public.delete_api_token(uuid) to authenticated;
revoke execute on function public.resolve_api_token_v2(text, text) from public, anon, authenticated;
grant execute on function public.resolve_api_token_v2(text, text) to service_role;
