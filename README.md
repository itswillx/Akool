# Akool

<!-- Badge do CI (DEV-001): troque OWNER/REPO pelo repositório no GitHub.
[![CI](https://github.com/OWNER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/OWNER/REPO/actions/workflows/ci.yml)
-->

Espaço de trabalho pessoal e colaborativo: páginas com notas, desenhos e tarefas, projetos em kanban e Gantt, finanças e estudos, num só app. Frontend em React, com o Supabase cuidando de login, banco (com RLS), arquivos e edge functions. A interface fala português e inglês.

## Módulos

| Módulo | O que faz | Onde fica |
|---|---|---|
| Páginas | Notas (editor de blocos), desenhos (Excalidraw), nota + desenho lado a lado e listas de tarefas, em árvore e compartilháveis | `src/components/PageEditor.tsx`, `src/contexts/PagesContext.tsx` |
| Documentos | Painel que reúne as páginas, os projetos e a rede de ligações entre elas | `src/components/DocumentsPanel.tsx`, `src/modules/docsnetwork/` |
| Projetos | Quadros kanban e Gantt, cards com checklist, importação de backlog em Markdown e a fila de desenvolvimento | `src/modules/projects/` |
| Finanças | Transações, contas, orçamentos, metas, importação de extrato, loja e visões por projeto | `src/modules/finance/` ([README do módulo](src/modules/finance/README.md)) |
| Estudos | Tópicos, cards de estudo, roteiros e diário | `src/modules/study/` |
| Backup | Backups do banco, manuais e automáticos | `src/modules/backup/` |
| Auditoria | Registro das ações administrativas e o estado da observabilidade | `src/modules/audit/` |
| Usuários | Administração de contas, códigos e cotas de convite | `src/components/UserManagementPanel.tsx` |
| Ajuda | Artigos e tour de boas-vindas | `src/components/HelpPanel.tsx`, `src/i18n/helpContent.ts` |

O seletor no topo alterna entre as visões Tudo, Documentos e Financeiro (`src/contexts/WorkspaceModeContext.tsx`).

## Stack

- **Frontend:** React 19, Vite 8 (rolldown), TypeScript e Tailwind 4, com BlockNote para as notas e Excalidraw para os desenhos.
- **Backend:** Supabase, com Auth, Postgres com RLS, Storage, Realtime e edge functions em Deno.
- **Idiomas:** pt-BR e en, em `src/i18n/`. O português vem no carregamento inicial, e o inglês baixa sob demanda.
- **Erros em produção:** Sentry, opcional; sem configuração, fica desligado. Ver `src/lib/observability.ts`.
- **Testes:** Vitest, com happy-dom para os componentes.

## Rodando localmente

1. **Node** `^22.13.0 || >=24`. O `.nvmrc` indica o 22, e o `.npmrc` recusa versões fora da faixa.
2. **Dependências:** `npm ci`, que instala exatamente o `package-lock.json`.
3. **Configuração:** copie o [`.env.example`](.env.example) para `.env.local` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`, que ficam em Project Settings → API no painel do Supabase. Sem elas, o app abre numa tela que diz o que falta.
4. **App:** `npm run dev` sobe em http://localhost:5173.

Criar conta exige um código de convite, que é gerado por quem já usa o app (em Configurações).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento do Vite |
| `npm run dev:staging` | O mesmo, apontando para o staging (ver [Ambientes](#ambientes)) |
| `npm run dev:localdb` | O mesmo, apontando para o Supabase local (ver [Supabase local](#supabase-local)) |
| `npm run build` | Checagem de tipos (`tsc -b`) e build de produção em `dist/` |
| `npm run build:staging` / `preview:staging` | Build e preview (porta 4173) do staging |
| `npm run preview` | Serve o `dist/` localmente |
| `npm test` | Testes (Vitest), uma vez |
| `npm run test:coverage` | Testes com cobertura e a trava por pasta (`scripts/coverage-baseline.json`) |
| `npm run test:e2e` | E2E (Playwright) contra o staging |
| `npm run test:watch` | Testes em modo observação |
| `npm run gen:types` | Regrava `src/types/database.ts` a partir do banco (Supabase CLI logado) |
| `npm run staging:reset` | Monta o staging a partir do repo: migrations, passos do staging e functions |
| `npm run drift` | Confere se o Supabase remoto bate com o repo (functions, migrations, schema, advisors) |
| `npm run lint` | ESLint com todos os problemas |
| `npm run lint:ci` | Lint que só falha com problema novo (base em `scripts/lint-baseline.json`) |
| `npm run import:cards` | Importa um backlog em Markdown para um quadro de Projetos |
| `npm run cards` | CLI da fila de desenvolvimento (ver abaixo) |
| `npm run generate:maps` | Gera os mapas de arquitetura e do fluxo de login (em `docs/`) |
| `npm run generate:architecture-map` | Só o mapa de arquitetura |
| `npm run generate:auth-flow-map` | Só o mapa do fluxo de login |

O script `prepare` liga o hook de pre-commit quando a pasta é um repositório git.

## Qualidade (CI)

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em todo push e pull request na `main`, com Node 22 (`.nvmrc`):

| Passo | Comando local |
|---|---|
| Segredos no histórico | `gitleaks git --redact` |
| Tipos | `npx tsc -b` |
| Lint sem problemas novos | `npm run lint:ci` |
| Tipos do banco em dia (com o segredo `SUPABASE_ACCESS_TOKEN`) | `npm run gen:types -- --check` |
| Testes com cobertura | `npm run test:coverage` |
| Build | `npx vite build` |
| E2E contra o staging (job separado, com os secrets do staging) | `npm run test:e2e` |

Outros workflows: **Supabase drift** (push na `main` em `supabase/`, toda segunda e manual; `npm run drift`) e **Deploy function** (manual, uma function por vez, para o staging ou a produção).

- **Testes sem segredos:** o `vite.config.ts` injeta um Supabase fictício no Vitest (`test.env`), que vence o `.env.local`. A suíte roda igual no CI e na sua máquina, e nunca aponta para o projeto real.
- **Catraca do lint:** o projeto tem problemas de lint antigos, contados por arquivo e regra em `scripts/lint-baseline.json`. O `lint:ci` falha se aparecer um problema novo. Quando você corrigir algum, rode `npm run lint:ci -- --update` para baixar a base (ele recusa se houver piora). `npm run lint` continua mostrando tudo.
- **Segredos:**
  - **O que é varrido:** o gitleaks usa as regras padrão mais o token pessoal da API de cards (`.gitleaks.toml`).
  - **CI:** varre todo o histórico, com o binário em versão e sha256 fixados. Um achado antigo, já rotacionado, pode ir para o `.gitleaksignore`, pelo fingerprint.
  - **Hook de pre-commit:** `.githooks/pre-commit`, ativado sozinho na instalação das dependências dentro de um repositório git. Ele roda o gitleaks nos arquivos staged, e sem o gitleaks instalado (`brew install gitleaks`) só avisa.
  - **Testes do TestSprite:** a credencial literal neles é barrada pelo `npm test` (veja [`testsprite_tests/README.md`](testsprite_tests/README.md)).

## Supabase

- **Migrations** em `supabase/migrations/`: o histórico do schema, das políticas RLS e das funções. Em produção, cada migration passa por um dry-run numa transação desfeita antes de ser aplicada.
- **Regras de acesso:** a matriz RLS, tabela por tabela, está em [`docs/matriz-rls.md`](docs/matriz-rls.md).
- **Scripts de verificação** em `supabase/checks/`: rodam numa transação desfeita, com IDs fictícios, e conferem regras de acesso direto no banco.
- **Edge functions** em `supabase/functions/`, com código comum (CORS, Sentry, limpeza de dados sensíveis) em `_shared/`:

| Função | O que faz |
|---|---|
| `admin-ops` | Operações de administrador sobre contas, registradas no `audit_log` |
| `site-backup` | Backups do banco: manual, com JWT de admin, e automático, pelo cron |
| `cards-api` | API da fila de desenvolvimento, autenticada por token pessoal (`akool_pat_…`) |

As edges de IA (`ai-chat`, `analyze-transaction-photo`, `categorize-transactions` e `study-lookup`) saíram em 01/10/2026 (SEC-015): nenhuma tela as usava.

## Ambientes

| | Produção | Staging |
|---|---|---|
| Projeto Supabase | `nhfftophadasiezrzlsv` | `akool-staging` (`ixqpkmxmgftchgwbrogw`, plano free) |
| Configuração | `.env.local` | `.env.staging.local`, por cima do `.env.local` ([exemplo](.env.staging.example)) |
| Rodar o app | `npm run dev` | `npm run dev:staging` |
| Testes E2E e TestSprite | **nunca** | sim, com um usuário de teste sem admin |

- **Montar/remontar o staging:** `npm run staging:reset` aplica as migrations do repo do zero, desliga o cron de backup e publica as functions.
  - Precisa de `SUPABASE_ACCESS_TOKEN` (token pessoal) e `STAGING_PROJECT_REF` no `.env.local`.
  - O script **recusa o ref da produção**.
- **Travas:** o Playwright (`playwright.config.ts`) e o `staging:reset` se recusam a rodar contra a produção.
- **Usuário de teste:** criado no painel do staging (Authentication → Add user). As credenciais ficam em `E2E_USER`/`E2E_PASSWORD`, no `.env.staging.local` e nos secrets do GitHub.
- **Projeto free:** pausa depois de ~7 dias sem uso. Reative no painel antes de rodar o E2E.

## Supabase local

Um Postgres/Auth/Storage na sua máquina, para testar migrations e o app sem tocar em nada remoto (DEV-006). Precisa do **Docker Desktop**.

1. `npx supabase start` sobe a stack e mostra a URL da API (`http://127.0.0.1:54321`) e a anon key local. `npx supabase status` mostra de novo.
2. `npx supabase db reset` recria o banco local: a baseline, todas as migrations de `supabase/migrations/` e o [`supabase/seed.sql`](supabase/seed.sql).
3. **App:** copie [`.env.localdb.example`](.env.localdb.example) para `.env.localdb.local`, cole a anon key e rode `npm run dev:localdb`.
4. **Functions (opcional):** copie [`supabase/functions/.env.example`](supabase/functions/.env.example) para `supabase/functions/.env` e rode `npx supabase functions serve --env-file supabase/functions/.env`.

Usuários do seed (senhas fictícias, só locais):

| E-mail | Senha | Papel |
|---|---|---|
| `admin@akool.test` | `local-admin-123` | admin |
| `pessoa@akool.test` | `local-user-123` | comum, com página, quadro e financeiro de exemplo |

Para cadastrar outra pessoa pela tela, use o convite `LOCAL-CONVITE`. O Studio local fica em http://127.0.0.1:54323 e os e-mails de teste em http://127.0.0.1:54324.

O seed só roda no banco local: o `npm run staging:reset` não o lê, e a produção nunca recebe seed.

## Deploy

Produção roda no **Coolify**, com Nixpacks e Caddy:
- o [`nixpacks.toml`](nixpacks.toml) fixa o Node 22, instala com `npm ci`, gera o `dist/` e define o Caddyfile, com fallback de SPA, cache dos assets e headers de segurança;
- as variáveis `VITE_*` entram no bundle na hora do build, então precisam estar marcadas como *Build Variable* no Coolify;
- o Sentry do frontend usa `VITE_SENTRY_DSN`, e o upload de source maps usa `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT`.

O passo a passo, com a checagem pós-deploy, está em [`docs/deploy-coolify.md`](docs/deploy-coolify.md). O Netlify não é mais usado.

## Fila de desenvolvimento

O desenvolvimento segue um quadro de Projetos que funciona como fila, em fases: avaliação, plano, desenvolvimento, validação e "aguardando você".
- **CLI:** `npm run cards -- <comando>` (por exemplo, `next --count=3`, `card <ID>` e `complete <ID>`). `npm run cards` sem comando mostra a ajuda.
- **Token:** a CLI precisa de `AKOOL_API_TOKEN` no `.env.local`. Ele é gerado em Configurações → API, e o banco só guarda o hash.
- **Backlogs:** entram pelo Projetos → Importar, ou por `npm run import:cards`, no formato de [`docs/imports/`](docs/imports/).

## Documentação

- [`docs/deploy-coolify.md`](docs/deploy-coolify.md): deploy, variáveis e checagem pós-deploy
- [`docs/matriz-rls.md`](docs/matriz-rls.md): quem lê e escreve o quê, tabela por tabela
- [`docs/plano-execucao.md`](docs/plano-execucao.md): roadmap de execução do backlog, por risco
- [`docs/Design System Akool.md`](<docs/Design System Akool.md>): backlog de system design, no formato de importação
- [`docs/imports/`](docs/imports/): backlogs no formato de importação
- [`src/modules/finance/README.md`](src/modules/finance/README.md): limites e estrutura do módulo financeiro
