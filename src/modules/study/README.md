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
   Pausado / Concluído, com `started_at`/`completed_at` automáticos), diário
   de estudos e meta com prazo (destaque de atraso).

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

## Dependências externas ao módulo

`contexts/AuthContext`, `i18n/LanguageContext`, `lib/supabase`,
`lib/studyMarkdownParser`, `lib/studyPrompt`, `lib/studyProgress`,
`components/ConfirmDeleteModal`, `components/MarkdownText`, tipos `Study*`
em `src/types`.

Regras: strings novas sempre em pt-BR **e** en (`src/i18n/translations.ts`);
estilos inline com tokens `var(--color-*)`; toda exclusão destrutiva passa
pelo `ConfirmDeleteModal`; tabelas novas nascem com RLS.
