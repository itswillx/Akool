-- API-021: regras de Estudos no servidor. Antes de a API escrever em Estudos,
-- o banco passa a garantir o que só o navegador fazia (e nem tudo).
--
-- Antes:
--   * study_cards e study_logs só conferiam user_id = auth.uid() (perf002). O
--     FK topic_id é conferido pelo RI, que ignora o RLS: dava para pendurar card
--     ou diário no tópico de outra pessoa (o dono do tópico apagava a linha do
--     outro em cascata, e 23503 contra sucesso dizia se um UUID existia). O
--     comentário de 20260720120000_study_module.sql que aceitava isso deixa de
--     valer;
--   * a forma de checkpoints, resources, quiz e blocks só existia nos COMMENT:
--     JSON fora da forma derrubava a Visão geral e deixava a carga girando;
--   * sort_order, updated_at, started_at e completed_at vinham do relógio e do
--     estado do aparelho.
--
-- Depois:
--   * card e diário só em tópico do mesmo dono (topic.user_id = user_id =
--     auth.uid()), conferido no INSERT e quando topic_id ou user_id muda. A
--     mensagem é a mesma para "não existe" e "é de outra pessoa" (P0002);
--   * forma dos quatro JSON por funções em private (motivo em texto, com o
--     índice a partir de 0 e sem repetir o conteúdo), só da coluna que mudou;
--   * sort_order vazio vai para o fim do tópico, contando só os cards do mesmo
--     dono (uma linha cruzada antiga com sort_order 2147483647 não estoura o
--     INSERT de quem é dono do tópico); updated_at do card é a versão do
--     conteúdo (mudar só a ordem mantém), sempre para frente (a exceção é o
--     conserto à mão sem usuário, nos riscos abaixo);
--   * datas do tópico derivam do status, como o app fazia: studying preenche
--     started_at uma vez, completed preenche completed_at, sair dele zera;
--   * CHECK (decisão do usuário, 07/10): resources com url http(s), a mesma
--     private.card_links_are_safe do SEC-010, e as quatro colunas sempre lista.
--     Valem também sem usuário (restore, SQL pelo MCP, service_role).
--
-- Regra dos gatilhos (docs/api-arquitetura.md §1.5): sem usuário, só posição e
-- versão são tratadas e as validações pulam; o INSERT guarda os valores que
-- vieram e completa os nulos ('[]' nas colunas jsonb, '' no rationale). O
-- restore_site_backup usa jsonb_populate_recordset, que põe NULL na chave
-- ausente, e INSERT … SELECT não aplica DEFAULT: backup anterior a quiz
-- (20260721120000) ou a blocks (20260830150627) falhava com 23502 e agora
-- restaura.
--
-- Levantamento na produção (07/10/2026, só contagens): 7 tópicos, 62 cards,
-- diário vazio; nenhum item fora da forma, URL fora de http(s), linha em
-- tópico alheio ou data no futuro. Únicos extras: 7 recursos com license e
-- licenseUrl, que passam a ser aceitas. Máximos: 12 pontos, 5 recursos, 15
-- perguntas, 4 alternativas e 6 blocos, bem abaixo dos limites daqui (os
-- mesmos números de src/lib/studyLimits.ts).
--
-- Riscos registrados:
--   * Lixeira do API-025 (docs/api-arquitetura.md §9.4): api_undo_call
--     reinsere as linhas como o usuário. O gatilho dos tópicos recalcula
--     started_at, completed_at e updated_at no INSERT com usuário, e o dos
--     cards valida a forma inteira no INSERT: desfazer a exclusão perderia as
--     datas e não traria de volta card antigo fora da forma. O API-025 precisa
--     tratar o undo como restore (por exemplo, um GUC ligado só por ele).
--   * Backup antigo no Storage com recurso fora de http(s) (linha apagada que o
--     levantamento não enxerga) faz o restore inteiro falhar pela CHECK.
--   * updated_at no futuro (relógio adiantado de antes do gatilho): com
--     usuário, greatest(agora, antigo + 1 µs) só avança. O conserto é um
--     UPDATE sem usuário (SQL pelo MCP, service_role) que mude só o
--     updated_at, por exemplo
--       update public.study_cards set updated_at = least(updated_at, now()) where updated_at > now();
--     (e o mesmo em study_topics): sem usuário, quando nada além da versão
--     muda, os gatilhos guardam o valor que veio. Medir na produção antes.

-- ---------------------------------------------------------------------------
-- 1. Forma dos campos JSON (reaproveitadas pela API, API-034)
-- ---------------------------------------------------------------------------
-- Cada função devolve null quando a lista está na forma ou o primeiro motivo,
-- em texto. Teto de 256 KiB por coluna (octet_length do jsonb em texto). O
-- progresso (completed dos pontos, userAnswer do quiz) é validado em passos
-- próprios; private.study_without_progress dá a projeção só do conteúdo, para
-- o API-022/034 saber se uma gravação mudou conteúdo ou só progresso.

-- Índice inteiro de 0 a p_len - 1, como número JSON (texto "0" não vale). Os
-- IFs ficam separados para o cast nunca rodar sobre outro tipo.
create function private.study_json_index(p_value jsonb, p_len integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if jsonb_typeof(p_value) is distinct from 'number' then
    return false;
  end if;
  v_num := (p_value #>> '{}')::numeric;
  return v_num = trunc(v_num) and v_num >= 0 and v_num < p_len;
end;
$$;

-- Ponto de estudo: até 200 {id, text, completed, note?}.
create function private.study_checkpoints_problem(p_items jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_i    bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    return 'não é uma lista';
  end if;
  if octet_length(p_items::text) > 262144 then
    return 'a lista passa de 256 KiB';
  end if;
  if jsonb_array_length(p_items) > 200 then
    return 'mais de 200 itens';
  end if;
  for v_item, v_i in select t.e, t.n - 1 from jsonb_array_elements(p_items) with ordinality as t(e, n) loop
    if jsonb_typeof(v_item) <> 'object' then
      return format('item %s não é objeto', v_i);
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'text', 'completed', 'note')) then
      return format('item %s: as chaves aceitas são id, text, completed e note', v_i);
    end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string' or length(v_item ->> 'id') not between 1 and 100 then
      return format('item %s: id é texto de 1 a 100 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'text') is distinct from 'string'
       or (v_item ->> 'text') ~ '^[[:space:]]*$' or length(v_item ->> 'text') > 2000 then
      return format('item %s: text é texto de 1 a 2000 caracteres', v_i);
    end if;
    if v_item ? 'note' and (jsonb_typeof(v_item -> 'note') is distinct from 'string' or length(v_item ->> 'note') > 5000) then
      return format('item %s: note é texto de até 5000 caracteres', v_i);
    end if;
    -- Progresso.
    if jsonb_typeof(v_item -> 'completed') is distinct from 'boolean' then
      return format('item %s: completed é true ou false', v_i);
    end if;
  end loop;
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_items) e) < jsonb_array_length(p_items) then
    return 'ids repetidos';
  end if;
  return null;
end;
$$;

-- Recurso: até 50 {id, title, url, license?, licenseUrl?}. url e licenseUrl
-- pela regra do SEC-010 (http(s), sem espaço nem caractere de controle).
-- title até 2048, porque o app e o parser o derivam da URL. license e
-- licenseUrl vieram da busca de recursos antiga (tirada no SEC-015); nulo
-- conta como ausente.
create function private.study_resources_problem(p_items jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_i    bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    return 'não é uma lista';
  end if;
  if octet_length(p_items::text) > 262144 then
    return 'a lista passa de 256 KiB';
  end if;
  if jsonb_array_length(p_items) > 50 then
    return 'mais de 50 itens';
  end if;
  for v_item, v_i in select t.e, t.n - 1 from jsonb_array_elements(p_items) with ordinality as t(e, n) loop
    if jsonb_typeof(v_item) <> 'object' then
      return format('item %s não é objeto', v_i);
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'title', 'url', 'license', 'licenseUrl')) then
      return format('item %s: as chaves aceitas são id, title, url, license e licenseUrl', v_i);
    end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string' or length(v_item ->> 'id') not between 1 and 100 then
      return format('item %s: id é texto de 1 a 100 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'title') is distinct from 'string' or length(v_item ->> 'title') > 2048 then
      return format('item %s: title é texto de até 2048 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'url') is distinct from 'string' or length(v_item ->> 'url') > 2048
       or (v_item ->> 'url') !~* '^https?://[^[:space:][:cntrl:]]+$' then
      return format('item %s: url é http(s), sem espaço, com até 2048 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'license') not in ('string', 'null') or length(v_item ->> 'license') > 2048 then
      return format('item %s: license é texto de até 2048 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'licenseUrl') not in ('string', 'null')
       or (jsonb_typeof(v_item -> 'licenseUrl') = 'string'
           and (length(v_item ->> 'licenseUrl') > 2048 or (v_item ->> 'licenseUrl') !~* '^https?://[^[:space:][:cntrl:]]+$')) then
      return format('item %s: licenseUrl é http(s), sem espaço, com até 2048 caracteres', v_i);
    end if;
  end loop;
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_items) e) < jsonb_array_length(p_items) then
    return 'ids repetidos';
  end if;
  return null;
end;
$$;

-- Quiz misto: até 100 perguntas. Certo/Errado (kind ausente ou 'boolean') com
-- answer certo|errado; escolha ('choice') com 2 a 10 alternativas e answer
-- como índice. userAnswer ausente, null ou um valor válido; explanation
-- ausente, null ou texto.
create function private.study_quiz_problem(p_items jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item   jsonb;
  v_i      bigint;
  v_choice boolean;
  v_n      integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    return 'não é uma lista';
  end if;
  if octet_length(p_items::text) > 262144 then
    return 'a lista passa de 256 KiB';
  end if;
  if jsonb_array_length(p_items) > 100 then
    return 'mais de 100 perguntas';
  end if;
  for v_item, v_i in select t.e, t.n - 1 from jsonb_array_elements(p_items) with ordinality as t(e, n) loop
    if jsonb_typeof(v_item) <> 'object' then
      return format('pergunta %s não é objeto', v_i);
    end if;
    if v_item ? 'kind' and (jsonb_typeof(v_item -> 'kind') is distinct from 'string' or (v_item ->> 'kind') not in ('boolean', 'choice')) then
      return format('pergunta %s: kind é boolean ou choice (ausente vale Certo/Errado)', v_i);
    end if;
    v_choice := coalesce(v_item ->> 'kind', '') = 'choice';
    if exists (select 1 from jsonb_object_keys(v_item) k
                where k not in ('kind', 'id', 'statement', 'answer', 'userAnswer', 'explanation')
                  and not (v_choice and k = 'options')) then
      return format('pergunta %s: as chaves aceitas são kind, id, statement, answer, userAnswer, explanation e, na escolha, options', v_i);
    end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string' or length(v_item ->> 'id') not between 1 and 100 then
      return format('pergunta %s: id é texto de 1 a 100 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'statement') is distinct from 'string'
       or (v_item ->> 'statement') ~ '^[[:space:]]*$' or length(v_item ->> 'statement') > 2000 then
      return format('pergunta %s: statement é texto de 1 a 2000 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'explanation') not in ('string', 'null') or length(v_item ->> 'explanation') > 4000 then
      return format('pergunta %s: explanation é texto de até 4000 caracteres ou null', v_i);
    end if;
    if v_choice then
      if jsonb_typeof(v_item -> 'options') is distinct from 'array' then
        return format('pergunta %s: options é uma lista de 2 a 10 alternativas', v_i);
      end if;
      v_n := jsonb_array_length(v_item -> 'options');
      if v_n not between 2 and 10 then
        return format('pergunta %s: options é uma lista de 2 a 10 alternativas', v_i);
      end if;
      if exists (select 1 from jsonb_array_elements(v_item -> 'options') o
                  where jsonb_typeof(o) <> 'string' or (o #>> '{}') ~ '^[[:space:]]*$' or length(o #>> '{}') > 1000) then
        return format('pergunta %s: cada alternativa é texto de 1 a 1000 caracteres', v_i);
      end if;
      if not private.study_json_index(v_item -> 'answer', v_n) then
        return format('pergunta %s: answer é o índice (a partir de 0) de uma alternativa', v_i);
      end if;
      -- Progresso.
      if jsonb_typeof(v_item -> 'userAnswer') <> 'null' and not private.study_json_index(v_item -> 'userAnswer', v_n) then
        return format('pergunta %s: userAnswer é null ou o índice de uma alternativa', v_i);
      end if;
    else
      if jsonb_typeof(v_item -> 'answer') is distinct from 'string' or (v_item ->> 'answer') not in ('certo', 'errado') then
        return format('pergunta %s: answer é certo ou errado', v_i);
      end if;
      -- Progresso.
      if jsonb_typeof(v_item -> 'userAnswer') <> 'null'
         and (jsonb_typeof(v_item -> 'userAnswer') <> 'string' or (v_item ->> 'userAnswer') not in ('certo', 'errado')) then
        return format('pergunta %s: userAnswer é null, certo ou errado', v_i);
      end if;
    end if;
  end loop;
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_items) e) < jsonb_array_length(p_items) then
    return 'ids repetidos';
  end if;
  return null;
end;
$$;

-- Bloco didático: até 50 {id, kind, title?, body, reveal?}. kind é um token,
-- não uma lista fechada: 20260830150627 deixou o kind livre para um cliente
-- mais novo gravar tipo novo sem tornar a linha ilegível para o antigo.
create function private.study_blocks_problem(p_items jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_i    bigint;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then
    return 'não é uma lista';
  end if;
  if octet_length(p_items::text) > 262144 then
    return 'a lista passa de 256 KiB';
  end if;
  if jsonb_array_length(p_items) > 50 then
    return 'mais de 50 blocos';
  end if;
  for v_item, v_i in select t.e, t.n - 1 from jsonb_array_elements(p_items) with ordinality as t(e, n) loop
    if jsonb_typeof(v_item) <> 'object' then
      return format('bloco %s não é objeto', v_i);
    end if;
    if exists (select 1 from jsonb_object_keys(v_item) k where k not in ('id', 'kind', 'title', 'body', 'reveal')) then
      return format('bloco %s: as chaves aceitas são id, kind, title, body e reveal', v_i);
    end if;
    if jsonb_typeof(v_item -> 'id') is distinct from 'string' or length(v_item ->> 'id') not between 1 and 100 then
      return format('bloco %s: id é texto de 1 a 100 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'kind') is distinct from 'string' or (v_item ->> 'kind') !~ '^[a-z][a-z0-9_-]{0,31}$' then
      return format('bloco %s: kind é um nome de 1 a 32 caracteres (a-z, 0-9, _ e -, começando por letra)', v_i);
    end if;
    if v_item ? 'title' and (jsonb_typeof(v_item -> 'title') is distinct from 'string' or length(v_item ->> 'title') > 200) then
      return format('bloco %s: title é texto de até 200 caracteres', v_i);
    end if;
    if jsonb_typeof(v_item -> 'body') is distinct from 'string' or length(v_item ->> 'body') > 20000 then
      return format('bloco %s: body é texto de até 20000 caracteres', v_i);
    end if;
    if v_item ? 'reveal' and (jsonb_typeof(v_item -> 'reveal') is distinct from 'string' or length(v_item ->> 'reveal') > 20000) then
      return format('bloco %s: reveal é texto de até 20000 caracteres', v_i);
    end if;
  end loop;
  if (select count(distinct e ->> 'id') from jsonb_array_elements(p_items) e) < jsonb_array_length(p_items) then
    return 'ids repetidos';
  end if;
  return null;
end;
$$;

-- Projeção só do conteúdo: tira completed e userAnswer de cada objeto. Mudar o
-- progresso não muda a projeção; mudar texto, alternativa ou gabarito muda.
create function private.study_without_progress(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_items) = 'array'
              then coalesce((select jsonb_agg(case when jsonb_typeof(t.e) = 'object' then t.e - 'completed' - 'userAnswer' else t.e end
                                              order by t.n)
                               from jsonb_array_elements(p_items) with ordinality as t(e, n)), '[]'::jsonb)
              else p_items end
$$;

revoke execute on function private.study_json_index(jsonb, integer) from public, anon, authenticated;
revoke execute on function private.study_checkpoints_problem(jsonb) from public, anon, authenticated;
revoke execute on function private.study_resources_problem(jsonb) from public, anon, authenticated;
revoke execute on function private.study_quiz_problem(jsonb) from public, anon, authenticated;
revoke execute on function private.study_blocks_problem(jsonb) from public, anon, authenticated;
revoke execute on function private.study_without_progress(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cards: dono, posição, versão e forma (BEFORE INSERT OR UPDATE)
-- ---------------------------------------------------------------------------

-- Sem DEFAULT: o card que chega sem posição vai para o fim do tópico (o app
-- calculava o max sobre o estado local).
alter table public.study_cards alter column sort_order drop default;

-- SECURITY DEFINER porque chama as funções de private e lê o tópico de
-- qualquer dono (a mensagem não conta se o tópico existe).
create function private.study_card_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_no_user boolean := auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon');
  v_problem text;
begin
  -- Sem usuário (restore, SQL pelo MCP, service_role): guarda o que veio e
  -- completa o que o backup antigo não tinha.
  if v_no_user and tg_op = 'INSERT' then
    new.checkpoints := coalesce(new.checkpoints, '[]'::jsonb);
    new.resources := coalesce(new.resources, '[]'::jsonb);
    new.quiz := coalesce(new.quiz, '[]'::jsonb);
    new.blocks := coalesce(new.blocks, '[]'::jsonb);
    new.rationale := coalesce(new.rationale, '');
  end if;

  -- Dono: o tópico é de quem grava, e o card também. Antes da posição, para o
  -- max nunca correr sobre tópico alheio, e antes do FK, que contaria se o
  -- tópico existe.
  if not v_no_user and (tg_op = 'INSERT' or new.topic_id is distinct from old.topic_id or new.user_id is distinct from old.user_id) then
    if not exists (select 1 from public.study_topics t
                    where t.id = new.topic_id and t.user_id = new.user_id and new.user_id = v_uid) then
      raise exception 'Tópico não encontrado' using errcode = 'P0002', hint = 'akool';
    end if;
  end if;

  -- Posição e versão valem também sem usuário. O max conta só os cards do
  -- mesmo dono no tópico: linha cruzada antiga não empurra (nem estoura) a
  -- posição de quem é dono do tópico.
  if new.sort_order is null then
    select coalesce(max(c.sort_order), -1) + 1 into new.sort_order
      from public.study_cards c
     where c.topic_id = new.topic_id and c.user_id = new.user_id;
  end if;
  if tg_op = 'UPDATE' then
    -- Versão do conteúdo: mudar só a ordem mantém. clock_timestamp(), não
    -- now(), e sempre para frente: duas gravações na mesma transação dão
    -- duas versões. Sem usuário e nada além da versão mudou: fica a que veio
    -- (conserto à mão de versão no futuro, cabeçalho). Com usuário, ou com
    -- qualquer outra coluna mudando, a versão continua do servidor.
    if v_no_user and (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
      null;
    elsif (to_jsonb(new) - array['updated_at', 'sort_order']) is distinct from
          (to_jsonb(old) - array['updated_at', 'sort_order']) then
      new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
    else
      new.updated_at := old.updated_at;
    end if;
  elsif not v_no_user or new.updated_at is null then
    new.updated_at := clock_timestamp();
  end if;

  if v_no_user then
    return new;
  end if;

  -- Forma: só o que mudou (dado antigo fora da regra não trava quem edita
  -- outra coisa). O app regrava a lista inteira: a lista toda é conferida.
  if tg_op = 'INSERT' or new.checkpoints is distinct from old.checkpoints then
    v_problem := private.study_checkpoints_problem(new.checkpoints);
    if v_problem is not null then
      raise exception 'Pontos de estudo fora do formato: %', v_problem using errcode = '23514', hint = 'akool';
    end if;
  end if;
  if tg_op = 'INSERT' or new.resources is distinct from old.resources then
    v_problem := private.study_resources_problem(new.resources);
    if v_problem is not null then
      raise exception 'Recursos fora do formato: %', v_problem using errcode = '23514', hint = 'akool';
    end if;
  end if;
  if tg_op = 'INSERT' or new.quiz is distinct from old.quiz then
    v_problem := private.study_quiz_problem(new.quiz);
    if v_problem is not null then
      raise exception 'Quiz fora do formato: %', v_problem using errcode = '23514', hint = 'akool';
    end if;
  end if;
  if tg_op = 'INSERT' or new.blocks is distinct from old.blocks then
    v_problem := private.study_blocks_problem(new.blocks);
    if v_problem is not null then
      raise exception 'Blocos fora do formato: %', v_problem using errcode = '23514', hint = 'akool';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function private.study_card_rules() from public, anon, authenticated;

create trigger study_cards_rules
  before insert or update on public.study_cards
  for each row execute function private.study_card_rules();

-- ---------------------------------------------------------------------------
-- 3. Tópicos: datas pelo status (BEFORE INSERT OR UPDATE)
-- ---------------------------------------------------------------------------

-- INVOKER: não lê tabela nem chama private. O cliente não grava as datas: com
-- usuário, o que vier em started_at e completed_at é trocado pela regra.
-- planned → completed direto deixa started_at nulo, como no app.
create function private.study_topic_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_no_user boolean := auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon');
  v_now     timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    -- Sem usuário (restore): as datas do backup.
    if v_no_user then
      new.updated_at := coalesce(new.updated_at, v_now);
      return new;
    end if;
    new.started_at := case when new.status = 'studying' then v_now end;
    new.completed_at := case when new.status = 'completed' then v_now end;
    new.updated_at := v_now;
    return new;
  end if;

  if not v_no_user then
    if new.status is distinct from old.status then
      new.started_at := coalesce(old.started_at, case when new.status = 'studying' then v_now end);
      new.completed_at := case when new.status = 'completed' then v_now end;
    else
      new.started_at := old.started_at;
      new.completed_at := old.completed_at;
    end if;
  end if;

  -- Sem usuário e nada além da versão mudou: fica a que veio (conserto à mão
  -- de versão no futuro, cabeçalho).
  if v_no_user and (to_jsonb(new) - 'updated_at') is not distinct from (to_jsonb(old) - 'updated_at') then
    return new;
  end if;
  if (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    new.updated_at := greatest(v_now, old.updated_at + interval '1 microsecond');
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

revoke execute on function private.study_topic_rules() from public, anon, authenticated;

create trigger study_topics_rules
  before insert or update on public.study_topics
  for each row execute function private.study_topic_rules();

-- ---------------------------------------------------------------------------
-- 4. Diário: dono do tópico (BEFORE INSERT OR UPDATE OF topic_id, user_id)
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER, como o dos cards: o tópico é lido por cima do RLS de quem
-- grava. Com as RESTRICTIVE do API-022, um token só com estudos.diario não lê
-- study_topics e, com o gatilho INVOKER, não gravaria diário nem no próprio
-- tópico. O predicado continua aceitando só o tópico de quem grava
-- (t.user_id = new.user_id = auth.uid()), e alheio e inexistente dão o mesmo
-- P0002: nada novo é revelado.
create function private.study_log_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null and coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' or new.topic_id is distinct from old.topic_id or new.user_id is distinct from old.user_id then
    if not exists (select 1 from public.study_topics t
                    where t.id = new.topic_id and t.user_id = new.user_id and new.user_id = auth.uid()) then
      raise exception 'Tópico não encontrado' using errcode = 'P0002', hint = 'akool';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.study_log_rules() from public, anon, authenticated;

create trigger study_logs_rules
  before insert or update of topic_id, user_id on public.study_logs
  for each row execute function private.study_log_rules();

-- ---------------------------------------------------------------------------
-- 5. CHECK de segurança (valem também sem usuário)
-- ---------------------------------------------------------------------------

-- private.card_links_are_safe (SEC-010) já tem EXECUTE para authenticated e
-- service_role; a CHECK guarda a função por OID. Levantamento = 0: NOT VALID e
-- VALIDATE na sequência (o VALIDATE não trava escrita).
alter table public.study_cards
  add constraint study_cards_resources_safe check (private.card_links_are_safe(resources)) not valid;
alter table public.study_cards validate constraint study_cards_resources_safe;

alter table public.study_cards
  add constraint study_cards_json_arrays check (
    jsonb_typeof(checkpoints) = 'array' and jsonb_typeof(resources) = 'array'
    and jsonb_typeof(quiz) = 'array' and jsonb_typeof(blocks) = 'array'
  ) not valid;
alter table public.study_cards validate constraint study_cards_json_arrays;

-- ---------------------------------------------------------------------------
-- 6. Documentação das colunas
-- ---------------------------------------------------------------------------

comment on column public.study_cards.topic_id is
  'Tópico do mesmo dono (topic.user_id = user_id = auth.uid()), conferido pelo gatilho study_cards_rules no INSERT e quando topic_id ou user_id muda (API-021). Erro P0002 "Tópico não encontrado", igual para tópico alheio e inexistente.';
comment on column public.study_cards.checkpoints is
  'Pontos de estudo: até 200 {id (1 a 100), text (1 a 2000), completed, note? (até 5000)}, ids únicos, até 256 KiB. Forma por private.study_checkpoints_problem no gatilho study_cards_rules (API-021).';
comment on column public.study_cards.resources is
  'Recursos: até 50 {id, title (até 2048), url http(s) até 2048, license?, licenseUrl? http(s)}, ids únicos, até 256 KiB (private.study_resources_problem). url http(s) também pela CHECK study_cards_resources_safe, que vale sem usuário.';
comment on column public.study_cards.quiz is
  'Quiz misto, até 100 perguntas e 256 KiB (private.study_quiz_problem). Certo/Errado: {id, statement (1 a 2000), answer: certo|errado, userAnswer?: certo|errado|null, kind?: "boolean", explanation?: texto até 4000 ou null}. Escolha: {kind: "choice", id, statement, options: 2 a 10 textos de 1 a 1000, answer: índice, userAnswer?: índice|null, explanation?}.';
comment on column public.study_cards.blocks is
  'Blocos didáticos: até 50 {id, kind, title? (até 200), body (até 20000, markdown), reveal? (até 20000)}, até 256 KiB (private.study_blocks_problem). kind é um token ^[a-z][a-z0-9_-]{0,31}$, não lista fechada (o app leva tipo desconhecido para note).';
comment on column public.study_cards.sort_order is
  'Posição no tópico. Sem valor no INSERT vai para o fim: max + 1 entre os cards do mesmo dono no tópico (gatilho study_cards_rules, API-021).';
comment on column public.study_cards.updated_at is
  'Versão do conteúdo, do servidor: muda só quando o conteúdo muda (mudar só sort_order mantém) e sempre para frente (API-021). Sem usuário, um UPDATE que mude só updated_at guarda o valor que veio (conserto à mão).';
comment on column public.study_topics.started_at is
  'Do servidor (gatilho study_topics_rules, API-021): preenchido na primeira ida para studying; o cliente não grava.';
comment on column public.study_topics.completed_at is
  'Do servidor (gatilho study_topics_rules, API-021): preenchido ao ir para completed e zerado ao sair dele.';
comment on column public.study_topics.updated_at is
  'Do servidor (gatilho study_topics_rules, API-021): muda quando a linha muda, sempre para frente. Sem usuário, um UPDATE que mude só updated_at guarda o valor que veio (conserto à mão).';
comment on column public.study_logs.topic_id is
  'Tópico do mesmo dono, conferido pelo gatilho study_logs_rules no INSERT e quando topic_id ou user_id muda (API-021).';
