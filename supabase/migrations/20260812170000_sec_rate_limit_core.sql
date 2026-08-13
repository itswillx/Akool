-- SEC-012: rate limiting no proprio Postgres.
--
-- Por que no banco e nao numa borda: as duas superficies expostas sao RPC
-- SECURITY DEFINER servidas direto pelo PostgREST -- `validate_invite_code`
-- (EXECUTE para anon, chamada no signup antes do login) e
-- `search_users_for_share` (authenticated, varre `profiles` por ilike). Nao ha
-- camada intermediaria onde limitar sem colocar um proxy na frente do Supabase.
--
-- Restricao do ambiente: o remoto NAO tem pg_cron nem pg_net (so
-- pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp). Nao existe
-- job de limpeza possivel, entao a expiracao e oportunistica, dentro da propria
-- funcao (secoes A e B em rate_limit_touch).
--
-- A DECISAO DE PROJETO MAIS IMPORTANTE AQUI -- leia antes de mexer:
--
--   O PostgREST roda cada RPC dentro de UMA transacao. Qualquer `raise`
--   (inclusive o `sqlstate 'PGRST'` que produz o 429) aborta essa transacao e
--   DESFAZ o INSERT do contador feito no mesmo request. Sem autonomous
--   transaction (nao ha dblink nem pg_background) isso e inescapavel.
--
--   A saida e o contador de janela fixa ser AUTO-SATURANTE:
--     * o request que leva hits de L-1 para L NAO bloqueia, responde 200 e
--       COMMITA -- o estado persistido passa a ser exatamente L;
--     * o request seguinte incrementaria para L+1, bloqueia, e o rollback
--       devolve o valor commitado para L;
--     * repete ate a janela virar.
--   Ou seja: o contador nunca passa de L e nunca regride abaixo de L, entao o
--   bloqueio e estavel pelo resto da janela.
--
--   Custo aceito: a tabela NAO mede o tamanho do ataque (fica pinada em L).
--   O volume fica nos logs do PostgREST; o evento pontual vai para audit_log.
--
--   Corolario 1 (fast path): o caminho ja bloqueado LE antes de escrever e sai
--   sem tocar na tupla. Sob ataque isso evita convoy de lock na linha quente e
--   nao gera tupla morta -- o INSERT seria revertido de qualquer jeito.
--   Corolario 2 (auditoria): audit_log so recebe o evento de TRANSICAO
--   (hits = L), que e o ultimo request PERMITIDO e portanto commita. Teto rigido
--   de 1 linha por (bucket, subject, janela). Logar cada tentativa invalida
--   seria (i) revertido justamente no caso bloqueado e (ii) um vetor de DoS,
--   porque audit_log nao tem poda.
--   Corolario 3 (edge functions): public.check_rate_limit NAO da raise, retorna
--   jsonb. Se desse raise, o incremento dela tambem seria revertido e o contador
--   ficaria travado no primeiro trip. O 429 das edge functions e montado em TS.
--
-- Idempotente: if not exists / create or replace / revoke de privilegio ausente
-- nao e erro no Postgres.

-- ---------------------------------------------------------------------------
-- 1. Schema privado
--    A Data API expoe apenas `public` e `graphql_public` (config.toml [api]
--    schemas), entao nada em `private` e alcancavel por REST.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- 2. Tabela de contadores
--    UNLOGGED: estado descartavel, nao vale o custo de WAL. Some em crash
--    recovery -- no pior caso uma janela de rate limit reseta, o que e
--    aceitavel para o que a tabela protege.
--    fillfactor 70: a MESMA tupla e atualizada dezenas de vezes por janela;
--    espaco livre na pagina permite HOT update e evita bloat de indice.
-- ---------------------------------------------------------------------------
create unlogged table if not exists private.rate_limits (
  bucket       text        not null,
  subject      text        not null,
  window_start timestamptz not null,
  hits         integer     not null,
  primary key (bucket, subject, window_start)
);

alter table private.rate_limits set (
  fillfactor                      = 70,
  autovacuum_vacuum_scale_factor  = 0.0,
  autovacuum_vacuum_threshold     = 200,
  autovacuum_analyze_scale_factor = 0.0,
  autovacuum_analyze_threshold    = 1000
);

-- Cinto-e-suspensorio: a tabela ja nao e alcancavel pela Data API e o owner
-- (postgres) ignora RLS de qualquer forma. Custa nada e fecha o caso de alguem
-- expor o schema `private` por engano no futuro.
alter table private.rate_limits enable row level security;
revoke all on private.rate_limits from public, anon, authenticated;

-- Indice da varredura global (secao B). Ordenado por window_start, que e
-- justamente o predicado dela -- e disjunto do acesso por PK da secao A.
create index if not exists rate_limits_sweep_idx
  on private.rate_limits (window_start);

-- ---------------------------------------------------------------------------
-- 3. Emissor do 429 do PostgREST
--    O header Retry-After serve para proxies/curl, mas NAO e legivel pelo
--    supabase-js sem Access-Control-Expose-Headers -- por isso os segundos vao
--    TAMBEM no corpo, no campo `hint`, que o cliente le como error.hint.
-- ---------------------------------------------------------------------------
create or replace function private.raise_rate_limited(
  p_retry_after integer,
  p_message     text default 'Muitas tentativas. Tente novamente em instantes.'
)
returns void
language plpgsql
set search_path to ''
as $$
begin
  raise sqlstate 'PGRST' using
    message = json_build_object(
                'code',    'rate_limited',
                'message', p_message,
                'hint',    'retry_after_seconds=' || p_retry_after::text
              )::text,
    detail  = json_build_object(
                'status',      429,
                'status_text', 'Too Many Requests',
                'headers',     json_build_object('Retry-After', p_retry_after::text)
              )::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Resolucao do IP do request
--    x-forwarded-for e "cliente, proxy1, proxy2, ..." e o proxy ACRESCENTA AO
--    FIM. O primeiro elemento e escrito pelo proprio cliente, entao usar o
--    primeiro hop (como no exemplo generico da doc do Supabase) deixa o
--    atacante rotacionar o header e anular o limite por completo. Ordem usada:
--      1) cf-connecting-ip  -- a borda SOBRESCREVE, nao e spoofavel
--      2) ultimo elemento do x-forwarded-for -- o unico escrito pela infra
--      3) null -> chave 'unknown' (bucket compartilhado; conservador)
--    Nada disso e confiavel o bastante sozinho: por isso existe tambem o bucket
--    global de backstop em validate_invite_code.
-- ---------------------------------------------------------------------------
create or replace function private.request_ip()
returns inet
language plpgsql
stable
set search_path to ''
as $$
declare
  v_headers json;
  v_raw     text;
  v_parts   text[];
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;

  if v_headers is null then
    return null;   -- chamada fora do PostgREST (SQL editor, MCP, trigger)
  end if;

  v_raw := nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip', '')), '');

  if v_raw is null then
    v_raw := nullif(btrim(coalesce(v_headers ->> 'x-forwarded-for', '')), '');
    if v_raw is not null then
      v_parts := string_to_array(v_raw, ',');
      v_raw   := btrim(v_parts[array_length(v_parts, 1)]);
    end if;
  end if;

  if v_raw is null or v_raw = '' then
    return null;
  end if;

  begin
    return v_raw::inet;
  exception when others then
    return null;   -- header malformado nao pode derrubar o request
  end;
end;
$$;

-- Chave do bucket. IPv6 normalizado para /64: um atacante com um /64 tem
-- 18 quintilhoes de enderecos, entao limitar por IPv6 exato nao limita nada.
create or replace function private.ip_bucket_key(p_ip inet)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_ip is null     then 'unknown'
    when family(p_ip) = 6 then 'ip6:' || host(network(set_masklen(p_ip, 64)))
    else                       'ip4:' || host(p_ip)
  end;
$$;

-- Rotulo para audit_log: propositalmente mais grosso que a chave, para nao
-- persistir o IP exato de quem errou o codigo de convite.
create or replace function private.ip_log_label(p_ip inet)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when p_ip is null     then 'unknown'
    when family(p_ip) = 6 then host(network(set_masklen(p_ip, 48))) || '/48'
    else                       host(network(set_masklen(p_ip, 24))) || '/24'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Nucleo: incrementa a janela e decide
--    Retorna just_tripped=true em EXATAMENTE um request por (bucket, subject,
--    janela) -- aquele em que hits atinge o limite. E o gancho de auditoria.
-- ---------------------------------------------------------------------------
create or replace function private.rate_limit_touch(
  p_bucket         text,
  p_subject        text,
  p_limit          integer,
  p_window_seconds integer
)
returns table (allowed boolean, hits_now integer, retry_after integer, just_tripped boolean)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_window timestamptz;
  v_hits   integer;
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'rate_limit_touch: p_limit invalido' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'rate_limit_touch: p_window_seconds invalido' using errcode = '22023';
  end if;

  -- Janela fixa alinhada ao epoch: todos os callers concorrentes derivam
  -- exatamente o mesmo window_start sem precisar coordenar.
  v_window := to_timestamp(
    (floor(extract(epoch from v_now))::bigint / p_window_seconds) * p_window_seconds
  );

  retry_after  := greatest(1, ceil(extract(epoch from
                    (v_window + make_interval(secs => p_window_seconds)) - v_now))::integer);
  just_tripped := false;

  -- FAST PATH (corolario 1 do cabecalho): le o valor ja commitado. Se a janela
  -- ja estourou, decide sem escrever nada -- sem lock na tupla quente e sem
  -- tupla morta, porque o INSERT seria revertido pelo raise do caller.
  select rl.hits into v_hits
  from private.rate_limits rl
  where rl.bucket = p_bucket
    and rl.subject = p_subject
    and rl.window_start = v_window;

  if v_hits is not null and v_hits >= p_limit then
    allowed  := false;
    hits_now := v_hits;
    return next;
    return;
  end if;

  -- Incremento atomico de UMA linha por statement => sem risco de deadlock.
  -- O RETURNING traz o valor real pos-incremento, o que corrige a corrida do
  -- fast path (N transacoes concorrentes lendo p_limit-1 ao mesmo tempo).
  insert into private.rate_limits as rl (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject, window_start)
  do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  hits_now     := v_hits;
  allowed      := (v_hits <= p_limit);
  just_tripped := (v_hits = p_limit);

  -- Limpeza A (sempre): janelas antigas DESTE subject, via PK.
  -- Limitada a < 1h de proposito, para ser DISJUNTA da varredura B. As duas
  -- percorrem as linhas em ordens diferentes (PK vs window_start); se os
  -- conjuntos se cruzassem, dois callers concorrentes dariam deadlock.
  delete from private.rate_limits d
  where d.bucket = p_bucket
    and d.subject = p_subject
    and d.window_start < v_window
    and d.window_start >= v_now - interval '1 hour';

  -- Limpeza B (~1% das chamadas): varredura global do que a limpeza A nunca
  -- alcanca (subject que nunca mais voltou). Limitada e nao-bloqueante, senao
  -- 1% dos requests pagaria um DELETE ilimitado e ainda esperaria lock.
  if random() < 0.01 then
    delete from private.rate_limits d
    where d.ctid in (
      select rl2.ctid
      from private.rate_limits rl2
      where rl2.window_start < v_now - interval '1 hour'
      order by rl2.window_start
      limit 500
      for update skip locked
    );
  end if;

  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. validate_invite_code -- chamada por anon no signup (src/pages/AuthPage.tsx)
--
--    Ordem deliberada:
--      1) codigo VALIDO retorna imediatamente, SEM passar pelo rate limit. O
--         usuario legitimo nunca e bloqueado, nem durante um ataque em curso,
--         e o caminho de sucesso do signup nao depende do contador.
--      2) codigo invalido -> bucket por IP (10 falhas / 10 min).
--      3) bucket global de backstop (120 falhas / 60 s em toda a plataforma),
--         a unica defesa contra enumeracao distribuida com IP rotativo ou XFF
--         forjado. Vem DEPOIS do bucket por IP de proposito: quem ja foi
--         barrado por IP nao chega a contaminar o contador compartilhado.
--
--    O corpo do SELECT abaixo e copia VERBATIM da versao em producao
--    (pg_get_functiondef em 2026-08-12) -- inclusive `expires_at > now()` sem
--    tratamento de NULL. Nao "corrija" isso aqui: mudaria em silencio quais
--    convites sao aceitos.
-- ---------------------------------------------------------------------------
create or replace function public.validate_invite_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row     public.invite_codes%rowtype;
  v_ip      inet;
  v_subject text;
  v_rl      record;
begin
  select * into v_row
  from public.invite_codes
  where code = trim(p_code)
    and used_at is null
    and expires_at > now();

  if v_row.id is not null then
    return jsonb_build_object('valid', true);
  end if;

  -- Daqui para baixo: tentativa invalida.
  v_ip      := private.request_ip();
  v_subject := private.ip_bucket_key(v_ip);

  select * into v_rl
  from private.rate_limit_touch('invite_validate:ip', v_subject, 10, 600);

  if v_rl.just_tripped then
    begin
      insert into public.audit_log
        (actor_id, actor_label, action, target_type, target_id, details, success, error_message)
      values
        (null, 'anon', 'rate_limit_tripped', 'invite_code', null,
         jsonb_build_object(
           'bucket',         'invite_validate:ip',
           'ip',             private.ip_log_label(v_ip),
           'ip_resolved',    v_ip is not null,
           'limit',          10,
           'window_seconds', 600
         ),
         false, 'forca bruta de codigo de convite suspeita');
    exception when others then
      null;   -- auditoria nunca derruba o fluxo
    end;
  end if;

  if not v_rl.allowed then
    perform private.raise_rate_limited(v_rl.retry_after);
  end if;

  select * into v_rl
  from private.rate_limit_touch('invite_validate:global', 'all', 120, 60);

  if v_rl.just_tripped then
    begin
      insert into public.audit_log
        (actor_id, actor_label, action, target_type, target_id, details, success, error_message)
      values
        (null, 'anon', 'rate_limit_tripped', 'invite_code', null,
         jsonb_build_object(
           'bucket',         'invite_validate:global',
           'limit',          120,
           'window_seconds', 60
         ),
         false, 'volume global de convites invalidos acima do normal');
    exception when others then
      null;
    end;
  end if;

  if not v_rl.allowed then
    perform private.raise_rate_limited(v_rl.retry_after);
  end if;

  return jsonb_build_object('valid', false, 'error', 'invite_invalid');
end;
$$;

-- Continua acessivel a anon: e usada no signup, antes do login
-- (ver comentario em 20260708110000_sec_rpc_grants.sql:51).
grant execute on function public.validate_invite_code(text) to anon, authenticated, service_role;
revoke execute on function public.validate_invite_code(text) from public;

-- ---------------------------------------------------------------------------
-- 7. search_users_for_share -- chave = auth.uid(), 40 chamadas / 60 s.
--
--    Conta TODAS as chamadas, inclusive termos com menos de 3 chars (que hoje
--    saem de graca). O numero pressupoe debounce no cliente: os 4 call sites em
--    src/ passam a ter 300 ms (dois ja tinham).
--
--    As colunas do RETURNS TABLE sao IDENTICAS as atuais de proposito -- mudar
--    qualquer uma exigiria DROP + CREATE, e a funcao renasceria com EXECUTE
--    para PUBLIC (ver 20260727160000_profile_avatars.sql:53-54). Os grants sao
--    reafirmados no fim de qualquer forma.
-- ---------------------------------------------------------------------------
create or replace function public.search_users_for_share(p_term text)
returns table(id uuid, display_name text, email text, avatar_emoji text, avatar_color text, avatar_url text)
language plpgsql
security definer
set search_path to ''
as $$
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

  -- Escape de \ % _ para ilike (20260810210000_sec_profile_search_ilike_escape).
  -- A ordem importa: as barras existentes tem que ser escapadas primeiro.
  v_term := replace(replace(replace(trim(p_term), '\', '\\'), '%', '\%'), '_', '\_');

  return query
    select p.id, p.display_name, p.email, p.avatar_emoji, p.avatar_color, p.avatar_url
    from public.profiles p
    where p.id <> v_uid
      and (p.email ilike '%' || v_term || '%' escape '\'
           or p.display_name ilike '%' || v_term || '%' escape '\')
    order by p.display_name nulls last
    limit 6;
end;
$$;

grant execute on function public.search_users_for_share(text) to authenticated, service_role;
revoke execute on function public.search_users_for_share(text) from anon, public;

-- ---------------------------------------------------------------------------
-- 8. Wrapper para as edge functions (ai-chat, analyze-transaction-photo)
--
--    NAO da raise de proposito (corolario 3 do cabecalho): retorna jsonb e a
--    edge function monta o 429 em TypeScript. Se esta funcao desse raise, o
--    proprio incremento seria revertido e o contador ficaria travado.
--
--    Prefixo 'ext:' na chave para que service_role nao consiga, nem por
--    engano, mexer nos contadores de convite/busca definidos acima.
-- ---------------------------------------------------------------------------
create or replace function public.check_rate_limit(
  p_bucket         text,
  p_subject        text,
  p_limit          integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rl record;
begin
  if p_bucket is null or btrim(p_bucket) = ''
     or p_subject is null or btrim(p_subject) = '' then
    raise exception 'check_rate_limit: p_bucket e p_subject sao obrigatorios'
      using errcode = '22023';
  end if;

  p_limit          := least(greatest(coalesce(p_limit, 1), 1), 1000000);
  p_window_seconds := least(greatest(coalesce(p_window_seconds, 60), 1), 86400);

  select * into v_rl
  from private.rate_limit_touch('ext:' || btrim(p_bucket), btrim(p_subject),
                                p_limit, p_window_seconds);

  return jsonb_build_object(
    'allowed',     v_rl.allowed,
    'hits',        v_rl.hits_now,
    'limit',       p_limit,
    'retry_after', v_rl.retry_after,
    'tripped',     v_rl.just_tripped
  );
end;
$$;

revoke execute on function public.check_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. Cinto-e-suspensorio nos grants de `private`.
--    anon/authenticated nao tem USAGE no schema, mas o `alter default
--    privileges` de 20260708110000_sec_rpc_grants.sql comprovadamente NAO pega
--    em objetos criados via MCP (ver migrations/README.md, linhas 39-45), entao
--    todo objeto novo precisa do revoke escrito a mao.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
