-- SEC-005: verificação das regras de pai de página (pages.parent_id).
--
-- Roda inteira numa transação desfeita: termina em RAISE EXCEPTION com o
-- resultado, então nada fica gravado. Usa três usuários descartáveis, criados
-- e desfeitos aqui (nenhum usuário real é tocado): o preparo desliga gatilhos
-- (convite, perfil) com session_replication_role, e os cenários rodam como
-- `authenticated`, com o JWT desses IDs. Os usuários precisam existir em
-- auth.users: linha inserida na mesma transação tem a FK conferida de novo
-- no update.
--
-- Como rodar: SQL editor do Supabase, ou psql como postgres. A mensagem de
-- erro traz uma linha por cenário. Antes da correção, os ataques aparecem como
-- PERMITIDO; depois, como "bloqueado", e os fluxos legítimos seguem "ok".
do $check$
declare
  a uuid := gen_random_uuid();  -- dono de P e R
  e uuid := gen_random_uuid();  -- editor, com share em P
  u uuid := gen_random_uuid();  -- ninguém: sem acesso a nada de A
  p uuid;
  r uuid;
  x uuid;
  guard_installed boolean := exists (
    select 1 from pg_trigger where tgname = 'guard_page_parent' and tgrelid = 'public.pages'::regclass
  );
  still_reads boolean;
  out text[] := array[]::text[];
begin
  -- Preparo: usuários descartáveis (sem gatilhos nem FKs só nesta etapa).
  set local session_replication_role = replica;
  insert into auth.users (id, email)
  select id, format('sec005-check-%s@example.invalid', id) from unnest(array[a, e, u]) as t(id);
  insert into public.pages (user_id, title) values (a, 'P, de A, compartilhada') returning id into p;
  insert into public.pages (user_id, title) values (a, 'R, de A') returning id into r;
  insert into public.pages (user_id, title) values (e, 'X, do editor') returning id into x;
  insert into public.page_shares (page_id, owner_id, shared_with_user_id, role) values (p, a, e, 'editor');
  set local session_replication_role = origin;

  -- Ataque 1: o editor move P para dentro de X (página dele) e é revogado.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.pages set parent_id = x where id = p;
    reset role;
    out := out || 'ataque 1, editor move P para a pagina dele: PERMITIDO'::text;
  exception when others then
    out := out || ('ataque 1, editor move P para a pagina dele: bloqueado (' || sqlerrm || ')');
  end;
  delete from public.page_shares where page_id = p and shared_with_user_id = e;
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  set local role authenticated;
  still_reads := exists (select 1 from public.pages where id = p);
  reset role;
  out := out || ('ataque 1, depois da revogacao o editor ' || case when still_reads then 'AINDA LE P' else 'perdeu o acesso (ok)' end);

  -- Volta ao estado inicial: P na raiz e a share de volta.
  set local session_replication_role = replica;
  update public.pages set parent_id = null, user_id = a where id = p;
  insert into public.page_shares (page_id, owner_id, shared_with_user_id, role) values (p, a, e, 'editor');
  set local session_replication_role = origin;

  -- Ataque 2: alguém sem acesso pendura uma página em P.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.pages (user_id, parent_id, title) values (u, p, 'intrusa');
    reset role;
    out := out || 'ataque 2, pagina pendurada em P por quem nao tem acesso: PERMITIDO'::text;
  exception when others then
    out := out || ('ataque 2, pagina pendurada em P por quem nao tem acesso: bloqueado (' || sqlerrm || ')');
  end;

  -- Ataque 3: o editor troca o user_id junto com o parent_id.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.pages set parent_id = x, user_id = e where id = p;
    reset role;
    out := out || 'ataque 3, editor troca user_id e parent_id juntos: PERMITIDO'::text;
  exception when others then
    out := out || ('ataque 3, editor troca user_id e parent_id juntos: bloqueado (' || sqlerrm || ')');
  end;
  set local session_replication_role = replica;
  update public.pages set parent_id = null, user_id = a where id = p;
  set local session_replication_role = origin;

  -- Fluxos legítimos.
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.pages (user_id, parent_id, title) values (a, p, 'subpagina do dono');
    reset role;
    out := out || 'legitimo, dono cria subpagina em P: ok'::text;
  exception when others then
    out := out || ('legitimo, dono cria subpagina em P: FALHOU (' || sqlerrm || ')');
  end;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
    set local role authenticated;
    insert into public.pages (user_id, parent_id, title) values (e, p, 'subpagina do editor');
    reset role;
    out := out || 'legitimo, editor com share cria subpagina em P: ok'::text;
  exception when others then
    out := out || ('legitimo, editor com share cria subpagina em P: FALHOU (' || sqlerrm || ')');
  end;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.pages set parent_id = p where id = r;
    update public.pages set parent_id = null where id = r;
    reset role;
    out := out || 'legitimo, dono move R para dentro de P e de volta para a raiz: ok'::text;
  exception when others then
    out := out || ('legitimo, dono move R para dentro de P e de volta para a raiz: FALHOU (' || sqlerrm || ')');
  end;

  -- Ciclo: sem a proteção, criaria recursão sem fim nas checagens de RLS, então
  -- só roda com o gatilho instalado.
  if guard_installed then
    begin
      perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
      set local role authenticated;
      update public.pages set parent_id = p where id = r;
      update public.pages set parent_id = r where id = p;
      reset role;
      out := out || 'ciclo, P para dentro de R (que esta dentro de P): PERMITIDO'::text;
    exception when others then
      out := out || ('ciclo, P para dentro de R (que esta dentro de P): bloqueado (' || sqlerrm || ')');
    end;
  else
    out := out || 'ciclo: nao testado (sem o gatilho, criaria recursao sem fim)'::text;
  end if;

  raise exception using
    message = format(E'SEC-005 verificacao (gatilho instalado: %s; tudo desfeito)\n%s',
                     guard_installed, array_to_string(out, E'\n'));
end
$check$;
