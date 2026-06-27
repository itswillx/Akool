# Backlog Excalinotion — Segurança & Performance

> 21 cards · BacklogCard v1 · Importar via Projects → Importar

Mapeamento baseado nos riscos mais comuns do mercado (OWASP Top 10 2025 — Broken Access
Control + Security Misconfiguration no topo) e no caso real do canal **YuriRDev** (invasão
de plataforma Supabase com **RLS desligado**, expondo tabelas inteiras pela chave `anon`
pública). Auditoria feita sobre o código atual deste repositório.

Categorias: **SEC** (Segurança) · **PERF** (Performance) · **INFRA** (Infra/DevOps) · **BUG** (Bugs).

---

## Tópico: SEC — Segurança

---

### CARD SEC-001 — Auditar e garantir RLS em todas as tabelas

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-001                                |
| **Prioridade** | P0                                     |
| **Esforço**    | L                                      |
| **Labels**     | seguranca, rls, owasp, broken-access   |
| **Arquivos**   | `supabase/migrations/`, `src/lib/supabaseClient.ts` |

**Problema:** A chave `anon` é pública por design (vai no bundle do browser). Se uma tabela não tiver RLS habilitado + política dona-do-registro, qualquer pessoa lê/escreve direto via REST — exatamente a falha do vídeo do YuriRDev. Hoje só `site_backups`/`site_backup_settings` têm RLS versionado; `pages`, `page_shares`, `note_contents`, `drawing_contents`, `todos`, `project_*`, `finance_*` e `profiles` não têm políticas no Git.

**Subtarefas Kanban:**

- [ ] Listar todas as tabelas e checar `rowsecurity` no Supabase (SQL: `select tablename, rowsecurity from pg_tables where schemaname='public'`)
- [ ] Habilitar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` em toda tabela sem RLS
- [ ] Criar política de SELECT/INSERT/UPDATE/DELETE escopada por `auth.uid()` (dono) em cada tabela de usuário
- [ ] Tratar tabelas compartilhadas (`page_shares`, `project_shares`) com política que respeita o papel
- [ ] Testar como invasor: chamar a REST API com a chave anon e o id de outro usuário — deve retornar vazio/403
- [ ] Garantir que `profiles` não exponha `ai_api_key`/`role` de terceiros
- [ ] Documentar a matriz tabela × política no repositório

---

### CARD SEC-002 — Autorização server-side em escrita de pages/shares

| Campo          | Valor                                              |
| -------------- | -------------------------------------------------- |
| **ID**         | SEC-002                                            |
| **Prioridade** | P0                                                 |
| **Esforço**    | M                                                  |
| **Labels**     | seguranca, autorizacao, broken-access              |
| **Arquivos**   | `[PagesContext.tsx](src/contexts/PagesContext.tsx)`, `[SharePageModal.tsx](src/components/SharePageModal.tsx)` |

**Problema:** `updatePage`, `deletePage` e `handleRoleChange` mandam o write direto pro banco sem checar papel no servidor — a checagem `canEdit` existe só no client. Sem RLS que imponha dono/editor, um usuário autenticado pode editar/excluir página de outro ou alterar permissões de share.

**Subtarefas Kanban:**

- [ ] Mapear todos os writes que dependem só de checagem no client
- [ ] Garantir política RLS de UPDATE/DELETE em `pages` que exige owner/co_owner/editor
- [ ] Garantir política em `page_shares` que só o dono da página altera/remove shares
- [ ] Remover confiança em `canEdit` client-side como única barreira
- [ ] Testar: usuário sem permissão tentando `update`/`delete` deve falhar no banco
- [ ] Cobrir com teste de regressão

---

### CARD SEC-003 — Hardening de IDOR em páginas compartilhadas e públicas

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-003                                |
| **Prioridade** | P1                                     |
| **Esforço**    | M                                      |
| **Labels**     | seguranca, idor, sharing               |
| **Arquivos**   | `[PagesContext.tsx](src/contexts/PagesContext.tsx)`, `[SharePageModal.tsx](src/components/SharePageModal.tsx)` |

**Problema:** A herança de papel em páginas-filhas (`walkShared`) é calculada só no client. Links públicos/compartilhados precisam ser inadivinháveis e não vazar dados privados ao acessar um id diretamente (IDOR — OWASP A01).

**Subtarefas Kanban:**

- [ ] Confirmar que ids de página/share são UUID (não sequenciais/adivinháveis)
- [ ] Validar herança de papel pai→filho também no servidor (RLS), não só no client
- [ ] Testar acesso direto ao id de página de outro usuário sem share — deve negar
- [ ] Garantir que página "pública" expõe só conteúdo, nunca dados de outros usuários/owner
- [ ] Revisar tokens de link público (rotação/expiração se existirem)

---

### CARD SEC-004 — Proteger chaves de IA (ai_api_key) em texto plano

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-004                                |
| **Prioridade** | P1                                     |
| **Esforço**    | M                                      |
| **Labels**     | seguranca, secrets, ia                 |
| **Arquivos**   | `supabase/functions/ai-chat/index.ts`, `supabase/migrations/` |

**Problema:** `profiles.ai_api_key` é lido em texto plano pela edge function `ai-chat` (via service role) e enviado a provedores externos. Se o banco/backup vazar, todas as chaves de IA dos usuários vazam junto.

**Subtarefas Kanban:**

- [ ] Criptografar `ai_api_key` em repouso (pgsodium/Vault) ou mover para Supabase secrets
- [ ] Restringir acesso à coluna via privilégios/política (nunca expor ao client)
- [ ] Garantir que a coluna nunca entra em `select('*')` mandado ao frontend
- [ ] Excluir/mascarar `ai_api_key` dos dumps de backup
- [ ] Validar consentimento do usuário antes de enviar histórico ao provedor de IA

---

### CARD SEC-005 — Rotacionar e validar segredos (git history)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-005                                |
| **Prioridade** | P1                                     |
| **Esforço**    | S                                      |
| **Labels**     | seguranca, secrets, devops             |
| **Arquivos**   | `[.env.example](.env.example)`, `[.gitignore](.gitignore)` |

**Problema:** A chave `anon` no bundle é normal (publicável). O risco é a `service_role` e segredos de edge function (`BACKUP_CRON_SECRET`, `GOOGLE_CLIENT_SECRET`) vazarem. Precisa confirmar que nenhum segredo server-side foi commitado e que `service_role` nunca chega ao client.

**Subtarefas Kanban:**

- [ ] `git log` / scan no histórico por `.env`, `service_role`, tokens (ex.: gitleaks/trufflehog)
- [ ] Confirmar que `service_role` só aparece em edge functions / CLI, nunca em `VITE_*`
- [ ] Rotacionar `BACKUP_CRON_SECRET` e service role se houver suspeita de exposição
- [ ] Confirmar `.env` no `.gitignore` (já está) e documentar fluxo de segredos
- [ ] Mover `IMPORT_USER_PASSWORD` do `.env.example` para fluxo seguro / nota clara

---

### CARD SEC-006 — CORS fail-closed nas edge functions

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-006                                |
| **Prioridade** | P2                                     |
| **Esforço**    | S                                      |
| **Labels**     | seguranca, cors, misconfig             |
| **Arquivos**   | `supabase/functions/site-backup/index.ts`, `supabase/functions/ai-chat/index.ts` |

**Problema:** `ALLOWED_ORIGINS` tem fallback hardcoded; se a env não estiver setada em produção, o fallback pode liberar origens demais. Security Misconfiguration é o #2 do OWASP 2025.

**Subtarefas Kanban:**

- [ ] Tornar CORS fail-closed: sem `ALLOWED_ORIGINS` válido ⇒ negar, não liberar geral
- [ ] Validar a origem antes de responder preflight
- [ ] Listar origens de produção explicitamente (sem `*`)
- [ ] Repetir a checagem na função `ai-chat`
- [ ] Testar request de origem não-autorizada — deve ser bloqueado

---

### CARD SEC-007 — Validação de entrada (import de cards e share)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-007                                |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | seguranca, validacao, owasp            |
| **Arquivos**   | `[importProjectCards.ts](src/lib/importProjectCards.ts)`, `[backlogMarkdownParser.ts](src/lib/backlogMarkdownParser.ts)`, `[SharePageModal.tsx](src/components/SharePageModal.tsx)` |

**Problema:** O servidor não pode confiar na requisição do client (OWASP — validação inadequada). Import de `.md` e share por email precisam de limites e validação no servidor, não só no front.

**Subtarefas Kanban:**

- [ ] Limitar tamanho do `.md` / número máximo de cards no import
- [ ] Validar/normalizar campos do card (prioridade, esforço, labels) antes de inserir
- [ ] Validar formato de email no share e existência do usuário no servidor
- [ ] Tratar conteúdo de card como dado (sem render de HTML cru no futuro)
- [ ] Mensagens de erro sem vazar detalhes internos

---

### CARD SEC-008 — Minimizar exposição de dados sensíveis

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-008                                |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | seguranca, data-exposure, owasp        |
| **Arquivos**   | `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)`, `[FinancePanel.tsx](src/components/FinancePanel.tsx)` |

**Problema:** OWASP alerta sobre exposição excessiva de dados — o backend mandar mais do que o necessário e confiar ao front a filtragem. Há `select('*')` e joins de `profiles` (email de terceiros) que vão inteiros ao client.

**Subtarefas Kanban:**

- [ ] Trocar `select('*')` por colunas específicas nas queries que vão ao client
- [ ] Não enviar email/dados de outros usuários além do necessário (ex.: só display_name)
- [ ] Revisar joins de `profiles` em cards/finance para mínimo necessário
- [ ] Garantir que campos sensíveis (`ai_api_key`, `role`) nunca saem nos selects
- [ ] Conferir respostas das edge functions por over-fetching

---

## Tópico: PERF — Performance

---

### CARD PERF-001 — Virtualização de listas grandes (Kanban e Gantt)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-001                               |
| **Prioridade** | P2                                     |
| **Esforço**    | L                                      |
| **Labels**     | performance, rendering, virtualization |
| **Arquivos**   | `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)`, `[GanttView.tsx](src/components/GanttView.tsx)` |

**Problema:** Colunas Kanban e linhas do Gantt renderizam todos os nós no DOM (200+ cards = travamento ao rolar). Sem virtualização, a fluidez cai de 60fps para ~15fps.

**Subtarefas Kanban:**

- [ ] Introduzir virtualização (react-window/virtua) nas colunas do Kanban
- [ ] Virtualizar linhas do Gantt (painel esquerdo + timeline)
- [ ] Garantir compatibilidade com drag-and-drop (dnd-kit) virtualizado
- [ ] Medir com 300+ cards antes/depois (DevTools Performance)
- [ ] Aplicar mesma ideia em listas longas de transações no Finance

---

### CARD PERF-002 — Paginação e limites nas queries Supabase

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-002                               |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | performance, supabase, data-fetching   |
| **Arquivos**   | `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)`, `[FinancePanel.tsx](src/components/FinancePanel.tsx)` |

**Problema:** Cards e transações são buscados com `select('*')` sem `.limit()`/paginação. Com muitos registros, todo o dataset entra em memória; o Finance dispara 12+ queries `select('*')` no load.

**Subtarefas Kanban:**

- [ ] Adicionar `.limit()` + paginação (range) em cards e transações
- [ ] Trocar `select('*')` por colunas necessárias
- [ ] Consolidar/reduzir as 12+ queries paralelas do Finance onde possível
- [ ] Carregar dados por board/conta sob demanda (lazy)
- [ ] Medir tempo de cold load antes/depois

---

### CARD PERF-003 — Memoização e quebra de componentes gigantes

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-003                               |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | performance, react, rendering          |
| **Arquivos**   | `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)` |

**Problema:** `ProjectsPanel` tem ~2.4k linhas com subcomponentes inline e estilos `style={{}}` recriados a cada render. Qualquer mudança de estado (ex.: filtro) re-renderiza toda a árvore de cards.

**Subtarefas Kanban:**

- [ ] Extrair card/coluna em componentes próprios com `React.memo`
- [ ] Estabilizar handlers com `useCallback` e estilos com constantes/`useMemo`
- [ ] Memoizar listas derivadas (já existe em `cardsByColumn`, replicar nas demais)
- [ ] Evitar criação de objetos/arrays inline no render de listas
- [ ] Medir re-renders com React DevTools Profiler

---

### CARD PERF-004 — Otimizar payload de autosave

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-004                               |
| **Prioridade** | P3                                     |
| **Esforço**    | M                                      |
| **Labels**     | performance, autosave                  |
| **Arquivos**   | `src/components/DrawingCanvas.tsx`, `src/components/NoteEditor.tsx` |

**Problema:** O autosave serializa a cena inteira do Excalidraw (2s) e o documento BlockNote inteiro (1s) a cada edição. Em cenas/docs grandes, são upserts pesados e frequentes.

**Subtarefas Kanban:**

- [ ] Revisar debounce (subir para janela maior em payloads grandes)
- [ ] Evitar reserializar quando não houve mudança real (dirty-check)
- [ ] Avaliar salvar diff/parcial em vez do documento inteiro
- [ ] Comprimir payloads grandes antes do upsert
- [ ] Medir tamanho médio do payload e frequência

---

### CARD PERF-005 — Revisar code-splitting e bundle

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-005                               |
| **Prioridade** | P3                                     |
| **Esforço**    | M                                      |
| **Labels**     | performance, bundle, vite              |
| **Arquivos**   | `[vite.config.ts](vite.config.ts)` |

**Problema:** Excalidraw e BlockNote/Mantine são pesados. `chunkSizeWarningLimit: 800` está alto e pode mascarar chunks problemáticos. Conferir que tudo grande é lazy-loaded.

**Subtarefas Kanban:**

- [ ] Confirmar `React.lazy`/`import()` dinâmico para Excalidraw e editor
- [ ] Rodar `vite build` + analisar bundle (rollup-plugin-visualizer)
- [ ] Reduzir `chunkSizeWarningLimit` e tratar avisos reais
- [ ] Avaliar tree-shaking do Mantine
- [ ] Medir tamanho do bundle inicial antes/depois

---

### CARD PERF-006 — Debounce e cleanup de subscriptions realtime

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-006                               |
| **Prioridade** | P3                                     |
| **Esforço**    | S                                      |
| **Labels**     | performance, realtime, supabase        |
| **Arquivos**   | `src/hooks/useCollaborativeContent.ts` |

**Problema:** Cada abertura de página cria uma subscription nova; trocas rápidas de página podem acumular canais antes do cleanup, e `setRemoteContent` dispara sem debounce.

**Subtarefas Kanban:**

- [ ] Garantir `removeChannel` no cleanup em troca rápida de página
- [ ] Adicionar debounce/throttle no `setRemoteContent`
- [ ] Evitar múltiplas subscriptions simultâneas para a mesma página
- [ ] Testar trocando rapidamente entre 10+ páginas (sem leak de canal)

---

## Tópico: INFRA — Infraestrutura / DevOps

---

### CARD INFRA-001 — RLS e schema versionados em migrations

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | INFRA-001                              |
| **Prioridade** | P1                                     |
| **Esforço**    | M                                      |
| **Labels**     | infra, supabase, migrations, rls       |
| **Arquivos**   | `supabase/migrations/` |

**Problema:** A lição do YuriRDev: se as políticas de RLS não estão no Git, ninguém revisa e regressões passam silenciosas. Hoje a maioria das tabelas não tem schema/políticas versionados.

**Subtarefas Kanban:**

- [ ] Exportar schema + políticas atuais (`supabase db pull` / dump) para migrations
- [ ] Versionar políticas de RLS de todas as tabelas (saída do SEC-001)
- [ ] Garantir que ambiente novo sobe com RLS correto a partir das migrations
- [ ] Adicionar checagem em CI de que nenhuma tabela nova vai sem RLS
- [ ] Documentar processo de migration no repositório

---

### CARD INFRA-002 — CI: lint, typecheck, testes e audit

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | INFRA-002                              |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | infra, ci, qualidade                   |
| **Arquivos**   | `[package.json](package.json)` |

**Problema:** Sem CI, regressões de segurança/qualidade entram sem barreira. Falta gate automático de lint, types, testes e auditoria de dependências.

**Subtarefas Kanban:**

- [ ] Criar workflow CI (GitHub Actions) com `lint` + `tsc --noEmit` + `vitest run`
- [ ] Adicionar `npm audit` (falhar em high/critical)
- [ ] Rodar scan de segredos (gitleaks) no CI
- [ ] Bloquear merge se o pipeline falhar
- [ ] Documentar como rodar o pipeline localmente

---

### CARD INFRA-003 — Backups: criptografia e restore transacional

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | INFRA-003                              |
| **Prioridade** | P2                                     |
| **Esforço**    | M                                      |
| **Labels**     | infra, backup, data-integrity          |
| **Arquivos**   | `supabase/functions/site-backup/index.ts` |

**Problema:** Backups são gzip mas **não criptografados** (dump completo do banco legível se o bucket vazar). O `restoreBackup` apaga tabelas e insere sem transação — se interromper no meio, há perda de dados.

**Subtarefas Kanban:**

- [ ] Criptografar o backup em repouso antes do upload
- [ ] Restringir/revisar ACL do bucket `site-backups`
- [ ] Tornar o restore atômico (transação / staging + swap)
- [ ] Excluir/mascarar segredos (`ai_api_key`) do dump
- [ ] Testar restore parcial interrompido (não pode corromper dados)

---

### CARD INFRA-004 — Observabilidade e logs estruturados

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | INFRA-004                              |
| **Prioridade** | P3                                     |
| **Esforço**    | M                                      |
| **Labels**     | infra, observabilidade, logs           |
| **Arquivos**   | `supabase/functions/` |

**Problema:** Sem rastreio de erros centralizado, falhas em produção (inclusive de segurança) passam despercebidas.

**Subtarefas Kanban:**

- [ ] Integrar error tracking no front (ex.: Sentry)
- [ ] Logs estruturados nas edge functions (sem vazar segredos/PII)
- [ ] Alertas para erros de autorização/5xx
- [ ] Painel mínimo de saúde (latência, taxa de erro)

---

### CARD INFRA-005 — Gestão de segredos no deploy (Coolify/Nixpacks)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | INFRA-005                              |
| **Prioridade** | P2                                     |
| **Esforço**    | S                                      |
| **Labels**     | infra, deploy, secrets                 |
| **Arquivos**   | `[docs/deploy-coolify.md](docs/deploy-coolify.md)`, `[nixpacks.toml](nixpacks.toml)` |

**Problema:** `VITE_*` é embutido em build time no bundle — qualquer segredo "VITE_" vira público. Precisa garantir que só chaves publicáveis sejam `VITE_*` e que `service_role`/secrets fiquem só no runtime das edge functions.

**Subtarefas Kanban:**

- [ ] Confirmar que apenas `anon`/publicáveis são `VITE_*` (build var)
- [ ] Garantir `service_role` e segredos só no runtime server-side (nunca no build do front)
- [ ] Documentar no `docs/deploy-coolify.md` quais vars são build vs runtime
- [ ] Revisar `nixpacks.toml` por exposição acidental de env

---

## Tópico: BUG — Bugs encontrados na auditoria

---

### CARD BUG-001 — Edge function admin-ops ausente (404)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | BUG-001                                |
| **Prioridade** | P1                                     |
| **Esforço**    | S                                      |
| **Labels**     | bug, admin, seguranca                  |
| **Arquivos**   | `[UserManagementPanel.tsx](src/components/UserManagementPanel.tsx)` |

**Problema:** O painel chama `/functions/v1/admin-ops` (`list_users`, `ban_user`, `delete_user`), mas não existe função `admin-ops` em `supabase/functions/`. As operações falham com 404 — ou, se alguém criar a função fora do versionamento, podem ficar desprotegidas.

**Subtarefas Kanban:**

- [ ] Decidir: implementar `admin-ops` versionada ou remover as chamadas
- [ ] Se implementar: verificar `auth.uid()` + `role='admin'` no servidor (service client)
- [ ] Tratar erro 404/ausência de função no client (mensagem clara)
- [ ] Testar ban/delete/list com usuário não-admin (deve negar no servidor)
- [ ] Versionar a função em `supabase/functions/`

---

### CARD BUG-002 — key={i} em listas causa bug de reorder

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | BUG-002                                |
| **Prioridade** | P3                                     |
| **Esforço**    | S                                      |
| **Labels**     | bug, react, rendering                  |
| **Arquivos**   | `[ProjectsPanel.tsx](src/components/ProjectsPanel.tsx)` |

**Problema:** Listas de labels/itens usam `key={i}` (índice). Ao reordenar/remover, o React casa nós errados, causando estado/visual inconsistente.

**Subtarefas Kanban:**

- [ ] Trocar `key={i}` por chave estável (id/valor) nos `.map` de labels e itens
- [ ] Revisar demais `.map` com índice como key no arquivo
- [ ] Testar reordenação/remoção de labels sem inconsistência
