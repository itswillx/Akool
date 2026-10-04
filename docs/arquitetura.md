# Arquitetura do Akool

Como o app sobe, em que ordem os providers se montam e por quê, como o `MainContent` decide o que mostrar, e por onde passam a autenticação e os dados. O mapa visual (`npm run generate:maps`) lê a ordem dos providers deste mesmo `src/App.tsx`; o teste `scripts/provider-order.test.ts` confere que a lista abaixo bate com o código.

## Boot (`src/main.tsx`)

1. **Variáveis de ambiente:** sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` o app mostra a `ConfigErrorScreen` em vez de quebrar em silêncio.
2. **Sentry** (REL-011): só com `VITE_SENTRY_DSN` no build; sem ele, no-op, e o SDK fica num chunk assíncrono fora do boot.
3. **Idioma salvo:** o dicionário pt-BR vai no boot; com `en` salvo no aparelho, o inglês é baixado antes do primeiro render (limite de 3 s). O `<html lang>` acompanha.
4. **Tema do aparelho:** `akool:theme` é aplicado em `html.dark` antes do primeiro paint (`src/lib/storedTheme.ts`), para as telas de entrada nascerem no tema certo.
5. **Telas de entrada em chunk próprio:** `AuthPage` (landing e login), `ResetPasswordPage` e `MfaChallengePage` vêm de `src/pages/auth/authPages.ts` por `import()`; sem a chave de sessão do Supabase no storage (`src/lib/sessionHint.ts`), o `App` pede o chunk já no boot, em paralelo com a checagem de sessão; quem está logado nunca baixa.
6. `createRoot` → `StrictMode` → `ErrorBoundary` (com `RootFallback`) → `App`.

## Árvore de providers (`src/App.tsx`)

```text
AuthProvider
  LanguageProvider
    ToastProvider
      AppInner  — portões: loading · recuperação de senha · login · MFA (AAL2)
        PagesProvider
          NotificationsProvider
            ThemeProvider
              OnboardingProvider
                WorkspaceModeProvider
                  SidebarDrawer · cabeçalho · MainContent · UserSettingsModal (lazy)
```

Por que nesta ordem:

| Provider | Onde | Motivo |
|---|---|---|
| `AuthProvider` | fora | sessão, perfil, `isAdmin`, portões de recuperação e MFA. Não usa toast nem idioma; de propósito não expõe a `session` (PERF-001: o token muda a cada foco e re-renderizava tudo). |
| `LanguageProvider` | fora, abaixo do Auth | o idioma vem do perfil (ou do escolhido no seletor PT/EN da página pública, antes de entrar); precisa do Auth e tem de envolver os toasts (UX-011). |
| `ToastProvider` | fora, abaixo do Language | o `ToastStack` escreve com `t()`; acima do Language ele saía sempre em pt-BR. |
| `AppInner` | — | decide, nesta ordem (`src/lib/authScreen.ts`): `loading` (tela de carregamento), `recoveryMode` com sessão e `mfaPending` (`MfaChallengePage`: o código antes da senha nova), `recoveryMode` (`ResetPasswordPage`), sem `user` (`AuthPage`: a página pública em `/`; `#entrar`, `#cadastro` e `#recuperar` abrem o formulário), `mfaPending` (`MfaChallengePage`); as três telas vêm do chunk lazy dentro de um `Suspense` cujo fallback é a própria tela de carregamento; só então monta o resto. Também roda o login diário (`mustReLogin`, data local) e o aviso de virada de dia (`useDayRollover`). |
| `PagesProvider` | dentro | páginas próprias e compartilhadas, página e painel ativos, realtime de `pages`. Dividido em três contexts (`pagesState.ts`: dados, navegação, ações) para a árvore não re-renderizar inteira (PERF-007). |
| `NotificationsProvider` | dentro | notificações do usuário em páginas de 30 ("carregar mais"), contagem real de não lidas, lida/não lida, excluir e limpar lidas, realtime (INSERT e UPDATE) e o aviso no canto quando chega uma nova (NOTIF-001). A interface é o sino da barra do topo (`src/components/notifications/`, chunk à parte), que abre a central e leva ao item; o acesso ao banco fica em `src/lib/data/notifications.ts` e o que cada tipo mostra, em `src/lib/notificationKinds.ts`. |
| `ThemeProvider` | dentro | tema do perfil, aplicado em `html.dark`. |
| `OnboardingProvider` | dentro | tour de boas-vindas (lazy). |
| `WorkspaceModeProvider` | dentro | o seletor Tudo / Documentos / Financeiro. |

Regra prática: quem precisa do idioma ou de toast fica abaixo do `ToastProvider`; quem precisa de página ativa fica abaixo do `PagesProvider`; nada acima do `AppInner` pode depender de estar logado.

## Roteamento (`src/components/MainContent.tsx`)

Não há router de URL: a tela vem do modo do workspace, do painel ativo e da página ativa, nesta ordem.

1. `mode === 'finance'` → `FinancePanel` ocupa tudo.
2. `activePanel === 'finance'` (só no modo Tudo) → `FinancePanel`.
3. `activePanel === 'documents'` → `DocumentsPanel`, que tem a sua própria seleção (`useDocsSelection`) e mostra a página escolhida dentro dele.
4. `activePanel === 'help'` → `HelpPanel`.
5. `activePage` → `PageEditor` (nota, desenho, nota + desenho ou lista, pelo `page.type`).
6. Senão → `Dashboard`.

Cada ramo tem o seu `ErrorBoundary` com `key` (REL-005), e o título da aba segue as mesmas regras (`documentTitleFor`, UX-006). Painéis pesados são `lazy` (PERF-009).

## Módulos

| Módulo | O que faz | Onde fica |
|---|---|---|
| Páginas | Notas (BlockNote), desenhos (Excalidraw), nota + desenho e listas de tarefas, em árvore e compartilháveis | `src/components/PageEditor.tsx`, `src/contexts/PagesContext.tsx` |
| Documentos | Painel que reúne as páginas, os projetos e a rede de ligações | `src/components/DocumentsPanel.tsx`, `src/modules/docsnetwork/` |
| Projetos | Kanban, Gantt, cards com checklist, importação de backlog e a fila de desenvolvimento | `src/modules/projects/` |
| Finanças | Transações, contas, orçamentos, metas, extratos, loja e visões por projeto | `src/modules/finance/` ([README](../src/modules/finance/README.md)) |
| Estudos | Tópicos, cards, roteiros e diário | `src/modules/study/` |
| Backup | Backups manuais e automáticos | `src/modules/backup/` |
| Auditoria | Log das ações administrativas | `src/modules/audit/` |
| Usuários | Contas, convites e cotas (admin) | `src/components/UserManagementPanel.tsx` (casca), `src/components/admin/` (hooks e abas), `src/lib/data/admin.ts` |

Módulos não importam uns dos outros (regra de lint `akool/no-cross-module-import`, ARCH-006): o que é comum vive em `src/shared` (UI e hooks genéricos: `Field`, `Backdrop`, `RailButton`, `ConfirmDeleteModal`, `useDialog`, `useIsMobile`…) e `src/lib` (ex.: `pageTree`, `priorities`, `appEvents`). `src/shared` só importa `src/lib` e `src/i18n`. O alias `@/` aponta para `src/` (tsconfig e Vite); os imports do `src/shared` usam `@/shared/ui/...` e `@/shared/hooks/...`.

## Fluxo de autenticação

- **Página pública** (`AuthPage`): sem sessão, `/` abre a landing (seções num chunk lazy, `src/pages/landing/`); `#entrar`, `#cadastro` e `#recuperar` abrem o formulário (`src/pages/auth/AuthForm.tsx`) e o Voltar do navegador devolve a página (`src/pages/auth/authView.ts`; hash com `=` é callback do auth-js e é ignorado). Login diário e link de recuperação expirado abrem direto no formulário. O seletor PT/EN grava `akool:auth.lang`, a mesma chave que o perfil preenche. Login, MFA e redefinição dividem o `AuthShell` (`src/pages/auth/AuthShell.tsx`: barra do topo, foco e título por view, cartão com o painel da tela, `AuthContextPanel`, ao lado no desktop e embaixo nas outras larguras) e o `useAuthLang`. O texto longo fica fora do dicionário do boot: `src/i18n/landingContent.ts` (landing, vitrine por módulo, perguntas frequentes), `authContent.ts` (painel por tela) e `appPreviewContent.ts` (a prévia do app desenhada em código, `AppPreview`: uma pequena demonstração clicável no hero e na vitrine, com o estado em `src/pages/auth/previewState.ts`, e só ilustração no painel do login). As trocas landing ↔ login e dentro do cartão usam a View Transitions API (`src/pages/auth/viewTransition.ts`, com `flushSync`); o movimento segue `docs/design-system.md` ("Movimento"). O formulário valida por conta própria (`noValidate`), mostra erro por campo (`Field`), traduz os erros do Supabase (`src/lib/authErrors.ts`) e, depois do cadastro ou do pedido de redefinição, troca o formulário por um painel com reenvio de e-mail (`src/lib/data/auth.ts`, espera de 60 s).
- **Entrar** (`signIn`): `supabase.auth.signInWithPassword` → o próprio perfil vem pela RPC `get_my_profile()` (security definer; as colunas de privilégio de `profiles` não são legíveis por `authenticated`, SEC-013) → conta desativada (`is_active = false`) é recusada e a sessão descartada → com MFA ativo, `mfaPending` até `verifyMfa` subir a sessão para AAL2 (SEC-004) → `last_login_date` gravado com a data local (REL-007).
- **Criar conta** (`signUp`): exige código de convite válido; a cota é descontada pelas RPCs de convite, auditadas (SEC-018).
- **Recuperar senha:** o link do e-mail dispara `PASSWORD_RECOVERY`; `recoveryMode` mostra a tela de nova senha mesmo com `user` nulo. Conta com MFA passa antes pelo código: a sessão do link é AAL1 e o Supabase só troca a senha em AAL2; "Sair" nesse código desfaz a recuperação (`cancelPasswordReset`).
- **Login diário:** uma vez por abertura do app, `mustReLogin` compara `last_login_date` com a data local; com o app aberto na virada do dia, aparece um aviso e o login é pedido na próxima abertura.
- **Sair** (`signOut`): limpa cache de signed URLs e do react-query (SEC-017), fecha os canais de realtime.
- **Admin:** banir, desativar, trocar papel e revogar sessões passam pela edge `admin-ops` (service_role, com auditoria); o painel lista perfis pela RPC `admin_list_profiles()`.
- **Permissões no banco:** RLS tabela a tabela em [`matriz-rls.md`](matriz-rls.md); grants por coluna em `profiles`; rate limit nas RPCs sensíveis.

## Fluxo de dados

- **Cliente:** `src/lib/supabase.ts` (um só, tipado por `src/types/database.ts`, gerado por `npm run gen:types`).
- **Leituras:** consultas por módulo em `src/lib/data/*` (páginas, projetos, dashboard) e nos hooks de dados (`useBoardData`, `useFinanceData`, `useStudyTopics`…). Listas que podem passar de 1000 linhas usam `fetchAllRows` (REL-003). A trava `scripts/data-layer.test.ts` impede consulta nova dentro de componente.
- **Cache:** só o Dashboard usa react-query (`src/lib/queryClient.ts`, provider no chunk do Dashboard, PERF-015); os outros painéis guardam estado local e recarregam pelo realtime.
- **Escritas:** `runGuarded`/`runOptimistic` (`src/lib/optimistic.ts`): nenhuma escrita descarta o resultado (regra de lint `akool/no-discarded-supabase-write`, REL-004); updates e deletes conferem `.select('id')` porque o RLS recusa com 0 linhas.
- **Conteúdo de nota e desenho:** autosave com debounce e save condicional pela versão (`saveVersionedContent`, REL-009); conflito mostra "carregar a versão salva / manter a minha"; o desenho só grava quando a soma das versões dos elementos muda.
- **Sem conexão (REL-012):** `src/lib/connectivity.ts` (estado da rede, banner no App, evento de volta), `src/lib/offlineStore.ts` (rascunhos em IndexedDB, por conta; carregado sob demanda) e `src/lib/offlineSync.ts` (reenvio ao voltar a conexão e logo após o login). O saver de notas e desenhos guarda o pendente como rascunho em erro de rede (status `offline`); a página abre com o rascunho e o primeiro save grava ou cai no aviso de conflito. Quick notes não revertem sem rede: o patch vira rascunho e é reenviado. Projetos, financeiro e tarefas continuam com reversão + toast. Sair da conta apaga os rascunhos.
- **Realtime:** publication com `pages`, `todos`, `notifications` (por migração desde a `notif001`; antes só pelo painel), `project_card_queue`, `note_contents`, `drawing_contents`, `project_cards`, `project_columns`. Canais por página (`useCollaborativeContent`), por quadro (`project-board:<id>`) e por usuário (notificações, cache do Dashboard). DELETE não é assinado (o Postgres Changes não aplica RLS nele).
- **Arquivos:** buckets privados com limite e MIME (SEC-011); imagens comprimidas antes de subir (PERF-010); signed URLs com cache, dedupe e lote (`storageUrl.ts`, PERF-014).
- **Entre módulos:** eventos tipados em `src/lib/appEvents.ts` (ARCH-007; a lista é a interface `AppEvents`): a Loja avisa o Financeiro (`finance_transactions_changed`) e as notificações (NOTIF-001) abrem o modal do workspace, recarregam o Financeiro, trocam o quadro de Projetos aberto, abrem as Configurações numa aba e atendem o "Ver" do aviso.
- **Edge functions:** `admin-ops`, `cards-api` (a CLI da fila, `npm run cards`) e `site-backup`.
- **localStorage:** todas as chaves sob `akool:` em `src/lib/localKeys.ts` (QA-006; `akool:auth.lang` é o idioma da página pública/tela de login, `akool:theme` o tema do aparelho, `akool:notifications.prefs` as categorias sem aviso ao chegar; as três sobrevivem ao logout); os nomes antigos `excalinotion_*`, `projects_*`, `finance_*` e `akool_*` são migrados no boot.

## Travas que mantêm isto verdadeiro

`scripts/provider-order.test.ts` (ordem dos providers = este doc), `scripts/data-layer.test.ts`, `scripts/module-size.test.ts` (≤ 600 linhas por arquivo nos módulos) e a regra `max-lines` (600 linhas sem brancos e comentários, aviso na catraca, em todo o `src/`), `scripts/supabase-drift.test.ts` (retrato do schema), `scripts/bundle-budget.mjs` (boot ≤ orçamento), a regra `akool/no-cross-module-import` (fronteira entre módulos e camada `src/shared`) e as catracas de lint e cobertura (a de cobertura guarda o total geral e aceita `--allow-moves` quando um arquivo testado muda de pasta).
