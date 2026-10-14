-- API-024: RPCs de Estudos por item, importação atômica e reagendamento no
-- servidor. A tela continua igual (decisão do usuário, 09/10: o API-029 troca
-- o hook pelas RPCs); a API v1 (API-034) e o app ganham um caminho que não
-- regrava a lista inteira.
--
-- Antes (reproduzido no hook e no staging, 09/10/2026):
--   * a tela regrava checkpoints, resources e quiz inteiros a partir do estado
--     local: o ponto que outra aba somou some quando esta aba marca outro;
--   * a trava do quiz (respondeu, só reiniciando) existe só no navegador: o
--     banco aceita trocar "errado" por "certo" num UPDATE direto;
--   * importar são dois INSERTs soltos: um card fora da forma deixa o tópico
--     vazio, e a mensagem ("Recursos fora do formato: item 0") não diz qual
--     card falhou;
--   * reagendar são N UPDATEs em paralelo, com rollback parcial no cliente, e
--     a posição do card novo é max + 1 calculado no aparelho (duas abas
--     repetem o sort_order).
--
-- Depois (11 funções SECURITY INVOKER em public, search_path vazio):
--   * por item: study_checkpoint_add/edit/toggle/remove, study_resource_add/
--     remove, study_quiz_answer e study_quiz_reset. Cada uma trava o card (FOR
--     NO KEY UPDATE), acha o item pelo id na linha travada e grava só aquele
--     índice; devolve a linha inteira, para o app adotar a coluna e o
--     updated_at. Repetição sem efeito não grava (a versão não muda);
--   * a forma continua com o gatilho DEFINER study_cards_rules (API-021): o
--     corpo daqui só faz o que ele não faz (texto em branco, id ausente,
--     normalização). A regex de URL e os tetos ficam só no gatilho;
--   * study_quiz_answer recusa a segunda resposta diferente (P0001). A trava
--     fica só na RPC, sem gatilho (decisão do usuário): o UPDATE direto da
--     tela de hoje continua como está até o API-029;
--   * study_cards_append: de 1 a 100 cards e até 4 MiB por chamada, posição a
--     partir de max + 1 dos cards do dono no tópico, tudo ou nada. O erro sai
--     como "cards/N: <mensagem>", com N a partir de 0 (o JSON Pointer da API),
--     e o mesmo SQLSTATE;
--   * study_import_topic: tópico, cards e reagendamento (quando há meta) numa
--     transação só: card com erro não deixa tópico vazio;
--   * study_reschedule: as datas do distributeDueDates do app, em aritmética
--     inteira, a partir do hoje de São Paulo ou do dia do aparelho, que tem de
--     estar a até 1 dia dele (fora disso, 22023; o API-016 limitava em
--     silêncio, aqui quem chama fica sabendo).
--
-- Erros: 42501 "not authenticated" sem usuário; P0002 (hint akool) para card,
-- tópico ou item inexistente, e o card ou tópico de outra pessoa dá a mesma
-- mensagem do inexistente; 22023 (hint akool) para entrada inválida; 23505
-- para id repetido com outro conteúdo; P0001 para pergunta já respondida e
-- tópico sem data-alvo; 23514 do gatilho do API-021 para a forma.
--
-- Texto aparado como o String.prototype.trim da tela: c_ws, em cada função
-- que apara, lista os 25 caracteres que o trim do JS tira. O btrim sem lista
-- só tira o espaço, e o [[:space:]] do regex depende da collation (no staging,
-- ICU, ele pega o U+3000 e não pega o U+FEFF). src/lib/studyLimits.test.ts
-- confere a lista contra o JS.
--
-- Grants: EXECUTE só para authenticated. O app chama no API-029; o akool_api
-- herda pela §1.2 de docs/api-arquitetura.md (grant authenticated to akool_api
-- with inherit true), e no plano B a transação da API já roda como
-- authenticated. O papel ainda não existe (API-004), e um grant direto
-- falharia; o harness tem o caso condicional.
--
-- Levantamento: o bloco 1 de supabase/checks/api024-study-rpcs.sql abre com as
-- contagens (staging, 11/10/2026: 0 tópicos e 0 cards; na produção, a medir no
-- ensaio). A produção de 07/10 (API-021) tinha 7 tópicos e 62 cards, nenhum
-- item fora da forma e no máximo 12 pontos, 5 recursos e 15 perguntas por card.
--
-- Riscos registrados:
--   * Ordem: RPC INVOKER não chama private (authenticated não tem USAGE), e a
--     forma depende do gatilho do API-021. Aplicar só depois da
--     20261008130000 (012 → 013 → 016 → 021 → 024).
--   * Dado antigo fora da forma na mesma coluna: o gatilho confere a coluna
--     inteira que mudou, então a RPC de um item falha apontando outro (o
--     levantamento conta 0).
--   * As RESTRICTIVE do API-022 valem dentro das RPCs. append, import e
--     reschedule leem e travam study_topics (o FOR NO KEY UPDATE exige ler e
--     atualizar tópicos); toggle, answer e reset só tocam study_cards. Prova:
--     bloco 2 do harness.
--   * Remover item é UPDATE: a regra "DELETE exige Excluir" (§2.2) e a lixeira
--     do API-025 não alcançam. O API-022/034 decide a regra.
--   * Progresso na criação: append e import guardam o completed de "- [x]"
--     (como o parser), e o userAnswer sai sempre null. O API-022/034 decide se
--     importar com ponto marcado exige estudos.progresso.
--   * Mudar uma assinatura depois exige DROP e CREATE e recarga do cache do
--     PostgREST.
--   * sort_order repetido (antigo): o reagendamento desempata por
--     (sort_order, created_at, id), e a tela usava a ordem do array.

-- ---------------------------------------------------------------------------
-- 1. Pontos de estudo
-- ---------------------------------------------------------------------------

-- Ponto novo no fim, sem progresso. Sem p_id, o servidor gera. id que já existe
-- com o mesmo texto (aparado) devolve o card sem gravar; com outro texto, 23505.
create function public.study_checkpoint_add(p_card uuid, p_text text, p_id text default null)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_ws   constant text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
  v_uid  uuid := auth.uid();
  v_text text := btrim(p_text, c_ws);
  v_id   text := coalesce(p_id, gen_random_uuid()::text);
  v_card public.study_cards;
  v_old  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(v_text, '') = '' then
    raise exception 'Informe o texto do ponto de estudo' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select t.e into v_old from jsonb_array_elements(v_card.checkpoints) as t(e) where t.e ->> 'id' = v_id limit 1;
  if found then
    if v_old ->> 'text' = v_text then
      return v_card;
    end if;
    raise exception 'Já existe um ponto de estudo com este id' using errcode = '23505', hint = 'akool';
  end if;

  update public.study_cards c
     set checkpoints = c.checkpoints || jsonb_build_array(jsonb_build_object('id', v_id, 'text', v_text, 'completed', false))
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_checkpoint_add(uuid, text, text) from public, anon;
grant execute on function public.study_checkpoint_add(uuid, text, text) to authenticated;
comment on function public.study_checkpoint_add(uuid, text, text) is
  'API-024: põe um ponto de estudo no fim do card, sem progresso; devolve o card. Texto aparado como na tela (vazio: 22023). Sem p_id, o servidor gera; id existente com o mesmo texto não grava, com outro texto dá 23505. Card de outra pessoa: P0002. Tetos e forma: gatilho study_cards_rules (23514).';

-- Muda o texto e/ou a nota de um ponto, sem mexer no progresso. Nulo mantém;
-- nota em branco tira a chave; texto em branco é recusado (remover é outra RPC).
create function public.study_checkpoint_edit(p_card uuid, p_checkpoint text, p_text text default null, p_note text default null)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_ws   constant text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
  v_uid  uuid := auth.uid();
  v_text text := btrim(p_text, c_ws);
  v_note text := btrim(p_note, c_ws);
  v_card public.study_cards;
  v_idx  integer;
  v_item jsonb;
  v_new  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_checkpoint is null then
    raise exception 'Informe o id do ponto de estudo' using errcode = '22023', hint = 'akool';
  end if;
  if p_text is null and p_note is null then
    raise exception 'Informe o texto ou a nota do ponto de estudo' using errcode = '22023', hint = 'akool';
  end if;
  if v_text = '' then
    raise exception 'O texto do ponto de estudo não pode ficar vazio (para remover, use study_checkpoint_remove)'
      using errcode = '22023', hint = 'akool';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select (t.n - 1)::integer, t.e into v_idx, v_item
    from jsonb_array_elements(v_card.checkpoints) with ordinality as t(e, n)
   where t.e ->> 'id' = p_checkpoint
   limit 1;
  if not found then
    raise exception 'Ponto de estudo não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  v_new := v_item;
  if v_text is not null then
    v_new := v_new || jsonb_build_object('text', v_text);
  end if;
  if v_note is not null then
    v_new := case when v_note = '' then v_new - 'note' else v_new || jsonb_build_object('note', v_note) end;
  end if;
  if v_new = v_item then
    return v_card;
  end if;

  update public.study_cards c set checkpoints = jsonb_set(c.checkpoints, array[v_idx::text], v_new)
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_checkpoint_edit(uuid, text, text, text) from public, anon;
grant execute on function public.study_checkpoint_edit(uuid, text, text, text) to authenticated;
comment on function public.study_checkpoint_edit(uuid, text, text, text) is
  'API-024: muda o texto e/ou a nota de um ponto, sem mexer no completed; devolve o card. Nulo mantém, nota em branco tira a chave, texto em branco dá 22023 (remover é study_checkpoint_remove). Os dois nulos ou id nulo: 22023. Ponto ou card inexistente: P0002. Sem mudança, não grava.';

-- Marca ou desmarca um ponto. p_completed nulo inverte; com valor, é idempotente
-- (o API-029 e a API mandam o valor).
create function public.study_checkpoint_toggle(p_card uuid, p_checkpoint text, p_completed boolean default null)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_card public.study_cards;
  v_idx  integer;
  v_item jsonb;
  v_done boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_checkpoint is null then
    raise exception 'Informe o id do ponto de estudo' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select (t.n - 1)::integer, t.e into v_idx, v_item
    from jsonb_array_elements(v_card.checkpoints) with ordinality as t(e, n)
   where t.e ->> 'id' = p_checkpoint
   limit 1;
  if not found then
    raise exception 'Ponto de estudo não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  v_done := coalesce(p_completed, not coalesce(v_item -> 'completed' = 'true'::jsonb, false));
  if v_item -> 'completed' = to_jsonb(v_done) then
    return v_card;
  end if;

  update public.study_cards c set checkpoints = jsonb_set(c.checkpoints, array[v_idx::text, 'completed'], to_jsonb(v_done))
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_checkpoint_toggle(uuid, text, boolean) from public, anon;
grant execute on function public.study_checkpoint_toggle(uuid, text, boolean) to authenticated;
comment on function public.study_checkpoint_toggle(uuid, text, boolean) is
  'API-024 (progresso): marca ou desmarca um ponto; devolve o card. p_completed nulo inverte; com valor é idempotente (o valor que já está não grava). Id nulo: 22023. Ponto ou card inexistente: P0002.';

-- Tira um ponto. Ausente dá P0002 (docs/api-arquitetura.md §4: zero linhas
-- afetadas nunca é sucesso); o API-029 trata como já removido em outra aba.
create function public.study_checkpoint_remove(p_card uuid, p_checkpoint text)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_card public.study_cards;
  v_idx  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_checkpoint is null then
    raise exception 'Informe o id do ponto de estudo' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select (t.n - 1)::integer into v_idx
    from jsonb_array_elements(v_card.checkpoints) with ordinality as t(e, n)
   where t.e ->> 'id' = p_checkpoint
   limit 1;
  if not found then
    raise exception 'Ponto de estudo não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  update public.study_cards c set checkpoints = c.checkpoints - v_idx
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_checkpoint_remove(uuid, text) from public, anon;
grant execute on function public.study_checkpoint_remove(uuid, text) to authenticated;
comment on function public.study_checkpoint_remove(uuid, text) is
  'API-024: tira um ponto de estudo; devolve o card. Ponto ausente dá P0002 (quem chama decide se é sucesso), id nulo dá 22023. É UPDATE, não DELETE: a regra de Excluir do API-022/034 tem de cobrir.';

-- ---------------------------------------------------------------------------
-- 2. Recursos
-- ---------------------------------------------------------------------------

-- Recurso novo no fim. Como o resourceFromInput da tela: URL e título aparados,
-- domínio sem esquema ganha https:// (o mesmo [\w-] ASCII do normalizeUrl) e o
-- título vazio vira a URL sem o esquema (cortado no teto do título, para a
-- recusa de uma URL longa falar da URL). O resto, inclusive javascript: e
-- data:, segue como veio e o gatilho do API-021 recusa (23514).
create function public.study_resource_add(p_card uuid, p_url text, p_title text default null, p_id text default null)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_ws    constant text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
  v_uid   uuid := auth.uid();
  v_url   text := btrim(p_url, c_ws);
  v_title text := btrim(p_title, c_ws);
  v_id    text := coalesce(p_id, gen_random_uuid()::text);
  v_card  public.study_cards;
  v_old   jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(v_url, '') = '' then
    raise exception 'Informe a URL do recurso' using errcode = '22023', hint = 'akool';
  end if;
  if v_url !~* '^https?://' and v_url ~ '^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+' then
    v_url := 'https://' || v_url;
  end if;
  if coalesce(v_title, '') = '' then
    v_title := left(regexp_replace(v_url, '^https?://', '', 'i'), 2048);
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select t.e into v_old from jsonb_array_elements(v_card.resources) as t(e) where t.e ->> 'id' = v_id limit 1;
  if found then
    if v_old ->> 'url' = v_url and v_old ->> 'title' = v_title then
      return v_card;
    end if;
    raise exception 'Já existe um recurso com este id' using errcode = '23505', hint = 'akool';
  end if;

  update public.study_cards c
     set resources = c.resources || jsonb_build_array(jsonb_build_object('id', v_id, 'title', v_title, 'url', v_url))
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_resource_add(uuid, text, text, text) from public, anon;
grant execute on function public.study_resource_add(uuid, text, text, text) to authenticated;
comment on function public.study_resource_add(uuid, text, text, text) is
  'API-024: põe um recurso no fim do card; devolve o card. Como a tela: URL e título aparados, domínio sem esquema ganha https://, título vazio vira a URL sem o esquema. URL vazia: 22023; fora de http(s) ou acima de 2048: 23514 do gatilho. id existente com a mesma URL e título não grava, com outro dá 23505.';

create function public.study_resource_remove(p_card uuid, p_resource text)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_card public.study_cards;
  v_idx  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_resource is null then
    raise exception 'Informe o id do recurso' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select (t.n - 1)::integer into v_idx
    from jsonb_array_elements(v_card.resources) with ordinality as t(e, n)
   where t.e ->> 'id' = p_resource
   limit 1;
  if not found then
    raise exception 'Recurso não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  update public.study_cards c set resources = c.resources - v_idx
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_resource_remove(uuid, text) from public, anon;
grant execute on function public.study_resource_remove(uuid, text) to authenticated;
comment on function public.study_resource_remove(uuid, text) is
  'API-024: tira um recurso; devolve o card. Recurso ausente dá P0002, id nulo dá 22023. É UPDATE, não DELETE: a regra de Excluir do API-022/034 tem de cobrir.';

-- ---------------------------------------------------------------------------
-- 3. Quiz
-- ---------------------------------------------------------------------------

-- Primeira resposta de uma pergunta. Escolha: o índice inteiro de uma
-- alternativa (2.0 vira 2); Certo/Errado (kind ausente ou boolean): "certo" ou
-- "errado". A mesma resposta de novo não grava; outra dá P0001 (a trava da
-- tela, agora no servidor; responder de novo é depois de study_quiz_reset).
-- Pergunta sem a chave userAnswer (legada) conta como não respondida.
create function public.study_quiz_answer(p_card uuid, p_question text, p_answer jsonb)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_card   public.study_cards;
  v_idx    integer;
  v_q      jsonb;
  v_n      integer;
  v_num    numeric;
  v_answer jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_question is null then
    raise exception 'Informe o id da pergunta' using errcode = '22023', hint = 'akool';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select (t.n - 1)::integer, t.e into v_idx, v_q
    from jsonb_array_elements(v_card.quiz) with ordinality as t(e, n)
   where jsonb_typeof(t.e) = 'object' and t.e ->> 'id' = p_question
   limit 1;
  if not found then
    raise exception 'Pergunta não encontrada' using errcode = 'P0002', hint = 'akool';
  end if;

  if coalesce(v_q ->> 'kind', '') = 'choice' then
    v_n := case when jsonb_typeof(v_q -> 'options') = 'array' then jsonb_array_length(v_q -> 'options') else 0 end;
    -- IFs separados: o cast só roda sobre número.
    if jsonb_typeof(p_answer) is distinct from 'number' then
      raise exception 'Resposta inválida: informe o índice (a partir de 0) de uma das % alternativas', v_n
        using errcode = '22023', hint = 'akool';
    end if;
    v_num := (p_answer #>> '{}')::numeric;
    if v_num <> trunc(v_num) or v_num < 0 or v_num >= v_n then
      raise exception 'Resposta inválida: informe o índice (a partir de 0) de uma das % alternativas', v_n
        using errcode = '22023', hint = 'akool';
    end if;
    v_answer := to_jsonb(v_num::integer);
  else
    if p_answer is distinct from '"certo"'::jsonb and p_answer is distinct from '"errado"'::jsonb then
      raise exception 'Resposta inválida: use "certo" ou "errado"' using errcode = '22023', hint = 'akool';
    end if;
    v_answer := p_answer;
  end if;

  if coalesce(v_q -> 'userAnswer', 'null'::jsonb) <> 'null'::jsonb then
    if v_q -> 'userAnswer' = v_answer then
      return v_card;
    end if;
    raise exception 'Pergunta já respondida: reinicie o quiz para responder de novo' using errcode = 'P0001', hint = 'akool';
  end if;

  update public.study_cards c set quiz = jsonb_set(c.quiz, array[v_idx::text, 'userAnswer'], v_answer)
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_quiz_answer(uuid, text, jsonb) from public, anon;
grant execute on function public.study_quiz_answer(uuid, text, jsonb) to authenticated;
comment on function public.study_quiz_answer(uuid, text, jsonb) is
  'API-024 (progresso): primeira resposta de uma pergunta; devolve o card. Escolha: índice inteiro de 0 a n-1; Certo/Errado: "certo" ou "errado"; outro valor: 22023. A mesma resposta de novo não grava; outra dá P0001 (reinicie com study_quiz_reset). Pergunta ou card inexistente: P0002.';

-- Zera as respostas: todas, ou só as erradas (as certas ficam, como o
-- resetWrongQuiz da tela). Sem resposta para zerar, não grava.
create function public.study_quiz_reset(p_card uuid, p_only_wrong boolean default false)
returns public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_card public.study_cards;
  v_new  jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_card from public.study_cards c where c.id = p_card and c.user_id = v_uid for no key update;
  if not found then
    raise exception 'Card não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;

  select coalesce(jsonb_agg(case when jsonb_typeof(t.e) = 'object'
                                  and coalesce(t.e -> 'userAnswer', 'null'::jsonb) <> 'null'::jsonb
                                  and (not coalesce(p_only_wrong, false) or t.e -> 'userAnswer' is distinct from t.e -> 'answer')
                                 then jsonb_set(t.e, '{userAnswer}', 'null'::jsonb)
                                 else t.e end
                            order by t.n), '[]'::jsonb)
    into v_new
    from jsonb_array_elements(v_card.quiz) with ordinality as t(e, n);
  if v_new = v_card.quiz then
    return v_card;
  end if;

  update public.study_cards c set quiz = v_new
   where c.id = v_card.id
  returning * into v_card;
  return v_card;
end;
$$;

revoke execute on function public.study_quiz_reset(uuid, boolean) from public, anon;
grant execute on function public.study_quiz_reset(uuid, boolean) to authenticated;
comment on function public.study_quiz_reset(uuid, boolean) is
  'API-024 (progresso): zera as respostas do quiz, todas ou só as erradas (p_only_wrong); devolve o card. Sem resposta para zerar, não grava. Card inexistente: P0002.';

-- ---------------------------------------------------------------------------
-- 4. Anexar cards
-- ---------------------------------------------------------------------------

-- De 1 a 100 cards ({title, description?, rationale?, checkpoints?,
-- resources?, quiz?, blocks?, due_date?}) e até 4 MiB por chamada (docs/
-- api-arquitetura.md §9.3), no fim do tópico, na ordem da lista. title é
-- texto e pode ser vazio, como a tabela aceita (o parser gera '' de
-- "## Card 1:   "). Cada item ganha id quando não tem; ponto sem completed
-- ganha false (o "- [x]" do parser fica); userAnswer é sempre null (responder
-- é study_quiz_answer). A trava do tópico serializa append, import e
-- reschedule do mesmo tópico.
--
-- Um BEGIN … EXCEPTION só, em volta do laço: um por card abria uma
-- subtransação com XID por card, e com 70 cards o cache de 64 subxids de
-- PGPROC estourava (overflowed=t, que pesa nos snapshots de todo o banco
-- enquanto a transação durar). As variáveis ficam como estavam no erro, então
-- o handler sabe o índice. Só o erro com hint akool (as validações daqui e a
-- forma do gatilho) ganha o "cards/N: "; o resto sobe como veio.
create function public.study_cards_append(p_topic uuid, p_cards jsonb)
returns setof public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_ws    constant text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
  v_uid   uuid := auth.uid();
  v_start integer;
  v_card  jsonb;
  v_i     integer;
  v_key   text;
  v_ids   uuid[] := '{}';
  v_id    uuid;
  v_state text;
  v_msg   text;
  v_hint  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cards) is distinct from 'array' or jsonb_array_length(p_cards) not between 1 and 100 then
    raise exception 'Informe uma lista de 1 a 100 cards' using errcode = '22023', hint = 'akool';
  end if;
  if octet_length(p_cards::text) > 4194304 then
    raise exception 'Os cards passam de 4 MiB por chamada' using errcode = '22023', hint = 'akool';
  end if;

  perform 1 from public.study_topics t where t.id = p_topic and t.user_id = v_uid for no key update;
  if not found then
    raise exception 'Tópico não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  -- Só os cards do dono: uma linha cruzada antiga no tópico não empurra a posição.
  select coalesce(max(c.sort_order), -1) + 1 into v_start
    from public.study_cards c
   where c.topic_id = p_topic and c.user_id = v_uid;

  begin
    for v_card, v_i in select t.e, (t.n - 1)::integer from jsonb_array_elements(p_cards) with ordinality as t(e, n) loop
      if jsonb_typeof(v_card) <> 'object' then
        raise exception 'o card é um objeto {title, description, rationale, checkpoints, resources, quiz, blocks, due_date}'
          using errcode = '22023', hint = 'akool';
      end if;
      select k into v_key from jsonb_object_keys(v_card) as k
       where k not in ('title', 'description', 'rationale', 'checkpoints', 'resources', 'quiz', 'blocks', 'due_date')
       order by k
       limit 1;
      if found then
        raise exception 'chave "%" não aceita (title, description, rationale, checkpoints, resources, quiz, blocks e due_date)', left(v_key, 40)
          using errcode = '22023', hint = 'akool';
      end if;
      if jsonb_typeof(v_card -> 'title') is distinct from 'string' then
        raise exception 'title é texto (pode ser vazio)' using errcode = '22023', hint = 'akool';
      end if;
      if coalesce(jsonb_typeof(v_card -> 'description'), 'null') not in ('string', 'null')
         or coalesce(jsonb_typeof(v_card -> 'rationale'), 'null') not in ('string', 'null') then
        raise exception 'description e rationale são texto ou null' using errcode = '22023', hint = 'akool';
      end if;
      -- pg_input_is_valid (PG 16+) confere a data sem abrir subtransação.
      if coalesce(jsonb_typeof(v_card -> 'due_date'), 'null') not in ('string', 'null')
         or (jsonb_typeof(v_card -> 'due_date') = 'string'
             and ((v_card ->> 'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not pg_input_is_valid(v_card ->> 'due_date', 'date'))) then
        raise exception 'due_date é uma data AAAA-MM-DD ou null' using errcode = '22023', hint = 'akool';
      end if;

      insert into public.study_cards (user_id, topic_id, title, description, rationale, checkpoints, resources, quiz, blocks, sort_order, due_date)
      values (
        v_uid, p_topic,
        btrim(v_card ->> 'title', c_ws),
        coalesce(btrim(v_card ->> 'description', c_ws), ''),
        coalesce(btrim(v_card ->> 'rationale', c_ws), ''),
        case when jsonb_typeof(v_card -> 'checkpoints') = 'array'
             then (select coalesce(jsonb_agg(case when jsonb_typeof(x.e) = 'object'
                                                  then jsonb_build_object('id', gen_random_uuid()::text, 'completed', false) || x.e
                                                  else x.e end order by x.n), '[]'::jsonb)
                     from jsonb_array_elements(v_card -> 'checkpoints') with ordinality as x(e, n))
             when coalesce(jsonb_typeof(v_card -> 'checkpoints'), 'null') = 'null' then '[]'::jsonb
             else v_card -> 'checkpoints' end,
        case when jsonb_typeof(v_card -> 'resources') = 'array'
             then (select coalesce(jsonb_agg(case when jsonb_typeof(x.e) = 'object'
                                                  then jsonb_build_object('id', gen_random_uuid()::text) || x.e
                                                  else x.e end order by x.n), '[]'::jsonb)
                     from jsonb_array_elements(v_card -> 'resources') with ordinality as x(e, n))
             when coalesce(jsonb_typeof(v_card -> 'resources'), 'null') = 'null' then '[]'::jsonb
             else v_card -> 'resources' end,
        case when jsonb_typeof(v_card -> 'quiz') = 'array'
             then (select coalesce(jsonb_agg(case when jsonb_typeof(x.e) = 'object'
                                                  then jsonb_build_object('id', gen_random_uuid()::text) || x.e || '{"userAnswer": null}'::jsonb
                                                  else x.e end order by x.n), '[]'::jsonb)
                     from jsonb_array_elements(v_card -> 'quiz') with ordinality as x(e, n))
             when coalesce(jsonb_typeof(v_card -> 'quiz'), 'null') = 'null' then '[]'::jsonb
             else v_card -> 'quiz' end,
        case when jsonb_typeof(v_card -> 'blocks') = 'array'
             then (select coalesce(jsonb_agg(case when jsonb_typeof(x.e) = 'object'
                                                  then jsonb_build_object('id', gen_random_uuid()::text) || x.e
                                                  else x.e end order by x.n), '[]'::jsonb)
                     from jsonb_array_elements(v_card -> 'blocks') with ordinality as x(e, n))
             when coalesce(jsonb_typeof(v_card -> 'blocks'), 'null') = 'null' then '[]'::jsonb
             else v_card -> 'blocks' end,
        v_start + v_i,
        (v_card ->> 'due_date')::date)
      returning id into v_id;
      v_ids := v_ids || v_id;
    end loop;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text, v_hint = pg_exception_hint;
    if v_hint is distinct from 'akool' then
      raise;
    end if;
    raise exception using message = format('cards/%s: %s', v_i, v_msg), errcode = v_state, hint = 'akool';
  end;

  return query select * from public.study_cards c where c.id = any (v_ids) order by c.sort_order;
end;
$$;

revoke execute on function public.study_cards_append(uuid, jsonb) from public, anon;
grant execute on function public.study_cards_append(uuid, jsonb) to authenticated;
comment on function public.study_cards_append(uuid, jsonb) is
  'API-024: anexa de 1 a 100 cards (até 4 MiB) no fim do tópico, tudo ou nada; devolve os cards criados. Chaves: title (texto, pode ser vazio), description, rationale, checkpoints, resources, quiz, blocks e due_date. Itens sem id ganham um; userAnswer sempre null; o completed que veio fica. Erro: "cards/N: …" (N a partir de 0), com o SQLSTATE de origem. Tópico de outra pessoa: P0002.';

-- ---------------------------------------------------------------------------
-- 5. Reagendar
-- ---------------------------------------------------------------------------

-- Distribui os prazos até a meta, como o distributeDueDates do app: o i-ésimo
-- card (1..n, por sort_order, created_at e id) vence em today +
-- round(i * span / n), em aritmética inteira (2*i*span + n) / (2*n), que é o
-- Math.round do JS para span > 0. Meta em hoje ou antes: todos na meta. Só
-- grava o que muda (a versão dos outros cards fica). p_today é o dia do
-- aparelho: nulo vale o hoje de São Paulo; a mais de 1 dia dele, 22023. A
-- janela é comparação, não subtração: 'infinity' e '-infinity' (datas que o
-- Postgres aceita) caem no 22023 em vez do 22008 sem hint da subtração. Pelo
-- mesmo motivo, meta infinita (gravada pelo UPDATE direto) dá 22023.
create function public.study_reschedule(p_topic uuid, p_today date default null)
returns setof public.study_cards
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_sp     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_today  date := coalesce(p_today, v_sp);
  v_target date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_today not between v_sp - 1 and v_sp + 1 then
    raise exception 'Data de hoje (%) a mais de 1 dia do hoje de São Paulo (%): mande o dia do aparelho ou nada', v_today, v_sp
      using errcode = '22023', hint = 'akool';
  end if;

  select t.target_date into v_target from public.study_topics t where t.id = p_topic and t.user_id = v_uid for no key update;
  if not found then
    raise exception 'Tópico não encontrado' using errcode = 'P0002', hint = 'akool';
  end if;
  if v_target is null then
    raise exception 'O tópico não tem data-alvo' using errcode = 'P0001', hint = 'akool';
  end if;
  if not isfinite(v_target) then
    raise exception 'A data-alvo do tópico (%) não é uma data do calendário', v_target using errcode = '22023', hint = 'akool';
  end if;

  with ordered as (
    select c.id, row_number() over (order by c.sort_order, c.created_at, c.id) as i, count(*) over () as n
      from public.study_cards c
     where c.topic_id = p_topic and c.user_id = v_uid
  ), due as (
    select o.id,
           case when v_target <= v_today then v_target
                else v_today + ((2 * o.i * (v_target - v_today) + o.n) / (2 * o.n))::integer end as d
      from ordered o
  )
  update public.study_cards c set due_date = due.d
    from due
   where c.id = due.id and c.due_date is distinct from due.d;

  return query select * from public.study_cards c
                where c.topic_id = p_topic and c.user_id = v_uid
                order by c.sort_order, c.created_at, c.id;
end;
$$;

revoke execute on function public.study_reschedule(uuid, date) from public, anon;
grant execute on function public.study_reschedule(uuid, date) to authenticated;
comment on function public.study_reschedule(uuid, date) is
  'API-024: distribui os prazos dos cards até a data-alvo do tópico, como o distributeDueDates do app (ordem por sort_order, created_at e id; meta em hoje ou antes põe todos na meta); devolve os cards. p_today nulo é o hoje de São Paulo; a mais de 1 dia dele (infinity inclusive), 22023. Sem meta: P0001; meta infinita: 22023. Tópico de outra pessoa: P0002. Só grava o que muda.';

-- ---------------------------------------------------------------------------
-- 6. Importar
-- ---------------------------------------------------------------------------

-- {topic: {title, area?, level?, objective?, target_date?}, cards?: [...]}: a
-- forma do StudyParseResult depois da mescla com o formulário. Tópico, cards
-- e, com meta, reagendamento numa transação: um card com erro desfaz o tópico.
-- status não entra (o tópico nasce planned; studying e completed são de
-- estudos.progresso). due_date por card junto de target_date é recusado: o
-- reagendamento sobrescreveria o prazo em silêncio. Textos aparados como na
-- tela; o título do tópico é obrigatório (a tela também exige).
create function public.study_import_topic(p_payload jsonb, p_today date default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_ws     constant text := U&'\0009\000a\000b\000c\000d\0020\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff';
  v_uid    uuid := auth.uid();
  v_sp     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_t      jsonb := p_payload -> 'topic';
  v_cards  jsonb := p_payload -> 'cards';
  v_key    text;
  v_title  text;
  v_target date;
  v_i      integer;
  v_topic  public.study_topics;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Envie {topic, cards}' using errcode = '22023', hint = 'akool';
  end if;
  if octet_length(p_payload::text) > 4194304 then
    raise exception 'A importação passa de 4 MiB por chamada' using errcode = '22023', hint = 'akool';
  end if;
  select k into v_key from jsonb_object_keys(p_payload) as k where k not in ('topic', 'cards') order by k limit 1;
  if found then
    raise exception 'chave "%" não aceita (topic e cards)', left(v_key, 40) using errcode = '22023', hint = 'akool';
  end if;

  if jsonb_typeof(v_t) is distinct from 'object' then
    raise exception 'topic é um objeto {title, area, level, objective, target_date}' using errcode = '22023', hint = 'akool';
  end if;
  select k into v_key from jsonb_object_keys(v_t) as k
   where k not in ('title', 'area', 'level', 'objective', 'target_date')
   order by k
   limit 1;
  if found then
    raise exception 'topic: chave "%" não aceita (title, area, level, objective e target_date)', left(v_key, 40)
      using errcode = '22023', hint = 'akool';
  end if;
  if jsonb_typeof(v_t -> 'title') = 'string' then
    v_title := btrim(v_t ->> 'title', c_ws);
  end if;
  if coalesce(v_title, '') = '' then
    raise exception 'topic/title: o título do tópico é obrigatório' using errcode = '22023', hint = 'akool';
  end if;
  if coalesce(jsonb_typeof(v_t -> 'area'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(v_t -> 'level'), 'null') not in ('string', 'null')
     or coalesce(jsonb_typeof(v_t -> 'objective'), 'null') not in ('string', 'null') then
    raise exception 'topic: area, level e objective são texto ou null' using errcode = '22023', hint = 'akool';
  end if;
  if coalesce(jsonb_typeof(v_t -> 'target_date'), 'null') not in ('string', 'null')
     or (jsonb_typeof(v_t -> 'target_date') = 'string'
         and ((v_t ->> 'target_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or not pg_input_is_valid(v_t ->> 'target_date', 'date'))) then
    raise exception 'topic/target_date: data AAAA-MM-DD ou null' using errcode = '22023', hint = 'akool';
  end if;
  v_target := (v_t ->> 'target_date')::date;

  if coalesce(jsonb_typeof(v_cards), 'null') = 'null' then
    v_cards := '[]'::jsonb;
  elsif jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) > 100 then
    raise exception 'cards é uma lista de até 100 cards' using errcode = '22023', hint = 'akool';
  end if;
  -- Comparação, não subtração (como no study_reschedule): ±infinity dá 22023.
  if p_today is not null and p_today not between v_sp - 1 and v_sp + 1 then
    raise exception 'Data de hoje (%) a mais de 1 dia do hoje de São Paulo (%): mande o dia do aparelho ou nada', p_today, v_sp
      using errcode = '22023', hint = 'akool';
  end if;
  if v_target is not null then
    select (t.n - 1)::integer into v_i
      from jsonb_array_elements(v_cards) with ordinality as t(e, n)
     where jsonb_typeof(t.e) = 'object' and coalesce(jsonb_typeof(t.e -> 'due_date'), 'null') <> 'null'
     order by t.n
     limit 1;
    if found then
      raise exception 'cards/%: due_date não combina com topic.target_date (o reagendamento distribui os prazos até a meta)', v_i
        using errcode = '22023', hint = 'akool';
    end if;
  end if;

  insert into public.study_topics (user_id, title, area, level, objective, target_date)
  values (v_uid, v_title,
          coalesce(btrim(v_t ->> 'area', c_ws), ''),
          coalesce(btrim(v_t ->> 'level', c_ws), ''),
          coalesce(btrim(v_t ->> 'objective', c_ws), ''),
          v_target)
  returning * into v_topic;

  if jsonb_array_length(v_cards) > 0 then
    perform 1 from public.study_cards_append(v_topic.id, v_cards);
    if v_target is not null then
      perform 1 from public.study_reschedule(v_topic.id, p_today);
    end if;
  end if;

  return jsonb_build_object(
    'topic', to_jsonb(v_topic),
    'cards', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order), '[]'::jsonb)
                from public.study_cards c
               where c.topic_id = v_topic.id and c.user_id = v_uid));
end;
$$;

revoke execute on function public.study_import_topic(jsonb, date) from public, anon;
grant execute on function public.study_import_topic(jsonb, date) to authenticated;
comment on function public.study_import_topic(jsonb, date) is
  'API-024: cria o tópico ({topic: {title, area?, level?, objective?, target_date?}, cards?: até 100}), anexa os cards (study_cards_append) e, com meta, reagenda (study_reschedule), tudo numa transação; devolve {topic, cards}. status não é aceito (22023); due_date por card junto de target_date: 22023. Até 4 MiB.';
