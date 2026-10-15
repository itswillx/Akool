-- Remoção da API v1 e da fila de cards do banco (PR A2). Decisão do usuário
-- em 14/10/2026: o programa API v1 foi cancelado e só volta quando o sistema
-- tiver maturidade funcional completa. O código saiu no PR anterior (A1): a
-- tela Configurações → API, a edge cards-api, o esqueleto _api/, a CLI de
-- cards, a fila de cards do app e o conversor Markdown. Aqui sai o que ficou
-- no banco.
--
-- Por quê: sem a tela, a function e a fila do app, nada mais chama estes
-- objetos. Mantê-los seria superfície sem dono: 11 funções SECURITY DEFINER
-- com EXECUTE para authenticated (5 de token e 6 da fila), uma tabela de
-- credenciais (hashes de token) e a fila na publicação realtime.
--
-- Antes (catálogo do staging, 15/10/2026):
--   * public.api_tokens: 11 colunas, policy api_tokens_select_own, grant de
--     SELECT por coluna para authenticated, CHECK api_tokens_scopes_shape
--     (chama private.api_scopes_shape_ok). private.api_scope_catalog: 27
--     linhas, RLS ligado e sem policies;
--   * 7 RPCs de token em public (create, update_scopes, revoke, revoke_all e
--     delete para authenticated; resolve e resolve_v2 só service_role) e 7
--     funções private.api_*;
--   * public.project_card_queue: policy project_card_queue_select, 5 índices,
--     na publicação supabase_realtime. O gatilho project_cards_queue_flow em
--     public.project_cards (AFTER UPDATE OF checklist, column_id) chama
--     private.cq_on_card_change; sem item na fila, ele já não fazia nada;
--   * 17 public.cq_* (6 com EXECUTE para authenticated, que o app usava até o
--     A1, e 11 só service_role, da cards-api) e 24 private.cq_*;
--   * 40 funções SECURITY DEFINER de public executáveis por authenticated.
--
-- Depois:
--   * nenhum desses objetos existe. Cada drop tem a assinatura exata
--     (conferida com pg_get_function_identity_arguments no staging) e nenhum
--     usa CASCADE: uma dependência que ninguém viu aborta a migration em vez
--     de levar junto outro objeto;
--   * 29 DEFINER para authenticated (11 helpers de RLS + 18 RPCs do app);
--   * a publicação supabase_realtime fica com as 7 tabelas do app (o DROP
--     TABLE tira a fila dela);
--   * o DO do fim confere que não sobrou função, tabela nem gatilho cq_* ou
--     api_* em public e private, fora private.cq_board_role, e que ela e o
--     gatilho de integridade de cards continuam lá.
--
-- O que FICA, e por quê:
--   * private.cq_board_role(uuid, uuid): o gatilho de integridade de cards do
--     API-013 (private.project_card_integrity, "o responsável tem acesso ao
--     quadro") a chama. Fica com o nome antigo para não redefinir o gatilho;
--     a menção a cq_on_card_change no corpo dele é só comentário;
--   * public.check_rate_limit e o núcleo de rate limit (private.rate_limits,
--     private.rate_limit_touch, private.raise_rate_limited): primitiva de
--     segurança genérica, usada também por convites, busca de usuários,
--     empréstimos e notificações;
--   * as linhas antigas de public.audit_log (action 'api_token_admin_scopes'):
--     histórico de auditoria não se apaga;
--   * o que é funcional nas migrations api003 a api028 (gatilhos de cards, de
--     Finanças, de Estudos e da Loja; a regra do hint 'akool');
--   * os papéis akool_api e akool_api_login: não existem no staging, e esta
--     migration não mexe em papel. Se o bloco 0 do harness os achar na
--     produção, a decisão é à parte.
--
-- Riscos:
--   * dado perdido sem volta: os tokens (quem tinha um perde o acesso, que é o
--     objetivo) e os itens da fila. O backup nunca guardou as duas tabelas
--     (EXCLUDED_TABLES), então o restore não os traz de volta;
--   * ordem: api_tokens cai antes de private.api_scopes_shape_ok (a CHECK
--     depende dela) e o gatilho antes de private.cq_on_card_change. O corpo
--     plpgsql não entra no pg_depend, então o resto da ordem (quem chama antes
--     de quem é chamado, funções antes das tabelas) não é cobrado pelo banco:
--     a lista de chamadores foi conferida pelo prosrc no staging, e só o
--     project_card_integrity chama um cq_* (o cq_board_role, que fica);
--   * site-backup: o assertNoTableDrift falha enquanto EXCLUDED_TABLES listar
--     tabela que não existe (e a versão nova, sem as duas, falha se subir
--     antes do apply). A function tem de ser republicada logo depois;
--   * uma aba aberta com o bundle de antes do A1 recebe erro ao chamar as RPCs
--     e perde o canal realtime da fila; recarregar resolve;
--   * locks: o DROP TRIGGER pega AccessExclusiveLock em public.project_cards,
--     e os DROP TABLE, pelas FKs, em public.project_boards, public.project_cards
--     e auth.users. Todos ficam até o commit (centenas de ms). Enquanto um DROP
--     espera um lock, todo SELECT nessas tabelas espera atrás dele, inclusive o
--     login e o refresh de token do GoTrue (supabase_auth_admin não tem
--     statement_timeout). Por isso a seção 0 limita a espera a 5 s: sem o lock,
--     o apply aborta inteiro (é uma transação só) e é só repetir. Aplicar com
--     pouco tráfego e longe das 06:00 UTC (o site-backup-auto lê as tabelas).
--     O ensaio do bloco 1 na produção segura os mesmos locks pelo DO inteiro.
--
-- Levantamento de produção pendente: o bloco 0 de supabase/checks/remove-api.sql
-- (só SELECT, sem id nem valor: tokens no total, ativos, donos e último uso; a
-- fila por status e origem; as linhas de auditoria de token; os papéis
-- akool_api*; assinaturas realtime na fila; as DEFINER para authenticated; e
-- tudo o que abortaria o apply: as 54 assinaturas, o catálogo de escopos e o
-- gatilho da fila presentes, o gatilho de integridade ligado, nenhuma relação ou
-- gatilho cq_*/api_*/queue fora da lista e nenhum dependente de fora) roda na
-- produção antes do apply, com o OK do usuário. O resultado entra aqui.
--
-- Ordem: só depois do PR A1 publicado (o app antigo chamaria funções
-- apagadas) e da cards-api apagada na produção; e com o site-backup
-- republicado logo em seguida (sem api_tokens e project_card_queue em
-- EXCLUDED_TABLES).
--
-- Prova: supabase/checks/remove-api.sql (bloco 1), mais os harnesses api006,
-- api013, api024, api028 e sec012 ajustados.

-- ---------------------------------------------------------------------------
-- 0. Espera de lock limitada (ver "locks" em Riscos). O SET LOCAL vale até o
--    fim da transação da migration; o DO confere que pegou (fora de uma
--    transação ele não teria efeito, e os drops não seriam atômicos).
-- ---------------------------------------------------------------------------
set local lock_timeout = '5s';

do $lock$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception 'remove_api_and_queue: o lock_timeout não pegou (%); a migration tem de rodar numa transação só',
      current_setting('lock_timeout');
  end if;
end
$lock$;

-- ---------------------------------------------------------------------------
-- 1. Fila: o gatilho em project_cards
-- ---------------------------------------------------------------------------
drop trigger project_cards_queue_flow on public.project_cards;

-- ---------------------------------------------------------------------------
-- 2. Fila: as 17 RPCs public.cq_*
-- ---------------------------------------------------------------------------
-- As 6 que o app chamava até o A1 (EXECUTE para authenticated).
drop function public.cq_list(uuid, text[], uuid);
drop function public.cq_enqueue(uuid, text[], text[], text[], text[], uuid);
drop function public.cq_move(uuid, integer, uuid);
drop function public.cq_remove(uuid, uuid);
drop function public.cq_reprioritize(uuid, uuid);
drop function public.cq_validate(uuid, text, boolean, text, uuid);
-- As 11 da cards-api (só service_role).
drop function public.cq_block(uuid, text, text, text[], text[], uuid);
drop function public.cq_boards(uuid);
drop function public.cq_card(uuid, text, uuid);
drop function public.cq_cards(uuid, text[], text[], text[], boolean, uuid);
drop function public.cq_check(uuid, text, text[], boolean, uuid);
drop function public.cq_complete(uuid, text, text, uuid);
drop function public.cq_next(uuid, uuid);
drop function public.cq_note(uuid, text, text, text, uuid);
drop function public.cq_release(uuid, text, text, uuid);
drop function public.cq_setup_flow(uuid, uuid);
drop function public.cq_start(uuid, integer, uuid);

-- ---------------------------------------------------------------------------
-- 3. Fila: os helpers private.cq_* (23; private.cq_board_role FICA)
-- ---------------------------------------------------------------------------
drop function private.cq_on_card_change();
drop function private.cq_insert_queued(uuid, uuid[], uuid, boolean);
drop function private.cq_renumber(uuid, integer);
drop function private.cq_card_json(uuid);
drop function private.cq_labels_match(jsonb, text[]);
drop function private.cq_resolve_columns(uuid, text[]);
drop function private.cq_priorities(text[]);
drop function private.cq_resolve_card(uuid, text);
drop function private.cq_move_card(uuid, uuid);
drop function private.cq_phase_column(uuid, text);
drop function private.cq_status_column(uuid, text);
drop function private.cq_flow_enabled(uuid);
drop function private.cq_stage_kind(text);
drop function private.cq_stage_names(text);
drop function private.cq_sync_todo_order(uuid);
drop function private.cq_stamp(text, text);
drop function private.cq_effort_rank(jsonb);
drop function private.cq_priority_rank(text);
drop function private.cq_require(uuid, uuid, text);
drop function private.cq_actor(uuid);
drop function private.cq_source();
drop function private.cq_norm(text);
drop function private.cq_is_uuid(text);

-- ---------------------------------------------------------------------------
-- 4. Fila: a tabela (policies, índices e a publicação realtime vão junto)
-- ---------------------------------------------------------------------------
drop table public.project_card_queue;

-- ---------------------------------------------------------------------------
-- 5. Tokens: as 7 RPCs
-- ---------------------------------------------------------------------------
drop function public.create_api_token(text, integer, jsonb);
drop function public.update_api_token_scopes(uuid, jsonb);
drop function public.revoke_api_token(uuid);
drop function public.revoke_all_my_api_tokens();
drop function public.delete_api_token(uuid);
drop function public.resolve_api_token(text);
drop function public.resolve_api_token_v2(text, text);

-- ---------------------------------------------------------------------------
-- 6. Tokens: a tabela, antes de private.api_scopes_shape_ok (a CHECK
--    api_tokens_scopes_shape depende dela)
-- ---------------------------------------------------------------------------
drop table public.api_tokens;

-- ---------------------------------------------------------------------------
-- 7. Escopos: as 7 private.api_* e o catálogo
-- ---------------------------------------------------------------------------
drop function private.api_token_audit_admin(uuid, uuid, text, text, jsonb, jsonb);
drop function private.api_token_policy(uuid, jsonb, timestamp with time zone);
drop function private.api_token_app_user();
drop function private.api_validate_scopes(jsonb, boolean);
drop function private.api_scopes_shape_ok(jsonb);
drop function private.api_legacy_scopes();
drop function private.api_level_rank(text);

drop table private.api_scope_catalog;

-- ---------------------------------------------------------------------------
-- 8. Conferência: nada cq_* ou api_* sobra em public e private, fora
--    private.cq_board_role; ela e o gatilho de integridade de cards ficam.
-- ---------------------------------------------------------------------------
do $conferencia$
declare
  v_sobra text;
begin
  select string_agg(format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)), ', ' order by n.nspname, p.proname)
    into v_sobra
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.proname like 'cq\_%' or p.proname like 'api\_%' or p.proname like '%api\_token%')
     and p.oid is distinct from to_regprocedure('private.cq_board_role(uuid, uuid)');
  if v_sobra is not null then
    raise exception 'remove_api_and_queue: sobraram funções: %', v_sobra;
  end if;

  select string_agg(format('%s.%s', n.nspname, c.relname), ', ' order by n.nspname, c.relname)
    into v_sobra
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
     and (c.relname like 'cq\_%' or c.relname like 'api\_%' or c.relname like 'project\_card\_queue%');
  if v_sobra is not null then
    raise exception 'remove_api_and_queue: sobraram tabelas ou índices: %', v_sobra;
  end if;

  select string_agg(format('%s.%s', t.tgrelid::regclass::text, t.tgname), ', ' order by t.tgname)
    into v_sobra
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and (t.tgname like '%queue%' or t.tgname like 'cq\_%' or t.tgname like 'api\_%'
          or p.proname like 'cq\_%' or p.proname like 'api\_%');
  if v_sobra is not null then
    raise exception 'remove_api_and_queue: sobraram gatilhos: %', v_sobra;
  end if;

  if to_regprocedure('private.cq_board_role(uuid, uuid)') is null then
    raise exception 'remove_api_and_queue: private.cq_board_role sumiu (o gatilho de integridade de cards a usa)';
  end if;
  if to_regprocedure('private.project_card_integrity()') is null
     or not exists (select 1 from pg_trigger
                     where tgrelid = 'public.project_cards'::regclass and tgname = 'project_cards_integrity'
                       and not tgisinternal and tgenabled <> 'D') then
    raise exception 'remove_api_and_queue: o gatilho de integridade de cards (project_cards_integrity) sumiu';
  end if;
end
$conferencia$;
