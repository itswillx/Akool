# Módulo de Estudos ("Estudos")

Mini-app de acompanhamento de estudos montado dentro da visão Documentos
(`DocumentsPanel` → seção "Estudos", lazy-loaded via o barrel `index.ts`).

## Fluxo principal

1. O usuário escolhe um título (e opcionalmente área/nível/objetivo) em
   `NewStudyTopicModal`.
2. O app gera um prompt padronizado (`src/lib/studyPrompt.ts`) que o usuário
   copia e roda no Claude por conta própria — **não há integração de API**.
3. O `.md` gerado é colado/enviado de volta e parseado por
   `src/lib/studyMarkdownParser.ts` (tolerante; problemas viram warnings),
   com preview antes de criar o tópico + cards + pontos de estudo.
4. Evolução: checkpoints → progresso %, status (A estudar / Estudando /
   Pausado / Concluído, com `started_at`/`completed_at` preenchidos pelo
   servidor), diário de estudos e meta com prazo (destaque de atraso).

## Estrutura

- `StudySection.tsx` — orquestrador (views + detalhe + modais + confirmação).
- `StudyNav.tsx` — navegação interna (rail agrupado no desktop, chips no mobile).
- Views: `StudyOverview`, `StudyTopicList`, `StudyHistory`, `StudyStats`,
  `StudyPlanning`; detalhe: `StudyTopicDetail` + `StudyCardItem` + `StudyDiary`.
- Import .md: `ImportStudyMarkdown` (peça compartilhada) +
  `NewStudyTopicModal` / `ImportStudyAppendModal`.
- Dados (API-029): `src/lib/data/study.ts` tem todas as consultas e RPCs
  (o hook não chama o `supabase` direto). `useStudyTopics.ts` tem as
  operações; `useStudySync.ts`, o estado, a carga e o refetch.
  - **Itens de lista** (ponto, recurso, resposta do quiz) vão pela RPC do
    item (API-024), que trava o card e mexe só naquele item: o ponto que
    outra aba somou não some quando esta marca outro. A tela muda na hora
    (espelho local da RPC) e adota a linha que volta, só se a versão dela
    for mais nova que a conhecida (as respostas chegam fora de ordem). O
    `toggle` manda `p_completed` explícito; o ponto e o recurso novos levam
    um `p_id` estável por rascunho (`createDraftIds`): o reenvio depois de
    uma falha não duplica. P0002 relê o card (numa remoção é sucesso calado;
    nas outras, aviso "já removido"); P0001 relê e mostra a resposta de lá.
  - **Campos escalares** (título, descrição, "por que agora", prazo;
    título, área, objetivo, status, nível e meta do tópico) gravam com
    `.eq('updated_at', versão do servidor)`. Com zero linhas, relê:
    reenvio → gravado; mesma versão → recusa do RLS (`denied`); card
    apagado → sai da tela; outra versão → se o campo mudou desde o início
    da edição (a `base`, guardada no foco ou ao abrir o texto), conflito:
    o card de lá entra e o aviso traz "Copiar meu texto"; se só outra coisa
    mudou (uma lista), refaz com a versão nova, até 3 vezes. Antes de ir à
    rede, a mesma regra contra a linha do servidor somada às gravações
    próprias pendentes (duas mudanças seguidas não são conflito). Data,
    status, nível e prazo, gravados no `onChange`, vão sem base: a última
    vale. A gravação que falha (rede, RLS, limite de tentativas) deixa a
    base dela para a seguinte do mesmo campo (`StudyFieldBases`), presa ao
    texto que falhou: só herda a edição que partiu dele (a pessoa voltou ao
    campo com ele na tela) ou o mesmo rascunho que voltou e sai de novo; o
    servidor ainda no valor de antes não é mudança de outra aba. O rascunho
    que voltou, editado ou não, grava quando o servidor já tem o texto que
    falhou (a resposta se perdeu depois do commit). A herança
    soma a base de antes à própria: cada linha relida refaz a escolha, e
    só é conflito se o servidor não está na base própria, na herdada nem
    no patch (a 1ª pode ter gravado e só a resposta se perdido). Todo fim
    de gravação do campo apaga a herança (inclusive o conflito da
    pré-checagem), menos a falha, que deixa a sua; o refetch que traz o
    valor que falhou troca a base herdada pelo valor que chegou. O hook
    devolve `'saved' | 'conflict' | 'failed'`, que o rascunho usa.
  - **Criar card, anexar `.md`, importar e reagendar** são uma RPC cada,
    tudo ou nada; a posição do card novo, as datas e a versão são do
    servidor. O `p_today` é o dia do aparelho, e só vai no reagendar e na
    importação com meta (sem meta ele não serve, e o servidor o conferiria
    à toa). Se o servidor o recusa (22023 "Data de hoje…": o relógio do
    aparelho está errado, e só o servidor sabe), a chamada refaz uma vez
    sem ele e vale o dia de São Paulo do servidor. O erro de importação
    vira "o card N (título)"; o motivo, em pt-BR, vai só para o console.
    P0002 nessas RPCs é o tópico excluído em outra aba ou aparelho: ele sai
    da tela com cards e diário, e o aberto vira o aviso "excluído em outra
    aba". Tudo fica "removido" no `StudyWriteTracker`, como na exclusão
    desta aba (o card que some numa releitura também): o refetch em voo,
    que leu antes da exclusão, não os traz de volta, nem os cards e o
    diário do tópico removido que esta aba nunca viu. P0001 no reagendar é a meta tirada em outra aba: relê o tópico (o
    botão some) e avisa.
  - **Livro por linha** (`StudyLedger`, em `studyMutations.ts`): a última
    linha do servidor e as gravações desta aba em voo; a tela mostra uma
    com as outras por cima. Falha só tira a gravação da lista (o
    "desfazer" é recalcular). Só a mesma chave (card + item, card + campo,
    ou o quiz do card inteiro: responder e reiniciar se esperam) espera a
    anterior; o resto sai na hora.
  - **Refetch** ao voltar o foco ou a visibilidade da aba, sem tela de
    carregando nem aviso de erro, no máximo um a cada 5 s, com uma rodada
    no fim do intervalo. O `mergeRefetch` não pisa no que esta aba gravou,
    criou ou ainda grava depois que o refetch saiu (contador de escrita por
    id, `StudyWriteTracker`), e o que esta aba excluiu não volta até um
    refetch posterior. Não há guarda por versão: o restore do site-backup
    traz versões mais velhas. O tópico aberto que um refetch não traz mais
    vira o aviso "excluído em outra aba". O refetch espera a carga inicial
    terminar, com sucesso ou não: depois de uma carga que falhou, o foco
    seguinte é a nova tentativa. A volta à aba (visibilitychange e focus
    juntos) conta como um pedido só. Depois do desmonte ou da troca de
    usuário nada reagenda, e a resposta em voo é descartada.
  - **Servidor desatualizado** (PGRST202: o front saiu antes da migration
    do API-024): aviso fixo, e listas, criar card, anexar, importar e
    recalcular desligados até recarregar. Sem volta para regravar a lista
    inteira. O aviso cobre só a falta da 024. Sem a 021 (gatilho
    `study_topics_rules`), a troca de status grava sem `started_at` e
    `completed_at`, e o `updated_at` não anda, sem erro nem aviso; a 021
    depois não conserta essas linhas. Por isso o front do lote só vai à
    main depois do apply da 021 e da 024 em produção.
  - Os campos de texto (`useFieldDraft`) seguem o servidor sem foco e
    guardam o rascunho com foco (o foco fica em state, não em ref). Na
    falha da gravação o rascunho volta, sem foco: o texto fica no campo e a
    próxima saída dele tenta de novo, com a base do início da edição. Só a
    última saída que gravou devolve o rascunho; a que não grava nada
    (entrar e sair sem mudar) não conta. No
    conflito o servidor vence (o aviso traz "Copiar meu texto"). O passo do
    roteiro com um campo de texto em edição não fecha quando o refetch muda
    o passo atual.
- `studyMutations.ts` — lógica pura: os espelhos locais das RPCs,
  `compareCardOrder` (sort_order, created_at e id, a ordem do
  `study_reschedule`), `isNewerVersion` (texto do servidor; nunca `Date` nem
  `localeCompare`), a regra de conflito por campo, `saveWithRetry`,
  `StudyFieldBases`, `StudyLedger`, `StudyWriteTracker` e `mergeRefetch`.
- `StudyCardQuiz.tsx` — o quiz do card (separado do `StudyCardItem` pelas
  600 linhas).
- `studyUi.ts` — helpers sem componente: `normalizeUrl`, `isUrlTooLong` e
  `resourceFromInput` (a URL e o recurso dentro da regra do servidor),
  `createSaveGate` (o campo de adicionar só limpa depois de gravar),
  `withoutSavedLead` (na limpeza, sai do começo do campo só o texto gravado;
  o que a pessoa digitou durante a gravação fica) e `createSentField`
  (ponto, título e URL do recurso: guarda o texto bruto de cada envio e marca
  "substituído" quando uma edição começa dentro dele durante a gravação, pela
  seleção de antes da edição em beforeinput/colar/recortar/soltar/composição/
  Backspace/Delete e, para o resto, pela troca de valor; substituído, o campo
  fica como a pessoa deixou, e "Capítulo 1" → "Capítulo 10" não vira "0").

## Regras no servidor (API-021)

Migration `supabase/migrations/20261008130000_api021_study_rules.sql`, prova
em `supabase/checks/api021-study.sql`.

- **Dono:** card e diário só em tópico do mesmo dono, conferido no INSERT e
  quando `topic_id`/`user_id` muda. Tópico alheio ou inexistente dá P0002
  "Tópico não encontrado". Os dois gatilhos são SECURITY DEFINER e leem o
  tópico por cima do RLS: quem grava diário no próprio tópico não precisa
  ler `study_topics`.
- **Datas e versão são do servidor:** `started_at`/`completed_at` derivam do
  status (gatilho `study_topics_rules`); `updated_at` do card é a versão do
  conteúdo (mudar só a ordem mantém). Desde o API-029 o app não manda
  nenhum desses campos: lê as datas e a versão de volta na linha. Sem
  usuário (SQL pelo MCP, `service_role`), um UPDATE que mude só o
  `updated_at` guarda o valor: é o conserto de versão no futuro.
- **Posição (`sort_order`) é do servidor:** desde o API-029 o app cria e
  anexa cards só pelo `study_cards_append` (e pelo `study_import_topic`),
  que põe `max + 1` com o tópico travado. O gatilho ainda guarda um
  `sort_order` mandado num INSERT direto (o restore do backup usa isso), e
  a posição antiga pode repetir: a ordem do roteiro desempata por
  `created_at` e `id`.
- **Forma dos JSON** (`checkpoints`, `resources`, `quiz`, `blocks`): só a
  coluna que mudou é conferida, com 23514 e o motivo com o índice. Os limites
  ficam em `src/lib/studyLimits.ts`, com os mesmos números do SQL (o teste
  confere contra a migration). O parser descarta o que passaria do limite e
  devolve os descartes em `dropped`, à parte dos avisos de formato: a prévia
  mostra os descartes primeiro e inteiros, e os avisos numa caixa que rola.
  Os campos do card têm `maxLength`, menos o da URL do recurso: colada com
  mais de 2048 caracteres, ela fica inteira, com aviso e o botão desabilitado
  (cortar em silêncio gravaria um link quebrado).
- **Teto por importação** (API-029): o `fitImportCards` do parser corta em
  100 cards e 4 MiB, medidos no texto do jsonb do payload inteiro (tópico
  incluído), do fim para o começo, e diz no `dropped` o que ficou de fora;
  sem nenhum card que caiba, o botão de importar desliga. É pura; o hook
  mede de novo com o tópico do formulário antes de enviar.
- **CHECK** (valem também no restore): `resources` só com URL http(s) e as
  quatro colunas sempre lista.
- Linha antiga fora da forma não derruba a carga: `normalizeStudyCard` tira o que
  não é objeto e a escolha sem alternativas.
- Exemplo para validar no staging: `docs/exemplos/estudo-api021.md`.

## Dependências externas ao módulo

`contexts/AuthContext`, `contexts/ToastContext`, `i18n/LanguageContext`, `lib/data/study`,
`lib/optimistic`, `lib/studyMarkdownParser`, `lib/studyLimits`, `lib/studyPrompt`, `lib/studyProgress`,
`components/ConfirmDeleteModal`, `components/MarkdownText`, tipos `Study*`
em `src/types`.

Regras: strings novas sempre em pt-BR **e** en (`src/i18n/translations.ts`);
estilos inline com tokens `var(--color-*)`; toda exclusão destrutiva passa
pelo `ConfirmDeleteModal`; tabelas novas nascem com RLS.
