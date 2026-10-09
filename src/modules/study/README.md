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
- Dados: `useStudyTopics.ts` — estado otimista + `supabase.from()` direto nas
  tabelas `study_topics` / `study_cards` / `study_logs` (RLS por `user_id`;
  migração `supabase/migrations/20260720120000_study_module.sql`).
  Toda mutação passa por `runOptimistic`/`runGuarded` (`lib/optimistic.ts`):
  em falha o rollback reverte **por id e por campo** — nunca substituindo a
  coleção, senão uma edição concorrente do autosave seria apagada junto — e
  emite toast. O estado é lastreado em `useRef` para que o snapshot enxergue a
  linha como ela está no momento do write, e não o valor do último render.
- `studyMutations.ts` — lógica pura do "Recalcular cronograma" (plano por id,
  detecção de falha parcial e rollback só dos ids que não gravaram).
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
  tópico por cima do RLS: um token só com `estudos.diario` (API-022) grava
  diário no próprio tópico sem ler `study_topics`.
- **Datas e versão são do servidor:** `started_at`/`completed_at` derivam do
  status (gatilho `study_topics_rules`); `updated_at` do card é a versão do
  conteúdo (mudar só a ordem mantém). O app ainda manda esses campos, e o
  servidor os troca: o `updateTopic` lê as datas de volta no mesmo
  round-trip. Sem usuário (SQL pelo MCP, `service_role`), um UPDATE que mude
  só o `updated_at` guarda o valor: é o conserto de versão no futuro.
- **Posição (`sort_order`) é do cliente:** o app manda a que calculou no
  aparelho (`max + 1` sobre o estado local, no `createCard` e no
  `insertCards`), e o gatilho a mantém. Só quando o INSERT vem sem
  `sort_order` o servidor põe `max + 1` entre os cards do mesmo dono no
  tópico. A posição não é única: duas abas ou dois INSERTs simultâneos podem
  repetir o valor (não há trava nem índice único em `(topic_id, sort_order)`).
- **Forma dos JSON** (`checkpoints`, `resources`, `quiz`, `blocks`): só a
  coluna que mudou é conferida, com 23514 e o motivo com o índice. Os limites
  ficam em `src/lib/studyLimits.ts`, com os mesmos números do SQL (o teste
  confere contra a migration). O parser descarta o que passaria do limite e
  devolve os descartes em `dropped`, à parte dos avisos de formato: a prévia
  mostra os descartes primeiro e inteiros, e os avisos numa caixa que rola.
  Os campos do card têm `maxLength`, menos o da URL do recurso: colada com
  mais de 2048 caracteres, ela fica inteira, com aviso e o botão desabilitado
  (cortar em silêncio gravaria um link quebrado).
- **CHECK** (valem também no restore): `resources` só com URL http(s) e as
  quatro colunas sempre lista.
- Linha antiga fora da forma não derruba a carga: `normalizeCard` tira o que
  não é objeto e a escolha sem alternativas.
- Exemplo para validar no staging: `docs/exemplos/estudo-api021.md`.

## Dependências externas ao módulo

`contexts/AuthContext`, `i18n/LanguageContext`, `lib/supabase`,
`lib/studyMarkdownParser`, `lib/studyLimits`, `lib/studyPrompt`, `lib/studyProgress`,
`components/ConfirmDeleteModal`, `components/MarkdownText`, tipos `Study*`
em `src/types`.

Regras: strings novas sempre em pt-BR **e** en (`src/i18n/translations.ts`);
estilos inline com tokens `var(--color-*)`; toda exclusão destrutiva passa
pelo `ConfirmDeleteModal`; tabelas novas nascem com RLS.
