# Backlog Akool — Avaliação completa 2026-08

> 80 cards · BacklogCard v1 · Importar via Documentos → Projetos → Importar
> Substitui os backlogs de 2026-06 (`backlog-*.md`): itens já feitos foram removidos,
> parciais foram reescritos só com o que resta, e ~35 achados novos das auditorias de
> 2026-08-07 foram incorporados. Numeração reiniciada — importar em quadro novo.
>
> **Índice por urgência**
> P0 (3): SEC-001, SEC-002, REL-001
> P1 (23): SEC-003..009 · ARCH-001..002 · PERF-001..006 · UX-001..003 · REL-002..003 · DEV-001 · QA-001..002
> P2 (39): SEC-010..013 · ARCH-003..009 · PERF-007..013 · UX-004..009 · REL-004..008 · DEV-002..005 · QA-003..008
> P3 (15): SEC-014 · ARCH-010..012 · PERF-014..016 · UX-010..011 · DEV-006 · QA-009..013
>
> Já resolvidos (não entram): segredos de IA isolados em `profile_secrets`,
> `supabase/config.toml`, mojibake do PageHeader, CI GitHub Actions, gitignore de
> artefatos de deploy, paths duplicados no Git.

## Tópico: Segurança

---

### CARD SEC-001 — Versionar baseline completo do schema, RLS e functions

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | SEC-001                                      |
| **Prioridade** | P0                                           |
| **Esforço**    | L                                            |
| **Labels**     | segurança, supabase, migrations              |
| **Arquivos**   | `supabase/migrations/`, `supabase/functions/` |

**Problema:** `supabase/migrations/README.md` admite que ~55 migrações antigas nunca tiveram arquivo — `pages`, `page_shares`, `project_shares`, `project_boards/cards`, `profiles` base e `invite_codes` existem só no projeto remoto, então a fronteira real de segurança (RLS) não é auditável nem reproduzível.

**Subtarefas Kanban:**

- [ ] Gerar baseline com `supabase db dump` (schema + policies + functions + triggers)
- [ ] Exportar as storage policies de todos os buckets para migration
- [ ] Verificar no dump se `page_shares`/`project_shares` impedem o destinatário de auto-promover o próprio `role`
- [ ] Documentar matriz role × tabela × operação
- [ ] Adicionar check de drift de migração no CI (falha se remoto ≠ repo)
- [ ] Habilitar `supabase db reset` local completo a partir do baseline

---

### CARD SEC-002 — Corrigir injeção de wildcard na RPC search_users_for_share

| Campo          | Valor                                                        |
| -------------- | ------------------------------------------------------------ |
| **ID**         | SEC-002                                                      |
| **Prioridade** | P0                                                           |
| **Esforço**    | S                                                            |
| **Labels**     | segurança, supabase, rpc                                     |
| **Arquivos**   | `supabase/migrations/20260727160000_profile_avatars.sql`, `src/lib/profileSearch.ts` |

**Problema:** A RPC interpola `p_term` cru no `ilike` (`'%' || trim(p_term) || '%'`, linha 76) — um POST direto com `p_term="%a%"` passa a guarda de 3 caracteres e enumera e-mail, nome e avatar de todos os usuários, derrotando a policy restritiva de profiles; a sanitização do cliente é bypassável.

**Subtarefas Kanban:**

- [ ] Escapar `%`, `_` e `\` dentro da RPC (`replace` ou `like ... escape`)
- [ ] Nova migration com a função corrigida + reconceder grants
- [ ] Adicionar `_` à sanitização do cliente (`sanitizeIlikeTerm`) por defesa em profundidade
- [ ] Trocar a interpolação do único filtro `.or()` concatenado do cliente (`FinancePanel.tsx:263`) por filtros estruturados
- [ ] Testar via REST direto que `%`/`_` não funcionam mais como curinga

---

### CARD SEC-003 — Adicionar fonte da edge function admin-ops ao repositório

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | SEC-003                                |
| **Prioridade** | P1                                     |
| **Esforço**    | S                                      |
| **Labels**     | segurança, edge-functions, admin       |
| **Arquivos**   | `supabase/functions/`, `src/components/UserManagementPanel.tsx` |

**Problema:** `UserManagementPanel.tsx:41` chama `/functions/v1/admin-ops` (ban/unban, delete de usuário), mas a fonte não está em `supabase/functions/` — o código que roda com service_role não é auditável nem versionado.

**Subtarefas Kanban:**

- [ ] Baixar a fonte da função do projeto remoto
- [ ] Commitar em `supabase/functions/admin-ops/`
- [ ] Revisar: validação de JWT + checagem de admin antes do client service_role
- [ ] Padronizar CORS com as demais funções
- [ ] Incluir no pipeline de deploy de functions (ver DEV-001)

---

### CARD SEC-004 — Restringir leitura dos buckets de imagens por dono/compartilhamento

| Campo          | Valor                                                    |
| -------------- | -------------------------------------------------------- |
| **ID**         | SEC-004                                                  |
| **Prioridade** | P1                                                       |
| **Esforço**    | L                                                        |
| **Labels**     | segurança, storage, supabase                             |
| **Arquivos**   | `supabase/migrations/20260708140000_sec_private_buckets.sql` |

**Problema:** As policies de `note-images`, `project-card-images` e `avatars` liberam SELECT para qualquer autenticado (`using (bucket_id = '...')`) — um convidado lista e assina URL de qualquer imagem de nota/card de outros usuários, mesmo sem compartilhamento.

**Subtarefas Kanban:**

- [ ] Desenhar policy que amarre o path (`storage.foldername(name)[1]`) ao dono
- [ ] Estender para leitores legítimos via `page_shares`/`project_shares`
- [ ] Avaliar impacto: imagens em páginas compartilhadas precisam continuar visíveis ao destinatário
- [ ] Migration + teste com dois usuários (dono, compartilhado, terceiro)
- [ ] `avatars` pode permanecer legível por autenticados (decisão explícita, documentar)

---

### CARD SEC-005 — Validar tipo e tamanho de uploads (cliente + buckets)

| Campo          | Valor                                                            |
| -------------- | ---------------------------------------------------------------- |
| **ID**         | SEC-005                                                          |
| **Prioridade** | P1                                                               |
| **Esforço**    | M                                                                |
| **Labels**     | segurança, storage, uploads                                      |
| **Arquivos**   | `src/components/NoteEditor.tsx`, `src/modules/finance/ui/AttachmentField.tsx`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** `NoteEditor.tsx:140` sobe qualquer arquivo ecoando o MIME declarado pelo cliente (`contentType: file.type`), `AttachmentField` não checa tipo nem tamanho, e nenhum bucket além de `site-backups` define `file_size_limit`/`allowed_mime_types` — um `text/html` num bucket legível por todo autenticado é superfície de XSS/phishing, e não há teto de consumo de storage.

**Subtarefas Kanban:**

- [ ] Definir allowlist de MIME e tamanho máximo por contexto (imagem de nota/card, anexo financeiro, avatar)
- [ ] Aplicar validação no cliente antes do upload (tipo + bytes)
- [ ] Migration setando `file_size_limit` e `allowed_mime_types` em cada bucket
- [ ] Derivar extensão de allowlist, não do nome do arquivo
- [ ] Mensagem de erro amigável quando recusar (i18n pt/en)

---

### CARD SEC-006 — Tornar a desativação de conta efetiva no servidor

| Campo          | Valor                                   |
| -------------- | --------------------------------------- |
| **ID**         | SEC-006                                 |
| **Prioridade** | P1                                      |
| **Esforço**    | M                                       |
| **Labels**     | segurança, auth, rls                    |
| **Arquivos**   | `src/contexts/AuthContext.tsx`, `src/App.tsx` |

**Problema:** `is_active` só é checado pelo cliente no signIn (`AuthContext.tsx:137` → signOut) — quem já tem refresh token válido ou fala direto com `/rest/v1` segue lendo e escrevendo tudo; `last_login_date`, que alimenta o logout diário, também é gravado pelo próprio cliente.

**Subtarefas Kanban:**

- [ ] Confirmar no schema remoto se alguma policy referencia `is_active` (nada no repo referencia)
- [ ] Adicionar checagem server-side (policy helper `is_active()` nas tabelas principais, ou ban via `admin-ops` usando o ban nativo do GoTrue)
- [ ] Revogar sessões ativas ao desativar (admin API `signOut` do usuário)
- [ ] Checar `is_active` também em `getSession`/`onAuthStateChange`, não só no signIn
- [ ] Mover `last_login_date` para trigger/RPC server-side ou aceitar como conveniência documentada

---

### CARD SEC-007 — Mover toggleRole para edge function com audit trail

| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| **ID**         | SEC-007                                    |
| **Prioridade** | P1                                         |
| **Esforço**    | M                                          |
| **Labels**     | segurança, admin, edge-functions           |
| **Arquivos**   | `src/components/UserManagementPanel.tsx`   |

**Problema:** `UserManagementPanel.tsx:212` ainda troca `profiles.role` com update direto do cliente (ban/unban já migrou para a edge `admin-ops`) e nenhuma ação administrativa deixa rastro de auditoria.

**Subtarefas Kanban:**

- [ ] Adicionar operação `set_role` na edge `admin-ops`
- [ ] Remover o update direto do cliente
- [ ] Criar tabela `admin_audit_log` (quem, o quê, quando, alvo)
- [ ] Registrar ban/unban/delete/set_role no log
- [ ] Exibir o log no painel admin (somente leitura)

---

### CARD SEC-008 — Rate limiting em RPCs e edge functions

| Campo          | Valor                              |
| -------------- | ---------------------------------- |
| **ID**         | SEC-008                            |
| **Prioridade** | P1                                 |
| **Esforço**    | M                                  |
| **Labels**     | segurança, rpc, edge-functions     |
| **Arquivos**   | `supabase/functions/`, `supabase/migrations/` |

**Problema:** Nenhuma RPC nem edge function tem limite de taxa (zero 429 no código) — `validate_invite_code` e `search_users_for_share` podem ser marteladas por força bruta/enumeração, e as functions de IA consomem quota de terceiros sem freio.

**Subtarefas Kanban:**

- [ ] Definir estratégia (tabela de contadores por usuário/IP + janela, ou limite no gateway)
- [ ] Aplicar em `validate_invite_code` com log de tentativas inválidas
- [ ] Aplicar em `search_users_for_share`
- [ ] Aplicar nas edge functions de IA (`ai-chat`, `analyze-transaction-photo`)
- [ ] Resposta 429 com retry-after e mensagem tratada no cliente

---

### CARD SEC-009 — Criptografar tokens OAuth e auditar operações com service role

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | SEC-009                                      |
| **Prioridade** | P1                                           |
| **Esforço**    | M                                            |
| **Labels**     | segurança, oauth, edge-functions             |
| **Arquivos**   | `supabase/functions/google-calendar/index.ts` |

**Problema:** `google-calendar/index.ts:89` grava access/refresh tokens do Google em texto puro em `user_google_tokens`, e operações destrutivas com service role (restore/delete de backup, delete de usuário) não geram nenhum registro de auditoria.

**Subtarefas Kanban:**

- [ ] Criptografar tokens em repouso (pgsodium/vault ou cifra na function com chave em env)
- [ ] Migrar tokens existentes e invalidar os antigos
- [ ] Registrar restore/delete do site-backup no audit log (ver SEC-007)
- [ ] Revisar policies de `user_google_tokens` (owner-only, sem SELECT amplo)

---

### CARD SEC-010 — CORS allowlist no google-calendar e helper compartilhado

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | SEC-010                                      |
| **Prioridade** | P2                                           |
| **Esforço**    | S                                            |
| **Labels**     | segurança, cors, edge-functions              |
| **Arquivos**   | `supabase/functions/google-calendar/index.ts`, `supabase/functions/` |

**Problema:** `google-calendar` responde `Access-Control-Allow-Origin: *` (index.ts:5) enquanto as outras três functions usam allowlist por origem — inconsistência de hardening e código CORS duplicado em cada function.

**Subtarefas Kanban:**

- [ ] Criar `supabase/functions/_shared/cors.ts` com a allowlist única
- [ ] Migrar as 4 functions para o helper
- [ ] Incluir `admin-ops` quando a fonte entrar no repo (SEC-003)
- [ ] Testar preflight das origens permitidas e bloqueio das demais

---

### CARD SEC-011 — Endurecer CSP e cobrir headers no deploy Coolify

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | SEC-011                        |
| **Prioridade** | P2                             |
| **Esforço**    | M                              |
| **Labels**     | segurança, headers, deploy     |
| **Arquivos**   | `netlify.toml`, `nixpacks.toml` |

**Problema:** A CSP do `netlify.toml` carrega `unsafe-inline`/`unsafe-eval` no script-src e `img-src *` (anula boa parte do valor anti-XSS), e o deploy Coolify — o documentado em `docs/deploy-coolify.md` — não define header de segurança nenhum (`nixpacks.toml` sem headers).

**Subtarefas Kanban:**

- [ ] Levantar o que exige `unsafe-eval` (Excalidraw? BlockNote?) e testar removê-lo
- [ ] Restringir `img-src` a self + supabase + data:
- [ ] Replicar todos os headers no deploy Coolify (Caddy config ou meta equivalente)
- [ ] Adicionar HSTS
- [ ] Smoke test dos dois deploys com securityheaders.com

---

### CARD SEC-012 — Alinhar sanitização de links do editor à allowlist

| Campo          | Valor                                       |
| -------------- | ------------------------------------------- |
| **ID**         | SEC-012                                     |
| **Prioridade** | P2                                          |
| **Esforço**    | S                                           |
| **Labels**     | segurança, xss, editor                      |
| **Arquivos**   | `src/lib/markdownHtml.ts`, `src/components/MarkdownText.tsx` |

**Problema:** `markdownHtml.ts:44` bloqueia só `javascript:` (blocklist — `data:`, `vbscript:`, `file:` passam para o href injetado via innerHTML no RichTextEditor), enquanto `MarkdownText.tsx:21` já faz o certo com allowlist `https?://|mailto:`.

**Subtarefas Kanban:**

- [ ] Trocar a blocklist por allowlist idêntica à do MarkdownText
- [ ] Adicionar `rel="noopener noreferrer"` nos links gerados
- [ ] Teste cobrindo `data:`, `vbscript:` e href vazio
- [ ] Extrair a função de validação de scheme para um só lugar (`lib/`)

---

### CARD SEC-013 — Limpar estado local do app no signOut

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | SEC-013                        |
| **Prioridade** | P2                             |
| **Esforço**    | S                              |
| **Labels**     | segurança, auth, localstorage  |
| **Arquivos**   | `src/contexts/AuthContext.tsx` |

**Problema:** `signOut` (AuthContext.tsx:167) só chama `supabase.auth.signOut()` — página/painel ativo, seleção de Documentos, prefs de board e onboarding ficam no localStorage e vazam entre contas no mesmo navegador (uso familiar compartilhado é o cenário do app).

**Subtarefas Kanban:**

- [ ] Inventariar chaves de estado por usuário (excalinotion_*, projects_*, docs selection, onboarding_seen_*)
- [ ] Criar limpeza centralizada (`clearUserLocalState()`) chamada no signOut
- [ ] Preservar prefs neutras (tema, idioma) — decisão documentada
- [ ] Testar troca de conta A→B: nada de A aparece para B

---

### CARD SEC-014 — Reduzir expiração das signed URLs de anexos financeiros

| Campo          | Valor                                         |
| -------------- | --------------------------------------------- |
| **ID**         | SEC-014                                       |
| **Prioridade** | P3                                            |
| **Esforço**    | S                                             |
| **Labels**     | segurança, storage, finance                   |
| **Arquivos**   | `src/lib/storageUrl.ts`, `src/modules/finance/ui/AttachmentField.tsx` |

**Problema:** `storageUrl.ts:29` assina URLs com 1h de validade + cache em memória e `AttachmentField.tsx:122` abre em aba nova — a URL de um comprovante/nota fiscal fica no histórico do navegador valendo 1h para quem a obtiver, sem autenticação.

**Subtarefas Kanban:**

- [ ] Reduzir `expiresIn` para 60–300s em anexos financeiros
- [ ] Ajustar o cache para respeitar a nova janela
- [ ] Manter expiração maior onde UX exigir (imagens inline), documentando
- [ ] Conferir que reabrir o anexo re-assina sem erro

---

## Tópico: Arquitetura / Modularização

---

### CARD ARCH-001 — ErrorBoundary nos painéis fora do financeiro

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | ARCH-001                               |
| **Prioridade** | P1                                     |
| **Esforço**    | S                                      |
| **Labels**     | arquitetura, resiliência, react        |
| **Arquivos**   | `src/components/MainContent.tsx`, `src/components/ErrorBoundary.tsx` |

**Problema:** Só o FinancePanel está envolto em ErrorBoundary (MainContent.tsx) — um erro de render em DocumentsPanel (que hoje hospeda Projetos, Estudos, QuickNotes e o editor), Dashboard, PageEditor ou HelpPanel derruba o app inteiro em tela branca sem recuperação, e foram justamente esses os módulos mais mexidos recentemente.

**Subtarefas Kanban:**

- [ ] Envolver DocumentsPanel, Dashboard, HelpPanel e PageEditor em ErrorBoundary no MainContent
- [ ] Boundary global no root (main.tsx) como última linha
- [ ] Fallback com botão de recarregar + mensagem i18n
- [ ] Testar com um throw proposital em cada painel

---

### CARD ARCH-002 — Blindar o invariante de identidade do user

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | ARCH-002                               |
| **Prioridade** | P1                                     |
| **Esforço**    | M                                      |
| **Labels**     | arquitetura, auth, react               |
| **Arquivos**   | `src/contexts/AuthContext.tsx`, `src/contexts/PagesContext.tsx`, `src/hooks/usePagePresence.ts` |

**Problema:** A estabilidade do app depende do guard `sameAccount` (AuthContext.tsx:114) que preserva a identidade do objeto `user` — mas ~9 efeitos (PagesContext:163, ProjectsPanel:2032, Dashboard:161, NotificationsContext, OnboardingContext, usePagePresence, ItemPicker, LinkedNotePanel) ainda dependem de `[user]` (objeto), e não há teste protegendo o invariante: um refactor inocente reintroduz o re-mount em 9 lugares de uma vez.

**Subtarefas Kanban:**

- [ ] Migrar os efeitos de `[user]` para primitivos (`[user?.id]`), como o FinancePanel já fez
- [ ] Teste de guarda do `sameAccount` (SIGNED_IN repetido não troca a referência)
- [ ] Lint ou comentário-contrato no AuthContext apontando os consumidores
- [ ] Verificar `USER_UPDATED` (troca de e-mail) — deve trocar a referência

---

### CARD ARCH-003 — Camada de repositórios Supabase

| Campo          | Valor                       |
| -------------- | --------------------------- |
| **ID**         | ARCH-003                    |
| **Prioridade** | P2                          |
| **Esforço**    | L                           |
| **Labels**     | arquitetura, supabase       |
| **Arquivos**   | `src/lib/supabase.ts`       |

**Problema:** `supabase.from(` está espalhado em 19 arquivos de UI — queries, mapeamento e tratamento de erro misturados com componentes, sem um `mapSupabaseError` comum nem ponto único para paginação/retry.

**Subtarefas Kanban:**

- [ ] Definir o padrão (`src/repositories/` ou `data/` por módulo) com um piloto (pages ou projects)
- [ ] Extrair queries do piloto para o repositório tipado
- [ ] `mapSupabaseError` comum (RLS vs rede vs validação)
- [ ] Migrar os demais módulos incrementalmente
- [ ] Proibir `supabase.from` em componentes via lint quando concluir

---

### CARD ARCH-004 — Tipos gerados do Supabase + unwrapRelation

| Campo          | Valor                                     |
| -------------- | ----------------------------------------- |
| **ID**         | ARCH-004                                  |
| **Prioridade** | P2                                        |
| **Esforço**    | M                                         |
| **Labels**     | arquitetura, typescript, supabase         |
| **Arquivos**   | `src/types/index.ts`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Os tipos são mantidos à mão (`src/types/index.ts`, 621 LOC) e o hack `as unknown as` para joins embutidos se repete 6× (PagesContext:111, ProjectsPanel:2020, projectImport:34, DashboardProjects:52, ItemPicker:51, UserManagementPanel:102); o modelo de card entra destipado (`as any[]` em ProjectsPanel:2085) e há `user!.id` em handler async (:1595).

**Subtarefas Kanban:**

- [ ] Script `gen:types` com `supabase gen types typescript`
- [ ] Adotar os tipos gerados nas queries (piloto: projects)
- [ ] Helper `unwrapRelation<T>()` substituindo os 6 casts
- [ ] Tipar o mapeamento de cards (remover `as any[]` e o eslint-disable)
- [ ] Trocar `user!.id` por guard explícito

---

### CARD ARCH-005 — Decidir React Router: adotar ou remover a dependência morta

| Campo          | Valor                     |
| -------------- | ------------------------- |
| **ID**         | ARCH-005                  |
| **Prioridade** | P2                        |
| **Esforço**    | M                         |
| **Labels**     | arquitetura, routing      |
| **Arquivos**   | `package.json`, `vite.config.ts` |

**Problema:** `react-router-dom ^7.15` está em deps com zero imports no src (e o vite.config:32 reserva um chunk 'router' fantasma) — enquanto a navegação real é um mosaico de estados (mode, activePanel, activePage, docsSelection) sem URLs, deep-link ou histórico do navegador.

**Subtarefas Kanban:**

- [ ] Decidir: adotar URLs reais ou remover a dependência
- [ ] Se remover: tirar do package.json + manualChunks e fechar o card
- [ ] Se adotar: mapear rotas (/docs/projects, /finance/overview, /page/:id) sobre o estado atual
- [ ] Migrar os deep links (projects_open_card) para query/route params
- [ ] Suportar voltar/avançar do navegador

---

### CARD ARCH-006 — Freio de tamanho de arquivo (max-lines no lint/CI)

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | ARCH-006                       |
| **Prioridade** | P2                             |
| **Esforço**    | S                              |
| **Labels**     | arquitetura, lint, dx          |
| **Arquivos**   | `eslint.config.js`             |

**Problema:** Os cards de modularização não têm freio — FinancePanel foi de 3919 para 4291 LOC e `reload()` de 19 para 24 chamadas mesmo com submódulos extraídos: sem um limite verificável, código novo continua entrando nos arquivos antigos.

**Subtarefas Kanban:**

- [ ] Regra `max-lines` (ex.: 800) como warning geral
- [ ] Error com allowlist explícita dos monolitos atuais (congela o tamanho de hoje)
- [ ] Reduzir a allowlist a cada extração (PERF-004/005, ARCH-007/012)
- [ ] Documentar o teto no README de cada módulo

---

### CARD ARCH-007 — Dividir usePdfExport

| Campo          | Valor                      |
| -------------- | -------------------------- |
| **ID**         | ARCH-007                   |
| **Prioridade** | P2                         |
| **Esforço**    | L                          |
| **Labels**     | arquitetura, pdf, dx       |
| **Arquivos**   | `src/hooks/usePdfExport.ts` |

**Problema:** 964 LOC num único hook que exporta páginas, finanças e cards de projeto, com 8 `any`, 9 `eslint-disable`, zero testes e strings pt hardcoded (:843) — terceiro maior arquivo de código do app, alto risco em qualquer mudança de layout de PDF.

**Subtarefas Kanban:**

- [ ] Separar por domínio: exportPage, exportFinance, exportProjectCards
- [ ] Extrair helpers puros (formatação de moeda/data, paginação) para `lib/` testável
- [ ] Mover strings para o i18n
- [ ] Remover os `any` com tipos do jspdf
- [ ] Teste dos helpers puros

---

### CARD ARCH-008 — Completar a estrutura modular (shared, aliases, fronteiras)

| Campo          | Valor                    |
| -------------- | ------------------------ |
| **ID**         | ARCH-008                 |
| **Prioridade** | P2                       |
| **Esforço**    | M                        |
| **Labels**     | arquitetura, modules     |
| **Arquivos**   | `src/modules/`, `tsconfig.app.json`, `eslint.config.js` |

**Problema:** `modules/{finance,study,projects,backup}` existem com barrel + README, mas não há `src/shared/` para os primitivos que os módulos copiam entre si, nem path aliases, nem regra ESLint impedindo import cruzado — a fronteira vive só de convenção nos READMEs.

**Subtarefas Kanban:**

- [ ] Criar `src/shared/` (ui primitives, hooks neutros) com critério de entrada documentado
- [ ] Path aliases (`@shared`, `@modules`) no tsconfig + vite
- [ ] Regra ESLint de fronteira (no-restricted-imports ou boundaries)
- [ ] Definir contrato de módulo (o que o barrel pode exportar)

---

### CARD ARCH-009 — Event bus tipado para comunicação entre módulos

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | ARCH-009                              |
| **Prioridade** | P2                                    |
| **Esforço**    | M                                     |
| **Labels**     | arquitetura, eventos                  |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`, `src/modules/backup/BackupPanel.tsx` |

**Problema:** A comunicação entre módulos usa `CustomEvent` global com strings soltas (`finance_tab_change` FinancePanel:3608, `finance_transactions_changed` :3618) — renomear um evento não quebra a compilação — e o backup importa `usePages` direto, acoplando módulos.

**Subtarefas Kanban:**

- [ ] Criar `lib/appEvents.ts` tipado (mapa evento→payload, on/emit com generics)
- [ ] Migrar os CustomEvent do financeiro
- [ ] Avaliar invalidação de dados do backup via evento em vez de import direto
- [ ] Lint proibindo `dispatchEvent`/`addEventListener` cru para eventos de app

---

### CARD ARCH-010 — Decidir destino das edge functions órfãs

| Campo          | Valor                    |
| -------------- | ------------------------ |
| **ID**         | ARCH-010                 |
| **Prioridade** | P3                       |
| **Esforço**    | S                        |
| **Labels**     | arquitetura, edge-functions |
| **Arquivos**   | `supabase/functions/ai-chat/`, `supabase/functions/analyze-transaction-photo/`, `supabase/functions/google-calendar/` |

**Problema:** `ai-chat`, `analyze-transaction-photo` e `google-calendar` estão deployadas e mantidas, mas nenhuma UI as chama (zero referências no src) — superfície de ataque e manutenção sem funcionalidade entregue.

**Subtarefas Kanban:**

- [ ] Decidir por função: ligar na UI, pausar ou remover
- [ ] Remover (ou documentar como experimental) as descartadas
- [ ] Se mantiver google-calendar: resolver SEC-009/SEC-010 antes de expor
- [ ] Atualizar docs de deploy com a lista final

---

### CARD ARCH-011 — Documentar a árvore de providers

| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | ARCH-011         |
| **Prioridade** | P3               |
| **Esforço**    | S                |
| **Labels**     | arquitetura, docs |
| **Arquivos**   | `src/App.tsx`    |

**Problema:** A ordem dos 7 providers em App.tsx carrega decisões implícitas (Notifications montado só depois do guard de user; WorkspaceMode o mais interno) que ninguém documentou — mudanças de ordem quebram coisas de formas não óbvias.

**Subtarefas Kanban:**

- [ ] Comentário/README explicando cada provider e por que está naquela posição
- [ ] Diagrama simples da árvore (mermaid no README)
- [ ] Registrar dependências entre contexts (quem consome quem)

---

### CARD ARCH-012 — Dividir a superfície de administração

| Campo          | Valor                                     |
| -------------- | ----------------------------------------- |
| **ID**         | ARCH-012                                  |
| **Prioridade** | P3                                        |
| **Esforço**    | L                                         |
| **Labels**     | arquitetura, admin                        |
| **Arquivos**   | `src/components/UserManagementPanel.tsx`, `src/components/UserSettingsModal.tsx` |

**Problema:** UserManagementPanel (829 LOC) + UserSettingsModal (717 LOC) somam 1546 linhas de UI admin/conta num par de arquivos — é onde vivem as ações mais sensíveis (delete de usuário, invite codes, avatar) e onde revisar é mais difícil.

**Subtarefas Kanban:**

- [ ] Extrair sub-painéis do UserManagementPanel (lista, convites, ações)
- [ ] Extrair seções do UserSettingsModal (perfil, avatar, segurança, preferências)
- [ ] Mover para `src/modules/admin/` com barrel + README
- [ ] Aproveitar para cobrir com aria (ver UX-004)

---

## Tópico: Performance

---

### CARD PERF-001 — Paginar transações financeiras

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | PERF-001                              |
| **Prioridade** | P1                                    |
| **Esforço**    | M                                     |
| **Labels**     | performance, finance, supabase        |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx` |

**Problema:** `finance_transactions.select('*')` sem `.range()` nem filtro de data (FinancePanel.tsx:210) carrega o histórico inteiro a cada load — cresce linearmente para sempre e é a base sobre a qual todos os filtros re-rodam.

**Subtarefas Kanban:**

- [ ] Carregar por janela (mês corrente ± N) com `.range()`/filtro de data
- [ ] Buscar janelas extras sob demanda (navegação de mês)
- [ ] Ajustar agregados que hoje assumem a lista completa (saldos, gráficos)
- [ ] Medir payload antes/depois num histórico real

---

### CARD PERF-002 — Eliminar o reload completo a cada mutação do financeiro

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | PERF-002                              |
| **Prioridade** | P1                                    |
| **Esforço**    | L                                     |
| **Labels**     | performance, finance                  |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx` |

**Problema:** 24 chamadas de `reload()` — toda mutação (criar transação, pagar recorrência, editar categoria) recarrega contas+transações+categorias+metas inteiras; o padrão cresceu desde o levantamento anterior (eram 19).

**Subtarefas Kanban:**

- [ ] Mapear as 24 chamadas e o que cada mutação realmente afeta
- [ ] Atualização local otimista + refetch pontual da entidade tocada
- [ ] Manter reload completo só para import em massa e restore
- [ ] Combinar com o tratamento de erro do UX-002 (rollback no fail)

---

### CARD PERF-003 — Desacoplar o Excalidraw do chunk do editor de notas

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-003                               |
| **Prioridade** | P1                                     |
| **Esforço**    | L                                      |
| **Labels**     | performance, bundle, editor            |
| **Arquivos**   | `src/components/DiagramBlock.tsx`, `src/components/NoteEditor.tsx` |

**Problema:** `DiagramBlock.tsx:3` importa Excalidraw estático e o bloco faz parte do schema do BlockNote (NoteEditor.tsx:11) — abrir qualquer nota puxa o chunk de 4.7MB mesmo sem nenhum diagrama; um `lazy()` simples no componente NÃO resolve porque o schema exige o bloco no registro.

**Subtarefas Kanban:**

- [ ] Separar o spec do bloco (leve) do componente de render (pesado)
- [ ] Render do bloco carrega Excalidraw via `lazy()` + Suspense só quando um diagrama aparece
- [ ] Placeholder de carregamento no bloco
- [ ] Confirmar no build que o chunk excalidraw só baixa ao renderizar diagrama
- [ ] Medir o first load de uma nota sem diagramas antes/depois

---

### CARD PERF-004 — Continuar a divisão do FinancePanel

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | PERF-004                              |
| **Prioridade** | P1                                    |
| **Esforço**    | L                                     |
| **Labels**     | performance, finance, arquitetura     |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx` |

**Problema:** Mesmo com `tabs/`, `store/`, `myprojects/`, `integrations/` e `ui/` extraídos, o arquivo tem 4291 LOC (cresceu 372 desde o último levantamento) — as tabs restantes e os modais continuam inline.

**Subtarefas Kanban:**

- [ ] Extrair as tabs restantes (Contas, Transações, Orçamentos, Metas) para `tabs/`
- [ ] Extrair os modais (transação, conta, categoria, recorrência) para arquivos próprios
- [ ] Concentrar os handlers de dados no store/repositório
- [ ] Meta: FinancePanel < 800 LOC (orquestração apenas) — travar com ARCH-006

---

### CARD PERF-005 — Dividir o ProjectsPanel

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | PERF-005                                 |
| **Prioridade** | P1                                       |
| **Esforço**    | L                                        |
| **Labels**     | performance, projects, arquitetura       |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** 2789 LOC num arquivo: CardModal, Column, CardView, as cinco views e todo o data-layer inline — revisão e manutenção caras, e nenhuma parte é testável isoladamente.

**Subtarefas Kanban:**

- [ ] Extrair CardModal (o maior bloco) com seu autosave/draft
- [ ] Extrair Column/CardView/SortableColumn (kanban)
- [ ] Extrair ListView/OverviewView/CompactKanbanView para `views/`
- [ ] Extrair o data-layer (loadBoards/loadBoardData/mutações) para hook próprio
- [ ] Nenhum arquivo novo > 400 LOC — travar com ARCH-006

---

### CARD PERF-006 — Estancar o churn de session no AuthContext

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | PERF-006                       |
| **Prioridade** | P1                             |
| **Esforço**    | M                              |
| **Labels**     | performance, auth, react       |
| **Arquivos**   | `src/contexts/AuthContext.tsx` |

**Problema:** `setSession(session)` incondicional (AuthContext.tsx:102) cria objeto novo a cada SIGNED_IN de foco de aba — como `session` está no useMemo do value, todo consumidor de `useAuth()` re-renderiza a cada `visibilitychange`; a proteção de identidade só foi aplicada a `user`.

**Subtarefas Kanban:**

- [ ] Aplicar a session o mesmo guard de identidade do user (mesmo token ⇒ mesma referência)
- [ ] Verificar consumidores que dependem de `session` (expiração de token?)
- [ ] Teste: SIGNED_IN repetido não re-renderiza consumidores
- [ ] Medir renders por foco de aba antes/depois (React DevTools)

---

### CARD PERF-007 — Otimizar o refresh do PagesContext

| Campo          | Valor                           |
| -------------- | ------------------------------- |
| **ID**         | PERF-007                        |
| **Prioridade** | P2                              |
| **Esforço**    | M                               |
| **Labels**     | performance, pages              |
| **Arquivos**   | `src/contexts/PagesContext.tsx` |

**Problema:** Todo `refreshPages` liga `setLoading(true)` e refaz as duas queries completas (próprias + compartilhadas) — criar uma página pisca a sidebar inteira; não há atualização incremental nem realtime.

**Subtarefas Kanban:**

- [ ] Refresh silencioso (sem loading) quando já há dados
- [ ] Atualização local para create/rename/delete (já existe parcial — completar)
- [ ] Avaliar channel realtime para pages compartilhadas
- [ ] Testar que a sidebar não pisca ao criar página

---

### CARD PERF-008 — Lazy-load do i18n e do help content

| Campo          | Valor                            |
| -------------- | -------------------------------- |
| **ID**         | PERF-008                         |
| **Prioridade** | P2                               |
| **Esforço**    | M                                |
| **Labels**     | performance, i18n, bundle        |
| **Arquivos**   | `src/i18n/translations.ts`, `src/i18n/helpContent.ts` |

**Problema:** `translations.ts` (2679 LOC, pt+en juntos) e `helpContent.ts` (1000 LOC) entram estáticos no bundle inicial — inclusive na tela de login; metade das strings nunca é usada (idioma não ativo).

**Subtarefas Kanban:**

- [ ] Separar pt-BR e en em arquivos próprios com import dinâmico por idioma
- [ ] Lazy no helpContent (só quando o HelpPanel abre)
- [ ] Manter a tipagem TranslationKey única (teste de paridade continua)
- [ ] Medir o chunk inicial antes/depois

---

### CARD PERF-009 — Presence e realtime: trocar poll por channel e fechar as races

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | PERF-009                       |
| **Prioridade** | P2                             |
| **Esforço**    | M                              |
| **Labels**     | performance, realtime          |
| **Arquivos**   | `src/hooks/usePagePresence.ts` |

**Problema:** A presença ainda é poll de 15s + upsert (usePagePresence.ts:15), o cleanup dispara `.delete()` fire-and-forget que pode apagar a presença recém-criada na troca rápida de página (:71), e não há handler de `pagehide` — fechar a aba deixa linhas fantasma por 45s.

**Subtarefas Kanban:**

- [ ] Migrar para Supabase Realtime Presence (channel) ou reduzir drasticamente o poll
- [ ] Aguardar o delete do cleanup antes do próximo upsert (ordem garantida)
- [ ] Handler de `pagehide`/`visibilitychange` com `keepalive`
- [ ] TodoList: aplicar delta do payload realtime em vez de `refresh()` completo

---

### CARD PERF-010 — Memoizar o kanban de Projetos

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | PERF-010                                 |
| **Prioridade** | P2                                       |
| **Esforço**    | M                                        |
| **Labels**     | performance, projects, react             |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Column e CardView não são memoizados (ProjectsPanel.tsx:263/313) — um board com centenas de cards re-renderiza tudo a cada movimento de drag; o board genérico do financeiro (`components/board/BoardCard.tsx:30`) já memoiza, mostrando o padrão.

**Subtarefas Kanban:**

- [ ] `React.memo` em CardView e Column com props estáveis
- [ ] Estabilizar callbacks (useCallback) passados por card
- [ ] Perfilar drag com ~200 cards antes/depois
- [ ] Depende da extração dos componentes (PERF-005) — fazer junto

---

### CARD PERF-011 — Memoizar os filtros de transações no render

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | PERF-011                              |
| **Prioridade** | P2                                    |
| **Esforço**    | M                                     |
| **Labels**     | performance, finance                  |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx` |

**Problema:** `transactions.filter(...)` roda no corpo do render sem useMemo em vários pontos (:1197, :1205, :1230 dentro de loop de meses, :2089 chamado por categoria) — sobre o array completo e a cada tecla/estado, multiplicando o custo do PERF-001.

**Subtarefas Kanban:**

- [ ] Inventariar os filtros por render e agrupar por dependência
- [ ] `useMemo` nos derivados (por mês, por categoria, somas)
- [ ] Pré-indexar por mês/categoria quando fizer sentido (Map)
- [ ] Perfilar a tab de transações com histórico grande

---

### CARD PERF-012 — Compressão e resize de imagens no upload

| Campo          | Valor                              |
| -------------- | ---------------------------------- |
| **ID**         | PERF-012                           |
| **Prioridade** | P2                                 |
| **Esforço**    | M                                  |
| **Labels**     | performance, storage, uploads      |
| **Arquivos**   | `src/lib/imageCrop.ts`, `src/modules/finance/FinancePanel.tsx`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Só o avatar passa por crop/resize — fotos de transação e imagens de card sobem no tamanho original (fotos de celular = vários MB), pesando storage, banda e o render das listas.

**Subtarefas Kanban:**

- [ ] Helper `compressImage` (canvas → WebP/JPEG com limite de dimensão)
- [ ] Aplicar em foto de transação e imagem de card antes do upload
- [ ] Thumbnail para listas quando aplicável
- [ ] Casar limites com os do SEC-005

---

### CARD PERF-013 — Otimizar o build do Vite (chunks por módulo, budget)

| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | PERF-013         |
| **Prioridade** | P2               |
| **Esforço**    | M                |
| **Labels**     | performance, bundle, vite |
| **Arquivos**   | `vite.config.ts` |

**Problema:** O manualChunks cobre vendors, mas não há chunks por módulo do app, nem budget de bundle inicial verificado — e o chunk `editor` (1.5MB) entra cedo demais; a config ainda referencia o chunk 'router' fantasma.

**Subtarefas Kanban:**

- [ ] Limpar manualChunks (remover 'router' — ver ARCH-005)
- [ ] Verificar que cada módulo do app (finance/projects/study/backup) vira chunk próprio via lazy
- [ ] Budget de first-load (< 300KB gzip antes de login) com check no CI
- [ ] Analisar com rollup-plugin-visualizer e registrar o baseline

---

### CARD PERF-014 — Debounce padronizado

| Campo          | Valor                       |
| -------------- | --------------------------- |
| **ID**         | PERF-014                    |
| **Prioridade** | P3                          |
| **Esforço**    | S                           |
| **Labels**     | performance, dx             |
| **Arquivos**   | `src/hooks/`, `src/components/SharePageModal.tsx` |

**Problema:** Cada busca implementa debounce ad-hoc (SharePageModal, ProjectsPanel, FinancePanel) com timers e delays diferentes — sem um `useDebouncedValue` compartilhado, cada novo campo reinventa e às vezes esquece o cleanup.

**Subtarefas Kanban:**

- [ ] Hook `useDebouncedValue`/`useDebouncedCallback` em `src/hooks/`
- [ ] Constante única de delay para buscas
- [ ] Migrar os 3 call sites existentes
- [ ] Cleanup garantido no unmount

---

### CARD PERF-015 — Lazy-load do GanttView e do ExportPdfModal

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | PERF-015                              |
| **Prioridade** | P3                                    |
| **Esforço**    | S                                     |
| **Labels**     | performance, bundle                   |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`, `src/components/Sidebar.tsx` |

**Problema:** GanttView (420 LOC + ganttLayout) entra estático no chunk de Projetos para todo usuário, mesmo quem só usa kanban; ExportPdfModal é import estático no Sidebar apesar de o jspdf em si já ser dinâmico.

**Subtarefas Kanban:**

- [ ] `lazy()` no GanttView (só quando a view timeline é selecionada)
- [ ] `lazy()` no ExportPdfModal (só quando abre)
- [ ] Suspense com placeholder discreto
- [ ] Conferir os chunks no build

---

### CARD PERF-016 — Avaliar TanStack Query como camada de cache

| Campo          | Valor            |
| -------------- | ---------------- |
| **ID**         | PERF-016         |
| **Prioridade** | P3               |
| **Esforço**    | L                |
| **Labels**     | performance, arquitetura |
| **Arquivos**   | `package.json`   |

**Problema:** Todo fetch é manual (useEffect + useState + reload) sem cache, dedupe, retry ou invalidação — a biblioteca não está nem instalada; boa parte de PERF-002/007 sairia de graça com uma camada de query.

**Subtarefas Kanban:**

- [ ] Spike num módulo pequeno (study ou backup) com @tanstack/react-query
- [ ] Comparar: complexidade vs ganho (invalidação, retry, cache)
- [ ] Decidir adoção gradual ou descarte documentado
- [ ] Se adotar: padrão de queryKeys por módulo + integração com o repositório (ARCH-003)

---

## Tópico: UX / Acessibilidade

---

### CARD UX-001 — Sistema global de feedback de erro

| Campo          | Valor                     |
| -------------- | ------------------------- |
| **ID**         | UX-001                    |
| **Prioridade** | P1                        |
| **Esforço**    | M                         |
| **Labels**     | ux, erros, toast          |
| **Arquivos**   | `src/components/`, `src/contexts/` |

**Problema:** Não existe toast/banner de erro — falhas de rede/RLS terminam em `console.error` e a UI finge sucesso; é o pré-requisito para UX-002/UX-003 terem onde reportar.

**Subtarefas Kanban:**

- [ ] Componente de toast (fila, auto-dismiss, variantes erro/aviso/sucesso)
- [ ] Context/provider global + hook `useToast`
- [ ] Acessível: `role="alert"`, foco não roubado
- [ ] i18n das mensagens padrão (falha de rede, sem permissão)
- [ ] Adotar nos fluxos que já tratam erro (quickAddTx, autosave de card)

---

### CARD UX-002 — Tratar erro nas ~22 escritas silenciosas do financeiro

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | UX-002                                |
| **Prioridade** | P1                                    |
| **Esforço**    | M                                     |
| **Labels**     | ux, erros, finance                    |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx` |

**Problema:** ~22 handlers de escrita (deleteTx:3690 … skipRecurringEntry:3860) ignoram o `error` do Supabase e chamam `reload()` — numa falha de RLS/rede o valor "volta" sem qualquer aviso e o usuário conclui que o app perdeu o dado; `quickAddTx` já faz `if (error) throw`, o padrão existe no próprio arquivo.

**Subtarefas Kanban:**

- [ ] Inventariar os handlers sem checagem (lista nas linhas 3686–3861)
- [ ] Aplicar o padrão `if (error) throw` + toast (UX-001)
- [ ] Não recarregar em caso de erro (manter o estado real)
- [ ] Testar com policy RLS negando de propósito

---

### CARD UX-003 — Tratar erro nas escritas de Projetos, shares e todos

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | UX-003                                       |
| **Prioridade** | P1                                           |
| **Esforço**    | M                                            |
| **Labels**     | ux, erros, projects                          |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`, `src/components/SharePageModal.tsx`, `src/components/TodoList.tsx`, `src/components/DiagramBlock.tsx` |

**Problema:** CRUD de board/coluna sem checagem (ProjectsPanel :2140–:2172, :2388), revogação de compartilhamento silenciosa (SharePageModal :202/:209 — "revogado" na UI pode não ter revogado), toggles do TodoList (:81–:93) e o catch vazio do DiagramBlock (:60) que rende canvas em branco para dado corrompido sem nem logar.

**Subtarefas Kanban:**

- [ ] ProjectsPanel: checar error em update/delete de board, coluna e card
- [ ] SharePageModal: confirmar sucesso antes de atualizar a lista
- [ ] TodoList: rollback do toggle otimista em erro
- [ ] DiagramBlock: logar o parse falho e mostrar aviso de conteúdo corrompido
- [ ] Tudo reportando via toast (UX-001)

---

### CARD UX-004 — Modais acessíveis (padrão unificado)

| Campo          | Valor                  |
| -------------- | ---------------------- |
| **ID**         | UX-004                 |
| **Prioridade** | P2                     |
| **Esforço**    | L                      |
| **Labels**     | ux, a11y, modal        |
| **Arquivos**   | `src/components/`, `src/modules/finance/ui/Modal.tsx` |

**Problema:** Dos ~15 shells de modal do app, só o WelcomeTour tem `role="dialog"`/`aria-modal` — nenhum outro tem focus trap, retorno de foco ou fechamento por Esc consistente.

**Subtarefas Kanban:**

- [ ] Definir o shell acessível (role, aria-modal, focus trap, Esc, retorno de foco)
- [ ] Implementar no Modal compartilhado (casar com QA-006)
- [ ] Migrar os modais de Projetos e Documentos
- [ ] Migrar os modais do financeiro e admin
- [ ] Testar navegação só por teclado nos fluxos principais

---

### CARD UX-005 — Sidebar drawer acessível

| Campo          | Valor         |
| -------------- | ------------- |
| **ID**         | UX-005        |
| **Prioridade** | P2            |
| **Esforço**    | S             |
| **Labels**     | ux, a11y      |
| **Arquivos**   | `src/App.tsx` |

**Problema:** O drawer do hambúrguer (App.tsx:88) só tem aria-label — sem `aria-expanded` no botão, sem focus trap, sem Esc, sem devolver o foco ao fechar.

**Subtarefas Kanban:**

- [ ] `aria-expanded`/`aria-controls` no botão do menu
- [ ] Focus trap enquanto aberto + Esc fecha
- [ ] Retorno de foco ao botão ao fechar
- [ ] `aria-modal` no backdrop

---

### CARD UX-006 — Tabs WAI-ARIA em Finance e Projects

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | UX-006                                |
| **Prioridade** | P2                                    |
| **Esforço**    | M                                     |
| **Labels**     | ux, a11y, tabs                        |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`, `src/modules/projects/ProjectsNav.tsx` |

**Problema:** Zero `role="tablist"`/`role="tab"`/`aria-selected` no src — as tabs do financeiro e o seletor de visualização de Projetos são divs/botões sem semântica nem navegação por setas.

**Subtarefas Kanban:**

- [ ] Padrão tablist/tab/tabpanel nas tabs do financeiro
- [ ] Aplicar no seletor de views de Projetos (rail + chips mobile)
- [ ] Navegação por setas + Home/End
- [ ] `aria-selected` e foco visível

---

### CARD UX-007 — Acessibilidade do FinancePanel

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | UX-007                                |
| **Prioridade** | P2                                    |
| **Esforço**    | L                                     |
| **Labels**     | ux, a11y, finance                     |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx` |

**Problema:** 4291 linhas, 125 `<button>`, zero `aria-*` ou `role` no arquivo — o módulo mais usado do app é integralmente opaco a leitor de tela; muitos botões são só ícone.

**Subtarefas Kanban:**

- [ ] `aria-label` em todos os botões ícone-only
- [ ] Semântica nas listas de transações (list/listitem ou tabela)
- [ ] Labels ligados aos inputs dos formulários
- [ ] Anúncio de valores (saldo, totais) com texto acessível
- [ ] Passar axe/lighthouse e registrar baseline

---

### CARD UX-008 — Rótulos nos botões ícone-only de Projetos

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | UX-008                                   |
| **Prioridade** | P2                                       |
| **Esforço**    | S                                        |
| **Labels**     | ux, a11y, projects                       |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Botões de fechar modal (:114/:137) e limpar seleção (:448) não têm `title` nem `aria-label` — o modal de card, tela mais usada de Projetos, não anuncia o próprio botão de fechar; outros botões do arquivo já têm `title`, o padrão só não foi aplicado.

**Subtarefas Kanban:**

- [ ] `aria-label` + `title` nos botões sem rótulo do ProjectsPanel
- [ ] Varredura por `<button>` só-ícone no módulo inteiro
- [ ] Incluir os botões do ProjectsNav e do cabeçalho mobile

---

### CARD UX-009 — Split view com suporte a touch

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | UX-009                         |
| **Prioridade** | P2                             |
| **Esforço**    | S                              |
| **Labels**     | ux, mobile, editor             |
| **Arquivos**   | `src/components/PageEditor.tsx` |

**Problema:** O divisor do split view (PageEditor.tsx:80) só escuta mouse events — em tablet/touch não dá para redimensionar os painéis.

**Subtarefas Kanban:**

- [ ] Migrar para pointer events (cobre mouse + touch)
- [ ] Área de toque maior no divisor em telas touch
- [ ] Testar em tablet e no modo mobile do devtools

---

### CARD UX-010 — Resíduo de i18n: tooltips e strings em .ts

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | UX-010                         |
| **Prioridade** | P3                             |
| **Esforço**    | S                              |
| **Labels**     | ux, i18n                       |
| **Arquivos**   | `src/components/TodoList.tsx`, `src/components/Dashboard.tsx`, `src/contexts/AuthContext.tsx`, `src/hooks/usePdfExport.ts` |

**Problema:** Idioma trocado em atributos visíveis (`title="Priority"`/`"Due date"` no TodoList vs `"Próximas Tarefas"` no Dashboard, `"Copiar"` no UserManagementPanel) e strings fora do translations em .ts (AuthContext:144/173/240, usePdfExport:843, UserManagementPanel:335, DrawingCanvas:59) — o conteúdo JSX já está 100% i18n.

**Subtarefas Kanban:**

- [ ] Migrar os `title=` hardcoded para `t()`
- [ ] Migrar as mensagens de erro dos .ts para chaves i18n
- [ ] Grep final por strings pt/en fora do translations

---

### CARD UX-011 — Onboarding e discoverability por módulo

| Campo          | Valor                              |
| -------------- | ---------------------------------- |
| **ID**         | UX-011                             |
| **Prioridade** | P3                                 |
| **Esforço**    | M                                  |
| **Labels**     | ux, onboarding                     |
| **Arquivos**   | `src/components/WelcomeTour.tsx`, `src/contexts/OnboardingContext.tsx` |

**Problema:** WelcomeTour/HelpPanel existem, mas não há tour por módulo (finanças, projetos, estudos), os empty states do Dashboard não têm CTA e os atalhos não são descobríveis.

**Subtarefas Kanban:**

- [ ] Tour curto por módulo no primeiro acesso a cada um
- [ ] Empty states com CTA (criar primeiro quadro/transação/tópico)
- [ ] Atualizar o help com a navegação atual (Documentos → Projetos)
- [ ] Lista de atalhos acessível pelo Help

---

## Tópico: Confiabilidade

---

### CARD REL-001 — Backup restore transacional

| Campo          | Valor                                     |
| -------------- | ----------------------------------------- |
| **ID**         | REL-001                                   |
| **Prioridade** | P0                                        |
| **Esforço**    | L                                         |
| **Labels**     | confiabilidade, backup, edge-functions    |
| **Arquivos**   | `supabase/functions/site-backup/index.ts` |

**Problema:** O restore (site-backup/index.ts:359) faz `delete()` de TODAS as linhas de cada tabela e depois insere o backup, sem transação, lock ou rollback — uma falha no meio (rede, constraint) deixa o banco meio-vazio com perda real de dados.

**Subtarefas Kanban:**

- [ ] Reescrever o restore como função SQL transacional (tudo ou nada)
- [ ] Lock/flag de manutenção durante o restore
- [ ] Backup automático de segurança imediatamente antes de restaurar
- [ ] Dry-run que valida o arquivo sem tocar no banco
- [ ] Registrar no audit log (SEC-007)

---

### CARD REL-002 — Rollback em optimistic updates (inventário: useStudyTopics)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | REL-002                                |
| **Prioridade** | P1                                     |
| **Esforço**    | M                                      |
| **Labels**     | confiabilidade, study, erros           |
| **Arquivos**   | `src/modules/study/useStudyTopics.ts`, `src/contexts/PagesContext.tsx` |

**Problema:** As mutações otimistas não revertem em falha — o exemplo mais puro é o useStudyTopics (:147–:253): update/delete de tópico/card some da tela e continua no banco, e `rescheduleCards` dispara Promise.all de N updates descartando resultado (persistência parcial silenciosa); `deletePage` no PagesContext tem o mesmo padrão.

**Subtarefas Kanban:**

- [ ] Padrão comum: snapshot → mutação → rollback + toast em erro
- [ ] Aplicar nas 6 mutações do useStudyTopics
- [ ] `rescheduleCards`: aguardar resultados e reportar parciais
- [ ] Aplicar em deletePage/updatePage do PagesContext
- [ ] Teste com client fake cobrindo o rollback (casar com QA-001)

---

### CARD REL-003 — Auto-backup só via cron

| Campo          | Valor                                 |
| -------------- | ------------------------------------- |
| **ID**         | REL-003                               |
| **Prioridade** | P1                                    |
| **Esforço**    | S                                     |
| **Labels**     | confiabilidade, backup                |
| **Arquivos**   | `src/modules/backup/useSiteBackup.ts` |

**Problema:** O auto-backup ainda dispara do browser (useSiteBackup.ts:66 — depende de alguém abrir o app) apesar de a edge function já aceitar `BACKUP_CRON_SECRET` para agendamento server-side; a UI não mostra quando será o próximo backup.

**Subtarefas Kanban:**

- [ ] Configurar o cron (Supabase cron ou externo) chamando a edge com o secret
- [ ] Remover o disparo automático do browser (manter só o manual)
- [ ] UI: exibir último backup e próximo agendamento
- [ ] Alerta se o backup agendado falhar (casar com REL-008)

---

### CARD REL-004 — Conflitos de colaboração em notas e desenhos

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | REL-004                                  |
| **Prioridade** | P2                                       |
| **Esforço**    | L                                        |
| **Labels**     | confiabilidade, colaboração              |
| **Arquivos**   | `src/components/NoteEditor.tsx`, `src/components/DrawingCanvas.tsx` |

**Problema:** Edição simultânea é last-write-wins silencioso (NoteEditor.tsx:111, DrawingCanvas.tsx:101 aplicam o remoto automaticamente numa janela de tempo) — dois editores ativos se sobrescrevem sem aviso.

**Subtarefas Kanban:**

- [ ] Detectar conflito (versão/updated_at) em vez de sobrescrever direto
- [ ] Banner "outra pessoa editou" com opção de recarregar/manter
- [ ] Usar a presença (usePagePresence) para avisar de co-edição ativa
- [ ] Avaliar CRDT/merge de longo prazo — documentar decisão

---

### CARD REL-005 — Realtime no módulo de Projetos

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | REL-005                                  |
| **Prioridade** | P2                                       |
| **Esforço**    | L                                        |
| **Labels**     | confiabilidade, realtime, projects       |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Zero channel no ProjectsPanel — em quadros compartilhados, outro usuário move/cria cards e você só vê ao recarregar; o TodoList já mostra o padrão de subscription.

**Subtarefas Kanban:**

- [ ] Channel por board (project_cards/project_columns) quando o quadro é compartilhado
- [ ] Aplicar deltas (INSERT/UPDATE/DELETE) sem reload completo
- [ ] Resolver corrida com drag em andamento (não aplicar delta durante o drag)
- [ ] Cleanup do channel na troca de quadro

---

### CARD REL-006 — Notifications realtime completo

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | REL-006                                |
| **Prioridade** | P2                                     |
| **Esforço**    | S                                      |
| **Labels**     | confiabilidade, realtime               |
| **Arquivos**   | `src/contexts/NotificationsContext.tsx` |

**Problema:** A subscription só escuta INSERT (NotificationsContext:43) — marcar como lida em outra aba/dispositivo ou deletar não sincroniza; o contador fica errado até o próximo reload.

**Subtarefas Kanban:**

- [ ] Escutar UPDATE e DELETE no channel
- [ ] Aplicar deltas no estado local
- [ ] Testar com duas abas abertas

---

### CARD REL-007 — Fila offline para saves de conteúdo

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | REL-007                                  |
| **Prioridade** | P2                                       |
| **Esforço**    | L                                        |
| **Labels**     | confiabilidade, offline                  |
| **Arquivos**   | `src/hooks/useCollaborativeContent.ts` |

**Problema:** Zero tratamento de offline (nenhum navigator.onLine/IndexedDB no src) — perder a conexão durante a edição de nota/desenho descarta silenciosamente os saves debounced.

**Subtarefas Kanban:**

- [ ] Detectar offline e segurar os saves numa fila local (IndexedDB)
- [ ] Reenviar na reconexão com resolução de conflito (REL-004)
- [ ] Indicador visual de "alterações não salvas / offline"
- [ ] Testar com devtools offline no meio da edição

---

### CARD REL-008 — Monitoring e alertas

| Campo          | Valor                        |
| -------------- | ---------------------------- |
| **ID**         | REL-008                      |
| **Prioridade** | P2                           |
| **Esforço**    | M                            |
| **Labels**     | confiabilidade, monitoring   |
| **Arquivos**   | `src/main.tsx`               |

**Problema:** Nenhum error tracking (Sentry ou similar), nenhum alerta de backup falho, nenhum uptime check — erros em produção só aparecem se o usuário reportar.

**Subtarefas Kanban:**

- [ ] Integrar error tracking no root + ErrorBoundaries (ARCH-001)
- [ ] Alerta (e-mail/webhook) quando o backup cron falhar
- [ ] Uptime check no deploy
- [ ] Dashboard mínimo de erros por versão

---

## Tópico: DevOps / Infra

---

### CARD DEV-001 — Pipeline de deploy das edge functions

| Campo          | Valor                                     |
| -------------- | ----------------------------------------- |
| **ID**         | DEV-001                                   |
| **Prioridade** | P1                                        |
| **Esforço**    | S                                         |
| **Labels**     | devops, edge-functions, ci                |
| **Arquivos**   | `.github/workflows/ci.yml`, `supabase/functions/` |

**Problema:** O CI roda tsc+vitest+build mas não toca em `supabase/functions/` — o deploy das functions é manual e sem verificação, então a versão remota pode divergir do repo sem ninguém saber.

**Subtarefas Kanban:**

- [ ] Job de deploy das functions (supabase CLI) em push na main
- [ ] Checagem de tipo/deno lint das functions no CI
- [ ] Secrets do CI (SUPABASE_ACCESS_TOKEN, project ref)
- [ ] Documentar o fluxo em docs/

---

### CARD DEV-002 — Validar env no boot e documentar deploy

| Campo          | Valor                 |
| -------------- | --------------------- |
| **ID**         | DEV-002               |
| **Prioridade** | P2                    |
| **Esforço**    | S                     |
| **Labels**     | devops, env           |
| **Arquivos**   | `src/lib/supabase.ts` |

**Problema:** `lib/supabase.ts:3` usa as env vars sem validar ausência — env faltando vira erro criptico em runtime; o README não tem seção de deploy (a doc real está só em docs/deploy-coolify.md).

**Subtarefas Kanban:**

- [ ] Falhar cedo com mensagem clara se VITE_SUPABASE_URL/ANON_KEY faltarem
- [ ] Conferir .env.example completo e referenciado no README
- [ ] Seção de deploy no README apontando docs/deploy-coolify.md

---

### CARD DEV-003 — Ambiente local Supabase completo

| Campo          | Valor                  |
| -------------- | ---------------------- |
| **ID**         | DEV-003                |
| **Prioridade** | P2                     |
| **Esforço**    | M                      |
| **Labels**     | devops, supabase       |
| **Arquivos**   | `supabase/config.toml` |

**Problema:** O config.toml existe, mas sem o baseline (SEC-001) o `supabase db reset` local sai incompleto — o próprio arquivo avisa; não há seed de dados nem doc de `functions serve`.

**Subtarefas Kanban:**

- [ ] Depende de SEC-001 (baseline) — validar `db reset` completo
- [ ] Script de seed com dados de exemplo
- [ ] Documentar `supabase start` + `functions serve` no README
- [ ] Env local de exemplo para as functions

---

### CARD DEV-004 — README real do projeto

| Campo          | Valor       |
| -------------- | ----------- |
| **ID**         | DEV-004     |
| **Prioridade** | P2          |
| **Esforço**    | S           |
| **Labels**     | devops, docs |
| **Arquivos**   | `README.md` |

**Problema:** O README ainda é o template do Vite ("React + TypeScript + Vite") — zero informação sobre o que o app é, como rodar, arquitetura de módulos ou deploy.

**Subtarefas Kanban:**

- [ ] Descrição do app e screenshot
- [ ] Setup local (npm, env, supabase)
- [ ] Mapa de módulos (link para os READMEs de cada um)
- [ ] Comandos de verificação (tsc -b --force, vitest, lint por arquivo)
- [ ] Badge do CI

---

### CARD DEV-005 — Dependabot e npm audit no CI

| Campo          | Valor         |
| -------------- | ------------- |
| **ID**         | DEV-005       |
| **Prioridade** | P2            |
| **Esforço**    | S             |
| **Labels**     | devops, deps  |
| **Arquivos**   | `.github/`    |

**Problema:** Sem dependabot.yml nem `npm audit` no CI — dependências (inclusive as com CVE) só são atualizadas manualmente quando alguém lembra.

**Subtarefas Kanban:**

- [ ] dependabot.yml (npm semanal, agrupado)
- [ ] `npm audit --audit-level=high` no CI (não bloqueante no início)
- [ ] Remover deps mortas na primeira rodada (react-router-dom — ARCH-005)

---

### CARD DEV-006 — Preview deployments por PR

| Campo          | Valor          |
| -------------- | -------------- |
| **ID**         | DEV-006        |
| **Prioridade** | P3             |
| **Esforço**    | M              |
| **Labels**     | devops, deploy |
| **Arquivos**   | `netlify.toml` |

**Problema:** Sem preview por PR — toda validação visual é local; um segundo ambiente evitaria testar direto em produção.

**Subtarefas Kanban:**

- [ ] Habilitar deploy preview (Netlify ou Coolify) por branch/PR
- [ ] Env de preview apontando para projeto Supabase de staging ou anon limitado
- [ ] Link do preview no PR via CI

---

## Tópico: Qualidade de código

---

### CARD QA-001 — Testes dos hooks Supabase com client fake

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | QA-001                                 |
| **Prioridade** | P1                                     |
| **Esforço**    | L                                      |
| **Labels**     | testes, hooks, supabase                |
| **Arquivos**   | `src/modules/study/useStudyTopics.ts`, `src/modules/finance/store/useFinanceStore.ts`, `src/hooks/useCollaborativeContent.ts` |

**Problema:** Nenhum hook que fala com Supabase tem teste — useStudyTopics (276 LOC, CRUD otimista), useFinanceStore (521 LOC, mutações sobre dinheiro), useCollaborativeContent (merge de realtime), usePagePresence — exatamente a camada onde vivem os bugs de escrita silenciosa; `useSiteBackup.test.ts` já prova que dá para testar com client fake.

**Subtarefas Kanban:**

- [ ] Extrair/reutilizar o padrão de client fake do useSiteBackup.test
- [ ] Testes do useFinanceStore (mutações + erros)
- [ ] Testes do useStudyTopics (CRUD + rollback do REL-002)
- [ ] Testes do useCollaborativeContent (merge/conflito)
- [ ] Testes do usePagePresence (upsert/delete/race)

---

### CARD QA-002 — ESLint type-aware e lint bloqueante no CI

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | QA-002                                 |
| **Prioridade** | P1                                     |
| **Esforço**    | M                                      |
| **Labels**     | lint, ci, typescript                   |
| **Arquivos**   | `eslint.config.js`, `.github/workflows/ci.yml` |

**Problema:** O ESLint usa configs não type-checked e o CI roda o lint com `continue-on-error: true` — o lint falha globalmente há meses e o CI passa verde, então novas violações entram sem fricção.

**Subtarefas Kanban:**

- [ ] Ativar `recommendedTypeChecked` com projectService
- [ ] Zerar os erros por diretório (burn-down por módulo)
- [ ] Remover o continue-on-error quando zerar
- [ ] Enquanto isso: lint bloqueante só nos arquivos alterados (lint-staged ou diff no CI)

---

### CARD QA-003 — TypeScript strict incremental

| Campo          | Valor               |
| -------------- | ------------------- |
| **ID**         | QA-003              |
| **Prioridade** | P2                  |
| **Esforço**    | L                   |
| **Labels**     | typescript          |
| **Arquivos**   | `tsconfig.app.json` |

**Problema:** O tsconfig não tem `strict` (só noUnusedLocals/Parameters/noFallthrough) — sem strictNullChecks, toda a superfície de null/undefined do Supabase passa sem verificação.

**Subtarefas Kanban:**

- [ ] Ligar flags incrementais (noImplicitAny → strictNullChecks → strict)
- [ ] Corrigir por módulo, começando pelos menores (backup, study)
- [ ] Casar com os tipos gerados (ARCH-004) para reduzir o custo
- [ ] Travar cada flag conquistada no CI

---

### CARD QA-004 — Desbloquear testes de DOM

| Campo          | Valor                              |
| -------------- | ---------------------------------- |
| **ID**         | QA-004                             |
| **Prioridade** | P2                                 |
| **Esforço**    | M                                  |
| **Labels**     | testes, dom                        |
| **Arquivos**   | `vite.config.ts`, `package.json`   |

**Problema:** O vitest roda com environment 'node' global e não há @testing-library/react — nenhum componente/modal é testável hoje; o desbloqueio é barato: happy-dom por-arquivo já funciona (markdownHtml.test.ts prova) mas ninguém documentou.

**Subtarefas Kanban:**

- [ ] Adicionar @testing-library/react + user-event
- [ ] Documentar o padrão do docblock `@vitest-environment happy-dom`
- [ ] Primeiro teste de componente (um modal simples ou RailItem)
- [ ] Teste de um fluxo com interação (marcar checkbox do import)

---

### CARD QA-005 — Testes das funções puras do PagesContext

| Campo          | Valor                           |
| -------------- | ------------------------------- |
| **ID**         | QA-005                          |
| **Prioridade** | P2                              |
| **Esforço**    | S                               |
| **Labels**     | testes, pages                   |
| **Arquivos**   | `src/contexts/PagesContext.tsx` |

**Problema:** `buildTree`, `updateNodeInTree` e `removeNodeFromTree` sustentam a árvore da sidebar/Documentos inteira e têm cobertura zero — custo de teste baixíssimo (são puras), risco alto.

**Subtarefas Kanban:**

- [ ] Extrair as 3 funções para `src/lib/pageTree.ts`
- [ ] Testes: árvore aninhada, órfãos, reparenting, delete com filhos
- [ ] PagesContext importa do novo módulo (sem mudança de comportamento)

---

### CARD QA-006 — Generalizar o Modal do finance/ui e adotar no app

| Campo          | Valor                              |
| -------------- | ---------------------------------- |
| **ID**         | QA-006                             |
| **Prioridade** | P2                                 |
| **Esforço**    | M                                  |
| **Labels**     | dx, modal, shared                  |
| **Arquivos**   | `src/modules/finance/ui/Modal.tsx` |

**Problema:** Um Modal completo (sheet mobile + dialog desktop) já existe em finance/ui, mas depende de `useFinanceMobile` e nada fora do financeiro o usa — 15 arquivos reconstroem `position:fixed; inset:0` à mão, cada um com comportamento diferente.

**Subtarefas Kanban:**

- [ ] Mover Modal/Drawer para `src/shared/ui/` sem a dependência finance (ARCH-008)
- [ ] Incorporar a acessibilidade do UX-004 no shell único
- [ ] Migrar os modais de Projetos e Documentos
- [ ] Migrar os demais (admin, study) incrementalmente

---

### CARD QA-007 — Unificar flattenPages

| Campo          | Valor                        |
| -------------- | ---------------------------- |
| **ID**         | QA-007                       |
| **Prioridade** | P2                           |
| **Esforço**    | S                            |
| **Labels**     | dx, pages                    |
| **Arquivos**   | `src/components/PageTree.tsx` |

**Problema:** `flattenPages` está reimplementado 6× (PageTree oficial + ExportPdfModal, ProjectsPanel, Dashboard, ItemPicker, QuickNotes) e 2 cópias já divergem no tratamento de sharedPages — mudanças na forma da árvore precisam ser aplicadas 6 vezes.

**Subtarefas Kanban:**

- [ ] Canonizar em `src/lib/pageTree.ts` (junto com QA-005)
- [ ] Substituir as 5 cópias
- [ ] Decidir e documentar o contrato (inclui sharedPages ou recebe a lista)

---

### CARD QA-008 — Suíte E2E Playwright versionada

| Campo          | Valor                  |
| -------------- | ---------------------- |
| **ID**         | QA-008                 |
| **Prioridade** | P2                     |
| **Esforço**    | L                      |
| **Labels**     | testes, e2e            |
| **Arquivos**   | `testsprite_tests/`    |

**Problema:** Os specs em testsprite_tests/ são gerados por ferramenta externa (Python, não versionados como suíte própria) e playwright não está nas devDependencies nem no CI — não há E2E reproduzível dos fluxos críticos.

**Subtarefas Kanban:**

- [ ] Playwright em devDependencies com config própria
- [ ] E2E dos fluxos: login, criar página, criar transação, criar card
- [ ] Usuário de teste/seed dedicado (DEV-003)
- [ ] Rodar no CI (smoke em PR, suíte completa na main)

---

### CARD QA-009 — Unificar os dois kanbans

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | QA-009                                       |
| **Prioridade** | P3                                           |
| **Esforço**    | L                                            |
| **Labels**     | dx, kanban, projects                         |
| **Arquivos**   | `src/components/board/`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Convivem dois kanbans: `components/board/` (genérico, memoizado, com modelo puro testado — usado só pelo financeiro) e a implementação inline do ProjectsPanel (~400 LOC dnd-kit sem teste) — correções de drag/ordenação precisam ser feitas duas vezes, e o kanban principal é justamente o sem teste.

**Subtarefas Kanban:**

- [ ] Mapear o delta de features entre os dois (colunas dinâmicas, drag de coluna)
- [ ] Estender o board genérico com o que falta
- [ ] Migrar o ProjectsPanel para o board genérico
- [ ] Aposentar a implementação inline
- [ ] Cuidado com o comentário do handleDragOver (loop corrigido) — portar o fix

---

### CARD QA-010 — Unificar modais de import e constantes de prioridade

| Campo          | Valor                                       |
| -------------- | ------------------------------------------- |
| **ID**         | QA-010                                      |
| **Prioridade** | P3                                          |
| **Esforço**    | S                                           |
| **Labels**     | dx, projects                                |
| **Arquivos**   | `src/components/ImportProjectCardsModal.tsx`, `src/modules/projects/ImportCardsModal.tsx` |

**Problema:** Dois modais consomem o mesmo backlogMarkdownParser com preview e mapa de prioridades duplicados, e PRIORITY_COLORS/labels existem em 6 lugares (inclusive labels PT hardcoded no usePdfExport) — a mesma prioridade já renderiza diferente entre board, bloco de nota, import e PDF.

**Subtarefas Kanban:**

- [ ] `src/lib/cardPriority.ts` único (cores + chaves i18n)
- [ ] Substituir as 6 cópias
- [ ] Extrair a tabela de preview comum dos dois modais de import
- [ ] Avaliar fundir os dois modais (o de nota e o de quadro)

---

### CARD QA-011 — Compartilhar os primitivos de rail

| Campo          | Valor                                   |
| -------------- | --------------------------------------- |
| **ID**         | QA-011                                  |
| **Prioridade** | P3                                      |
| **Esforço**    | S                                       |
| **Labels**     | dx, ui                                  |
| **Arquivos**   | `src/modules/projects/ProjectsNav.tsx`, `src/modules/study/StudyNav.tsx`, `src/components/DocumentsPanel.tsx` |

**Problema:** RailButton/GroupTitle/RailItem existem em 3 variantes (ProjectsNav — com comentário admitindo a cópia —, StudyNav e DocumentsPanel) com hover/active levemente diferentes na mesma tela de Documentos.

**Subtarefas Kanban:**

- [ ] Mover RailButton/GroupTitle/RailItem para `src/shared/ui/` (depende de ARCH-008)
- [ ] Unificar os tokens de estado (active/hover/fontWeight)
- [ ] Migrar os 3 consumidores
- [ ] Conferir visualmente as três seções lado a lado

---

### CARD QA-012 — Tipar as APIs de Excalidraw e BlockNote

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | QA-012                                   |
| **Prioridade** | P3                                       |
| **Esforço**    | M                                        |
| **Labels**     | typescript, editor                       |
| **Arquivos**   | `src/components/DrawingCanvas.tsx`, `src/components/DiagramBlock.tsx`, `src/components/NoteEditor.tsx` |

**Problema:** ~10 `eslint-disable no-explicit-any` concentrados no DrawingCanvas (8×), DiagramBlock e NoteEditor — as fronteiras com as duas maiores libs do app não têm nenhuma garantia de tipo.

**Subtarefas Kanban:**

- [ ] Usar os tipos exportados oficiais (@excalidraw/excalidraw types, BlockNote schema types)
- [ ] Wrapper tipado para os pontos sem tipo oficial
- [ ] Remover os eslint-disable
- [ ] Casar com QA-003 (strict) nesses arquivos

---

### CARD QA-013 — Documentar e migrar as chaves excalinotion_* com segurança

| Campo          | Valor                                       |
| -------------- | ------------------------------------------- |
| **ID**         | QA-013                                      |
| **Prioridade** | P3                                          |
| **Esforço**    | S                                           |
| **Labels**     | dx, localstorage, naming                    |
| **Arquivos**   | `src/lib/docsNavigation.ts`, `src/contexts/PagesContext.tsx` |

**Problema:** O produto chama Akool mas 14 chaves de localStorage seguem `excalinotion_*` — renomear a seco perderia estado vivo dos usuários (a lição do finance/myprojects); hoje não há sequer um inventário das chaves.

**Subtarefas Kanban:**

- [ ] Inventariar todas as chaves de localStorage/sessionStorage num doc único
- [ ] Decidir: manter com alias documentado ou migrar com leitura dupla (novo→velho)
- [ ] Se migrar: migração one-shot no boot, no padrão do docsNavigation
- [ ] Teste das funções de migração (chave velha, nova, ausente)

---

