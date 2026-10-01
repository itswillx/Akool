# Backlog Akool: Auditoria 2026-09

> 87 cards no formato BacklogCard v1. Importar em Projetos → Importar, num **quadro novo** (ex.: "Auditoria 2026-09").
> A numeração recomeça: os IDs **não** batem com os de `backlog-completo-2026-08.md`.
> Fontes: auditoria estática do código (25/09/2026), advisors do Supabase e queries somente leitura no projeto `nhfftophadasiezrzlsv`.
> Este arquivo **não** traz credenciais nem segredos. Onde houve vazamento, o card cita só o arquivo afetado.

## Resumo executivo

O Akool avançou bastante desde agosto: rate limiting, restore transacional com audit log, escape no `ilike`, papel de admin travado, leitura de storage por dono ou share e toasts globais já estão no código. Mas três problemas exigem ação imediata:

1. **Credencial admin exposta.** O e-mail e a senha da conta dona do projeto (admin) estão em texto puro em cerca de 28 scripts do TestSprite. **Troque a senha antes de qualquer outra coisa** (SEC-001).
2. **Sem backup desde 30/07/2026.** A function `site-backup` ainda cita 5 tabelas dropadas em 07/08, então todo backup falha. As tabelas da Loja nunca entraram no backup (REL-001).
3. **Escalada de acesso via shares.** Qualquer usuário consegue re-apontar uma share própria para a página ou o quadro de outra pessoa e ganhar leitura e escrita. Isso foi confirmado nas policies do remoto (SEC-002).

### Por categoria

| Categoria           | P0 | P1 | P2 | P3 | Total | Principais riscos |
| ------------------- | -- | -- | -- | -- | ----- | ----------------- |
| Segurança           | 1  | 3  | 8  | 6  | 18    | credencial admin no repo; shares re-apontáveis; cron secret com poder de restore; sem MFA e senha mínima de 6 |
| Confiabilidade      | 1  | 1  | 9  | 1  | 12    | backup parado; editor sobrescreve nota em erro de rede; mutações sem rollback; logout às 21h (UTC) |
| Performance         | 0  | 2  | 7  | 6  | 15    | re-render global por contexts; 90 policies RLS com initplan e 26 FKs sem índice; load financeiro serial; 1 UPDATE por card no drag |
| UX e Acessibilidade | 0  | 3  | 8  | 4  | 15    | Enter confirma exclusão/restore com foco em Cancelar; navegação sem teclado; modais sem focus trap; foco invisível; contraste baixo |
| Arquitetura         | 0  | 0  | 4  | 5  | 9     | FinancePanel com 4913 linhas; ProjectsPanel com 2936 e dois kanbans; sem camada de dados nem tipos gerados |
| Qualidade de código | 0  | 0  | 3  | 3  | 6     | hooks e edges sem teste; TS sem `strict`; sem testes E2E próprios |
| DevOps e Infra      | 0  | 1  | 6  | 5  | 12    | sem CI; testes contra produção; tela branca sem env; README de template |
| **Total**           | 2  | 10 | 45 | 30 | 87    | |

### Índice por urgência

- **P0 (2):** SEC-001, REL-001
- **P1 (10):** SEC-002..004 · REL-002 · PERF-001..002 · UX-001..003 · DEV-001
- **P2 (45):** SEC-005..012 · REL-003..011 · PERF-003..009 · UX-004..011 · ARCH-001..004 · QA-001..003 · DEV-002..007
- **P3 (30):** SEC-013..018 · REL-012 · PERF-010..015 · UX-012..015 · ARCH-005..009 · QA-004..006 · DEV-008..012

### Ordem sugerida (primeiras duas semanas)

1. SEC-001: trocar a senha e revogar sessões (hoje)
2. REL-001: restaurar o backup e disparar um backup manual
3. SEC-002 e SEC-003: fechar as shares e o cron secret
4. UX-001: tirar o Enter global do modal de exclusão (5 min, evita restore acidental)
5. DEV-001: CI mínimo para segurar regressões nas correções acima
6. SEC-004 e PERF-002: MFA e senha vazada; migration de RLS e índices

### Verificado no banco remoto (25/09/2026)

- `site_backups`: 8 backups `completed`, o último em **30/07/2026 22:59 UTC**. As tabelas `finance_projects`, `finance_project_stages`, `_items`, `_quotes` e `_expenses` **não existem mais**.
- `page_shares_update`/`project_shares_update`: `qual` e `with_check` = `owner_id = auth.uid()`. `authenticated` tem UPDATE em `page_id`/`board_id`. Não há trigger nessas tabelas.
- `restore_site_backup(jsonb)`: **não** é executável por anon nem por authenticated. O achado inicial era falso positivo e foi descartado.
- `admin_revoke_user_sessions`, `admin_add_invite_slots` e `generate_invite_code`: executáveis por authenticated (com checagem interna de admin).
- Advisor de segurança: 35 funções SECURITY DEFINER executáveis por authenticated; `validate_invite_code` também por anon; proteção contra senha vazada **desligada**; 3 tabelas com RLS e sem policy (intencional: `profile_secrets`, `private.rate_limits`, `study_lookup_cache`).
- Advisor de performance: 90 `auth_rls_initplan`, 91 `multiple_permissive_policies`, 26 FKs sem índice e 67 índices sem uso.
- Volume: nenhuma tabela pública passa de 500 linhas. O corte em 1000 linhas (REL-003) ainda é risco latente.

### Resolvido desde o backlog 2026-08 (IDs antigos, fora deste arquivo)

SEC-002 (escape no `ilike`), SEC-003 (admin-ops versionada e com checagem no servidor), SEC-004 (leitura de buckets por dono ou share), SEC-007 (role só via edge + `audit_log`), SEC-008 (rate limiting), PERF-002 (financeiro sem reload global), PERF-003 (DiagramCanvas lazy), PERF-007 (PagesContext com refresh silencioso), ARCH-001 (ErrorBoundary por painel), ARCH-002 (contrato do `user` no AuthContext), REL-001 (restore transacional; regrediu, ver REL-001 novo), REL-002 (helpers otimistas), UX-001 (toast global) e UX-002 (erros do financeiro).

Parciais do backlog antigo foram reescritos aqui só com o que falta.

---

## Tópico: Segurança

---

### CARD SEC-001 — Remover credencial de admin dos testes TestSprite e trocar a senha

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | SEC-001                                                               |
| **Prioridade** | P0                                                                    |
| **Esforço**    | S                                                                     |
| **Labels**     | segurança, credenciais, testes, admin                                 |
| **Arquivos**   | `testsprite_tests/TC0*.py`, `testsprite_tests/standard_prd.json`      |

**Problema:** O e-mail e a senha (numérica, 9 dígitos) da conta dona do projeto, que é admin, estão em texto puro em cerca de 28 scripts `TC0*.py` (nos comentários e nos `fill()`) e em `standard_prd.json:177-180`. Quem tiver acesso ao repositório, ou adivinhar a senha, consegue apagar e restaurar o banco, banir ou excluir usuários e ler os dados financeiros.

**Subtarefas Kanban:**

- [ ] Trocar a senha da conta agora (mínimo de 12 caracteres, gerenciador de senhas)
- [ ] Revogar todas as sessões ativas da conta (Auth → Users → Sign out)
- [ ] Trocar os valores fixos por `{{LOGIN_USER}}`/`{{LOGIN_PASSWORD}}` vindos de env, como o `testsprite_frontend_test_plan.json` já faz
- [ ] Apagar a credencial do histórico do Git (`git filter-repo`) se o repo for, ou vier a ser, compartilhado
- [ ] Revisar os auth logs e o `audit_log` em busca de logins ou ações desconhecidas
- [ ] Adicionar gitleaks (secret scan) no pre-commit e no CI

---

### CARD SEC-002 — Shares permitem re-apontar page_id/board_id (escalada de acesso)

| Campo          | Valor                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-002                                                                                                 |
| **Prioridade** | P1                                                                                                      |
| **Esforço**    | M                                                                                                       |
| **Labels**     | segurança, rls, supabase, compartilhamento                                                              |
| **Arquivos**   | `supabase/migrations/20260509000000_baseline_remote_schema.sql`, `docs/matriz-rls.md`                   |

**Problema:** Confirmado no remoto em 25/09: as policies `page_shares_update` e `project_shares_update` só checam `owner_id = auth.uid()`, `authenticated` tem UPDATE nas colunas `page_id`/`board_id` e nenhum trigger impede a troca. Um usuário cria uma share na própria página e depois faz PATCH do `page_id` ou `board_id` para o recurso de outra pessoa, escolhendo o `role`. Com isso ganha leitura e escrita, inclusive das imagens no storage, e pode se reconceder acesso depois de revogado. A `matriz-rls.md` conclui o contrário.

**Subtarefas Kanban:**

- [ ] `revoke update on page_shares, project_shares from authenticated` + `grant update(role)` apenas
- [ ] Trigger BEFORE UPDATE que congela `page_id`, `board_id`, `owner_id` e `shared_with_user_id`
- [ ] WITH CHECK do UPDATE exigindo `current_user_can_share_page(page_id)` ou ser dono do board
- [ ] `page_is_readable`, `page_is_writable` e `user_can_access_board` só aceitam shares cujo `owner_id` seja dono ou co_owner do recurso
- [ ] Query de auditoria: listar e remover shares em que `owner_id` ≠ dono do recurso
- [ ] Teste via REST com 3 usuários e correção de `docs/matriz-rls.md`

---

### CARD SEC-003 — BACKUP_CRON_SECRET libera todas as ações do site-backup

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | SEC-003                                                               |
| **Prioridade** | P1                                                                    |
| **Esforço**    | S                                                                     |
| **Labels**     | segurança, edge-functions, backup                                     |
| **Arquivos**   | `supabase/functions/site-backup/index.ts`, `supabase/config.toml`     |

**Problema:** Com o header `x-cron-secret`, o `verifyAdmin` (`site-backup/index.ts:108-116`) libera qualquer ação, inclusive `restore_backup`, `delete_backup` e `update_settings`. A função é exposta com `verify_jwt = false`, e a comparação usa `===`, que não roda em tempo constante.

**Subtarefas Kanban:**

- [ ] Aceitar o segredo só quando `action === "run_auto_backup"`
- [ ] Exigir JWT de admin (e AAL2, ver SEC-004) para restore, delete e settings
- [ ] Comparar o segredo em tempo constante (`timingSafeEqual`)
- [ ] Rotacionar o `BACKUP_CRON_SECRET` depois do deploy
- [ ] Teste: com o cron secret, `restore_backup` retorna 403

---

### CARD SEC-004 — MFA para admin, política de senha e proteção contra senha vazada

| Campo          | Valor                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-004                                                                                                    |
| **Prioridade** | P1                                                                                                         |
| **Esforço**    | M                                                                                                          |
| **Labels**     | segurança, auth, mfa, supabase                                                                             |
| **Arquivos**   | `supabase/config.toml`, `src/components/UserSettingsModal.tsx`, `src/pages/ResetPasswordPage.tsx`, `supabase/functions/admin-ops/index.ts` |

**Problema:** Uma única senha fraca basta para apagar e restaurar o banco inteiro. Não há MFA. O mínimo de senha é 6 caracteres (`UserSettingsModal.tsx:233`, `ResetPasswordPage.tsx:25`). O advisor do Supabase mostra a proteção contra senha vazada (HaveIBeenPwned) desligada. `admin-ops` e `site-backup` não checam `aal`.

**Subtarefas Kanban:**

- [ ] Habilitar MFA TOTP no Auth e criar o fluxo de enrolment na tela de configurações
- [ ] Exigir `aal2` no JWT em `admin-ops` e `site-backup`
- [ ] Ligar "Leaked password protection" no dashboard do Supabase
- [ ] Mínimo de 10+ caracteres com requisitos, aplicado no servidor e no cliente
- [ ] Codificar essas configurações em `supabase/config.toml` (`[auth]`)

---

### CARD SEC-005 — Re-parent de páginas mantém acesso e permite páginas sob IDs alheios

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | SEC-005                                                               |
| **Prioridade** | P2                                                                    |
| **Esforço**    | M                                                                     |
| **Labels**     | segurança, rls, pages                                                 |
| **Arquivos**   | `supabase/migrations/20260509000000_baseline_remote_schema.sql`       |

**Problema:** O único trigger em `pages` (`prevent_page_ownership_transfer`) congela só o `user_id`. Um editor muda o `parent_id` de uma página compartilhada para uma página própria e continua com acesso pelo ancestral depois que a share é revogada. O `pages_insert` também não valida o `parent_id`, então qualquer usuário consegue criar páginas penduradas no ID de uma página alheia.

**Subtarefas Kanban:**

- [ ] Trigger: só permitir mudar `parent_id` para uma página do mesmo dono
- [ ] `pages_insert` WITH CHECK: `parent_id is null or page_is_writable(parent_id)`
- [ ] Varrer as páginas existentes cujo pai tem outro `user_id`
- [ ] Teste de revogação feita depois de um re-parent

---

### CARD SEC-006 — Revogar sessões e desativar usuário não surtem efeito

| Campo          | Valor                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-006                                                                                                                |
| **Prioridade** | P2                                                                                                                     |
| **Esforço**    | S                                                                                                                      |
| **Labels**     | segurança, admin, auth, edge-functions                                                                                 |
| **Arquivos**   | `supabase/migrations/20260812140000_sec_admin_revoke_sessions.sql`, `supabase/functions/admin-ops/index.ts`            |

**Problema:** A `admin-ops` chama `admin_revoke_user_sessions` com o client service_role. Nesse contexto `auth.uid()` é nulo, `is_admin()` retorna falso e a função lança "Forbidden". O erro vai só para o `console.error`, enquanto a UI e o `audit_log` registram sucesso, então as sessões nunca são revogadas ao banir ou rebaixar alguém. Além disso, nenhuma policy RLS olha `is_active`.

**Subtarefas Kanban:**

- [ ] Aceitar o claim `role = service_role` na função, ou restringi-la a service_role sem `is_admin()`
- [ ] Tratar `revokeErr` como falha: HTTP de erro + `audit success=false`
- [ ] Bloquear a escrita direta de `is_active` pela REST (fazer só via edge)
- [ ] Teste de integração: após o ban, o refresh token é recusado

---

### CARD SEC-007 — Remover edge functions órfãs em produção

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | SEC-007                                                               |
| **Prioridade** | P2                                                                    |
| **Esforço**    | S                                                                     |
| **Labels**     | segurança, edge-functions, supabase                                   |
| **Arquivos**   | `docs/deploy-coolify.md`, `supabase/migrations/README.md`             |

**Problema:** Segundo a documentação, `google-calendar` (com `Access-Control-Allow-Origin: *`) continua publicada sem fonte no repo, e `categorize-transactions` roda com service role sem código versionado. É superfície exposta que não dá para auditar. O CORS também está duplicado em 4 functions, sem um `_shared/cors.ts`.

**Subtarefas Kanban:**

- [ ] `supabase functions list` e comparar com as pastas de `supabase/functions/`
- [ ] `supabase functions delete google-calendar` e remover os secrets `GOOGLE_*`
- [ ] Baixar e revisar `categorize-transactions` (versionar ou excluir)
- [ ] Extrair `supabase/functions/_shared/cors.ts` com allowlist por ambiente
- [ ] Tirar localhost do default de `ALLOWED_ORIGINS` em produção

---

### CARD SEC-008 — Tirar do repositório dados reais e metadados de infra

| Campo          | Valor                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- |
| **ID**         | SEC-008                                                                                       |
| **Prioridade** | P2                                                                                            |
| **Esforço**    | S                                                                                             |
| **Labels**     | segurança, lgpd, repositório                                                                  |
| **Arquivos**   | `supabase/backups/20260807_obras_investimentos.json`, `supabase/.temp/`, `.gitignore`         |

**Problema:** `supabase/backups/*.json` traz `user_id`, `workspace_id`, orçamento, despesas e fornecedores com telefone. `supabase/.temp/` expõe o ref do projeto, o org id e o host e usuário do pooler. O `.gitignore` não cobre nenhum dos dois.

**Subtarefas Kanban:**

- [ ] Mover o JSON para o bucket privado `site-backups` e apagar do repo
- [ ] Adicionar `supabase/backups/` e `supabase/.temp/` ao `.gitignore`
- [ ] Purgar do histórico, se necessário
- [ ] Atualizar a referência em `20260807120000_finance_drop_works_investments.sql:15`

---

### CARD SEC-009 — CSP e headers de segurança consistentes em Netlify e Coolify

| Campo          | Valor                                                             |
| -------------- | ----------------------------------------------------------------- |
| **ID**         | SEC-009                                                           |
| **Prioridade** | P2                                                                |
| **Esforço**    | M                                                                 |
| **Labels**     | segurança, csp, headers, deploy                                   |
| **Arquivos**   | `netlify.toml`, `nixpacks.toml`, `index.html`, `vite.config.ts`   |

**Problema:** A CSP do `netlify.toml:18` usa `'unsafe-inline' 'unsafe-eval'`, `img-src *` e `connect-src https://*.supabase.co`. O deploy Coolify/Nixpacks não envia nenhum header de segurança nem HSTS. O script inline em `index.html:11` (`window.process`) obriga o uso de `unsafe-inline`.

**Subtarefas Kanban:**

- [ ] Trocar o script inline do `index.html` por `define` no `vite.config.ts`
- [ ] Remover `unsafe-inline` do `script-src`; avaliar se o Excalidraw ainda precisa de `unsafe-eval`
- [ ] Restringir `img-src` e `connect-src` ao domínio exato do projeto Supabase
- [ ] Configurar os mesmos headers + HSTS no Caddy/Coolify
- [ ] Validar com securityheaders.com e com o console sem violações de CSP

---

### CARD SEC-010 — Allowlist de esquemas de link no editor e nos cards

| Campo          | Valor                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-010                                                                                                 |
| **Prioridade** | P2                                                                                                      |
| **Esforço**    | S                                                                                                       |
| **Labels**     | segurança, xss, frontend                                                                                |
| **Arquivos**   | `src/lib/markdownHtml.ts`, `src/components/RichTextEditor.tsx`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** `markdownHtml.ts:45` bloqueia só `javascript:` (blocklist) e não adiciona `rel="noopener noreferrer"`, e o resultado vai para `innerHTML` (`RichTextEditor.tsx:42`). Os links de card (`ProjectsPanel.tsx:972`) são renderizados sem validar o esquema: um editor grava qualquer valor direto pela REST.

**Subtarefas Kanban:**

- [ ] Criar `safeHref()` compartilhado com allowlist (`http`, `https`, `mailto`)
- [ ] Usar no `markdownHtml` e na renderização dos links de card
- [ ] Adicionar `rel="noopener noreferrer"` e `target="_blank"` nos links externos
- [ ] CHECK ou trigger validando o esquema em `project_cards.links`
- [ ] Testes para `data:`, `vbscript:` e entidades HTML ofuscadas

---

### CARD SEC-011 — Limites de upload nos buckets restantes

| Campo          | Valor                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-011                                                                                                                |
| **Prioridade** | P2                                                                                                                     |
| **Esforço**    | M                                                                                                                      |
| **Labels**     | segurança, storage, upload                                                                                             |
| **Arquivos**   | `supabase/migrations/20260812130000_sec_storage_upload_limits.sql`, `src/components/UserSettingsModal.tsx`, `src/modules/finance/FinancePanel.tsx` |

**Problema:** `avatars`, `bank-statements` e `project-expense-files` não têm `file_size_limit` nem `allowed_mime_types`. O limite de `transaction-photos` só existe no replay local (a baseline usa `ON CONFLICT DO NOTHING`). A foto de transação (`FinancePanel.tsx:849-853`) não passa por `validateUpload` e pega a extensão do nome do arquivo.

**Subtarefas Kanban:**

- [ ] Migration com limite de tamanho e MIME nos 4 buckets
- [ ] Conferir no remoto os valores de `storage.buckets`
- [ ] Usar `validateUpload` no avatar e na foto de transação
- [ ] Derivar a extensão do MIME validado, não do nome do arquivo
- [ ] Testes de `uploadValidation.ts`

---

### CARD SEC-012 — Revisar funções SECURITY DEFINER, grants e default privileges

| Campo          | Valor                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-012                                                                                                  |
| **Prioridade** | P2                                                                                                       |
| **Esforço**    | M                                                                                                        |
| **Labels**     | segurança, supabase, grants, rpc                                                                         |
| **Arquivos**   | `supabase/migrations/20260509000000_baseline_remote_schema.sql`, `supabase/migrations/README.md`, `docs/matriz-rls.md` |

**Problema:** O advisor do Supabase lista 35 funções SECURITY DEFINER executáveis por `authenticated` e `validate_invite_code` também por `anon`. Anon tem `insert/delete/truncate` em `profiles` e `grant all` em `invite_codes` (TRUNCATE ignora RLS), e `authenticated` pode escrever em `audit_log`. Checagens como `v_role != 'admin'` viram NULL quando não há linha em `profiles`. Funções criadas via MCP nascem com EXECUTE para anon.

**Subtarefas Kanban:**

- [ ] Revisar a lista do advisor: revogar EXECUTE das funções auxiliares de RLS (`page_is_*`, `loan_is_*`, `is_workspace_member`…) e deixar só as RPCs de fato chamadas pelo cliente
- [ ] `alter default privileges ... revoke execute on functions from anon, authenticated` para o role que cria as functions
- [ ] Revogar `truncate/trigger/references` e a escrita de anon em todas as tabelas de `public`
- [ ] Revogar a escrita de `authenticated` em `audit_log`
- [ ] Trocar as checagens por `public.is_admin()`/`coalesce(..., false)`
- [ ] Rodar os advisors de segurança no CI e falhar em WARN novo

---

### CARD SEC-013 — Compartilhamento financeiro sem consentimento do destinatário

| Campo          | Valor                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-013                                                                                                 |
| **Prioridade** | P3                                                                                                      |
| **Esforço**    | M                                                                                                       |
| **Labels**     | segurança, finance, rls, privacidade                                                                    |
| **Arquivos**   | `supabase/migrations/20260509000000_baseline_remote_schema.sql`, `supabase/migrations/20260708150000_sec_profiles_search.sql`, `src/modules/finance/FinancePanel.tsx` |

**Problema:** O dono adiciona qualquer `user_id` ao workspace (`wm_owner_insert`). `shared_with_user_id` injeta lançamentos na tela de outra pessoa. `shared_insert` não exige `user_id = auth.uid()`, o que permite atribuir contribuições a terceiros. Qualquer share torna o alvo "relacionado" e expõe `last_login_date`, `role` e `is_active` dele.

**Subtarefas Kanban:**

- [ ] Filiação a workspace só por convite aceito (RPC)
- [ ] Validar `shared_with_user_id` contra uma relação já existente
- [ ] Adicionar `user_id = auth.uid()` ao WITH CHECK de `shared_insert`
- [ ] Limitar as colunas de `profiles` visíveis para perfis "relacionados"

---

### CARD SEC-014 — URLs externas funcionando como beacon de rastreamento

| Campo          | Valor                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- |
| **ID**         | SEC-014                                                                                       |
| **Prioridade** | P3                                                                                            |
| **Esforço**    | S                                                                                             |
| **Labels**     | segurança, privacidade, storage                                                               |
| **Arquivos**   | `src/lib/storageUrl.ts`, `src/components/UserAvatar.tsx`, `netlify.toml`                      |

**Problema:** `avatar_url`, anexos e imagens do BlockNote com URL `https://` externa passam direto (`storageUrl.ts:35,41`), e `avatar_color` vai cru para o CSS `background` (`UserAvatar.tsx:65-73`), que aceita `url(...)`. Com isso, qualquer usuário consegue capturar IP, user agent e horário de quem vê o conteúdo dele.

**Subtarefas Kanban:**

- [ ] `resolveSignedUrl` recusa hosts fora do storage do projeto
- [ ] CHECK em `avatar_url` (`<uid>/<uuid>.jpg`) e em `avatar_color` (`^#[0-9a-f]{6}$`)
- [ ] Restringir `img-src` na CSP (junto com o SEC-009)

---

### CARD SEC-015 — Chaves de IA sem cifra e entrada das edges de IA sem limite

| Campo          | Valor                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-015                                                                                                                |
| **Prioridade** | P3                                                                                                                     |
| **Esforço**    | M                                                                                                                      |
| **Labels**     | segurança, ia, edge-functions, segredos                                                                                |
| **Arquivos**   | `supabase/migrations/20260708100000_sec_profile_secrets.sql`, `supabase/functions/ai-chat/index.ts`, `supabase/functions/analyze-transaction-photo/index.ts` |

**Problema:** A chave de IA do usuário fica sem cifra em `profile_secrets`. A chave do Gemini vai em `?key=` na URL, onde pode acabar em logs. `history`, `message` e `image_base64` não têm limite de tamanho, e as duas functions não têm consumidor no frontend.

**Subtarefas Kanban:**

- [ ] Guardar as chaves no Supabase Vault (`vault.create_secret`)
- [ ] Mandar a chave no header `x-goog-api-key`
- [ ] Limitar o tamanho e a quantidade de mensagens e da imagem; allowlist de `mime_type`
- [ ] Decidir: remover as functions sem uso ou ligá-las a uma feature

---

### CARD SEC-016 — Enumeração residual de usuários

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | SEC-016                                                               |
| **Prioridade** | P3                                                                    |
| **Esforço**    | S                                                                     |
| **Labels**     | segurança, privacidade, rpc                                           |
| **Arquivos**   | `supabase/migrations/20260812170000_sec_rate_limit_core.sql`          |

**Problema:** `search_users_for_share` aceita substring de 3 caracteres no e-mail, com limite de 40 consultas por minuto, o que permite listar a base inteira em poucas horas. O erro de `invite_member` revela se um e-mail existe e se já está em algum workspace.

**Subtarefas Kanban:**

- [ ] Para quem não é relacionado, aceitar só e-mail exato ou devolver resultado mascarado
- [ ] Resposta genérica em `invite_member` (não revelar se o e-mail existe)
- [ ] Rate limit também em `invite_member`

---

### CARD SEC-017 — Limpar estado local no logout e reduzir expiração de signed URLs

| Campo          | Valor                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| **ID**         | SEC-017                                                                               |
| **Prioridade** | P3                                                                                    |
| **Esforço**    | S                                                                                     |
| **Labels**     | segurança, auth, frontend, storage                                                    |
| **Arquivos**   | `src/contexts/AuthContext.tsx`, `src/lib/storageUrl.ts`, `src/modules/finance/ui/AttachmentField.tsx` |

**Problema:** O `signOut` (`AuthContext.tsx:199-202`) só chama `auth.signOut()` e `setProfile(null)`. Cerca de 60 chaves de localStorage, o cache de signed URLs e os rascunhos continuam lá para o próximo usuário do mesmo navegador. As signed URLs de comprovantes financeiros valem 1 h (`storageUrl.ts:32`).

**Subtarefas Kanban:**

- [ ] No logout, limpar as chaves do app no localStorage e o cache de signed URLs
- [ ] Encerrar os canais de realtime no logout
- [ ] Reduzir para 5 min a validade das signed URLs de arquivos financeiros
- [ ] Teste: depois do logout, nenhum dado do usuário fica no storage do navegador

---

### CARD SEC-018 — Completar auditoria de ações admin e rate limit fail-open

| Campo          | Valor                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| **ID**         | SEC-018                                                                                                     |
| **Prioridade** | P3                                                                                                          |
| **Esforço**    | S                                                                                                           |
| **Labels**     | segurança, auditoria, rate-limit                                                                            |
| **Arquivos**   | `src/components/UserManagementPanel.tsx`, `supabase/functions/ai-chat/index.ts`, `supabase/functions/analyze-transaction-photo/index.ts` |

**Problema:** `admin_add_invite_slots`, `admin_revoke_invite_code` (`UserManagementPanel.tsx:183-205`) e os updates diretos de `is_active`/`invite_slots_remaining` não entram no `audit_log`. Nas edges de IA, se o contador de rate limit falhar, a requisição é liberada (fail-open, l.52-60).

**Subtarefas Kanban:**

- [ ] Registrar no `audit_log` todas as RPCs admin de convite e slots
- [ ] Trigger de auditoria para mudanças em `is_active` e `invite_slots_remaining`
- [ ] Rate limit fail-closed nas edges de IA
- [ ] Filtro por tipo de ação no `AuditLogPanel`

---

## Tópico: Confiabilidade

---

### CARD REL-001 — Consertar backup do site (parado desde 30/07)

| Campo          | Valor                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **ID**         | REL-001                                                                                                                       |
| **Prioridade** | P0                                                                                                                            |
| **Esforço**    | M                                                                                                                             |
| **Labels**     | confiabilidade, backup, supabase, dados                                                                                       |
| **Arquivos**   | `supabase/functions/site-backup/index.ts`, `supabase/migrations/20260810130000_rel001_transactional_restore.sql`, `supabase/config.toml` |

**Problema:** Confirmado no remoto: o último backup `completed` é de 30/07/2026. `BACKUP_TABLES` (`site-backup/index.ts:26-61`) e `restore_order` ainda citam 5 tabelas `finance_project*` que foram dropadas em 07/08, e o dump falha na primeira delas. As tabelas `finance_store_*` nunca entraram no backup. Cada tabela é lida sem `.range()` e acaba cortada em `max_rows = 1000`. Como o restore faz DELETE e depois INSERT, o excedente seria apagado de vez.

**Subtarefas Kanban:**

- [ ] Tirar as 5 tabelas dropadas de `BACKUP_TABLES` + migration com `CREATE OR REPLACE restore_site_backup`
- [ ] Incluir `finance_store_*` na lista e no `restore_order`, na ordem de dependência
- [ ] Paginar o dump com `.range()` em loop, ou RPC com `json_agg`, e comparar com `count(*)`
- [ ] Teste de paridade: tabelas do backup = tabelas de `public` menos as exclusões documentadas
- [ ] Publicar a function e disparar um backup manual para conferir o resumo por tabela
- [ ] Alerta quando passar mais de 48 h sem backup `completed`

---

### CARD REL-002 — NoteEditor e DrawingCanvas perdem ou sobrescrevem conteúdo

| Campo          | Valor                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| **ID**         | REL-002                                                                               |
| **Prioridade** | P1                                                                                    |
| **Esforço**    | M                                                                                     |
| **Labels**     | confiabilidade, editor, dados                                                         |
| **Arquivos**   | `src/components/NoteEditor.tsx`, `src/components/DrawingCanvas.tsx`                   |

**Problema:** Um erro de rede na leitura é tratado como nota vazia (`NoteEditor.tsx:44-57`), e o próximo save grava por cima do conteúdo real. O `upsert` do save não checa `error` (`:178-186`). Ao desmontar, o timer é cancelado e a edição pendente se perde (1 s na nota, 2 s no desenho). O `DrawingCanvas` marca "salvo" antes de o save terminar.

**Subtarefas Kanban:**

- [ ] Distinguir "linha não existe" (`PGRST116`) de erro; em caso de erro, não montar o editor em modo editável e oferecer "tentar de novo"
- [ ] Checar `error` no save e mostrar o indicador "não salvo"
- [ ] Salvar a edição pendente no unmount e no `pagehide`, como o `QuickNotes.tsx:152` já faz
- [ ] DrawingCanvas: só limpar o dirty depois de o save dar certo
- [ ] Teste com client falso simulando falha de leitura e troca rápida de página

---

### CARD REL-003 — Leituras truncadas pelo limite de 1000 linhas

| Campo          | Valor                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **ID**         | REL-003                                                                                                                |
| **Prioridade** | P2                                                                                                                     |
| **Esforço**    | M                                                                                                                      |
| **Labels**     | confiabilidade, supabase, finance, dashboard                                                                           |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`, `src/components/Dashboard.tsx`, `src/contexts/PagesContext.tsx`, `supabase/config.toml` |

**Problema:** `fetchTxAggregates` (`FinancePanel.tsx:276-289`), `fetchFullHistoryTx` (`:167-179`), `Dashboard.tsx:82-86` (`select('*')` do histórico inteiro), `DashboardProjects.tsx:62-64` e `PagesContext.tsx:161-165` não paginam. Acima de 1000 linhas, o PostgREST devolve um subconjunto sem erro, e saldos, gráficos e a detecção de duplicatas ficam errados. Hoje nenhuma tabela passa de 500 linhas, então o risco ainda é latente.

**Subtarefas Kanban:**

- [ ] RPC SQL de agregados (soma por conta, categoria e mês) para o financeiro e o Dashboard
- [ ] Contagens com `count: 'exact', head: true`
- [ ] Helper `fetchAllRows()` com `.range()` para import e PDF
- [ ] Teste com massa de mais de 1500 transações

---

### CARD REL-004 — Mutações sem checagem de erro nem rollback

| Campo          | Valor                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **ID**         | REL-004                                                                                                                     |
| **Prioridade** | P2                                                                                                                          |
| **Esforço**    | M                                                                                                                           |
| **Labels**     | confiabilidade, ux, otimista                                                                                                |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`, `src/components/SharePageModal.tsx`, `src/components/TodoList.tsx`, `src/hooks/useQuickNotes.ts`, `src/contexts/NotificationsContext.tsx` |

**Problema:** Escritas de board e coluna (`ProjectsPanel.tsx:2246-2278`), exclusão de card (`:2506`), `SharePageModal.tsx:210,217`, `TodoList.tsx:81-93`, `useQuickNotes.ts:35-44`, `markAsRead` (`NotificationsContext.tsx:57-67`), `setTheme` e o `insert` de `recurring_entries` (`FinancePanel.tsx:156`) ignoram `error` ou não fazem rollback. `DiagramBlock.tsx:70-71` tem `catch {}` vazio. A UI mostra sucesso quando a operação falhou.

**Subtarefas Kanban:**

- [ ] Passar essas escritas por `runGuarded`/`runOptimistic` (`src/lib/optimistic.ts`)
- [ ] Toast de erro com a ação desfeita
- [ ] `useQuickNotes`: tratar erro e sair do `loading` quando não houver `userId`
- [ ] Notificações via realtime: deduplicar por id e limitar a 50
- [ ] Regra de revisão: toda escrita passa por um helper guardado

---

### CARD REL-005 — ErrorBoundary preso entre painéis e chunk desatualizado após deploy

| Campo          | Valor                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **ID**         | REL-005                                                                                                |
| **Prioridade** | P2                                                                                                     |
| **Esforço**    | S                                                                                                      |
| **Labels**     | confiabilidade, deploy, lazy-loading                                                                   |
| **Arquivos**   | `src/components/MainContent.tsx`, `src/components/ErrorBoundary.tsx`, `netlify.toml`, `src/modules/DocumentsPanel.tsx` |

**Problema:** Todos os ramos de `MainContent.tsx:22-47` devolvem `<ErrorBoundary>` na mesma posição, então o erro de um painel continua aparecendo ao navegar para outro. Depois de um deploy, uma aba antiga falha ao importar o chunk; o `React.lazy` guarda a rejeição em cache e o "Tentar novamente" nunca se recupera. O fallback de SPA ainda devolve `index.html` para `/assets/*` que já não existem.

**Subtarefas Kanban:**

- [ ] Dar `key` por painel ao ErrorBoundary (ou usar `resetKeys`)
- [ ] Listener de `vite:preloadError` com reload único (flag em `sessionStorage`)
- [ ] Helper `lazyWithRetry`
- [ ] Tirar `/assets/*` do fallback de SPA; `Cache-Control: immutable` nos assets e `no-cache` no `index.html`
- [ ] Boundary por seção dentro do DocumentsPanel

---

### CARD REL-006 — Corrida em loadBoardData ao trocar de quadro

| Campo          | Valor                                                 |
| -------------- | ----------------------------------------------------- |
| **ID**         | REL-006                                               |
| **Prioridade** | P2                                                    |
| **Esforço**    | S                                                     |
| **Labels**     | confiabilidade, projetos, race-condition              |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`              |

**Problema:** Ao trocar de quadro rápido, a resposta do quadro anterior pode chegar depois e sobrescrever os cards, colunas e membros do atual (`ProjectsPanel.tsx:2154-2186`). As 4 queries também ignoram `error`.

**Subtarefas Kanban:**

- [ ] Guardar o `boardId` corrente num ref e descartar respostas antigas (ou usar `abortSignal`)
- [ ] Checar `error` e mostrar estado de falha com retry
- [ ] Teste com latências invertidas

---

### CARD REL-007 — Logout diário calculado pela data UTC

| Campo          | Valor                                                       |
| -------------- | ----------------------------------------------------------- |
| **ID**         | REL-007                                                     |
| **Prioridade** | P2                                                          |
| **Esforço**    | S                                                           |
| **Labels**     | confiabilidade, auth, ux                                    |
| **Arquivos**   | `src/App.tsx`, `src/contexts/AuthContext.tsx`               |

**Problema:** `toISOString().split('T')[0]` (`App.tsx:34-38`, `AuthContext.tsx:180,216,255`) usa UTC, então no horário de Brasília o "dia" vira às 21h. Qualquer `updateProfile` feito depois disso, como trocar tema ou idioma, dispara `signOut()` no meio da sessão e o trabalho não salvo se perde.

**Subtarefas Kanban:**

- [ ] Usar a data local (ou comparar no servidor)
- [ ] Checar só no boot, não a cada re-render do profile
- [ ] Avisar e salvar pendências antes de deslogar

---

### CARD REL-008 — Backup automático disparado pelo navegador

| Campo          | Valor                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| **ID**         | REL-008                                                                            |
| **Prioridade** | P2                                                                                 |
| **Esforço**    | M                                                                                  |
| **Labels**     | confiabilidade, backup, cron                                                       |
| **Arquivos**   | `src/modules/backup/useSiteBackup.ts`, `src/modules/backup/BackupPanel.tsx`        |

**Problema:** O backup "automático" só roda quando um admin abre o painel (`BackupPanel.tsx:60` com `runAuto: true`, `useSiteBackup.ts:71-91`). Não há cron versionado, então sem visita não há backup.

**Subtarefas Kanban:**

- [ ] Agendar com `pg_cron` + `pg_net` (ou Scheduled Function) chamando `run_auto_backup`
- [ ] Versionar o agendamento em migration
- [ ] Remover o disparo pelo cliente
- [ ] Retenção automática dos backups antigos

---

### CARD REL-009 — Conflito de edição concorrente sem aviso

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | REL-009                                                               |
| **Prioridade** | P2                                                                    |
| **Esforço**    | M                                                                     |
| **Labels**     | confiabilidade, colaboração, editor                                   |
| **Arquivos**   | `src/components/NoteEditor.tsx`, `src/components/DrawingCanvas.tsx`, `src/hooks/useCollaborativeContent.ts` |

**Problema:** Só existe uma janela de proteção logo depois do save (`NoteEditor.tsx:110-121`, `DrawingCanvas.tsx:100-110`). Com duas pessoas editando, prevalece quem salvou por último, sem nenhum aviso.

**Subtarefas Kanban:**

- [ ] Versionar o conteúdo (`updated_at`/`version`) e fazer UPDATE condicional
- [ ] Ao detectar conflito, mostrar um aviso com "recarregar" ou "manter a minha versão"
- [ ] Avaliar Yjs/CRDT para notas (BlockNote já suporta)

---

### CARD REL-010 — Realtime faltando em Projetos e notificações

| Campo          | Valor                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| **ID**         | REL-010                                                                           |
| **Prioridade** | P2                                                                                |
| **Esforço**    | M                                                                                 |
| **Labels**     | confiabilidade, realtime, projetos                                                |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`, `src/contexts/NotificationsContext.tsx` |

**Problema:** O ProjectsPanel não tem nenhum `.channel(`, então quem colabora num quadro compartilhado não vê as mudanças dos outros. As notificações só escutam INSERT (`NotificationsContext.tsx:45`), e o status de lida não sincroniza entre abas.

**Subtarefas Kanban:**

- [ ] Canal realtime por board em `project_cards` e `project_columns`
- [ ] Merge com o estado local sem perder o drag em andamento
- [ ] Notificações: escutar UPDATE e DELETE
- [ ] Adicionar as tabelas à publication `supabase_realtime` via migration

---

### CARD REL-011 — Observabilidade de erros no frontend e nas edges

| Campo          | Valor                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| **ID**         | REL-011                                                                      |
| **Prioridade** | P2                                                                           |
| **Esforço**    | S                                                                            |
| **Labels**     | confiabilidade, observabilidade                                              |
| **Arquivos**   | `src/components/ErrorBoundary.tsx`, `supabase/functions/`                    |

**Problema:** O `ErrorBoundary.tsx:41` só chama `console.error`, e não existe Sentry nem equivalente. Os erros em produção, como o backup parado há 2 meses, passam despercebidos.

**Subtarefas Kanban:**

- [ ] Integrar Sentry (ou similar) no frontend, com source maps
- [ ] Reportar erros das edge functions
- [ ] Alerta para falha de backup e picos de 5xx
- [ ] Remover PII dos eventos

---

### CARD REL-012 — Modo offline e fila de escrita

| Campo          | Valor                                    |
| -------------- | ---------------------------------------- |
| **ID**         | REL-012                                  |
| **Prioridade** | P3                                       |
| **Esforço**    | L                                        |
| **Labels**     | confiabilidade, offline, pwa             |
| **Arquivos**   | `src/lib/`, `src/contexts/`              |

**Problema:** Não existe `navigator.onLine` nem IndexedDB no app. Sem conexão, as escritas falham e o conteúdo digitado se perde.

**Subtarefas Kanban:**

- [ ] Banner de "sem conexão"
- [ ] Fila de escritas em IndexedDB com reenvio
- [ ] Rascunho local para notas e quick notes

---

## Tópico: Performance

---

### CARD PERF-001 — Contexts sem memo causam re-render global

| Campo          | Valor                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **ID**         | PERF-001                                                                                                                               |
| **Prioridade** | P1                                                                                                                                     |
| **Esforço**    | S                                                                                                                                      |
| **Labels**     | performance, react, contexts                                                                                                           |
| **Arquivos**   | `src/contexts/AuthContext.tsx`, `src/contexts/LanguageContext.tsx`, `src/contexts/ThemeContext.tsx`, `src/contexts/ToastContext.tsx`, `src/contexts/NotificationsContext.tsx`, `src/contexts/OnboardingContext.tsx` |

**Problema:** Os providers de Language, Theme, Notifications e Onboarding criam um objeto `value={{...}}` novo a cada render. O Auth chama `setSession` incondicionalmente (`AuthContext.tsx:131`) e expõe `session` no value. O Toast mistura a fila com `showToast`. Resultado: cada refresh de sessão ao focar a aba re-renderiza os 89 arquivos que usam `useLanguage()`, incluindo o FinancePanel de 4,9 mil linhas.

**Subtarefas Kanban:**

- [ ] `useMemo` no value de cada provider e `useCallback` nas ações
- [ ] Separar o Toast em dois contexts: ações (estáveis) e fila
- [ ] Tirar `session` do value do Auth e usar `getSession()` onde for preciso
- [ ] Só chamar `setSession` quando o token mudar
- [ ] Medir com o React Profiler antes e depois do foco na aba

---

### CARD PERF-002 — Otimizar policies RLS e índices (advisors do Supabase)

| Campo          | Valor                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| **ID**         | PERF-002                                                                           |
| **Prioridade** | P1                                                                                 |
| **Esforço**    | M                                                                                  |
| **Labels**     | performance, supabase, rls, índices                                                |
| **Arquivos**   | `supabase/migrations/`, `src/contexts/NotificationsContext.tsx`                    |

**Problema:** O advisor de performance em 25/09 aponta: 90 policies com `auth.uid()` reavaliado por linha (`auth_rls_initplan`), 91 casos de várias policies permissivas na mesma ação (as `finance_*` sobretudo, 15 cada em budgets, categories e transactions), 26 FKs sem índice e 67 índices sem uso. `notifications` é lida por `user_id` ordenada por `created_at` e não tem índice.

**Subtarefas Kanban:**

- [ ] Migration trocando `auth.uid()` por `(select auth.uid())` em todas as policies apontadas
- [ ] Consolidar as policies permissivas duplicadas (uma por ação e role)
- [ ] Índices nas 26 FKs e em `notifications (user_id, created_at desc)`
- [ ] Índices parciais em `finance_workspace_invites` com `where status = 'pending'`
- [ ] Revisar os 67 índices sem uso depois de 30 dias de tráfego e dropar os inúteis
- [ ] Rodar o advisor de novo e registrar a baseline

---

### CARD PERF-003 — load() do financeiro com ~8 round-trips em série

| Campo          | Valor                                           |
| -------------- | ----------------------------------------------- |
| **ID**         | PERF-003                                        |
| **Prioridade** | P2                                              |
| **Esforço**    | M                                               |
| **Labels**     | performance, finance, supabase                  |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`          |

**Problema:** `load()` (`FinancePanel.tsx:381-519`) encadeia RPC, membership, 12 queries, outra RPC, mais 6 queries, convites, perfis, insert e refetch, tudo em série. Isso inclui um RPC de bootstrap (escrita) a cada load. Nenhuma das mais de 22 respostas checa `error`, então uma falha aparece como saldo zero.

**Subtarefas Kanban:**

- [ ] Rodar o bootstrap uma vez por sessão, ou numa RPC única de carga
- [ ] Paralelizar membership, convites e as queries pessoais com `Promise.all`
- [ ] `upsert ... ignoreDuplicates` em `ensureRecurringEntries`
- [ ] Juntar os erros num estado de falha com retry
- [ ] Guard contra loads sobrepostos

---

### CARD PERF-004 — Drag de card dispara um UPDATE por card

| Campo          | Valor                                           |
| -------------- | ----------------------------------------------- |
| **ID**         | PERF-004                                        |
| **Prioridade** | P2                                              |
| **Esforço**    | M                                               |
| **Labels**     | performance, projetos, kanban                   |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`        |

**Problema:** `persist`/`persistColumns` (`ProjectsPanel.tsx:2566-2590`) e o auto-agendamento (`:2548`) mandam um UPDATE HTTP por card. Mover um card entre duas colunas de 50 cards gera cerca de 100 requisições, sem atomicidade: uma falha parcial deixa a ordem inconsistente.

**Subtarefas Kanban:**

- [ ] RPC `reorder_project_cards(board, moves jsonb)` executada numa transação
- [ ] Enviar só os cards cujo `(column_id, sort_order)` mudou
- [ ] O mesmo para colunas e para o auto-agendamento
- [ ] Testar o cálculo de diferença (depois de extrair para `lib/boardMoves.ts`)

---

### CARD PERF-005 — Memoização de filtros e derivados no FinancePanel

| Campo          | Valor                                           |
| -------------- | ----------------------------------------------- |
| **ID**         | PERF-005                                        |
| **Prioridade** | P2                                              |
| **Esforço**    | S                                               |
| **Labels**     | performance, finance, react                     |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`          |

**Problema:** Não há nenhum `useMemo` no FinancePanel. Filtros e contagens rodam a cada render (`:1501`, `:1509`, `:1866`, `:2092`, `:2424`, `:4128`), e `txCount` custa O(categorias × transações).

**Subtarefas Kanban:**

- [ ] `useMemo` nos filtros e agregados por aba
- [ ] Índice `Map` de transações por categoria
- [ ] Medir o tempo de render com 1000 transações antes e depois

---

### CARD PERF-006 — Export de PDF puxa o Excalidraw e faz N queries em série

| Campo          | Valor                                                               |
| -------------- | ------------------------------------------------------------------- |
| **ID**         | PERF-006                                                            |
| **Prioridade** | P2                                                                  |
| **Esforço**    | S                                                                   |
| **Labels**     | performance, pdf, bundle                                            |
| **Arquivos**   | `src/hooks/usePdfExport.ts`, `src/modules/finance/FinancePanel.tsx` |

**Problema:** `usePdfExport.ts:3` importa o Excalidraw de forma estática, então exportar o financeiro baixa um chunk de ~4,7 MB. O export de páginas faz de N a 3N queries sequenciais (`:219-313`).

**Subtarefas Kanban:**

- [ ] `import()` dinâmico do Excalidraw só no ramo de desenho
- [ ] Separar o export financeiro em módulo próprio
- [ ] Buscar o conteúdo das páginas em lote com `.in('page_id', ids)`
- [ ] Conferir no build que o chunk do PDF financeiro não referencia o Excalidraw

---

### CARD PERF-007 — PagesContext monolítico re-renderiza a árvore inteira

| Campo          | Valor                                                                 |
| -------------- | --------------------------------------------------------------------- |
| **ID**         | PERF-007                                                              |
| **Prioridade** | P2                                                                    |
| **Esforço**    | M                                                                     |
| **Labels**     | performance, pages, contexts                                          |
| **Arquivos**   | `src/contexts/PagesContext.tsx`, `src/components/PageTree.tsx`        |

**Problema:** `PageItem` é `memo`, mas chama `usePages()` internamente (`PageTree.tsx:41-42`). `buildTree` recria todos os nós, e qualquer INSERT/UPDATE em `pages` faz refetch completo. `activePage` é uma cópia que o refresh não atualiza, então o rename feito por um colaborador não aparece no cabeçalho.

**Subtarefas Kanban:**

- [ ] Separar em contexts de dados, navegação e ações
- [ ] Guardar só `activePageId` e derivar o objeto da árvore
- [ ] Preservar a identidade dos nós que não mudaram (por `id` + `updated_at`)
- [ ] Em erro de leitura: toast e manter a árvore anterior

---

### CARD PERF-008 — Presence: delete nunca enviado e heartbeat em páginas privadas

| Campo          | Valor                                                            |
| -------------- | ---------------------------------------------------------------- |
| **ID**         | PERF-008                                                         |
| **Prioridade** | P2                                                               |
| **Esforço**    | S                                                                |
| **Labels**     | performance, presence, supabase                                  |
| **Arquivos**   | `src/hooks/usePagePresence.ts`, `src/components/PageHeader.tsx`  |

**Problema:** O `.delete()` de cleanup (`usePagePresence.ts:76-80`) não tem `await`/`.then()` e por isso nunca é enviado; a linha só expira pelo TTL de 45 s. O heartbeat (2 requisições a cada 15 s) roda em qualquer página aberta, até nas que não são compartilhadas, e continua com a aba oculta.

**Subtarefas Kanban:**

- [ ] Executar o delete de fato e ativar `no-floating-promises` no lint
- [ ] Ativar presence só em páginas compartilhadas
- [ ] Pausar quando `document.hidden` e limpar no `pagehide`
- [ ] Avaliar trocar o polling por Realtime Presence

---

### CARD PERF-009 — Lazy load de i18n, help e modais raros

| Campo          | Valor                                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **ID**         | PERF-009                                                                                                               |
| **Prioridade** | P2                                                                                                                     |
| **Esforço**    | S                                                                                                                      |
| **Labels**     | performance, bundle, lazy-loading                                                                                      |
| **Arquivos**   | `src/App.tsx`, `src/i18n/translations.ts`, `src/contexts/OnboardingContext.tsx`, `src/modules/projects/ProjectsPanel.tsx`, `src/components/Sidebar.tsx` |

**Problema:** Entram no bundle de entrada: `translations.ts` (3058 linhas, os dois idiomas), `helpContent` (1000 linhas, via WelcomeTour), `UserSettingsModal` (722 linhas + `react-easy-crop`), `GanttView` (`ProjectsPanel.tsx:31`) e `ExportPdfModal` (`Sidebar.tsx:17`), todos com import estático.

**Subtarefas Kanban:**

- [ ] Separar as traduções por idioma e carregar só o ativo
- [ ] `lazy()` no WelcomeTour, no UserSettingsModal e no AvatarCropModal
- [ ] `lazy()` no GanttView e no ExportPdfModal
- [ ] Medir o chunk de entrada antes e depois (meta: −30%)

---

### CARD PERF-010 — Comprimir imagens antes do upload

| Campo          | Valor                                                              |
| -------------- | ------------------------------------------------------------------ |
| **ID**         | PERF-010                                                           |
| **Prioridade** | P3                                                                 |
| **Esforço**    | S                                                                  |
| **Labels**     | performance, upload, storage                                       |
| **Arquivos**   | `src/lib/imageCrop.ts`, `src/components/NoteEditor.tsx`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** Só o avatar é redimensionado (`imageCrop.ts:41`). Fotos de celular de 4 a 8 MB vão cruas para notas, cards e comprovantes.

**Subtarefas Kanban:**

- [ ] Criar `compressImage()` (canvas → WebP/JPEG, lado máximo de 2048 px)
- [ ] Aplicar em todos os uploads de imagem
- [ ] Manter o original só quando o usuário pedir

---

### CARD PERF-011 — memo nos cards e colunas do kanban

| Campo          | Valor                                           |
| -------------- | ----------------------------------------------- |
| **ID**         | PERF-011                                        |
| **Prioridade** | P3                                              |
| **Esforço**    | S                                               |
| **Labels**     | performance, projetos, react                    |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`        |

**Problema:** `CardView` (`:189`) e `Column` (`:303`) não usam `memo`, então cada frame de drag re-renderiza o quadro inteiro.

**Subtarefas Kanban:**

- [ ] `memo` em CardView e Column, com props estáveis
- [ ] `useCallback` nos handlers repassados
- [ ] Medir com o Profiler num quadro de 100 cards

---

### CARD PERF-012 — Orçamento de bundle e limpeza do manualChunks

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | PERF-012                               |
| **Prioridade** | P3                                     |
| **Esforço**    | S                                      |
| **Labels**     | performance, bundle, vite              |
| **Arquivos**   | `vite.config.ts`                       |

**Problema:** Os chunks `router` e `xyflow` (`vite.config.ts:33,37`) apontam para libs que ninguém importa. Não há visualizer nem orçamento de tamanho, então regressões de bundle passam sem ninguém ver.

**Subtarefas Kanban:**

- [ ] Remover as regras mortas do `manualChunks`
- [ ] Adicionar `rollup-plugin-visualizer` (script `build:analyze`)
- [ ] Orçamento de tamanho no CI (size-limit)

---

### CARD PERF-013 — Hook useDebounce compartilhado

| Campo          | Valor                                                                  |
| -------------- | ---------------------------------------------------------------------- |
| **ID**         | PERF-013                                                               |
| **Prioridade** | P3                                                                     |
| **Esforço**    | S                                                                      |
| **Labels**     | performance, hooks                                                     |
| **Arquivos**   | `src/components/SharePageModal.tsx`, `src/modules/finance/FinancePanel.tsx` |

**Problema:** O debounce é feito à mão em `SharePageModal.tsx:140` e `FinancePanel.tsx:573,666`, cada um com seu próprio cleanup (ou sem nenhum).

**Subtarefas Kanban:**

- [ ] Criar `useDebouncedValue` e `useDebouncedCallback` em `src/hooks/`
- [ ] Substituir as implementações manuais
- [ ] Teste com fake timers

---

### CARD PERF-014 — Dedup e lote de signed URLs

| Campo          | Valor                                   |
| -------------- | --------------------------------------- |
| **ID**         | PERF-014                                |
| **Prioridade** | P3                                      |
| **Esforço**    | S                                       |
| **Labels**     | performance, storage                    |
| **Arquivos**   | `src/lib/storageUrl.ts`                 |

**Problema:** O mesmo avatar dispara N requisições de signed URL ao mesmo tempo (`storageUrl.ts:25-43`), e o cache nunca é limpo.

**Subtarefas Kanban:**

- [ ] Deduplicar requisições em andamento (map de promises)
- [ ] Usar `createSignedUrls` em lote
- [ ] Limpar o cache no logout e quando a URL expirar

---

### CARD PERF-015 — Camada de cache de dados (react-query)

| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| **ID**         | PERF-015                                   |
| **Prioridade** | P3                                         |
| **Esforço**    | L                                          |
| **Labels**     | performance, arquitetura, dados            |
| **Arquivos**   | `package.json`, `src/modules/`             |

**Problema:** Cada painel refaz as mesmas queries ao montar, sem cache, dedupe nem invalidação. A lógica de loading, erro e retry fica espalhada à mão.

**Subtarefas Kanban:**

- [ ] Adicionar `@tanstack/react-query` com QueryClient global
- [ ] Migrar primeiro Dashboard e Projetos
- [ ] Invalidação a partir dos eventos de realtime

---

## Tópico: UX e Acessibilidade

---

### CARD UX-001 — Enter confirma exclusão mesmo com foco em Cancelar

| Campo          | Valor                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| **ID**         | UX-001                                                                         |
| **Prioridade** | P1                                                                             |
| **Esforço**    | S                                                                              |
| **Labels**     | ux, acessibilidade, modal, destrutivo                                          |
| **Arquivos**   | `src/components/ConfirmDeleteModal.tsx`, `src/modules/backup/BackupPanel.tsx`  |

**Problema:** O foco inicial fica em Cancelar (`ConfirmDeleteModal.tsx:18-20`), mas um listener global de `Enter` (`:22-30`) chama `onConfirm()` sem olhar `e.target`. Com isso, apertar Enter em Cancelar confirma a ação. Isso afeta os 7 consumidores, inclusive **restaurar backup** (`BackupPanel.tsx:280-284`) e excluir páginas, cards e usuários.

**Subtarefas Kanban:**

- [ ] Remover o atalho global de Enter (ou ignorar quando `e.target` for um botão)
- [ ] `role="alertdialog"` + `aria-labelledby`/`aria-describedby`
- [ ] Focus trap e Esc para fechar
- [ ] Teste de teclado cobrindo Enter em Cancelar

---

### CARD UX-002 — Navegação principal inacessível por teclado

| Campo          | Valor                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **ID**         | UX-002                                                                                                         |
| **Prioridade** | P1                                                                                                             |
| **Esforço**    | M                                                                                                              |
| **Labels**     | acessibilidade, teclado, projetos, sidebar                                                                     |
| **Arquivos**   | `src/components/PageTree.tsx`, `src/modules/projects/ProjectsPanel.tsx`, `src/components/board/KanbanBoard.tsx`, `src/modules/projects/GanttView.tsx` |

**Problema:** Para abrir uma página na árvore só existe `div onClick` (`PageTree.tsx:97-101`), e o chevron não tem `aria-expanded`. Os cards são `div onClick` (`ProjectsPanel.tsx:200`) e não há `KeyboardSensor` no dnd-kit (`:2106`, `KanbanBoard.tsx:93`). Quem usa só teclado não consegue abrir páginas nem abrir ou mover cards. O mesmo padrão aparece em GanttView, Dashboard, StudyTopicList e SalesView.

**Subtarefas Kanban:**

- [ ] Trocar os `div onClick` por `<button>` (ou `role` + `tabIndex` + Enter/Espaço)
- [ ] `KeyboardSensor` com `sortableKeyboardCoordinates` nos dois kanbans
- [ ] `role="tree"`/`aria-expanded` na árvore de páginas
- [ ] Adicionar `eslint-plugin-jsx-a11y` (`click-events-have-key-events`, `no-static-element-interactions`)

---

### CARD UX-003 — Modais e drawer acessíveis (role, Esc, focus trap)

| Campo          | Valor                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| **ID**         | UX-003                                                                                                 |
| **Prioridade** | P1                                                                                                     |
| **Esforço**    | M                                                                                                      |
| **Labels**     | acessibilidade, modal, drawer, mobile                                                                  |
| **Arquivos**   | `src/modules/finance/ui/Modal.tsx`, `src/components/Drawer.tsx`, `src/App.tsx`                         |

**Problema:** Só o WelcomeTour tem `role="dialog"`. `finance/ui/Modal.tsx` e `Drawer.tsx` não têm role, Esc nem focus trap, e 16 arquivos montam overlays à mão. O botão da sidebar mobile (`App.tsx:96`) tem `aria-label` em inglês, sem `aria-expanded`. O `@radix-ui/react-dialog` está instalado, mas não é usado.

**Subtarefas Kanban:**

- [ ] Criar um shell `Dialog` único (Radix Dialog ou implementação própria) com role, Esc, focus trap e retorno de foco
- [ ] Migrar primeiro o `finance/ui/Modal`, o `Drawer` e os modais de Projetos
- [ ] Botão da sidebar com `aria-expanded`, `aria-controls` e texto via i18n
- [ ] Travar o scroll do body com o modal aberto

---

### CARD UX-004 — Indicador de foco removido

| Campo          | Valor                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| **ID**         | UX-004                                                                   |
| **Prioridade** | P2                                                                       |
| **Esforço**    | S                                                                        |
| **Labels**     | acessibilidade, css, wcag                                                |
| **Arquivos**   | `src/components/uiTokens.ts`, `src/index.css`, `src/modules/projects/ProjectsPanel.tsx` |

**Problema:** `outline:'none'` aparece em `uiTokens.ts:22` (usado em cerca de 132 campos) e em mais 43 lugares, e o `index.css` não tem `:focus-visible`. O foco do teclado fica invisível em quase todo o app, o que viola a WCAG 2.4.7.

**Subtarefas Kanban:**

- [ ] Regra global `:where(button,a,input,select,textarea,[tabindex]):focus-visible` com outline no token primário
- [ ] Tirar `outline:none` dos tokens e dos estilos inline
- [ ] QA com Tab nos fluxos de login, projetos e financeiro

---

### CARD UX-005 — Contraste insuficiente do text-muted

| Campo          | Valor                                              |
| -------------- | -------------------------------------------------- |
| **ID**         | UX-005                                             |
| **Prioridade** | P2                                                 |
| **Esforço**    | S                                                  |
| **Labels**     | acessibilidade, contraste, design-system           |
| **Arquivos**   | `src/index.css`, `src/components/uiTokens.ts`      |

**Problema:** No tema claro, `--color-text-muted` `#9b9a97` sobre branco dá cerca de 2,8:1 (`index.css:13`); no escuro, `#7a7a77` sobre `#191919` dá cerca de 4,1:1 (`:53`). O token tem 668 usos, inclusive os rótulos de formulário.

**Subtarefas Kanban:**

- [ ] Escurecer o token no tema claro (ex.: `#6f6e69`, ~5:1)
- [ ] Clarear no escuro (ex.: `#9a9a96`)
- [ ] Rótulos de formulário com `text-subtle`
- [ ] Baseline de contraste com axe/Lighthouse

---

### CARD UX-006 — lang fixo em inglês e zoom bloqueado

| Campo          | Valor                                                  |
| -------------- | ------------------------------------------------------ |
| **ID**         | UX-006                                                 |
| **Prioridade** | P2                                                     |
| **Esforço**    | S                                                      |
| **Labels**     | acessibilidade, mobile, i18n                           |
| **Arquivos**   | `index.html`, `src/contexts/LanguageContext.tsx`       |

**Problema:** `index.html:2` declara `lang="en"`, embora o app seja pt-BR por padrão, e o `LanguageContext` nunca atualiza `document.documentElement.lang`. `index.html:6` tem `maximum-scale=1, user-scalable=no`, que impede o zoom no celular.

**Subtarefas Kanban:**

- [ ] `lang="pt-BR"` e sincronizar com o idioma escolhido
- [ ] Remover `maximum-scale` e `user-scalable`
- [ ] Inputs com `font-size: 16px` no mobile, para evitar o auto-zoom do iOS
- [ ] Atualizar `document.title` por seção

---

### CARD UX-007 — Formulários sem label associado, autocomplete e aria-live

| Campo          | Valor                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------ |
| **ID**         | UX-007                                                                                     |
| **Prioridade** | P2                                                                                         |
| **Esforço**    | M                                                                                          |
| **Labels**     | acessibilidade, formulários, auth                                                          |
| **Arquivos**   | `src/pages/AuthPage.tsx`, `src/modules/projects/ImportCardsModal.tsx`, `src/components/Sidebar.tsx` |

**Problema:** Não há nenhum `htmlFor` no `src`: 114 `<label>` estão soltos. Os campos de login (`AuthPage.tsx:252-275`) não têm `autoComplete`. Mensagens de erro e sucesso não têm `role="alert"`/`aria-live`. A busca da sidebar tem só placeholder.

**Subtarefas Kanban:**

- [ ] Componente `Field` com `useId()` que liga label, input e erro
- [ ] `autoComplete="email|current-password|new-password"` no login e no reset
- [ ] `aria-live="polite"` nas mensagens inline e `aria-invalid` nos erros
- [ ] `aria-label` na busca da sidebar

---

### CARD UX-008 — Acessibilidade do FinancePanel, tabs e ícones sem rótulo

| Campo          | Valor                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| **ID**         | UX-008                                                                                  |
| **Prioridade** | P2                                                                                      |
| **Esforço**    | M                                                                                       |
| **Labels**     | acessibilidade, finance, projetos                                                       |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`, `src/modules/projects/ProjectsPanel.tsx`        |

**Problema:** O FinancePanel tem 125 botões, 0 `aria-*`/`role` e 39 labels sem associação. Não existe `role="tab"`/`tablist` no app. Botões só com ícone não têm `aria-label` (`ProjectsPanel.tsx:118,141,733`).

**Subtarefas Kanban:**

- [ ] Componente `Tabs` WAI-ARIA (setas, `aria-selected`) e usá-lo nas abas do financeiro
- [ ] `aria-label` em todos os botões só com ícone
- [ ] Associar os labels do FinancePanel (depende do UX-007)
- [ ] Varredura com axe DevTools e zerar os erros críticos

---

### CARD UX-009 — Importação de cards frágil

| Campo          | Valor                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| **ID**         | UX-009                                                                                 |
| **Prioridade** | P2                                                                                     |
| **Esforço**    | S                                                                                      |
| **Labels**     | ux, projetos, import                                                                   |
| **Arquivos**   | `src/modules/projects/ImportCardsModal.tsx`, `src/lib/importProjectCards.ts`           |

**Problema:** Em caso de erro, o modal faz `return` antes de `onImported()` (`:113-115`): os lotes já gravados não aparecem e o usuário não fica sabendo. Clicar no backdrop fecha o modal e perde o markdown colado. O dedupe só olha o prefixo do título, então IDs repetidos de outro backlog são pulados sem aviso. O destino é sempre a primeira coluna.

**Subtarefas Kanban:**

- [ ] Mostrar "X criados antes do erro" e sempre chamar `onImported`
- [ ] Não fechar pelo backdrop quando houver texto
- [ ] Listar os IDs pulados no resultado
- [ ] Guardar o ID externo em coluna ou label própria
- [ ] Permitir escolher a coluna de destino; aceitar drag-and-drop do `.md`

---

### CARD UX-010 — Split view sem suporte a touch

| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| **ID**         | UX-010                                     |
| **Prioridade** | P2                                         |
| **Esforço**    | S                                          |
| **Labels**     | ux, mobile, editor                         |
| **Arquivos**   | `src/components/PageEditor.tsx`            |

**Problema:** O divisor do split view só escuta `onMouseDown/Move/Up` (`PageEditor.tsx:80,111,132`), então no tablet ou celular não dá para redimensionar.

**Subtarefas Kanban:**

- [ ] Migrar para Pointer Events (`onPointerDown` + `setPointerCapture`)
- [ ] Área de toque de pelo menos 24 px
- [ ] Redimensionar pelo teclado (setas) com `role="separator"`

---

### CARD UX-011 — Resíduo de i18n e Toast fora do LanguageProvider

| Campo          | Valor                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **ID**         | UX-011                                                                                                         |
| **Prioridade** | P2                                                                                                             |
| **Esforço**    | M                                                                                                              |
| **Labels**     | ux, i18n                                                                                                       |
| **Arquivos**   | `src/App.tsx`, `src/components/TodoList.tsx`, `src/components/Dashboard.tsx`, `src/hooks/usePdfExport.ts`, `src/components/blocks/DiagramBlock.tsx` |

**Problema:** Ainda há strings fixas em `TodoList.tsx:239,250`, `Dashboard.tsx:383-391`, `UserManagementPanel.tsx:484,512`, `AuthContext.tsx:173,205`, `usePdfExport.ts:827-894`, `Sidebar.tsx:230`, `HelpPanel.tsx:342`, `DiagramBlock.tsx:78-84` e nos avisos do parser de backlog. O `ToastProvider` fica acima do `LanguageProvider` (`App.tsx:137-143`), então os toasts saem sempre em pt-BR.

**Subtarefas Kanban:**

- [ ] Mover as strings para `translations.ts`
- [ ] Inverter a ordem dos providers (Language por fora do Toast)
- [ ] Script de lint que detecta string literal em JSX

---

### CARD UX-012 — Onboarding por módulo e CTAs em estados vazios

| Campo          | Valor                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| **ID**         | UX-012                                                                                    |
| **Prioridade** | P3                                                                                        |
| **Esforço**    | M                                                                                         |
| **Labels**     | ux, onboarding, help                                                                      |
| **Arquivos**   | `src/contexts/OnboardingContext.tsx`, `src/components/Dashboard.tsx`, `src/i18n/helpContent.ts` |

**Problema:** O tour "visto" fica só no localStorage (`OnboardingContext.tsx:14-25`), então reaparece a cada dispositivo. Os estados vazios mostram só texto (`Dashboard.tsx:716`), sem ação. O help não tem a seção de Estudos.

**Subtarefas Kanban:**

- [ ] Persistir o estado do tour no `profiles`
- [ ] Botão de ação nos estados vazios (criar página, board, conta)
- [ ] Mini-tour por módulo (Projetos, Financeiro, Estudos)
- [ ] Seção de Estudos no HelpPanel

---

### CARD UX-013 — DiagramBlock ignora o tema escuro

| Campo          | Valor                                           |
| -------------- | ----------------------------------------------- |
| **ID**         | UX-013                                          |
| **Prioridade** | P3                                              |
| **Esforço**    | S                                               |
| **Labels**     | ux, tema, editor                                |
| **Arquivos**   | `src/components/blocks/DiagramBlock.tsx`        |

**Problema:** `bg-white`, `bg-[#f7f6f3]` e outros hex fixos (`DiagramBlock.tsx:74-84`) quebram o tema escuro. O timer (`:38-57`) chama `updateBlock` mesmo depois de o bloco ser removido.

**Subtarefas Kanban:**

- [ ] Trocar as cores fixas por `var(--color-*)`
- [ ] Limpar o timer no unmount
- [ ] Mostrar um aviso quando o JSON do diagrama estiver corrompido

---

### CARD UX-014 — Metadados, favicon e PWA

| Campo          | Valor                                                  |
| -------------- | ------------------------------------------------------ |
| **ID**         | UX-014                                                 |
| **Prioridade** | P3                                                     |
| **Esforço**    | S                                                      |
| **Labels**     | ux, pwa, branding                                      |
| **Arquivos**   | `index.html`, `public/`, `src/assets/`, `src/App.tsx`  |

**Problema:** Faltam `meta description`, `theme-color`, manifest e `apple-touch-icon`. O `favicon.svg` usa `fill="#000"` e some em aba escura. Há sobras do template (`favicon.png`, `icons.svg`, `react.svg`, `vite.svg`, `hero.png`). O loading mostra "E", herdado do antigo nome Excalinotion (`App.tsx:50`).

**Subtarefas Kanban:**

- [ ] Manifest + ícones + `theme-color`
- [ ] Favicon adaptado a `prefers-color-scheme`
- [ ] Hospedar a fonte Space Grotesk localmente
- [ ] Apagar os assets do template e trocar o "E" por "A"

---

### CARD UX-015 — Cor de ação inconsistente e tokens de design

| Campo          | Valor                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| **ID**         | UX-015                                                                             |
| **Prioridade** | P3                                                                                 |
| **Esforço**    | M                                                                                  |
| **Labels**     | ux, design-system                                                                  |
| **Arquivos**   | `src/components/uiTokens.ts`, `src/index.css`, `docs/Design System Akool.md`       |

**Problema:** `#6366f1` aparece fixo 78 vezes, contrariando a decisão "graphite accent" registrada em `uiTokens.ts:5-7`. Apesar do nome, `docs/Design System Akool.md` é um backlog antigo e não documenta tokens.

**Subtarefas Kanban:**

- [ ] Criar o token `--color-accent` e substituir os hex
- [ ] Documentar tokens (cores, espaçamento, raio, tipografia) num design system real
- [ ] Lint contra hex literal em TSX

---

## Tópico: Arquitetura

---

### CARD ARCH-001 — Quebrar o FinancePanel (4913 linhas)

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | ARCH-001                                     |
| **Prioridade** | P2                                           |
| **Esforço**    | L                                            |
| **Labels**     | arquitetura, finance, refactor               |
| **Arquivos**   | `src/modules/finance/FinancePanel.tsx`       |

**Problema:** O arquivo tem 4913 linhas (+622 desde agosto), com 23 componentes inline, de `TransactionModal` (`:749`) a `WorkspaceModal` (`:3656`). Qualquer mudança re-renderiza e re-testa tudo, e a revisão fica inviável.

**Subtarefas Kanban:**

- [ ] Extrair um arquivo por aba em `modules/finance/tabs/`
- [ ] Extrair os modais para `modules/finance/modals/`
- [ ] Mover o `load()` e as mutações para um hook `useFinanceData`
- [ ] Meta: nenhum arquivo acima de 600 linhas

---

### CARD ARCH-002 — Quebrar o ProjectsPanel e unificar os dois kanbans

| Campo          | Valor                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| **ID**         | ARCH-002                                                                            |
| **Prioridade** | P2                                                                                  |
| **Esforço**    | L                                                                                   |
| **Labels**     | arquitetura, projetos, refactor                                                     |
| **Arquivos**   | `src/modules/projects/ProjectsPanel.tsx`, `src/components/board/KanbanBoard.tsx`    |

**Problema:** O ProjectsPanel tem 2936 linhas, com `CardModal` (`:1023`) e as views (`:1711-2052`) inline. Existem dois kanbans: `components/board/` e o inline em `ProjectsPanel.tsx:189-433`. As funções puras de drag (`applyCardMove`, `reindexAllCards`…) não são exportadas nem testadas.

**Subtarefas Kanban:**

- [ ] Extrair CardModal, views e navegação para arquivos próprios
- [ ] Ficar com um único componente de kanban
- [ ] Mover as funções de drag para `lib/boardMoves.ts`, com testes
- [ ] Hook `useBoardData` para o carregamento e as mutações

---

### CARD ARCH-003 — Camada de dados e mapSupabaseError

| Campo          | Valor                                             |
| -------------- | ------------------------------------------------- |
| **ID**         | ARCH-003                                          |
| **Prioridade** | P2                                                |
| **Esforço**    | M                                                 |
| **Labels**     | arquitetura, supabase, erros                      |
| **Arquivos**   | `src/lib/supabase.ts`, `src/modules/`             |

**Problema:** Há chamadas diretas a `supabase.from`/`rpc` em 18 arquivos fora de `lib/`, e cada um trata (ou ignora) erros do seu jeito. Não existe um `mapSupabaseError` para mensagens amigáveis.

**Subtarefas Kanban:**

- [ ] Criar `src/lib/data/<domínio>.ts` com as queries tipadas
- [ ] `mapSupabaseError()` → mensagem i18n + código
- [ ] Migrar primeiro Projetos e Pages
- [ ] Lint proibindo `supabase.from` fora de `lib/data`

---

### CARD ARCH-004 — Tipos gerados do Supabase

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| **ID**         | ARCH-004                                     |
| **Prioridade** | P2                                           |
| **Esforço**    | M                                            |
| **Labels**     | arquitetura, typescript, supabase            |
| **Arquivos**   | `src/types/index.ts`, `src/lib/supabase.ts`  |

**Problema:** Os tipos são escritos à mão em `src/types/index.ts` (640 linhas). Há 8 `as unknown as`, `as any[]` (`ProjectsPanel.tsx:2164`) e `user!.id` (`:1665`), e o schema muda sem que o TypeScript perceba.

**Subtarefas Kanban:**

- [ ] `supabase gen types typescript` → `src/types/database.ts`
- [ ] `createClient<Database>()`
- [ ] Remover os casts e o `!` não justificados
- [ ] Gerar os tipos no CI e falhar se houver diff

---

### CARD ARCH-005 — Dividir o usePdfExport (964 linhas)

| Campo          | Valor                                  |
| -------------- | -------------------------------------- |
| **ID**         | ARCH-005                               |
| **Prioridade** | P3                                     |
| **Esforço**    | M                                      |
| **Labels**     | arquitetura, pdf, refactor             |
| **Arquivos**   | `src/hooks/usePdfExport.ts`            |

**Problema:** O hook tem 964 linhas, 9 `eslint-disable` de `any` e rótulos em português fixos (`:29-31`), e mistura o export de páginas com o do financeiro.

**Subtarefas Kanban:**

- [ ] Separar os renderers: nota, desenho, financeiro
- [ ] Tipar os blocos do BlockNote em vez de usar `any`
- [ ] Rótulos via i18n

---

### CARD ARCH-006 — Estrutura src/shared, aliases e limite de tamanho

| Campo          | Valor                                                  |
| -------------- | ------------------------------------------------------ |
| **ID**         | ARCH-006                                               |
| **Prioridade** | P3                                                     |
| **Esforço**    | M                                                      |
| **Labels**     | arquitetura, lint, estrutura                           |
| **Arquivos**   | `eslint.config.js`, `tsconfig.app.json`, `src/`        |

**Problema:** Não há `src/shared`, aliases de import (`@/`) nem regra de fronteira entre módulos. Hoje os módulos não se importam entre si só por convenção. Também não há `max-lines` no ESLint.

**Subtarefas Kanban:**

- [ ] Alias `@/` no tsconfig e no Vite
- [ ] `src/shared/` para UI e hooks genéricos
- [ ] Regra `no-restricted-imports` entre módulos
- [ ] `max-lines: 600` como warning

---

### CARD ARCH-007 — Eventos entre módulos tipados

| Campo          | Valor                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| **ID**         | ARCH-007                                                                                 |
| **Prioridade** | P3                                                                                       |
| **Esforço**    | S                                                                                        |
| **Labels**     | arquitetura, eventos                                                                     |
| **Arquivos**   | `src/modules/finance/store/useFinanceStore.ts`, `src/modules/finance/FinancePanel.tsx`   |

**Problema:** O emissor usa uma constante (`useFinanceStore.ts:35`), mas o listener usa uma string solta (`FinancePanel.tsx:4057`), e existe ainda um `'finance_tab_change'` (`:4047`) sem contrato.

**Subtarefas Kanban:**

- [ ] `src/lib/appEvents.ts` com um mapa tipado de eventos
- [ ] Helpers `emit`/`on` tipados
- [ ] Substituir as strings soltas

---

### CARD ARCH-008 — Dividir UserManagementPanel e UserSettingsModal

| Campo          | Valor                                                                              |
| -------------- | ---------------------------------------------------------------------------------- |
| **ID**         | ARCH-008                                                                           |
| **Prioridade** | P3                                                                                 |
| **Esforço**    | M                                                                                  |
| **Labels**     | arquitetura, admin, refactor                                                       |
| **Arquivos**   | `src/components/UserManagementPanel.tsx`, `src/components/UserSettingsModal.tsx`   |

**Problema:** Os dois arquivos cresceram desde agosto: `UserManagementPanel` tem 871 linhas e `UserSettingsModal` tem 722, cada um misturando várias responsabilidades (perfil, senha, IA, avatar, convites).

**Subtarefas Kanban:**

- [ ] Uma seção por arquivo (perfil, segurança, IA, convites)
- [ ] Hooks de dados separados da UI
- [ ] Chamar o admin só pela edge `admin-ops`

---

### CARD ARCH-009 — Documentar arquitetura e ordem dos providers

| Campo          | Valor                                                                    |
| -------------- | ------------------------------------------------------------------------ |
| **ID**         | ARCH-009                                                                 |
| **Prioridade** | P3                                                                       |
| **Esforço**    | S                                                                        |
| **Labels**     | arquitetura, docs                                                        |
| **Arquivos**   | `src/App.tsx`, `scripts/generate-architecture-map.mjs`                   |

**Problema:** Há só um comentário em `App.tsx:67-69`, e o mapa gerado por script mostra os providers numa ordem diferente da real.

**Subtarefas Kanban:**

- [ ] `docs/arquitetura.md` com a árvore de providers e os módulos
- [ ] Corrigir o gerador para ler a ordem real do `App.tsx`
- [ ] Documentar o fluxo de auth e de dados

---

## Tópico: Qualidade de código

---

### CARD QA-001 — Lacunas de teste e relatório de cobertura

| Campo          | Valor                                                                           |
| -------------- | ------------------------------------------------------------------------------- |
| **ID**         | QA-001                                                                          |
| **Prioridade** | P2                                                                              |
| **Esforço**    | M                                                                               |
| **Labels**     | qualidade, testes, vitest                                                       |
| **Arquivos**   | `src/hooks/`, `src/modules/`, `src/lib/uploadValidation.ts`, `vite.config.ts`   |

**Problema:** Não há testes em `supabase/functions/*`, em nenhum dos 6 hooks, em `useFinanceStore`, `useStudyTopics`, `modules/audit`, `modules/docsnetwork`, `uploadValidation`, `storageUrl` e `projectImport`, nem nas funções de drag. Também não existe relatório de cobertura.

**Subtarefas Kanban:**

- [ ] `@vitest/coverage-v8` + script `test:coverage` com baseline por pasta
- [ ] Testes de `uploadValidation`, `storageUrl` e `boardMoves`
- [ ] Teste de paridade backup × schema (REL-001)
- [ ] Testes Deno para `admin-ops` e `site-backup`

---

### CARD QA-002 — TypeScript strict e lint com checagem de tipos

| Campo          | Valor                                           |
| -------------- | ----------------------------------------------- |
| **ID**         | QA-002                                          |
| **Prioridade** | P2                                              |
| **Esforço**    | M                                               |
| **Labels**     | qualidade, typescript, eslint                   |
| **Arquivos**   | `tsconfig.app.json`, `eslint.config.js`         |

**Problema:** O `tsconfig.app.json` não usa `strict`, e o ESLint usa só `recommended`, sem regras type-aware. Há 39 `eslint-disable` (27 de `any`, 11 de `exhaustive-deps`). Bugs como o delete não enviado do presence (PERF-008) passam despercebidos.

**Subtarefas Kanban:**

- [ ] Ligar `strict` e corrigir os erros por pasta
- [ ] `recommendedTypeChecked` + `no-floating-promises` + `no-misused-promises`
- [ ] `eslint-plugin-jsx-a11y` (ver UX-002)
- [ ] Reduzir os `eslint-disable` à metade

---

### CARD QA-003 — Testes de componente e E2E

| Campo          | Valor                                                  |
| -------------- | ------------------------------------------------------ |
| **ID**         | QA-003                                                 |
| **Prioridade** | P2                                                     |
| **Esforço**    | M                                                      |
| **Labels**     | qualidade, testes, e2e                                 |
| **Arquivos**   | `package.json`, `testsprite_tests/`                    |

**Problema:** Não há `@testing-library` nem Playwright. Os testes do TestSprite são scripts Python gerados, que rodam contra produção usando a conta admin (SEC-001).

**Subtarefas Kanban:**

- [ ] `@testing-library/react` + happy-dom para os modais e formulários críticos
- [ ] Playwright com 5 fluxos: login, criar página, mover card, lançamento financeiro, import de cards
- [ ] Rodar o E2E contra o Supabase local ou staging (DEV-002)

---

### CARD QA-004 — Remover duplicações (overlay, árvore, prioridades, navs)

| Campo          | Valor                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **ID**         | QA-004                                                                                                  |
| **Prioridade** | P3                                                                                                      |
| **Esforço**    | S                                                                                                       |
| **Labels**     | qualidade, refactor, duplicação                                                                         |
| **Arquivos**   | `src/contexts/PagesContext.tsx`, `src/components/PageTree.tsx`, `src/components/blocks/ProjectCardBlock.tsx` |

**Problema:** 16 overlays são montados à mão. O flatten da árvore existe em 7 cópias (`PageTree`, `ExportPdfModal`, `ProjectsPanel`, `Dashboard`, `ItemPicker`, `QuickNotes`, `PagesContext`). `PRIORITY_COLORS` está duplicado e há 3 variantes de nav lateral (Projects, Study, Documents).

**Subtarefas Kanban:**

- [ ] `lib/pageTree.ts` exportando as funções de árvore
- [ ] Constante única de prioridades (cores + rótulos i18n)
- [ ] Componente de nav lateral compartilhado

---

### CARD QA-005 — Remover any nos canvases Excalidraw

| Campo          | Valor                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **ID**         | QA-005                                                                                                |
| **Prioridade** | P3                                                                                                    |
| **Esforço**    | S                                                                                                     |
| **Labels**     | qualidade, typescript, excalidraw                                                                     |
| **Arquivos**   | `src/components/DrawingCanvas.tsx`, `src/components/DiagramCanvas.tsx`, `src/components/NoteEditor.tsx` |

**Problema:** Há `any` com `eslint-disable` em DrawingCanvas (8), DiagramCanvas (3), DiagramBlock (1) e NoteEditor (1), embora os tipos do Excalidraw sejam exportados.

**Subtarefas Kanban:**

- [ ] Importar `ExcalidrawImperativeAPI`, `ExcalidrawElement` e `AppState`
- [ ] Remover os disables

---

### CARD QA-006 — Inventário e namespace das chaves de localStorage

| Campo          | Valor                                   |
| -------------- | --------------------------------------- |
| **ID**         | QA-006                                  |
| **Prioridade** | P3                                      |
| **Esforço**    | S                                       |
| **Labels**     | qualidade, storage, frontend            |
| **Arquivos**   | `src/`                                  |

**Problema:** Há cerca de 60 chaves de localStorage espalhadas, 9 delas ainda com o prefixo `excalinotion_*`. Não há inventário, então o logout não sabe o que limpar (SEC-017).

**Subtarefas Kanban:**

- [ ] `lib/localKeys.ts` com todas as chaves e o prefixo `akool:`
- [ ] Migrar as chaves antigas na inicialização
- [ ] Helper `clearUserLocalState()` usado no logout

---

## Tópico: DevOps e Infra

---

### CARD DEV-001 — Criar CI e tornar os testes independentes de env

| Campo          | Valor                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| **ID**         | DEV-001                                                                                                 |
| **Prioridade** | P1                                                                                                      |
| **Esforço**    | S                                                                                                       |
| **Labels**     | devops, ci, testes                                                                                      |
| **Arquivos**   | `.github/workflows/ci.yml`, `src/lib/supabase.ts`, `src/contexts/AuthContext.test.ts`                   |

**Problema:** Não existe `.github/` neste checkout: nada roda `tsc`, `vitest`, `lint` ou `build` antes do deploy (Netlify e Coolify rodam só `npm run build`). Sem `VITE_SUPABASE_*`, as suítes `AuthContext.test.ts` e `useSiteBackup.test.ts` quebram já no import.

**Subtarefas Kanban:**

- [ ] Confirmar no GitHub se já existe workflow (o zip pode ter omitido); se não houver, criar
- [ ] Job: Node 22, `npm ci`, `tsc -b`, `eslint`, `vitest run`, `vite build`
- [ ] Env fictícia no job ou client Supabase lazy
- [ ] Status check obrigatório na `main`
- [ ] Badge no README

---

### CARD DEV-002 — Ambiente de staging e usuário de teste para E2E

| Campo          | Valor                                                   |
| -------------- | ------------------------------------------------------- |
| **ID**         | DEV-002                                                 |
| **Prioridade** | P2                                                      |
| **Esforço**    | M                                                       |
| **Labels**     | devops, staging, testes                                 |
| **Arquivos**   | `testsprite_tests/`, `.env.example`                     |

**Problema:** O único projeto Supabase documentado é o de produção. Os testes TestSprite ("update access", "start backup", "import", "SMOKE_EDIT") gravam dados reais usando a conta admin.

**Subtarefas Kanban:**

- [ ] Criar um projeto de staging (ou branch Supabase) com migrations e seed
- [ ] Usuário de teste sem admin, com credenciais via secret do CI
- [ ] Apontar TestSprite e Playwright para o staging
- [ ] Documentar no README como alternar os ambientes

---

### CARD DEV-003 — Validar env no boot (evitar tela branca)

| Campo          | Valor                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| **ID**         | DEV-003                                                                                                      |
| **Prioridade** | P2                                                                                                           |
| **Esforço**    | S                                                                                                            |
| **Labels**     | devops, env, dx                                                                                              |
| **Arquivos**   | `src/lib/supabase.ts`, `src/components/UserManagementPanel.tsx`, `src/modules/backup/useSiteBackup.ts`       |

**Problema:** Sem env, `createClient(undefined)` (`supabase.ts:15`) lança exceção durante o import dos módulos. O resultado é tela branca, que nem o ErrorBoundary nem o `RootFallback` capturam. `UserManagementPanel.tsx:42-43` e `useSiteBackup.ts:5-6` leem a env direto.

**Subtarefas Kanban:**

- [ ] `src/lib/env.ts` que valida e exporta as variáveis
- [ ] Tela de erro amigável quando faltar configuração
- [ ] Usar o módulo `env` em todos os lugares

---

### CARD DEV-004 — Build reprodutível (npm ci, engines)

| Campo          | Valor                                              |
| -------------- | -------------------------------------------------- |
| **ID**         | DEV-004                                            |
| **Prioridade** | P2                                                 |
| **Esforço**    | S                                                  |
| **Labels**     | devops, build, node                                |
| **Arquivos**   | `nixpacks.toml`, `package.json`, `netlify.toml`    |

**Problema:** `nixpacks.toml:13-17` roda `npm install --no-audit` em vez de `npm ci`. O `package.json` não tem `engines`, e o Vite 8 exige Node ≥ 20.19/22.12.

**Subtarefas Kanban:**

- [ ] Trocar por `npm ci` no Nixpacks
- [ ] `"engines": { "node": ">=22.12" }` + `.npmrc` com `engine-strict=true`
- [ ] Deixar a versão do Node explícita no `netlify.toml`
- [ ] Regenerar o lockfile incluindo os binários opcionais de cada plataforma

---

### CARD DEV-005 — Deploy automatizado de edge functions e check de drift

| Campo          | Valor                                                     |
| -------------- | --------------------------------------------------------- |
| **ID**         | DEV-005                                                   |
| **Prioridade** | P2                                                        |
| **Esforço**    | M                                                         |
| **Labels**     | devops, edge-functions, supabase, ci                      |
| **Arquivos**   | `supabase/functions/`, `supabase/migrations/`             |

**Problema:** Functions e migrations são publicadas à mão. O backup quebrado (REL-001) e as functions órfãs (SEC-007) mostram que o remoto divergiu do repositório sem ninguém perceber.

**Subtarefas Kanban:**

- [ ] Workflow de deploy das functions na `main` (`supabase functions deploy`)
- [ ] `supabase db diff` no CI, falhando se o remoto ≠ repo
- [ ] Comparar `functions list` com as pastas do repo
- [ ] Rodar os advisors de segurança e performance depois de cada migration

---

### CARD DEV-006 — Supabase local com seed documentado

| Campo          | Valor                                                     |
| -------------- | --------------------------------------------------------- |
| **ID**         | DEV-006                                                   |
| **Prioridade** | P2                                                        |
| **Esforço**    | M                                                         |
| **Labels**     | devops, supabase, dx                                      |
| **Arquivos**   | `supabase/config.toml`, `supabase/seed.sql`               |

**Problema:** A baseline já existe, mas faltam `seed.sql`, um env de exemplo das functions e documentação de `supabase start`/`functions serve`. O comentário em `config.toml:7-9` ainda diz que a baseline não existe.

**Subtarefas Kanban:**

- [ ] `seed.sql` com um usuário admin e um usuário comum, convite e dados de exemplo
- [ ] `supabase/functions/.env.example`
- [ ] Documentar o fluxo local no README
- [ ] Corrigir o comentário do `config.toml`

---

### CARD DEV-007 — README real do projeto

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | DEV-007                        |
| **Prioridade** | P2                             |
| **Esforço**    | S                              |
| **Labels**     | devops, docs, dx               |
| **Arquivos**   | `README.md`                    |

**Problema:** O `README.md` ainda é o template "React + TypeScript + Vite" e não tem setup, env, scripts, deploy nem arquitetura.

**Subtarefas Kanban:**

- [ ] Visão geral e módulos
- [ ] Setup: Node 22, `npm ci`, `.env.local`, `npm run dev`
- [ ] Scripts (test, import:cards, generate:maps) e deploy (Netlify/Coolify)
- [ ] Links para `docs/`

---

### CARD DEV-008 — Dependabot e npm audit

| Campo          | Valor                                            |
| -------------- | ------------------------------------------------ |
| **ID**         | DEV-008                                          |
| **Prioridade** | P3                                               |
| **Esforço**    | S                                                |
| **Labels**     | devops, dependências, segurança                  |
| **Arquivos**   | `.github/dependabot.yml`, `package.json`         |

**Problema:** Não há monitoramento de vulnerabilidades em dependências. Bibliotecas sensíveis como jspdf, pdfjs-dist e dompurify dependem de atualização manual.

**Subtarefas Kanban:**

- [ ] `dependabot.yml` semanal para npm e GitHub Actions
- [ ] `npm audit --omit=dev --audit-level=high` no CI
- [ ] Agrupar os updates minor e patch

---

### CARD DEV-009 — Preview de deploy por PR

| Campo          | Valor                           |
| -------------- | ------------------------------- |
| **ID**         | DEV-009                         |
| **Prioridade** | P3                              |
| **Esforço**    | S                               |
| **Labels**     | devops, netlify, preview        |
| **Arquivos**   | `netlify.toml`                  |

**Problema:** O `netlify.toml` não tem `[context.deploy-preview]`, então as mudanças de UI só são vistas depois do merge.

**Subtarefas Kanban:**

- [ ] Habilitar Deploy Previews apontando para o staging (DEV-002)
- [ ] Comentário automático no PR com o link

---

### CARD DEV-010 — Remover dependências e configurações mortas

| Campo          | Valor                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| **ID**         | DEV-010                                                                               |
| **Prioridade** | P3                                                                                    |
| **Esforço**    | S                                                                                     |
| **Labels**     | devops, dependências, limpeza                                                         |
| **Arquivos**   | `package.json`, `vite.config.ts`, `tailwind.config.js`, `src/App.css`                 |

**Problema:** Nenhum código importa `react-router-dom`, `@xyflow/react`, 6 pacotes `@radix-ui/*`, `class-variance-authority`, `clsx` nem `tailwind-merge`. O `tailwind.config.js` não é carregado (Tailwind 4 sem `@config`) e o `src/App.css` (184 linhas) nunca é importado.

**Subtarefas Kanban:**

- [ ] Remover os pacotes sem uso e rodar o build
- [ ] Apagar `tailwind.config.js` e `App.css` (ou migrar o que servir)
- [ ] `knip` ou `depcheck` no CI

---

### CARD DEV-011 — Dev server exposto na rede local por padrão

| Campo          | Valor                          |
| -------------- | ------------------------------ |
| **ID**         | DEV-011                        |
| **Prioridade** | P3                             |
| **Esforço**    | S                              |
| **Labels**     | devops, segurança, dx          |
| **Arquivos**   | `vite.config.ts`               |

**Problema:** `server.host: true` (`vite.config.ts:8`) expõe o dev server a qualquer dispositivo da rede, inclusive em Wi-Fi público.

**Subtarefas Kanban:**

- [ ] Voltar ao padrão `localhost`
- [ ] Script `dev:lan` com `--host` para testar no celular

---

### CARD DEV-012 — Atualizar docs e configs de infra desatualizados

| Campo          | Valor                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------- |
| **ID**         | DEV-012                                                                                   |
| **Prioridade** | P3                                                                                        |
| **Esforço**    | S                                                                                         |
| **Labels**     | devops, docs                                                                              |
| **Arquivos**   | `supabase/migrations/README.md`, `.gitignore`, `docs/deploy-coolify.md`                   |

**Problema:** `migrations/README.md:80` cita um arquivo de baseline que não existe. A última linha do `.gitignore` usa barra invertida e não tem efeito. A porta de preview (4173) usada pelo TestSprite não está documentada. `docs/deploy-coolify.md` descreve functions que já não existem no repo.

**Subtarefas Kanban:**

- [ ] Corrigir as referências do README de migrations
- [ ] Limpar o `.gitignore` (barras e entradas que faltam)
- [ ] Documentar as portas: dev 5173, preview 4173
- [ ] Revisar o `deploy-coolify.md`

---
