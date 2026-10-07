# Backlog Akool: API v1 (multi-IA, permissões por seção)

> 63 cards no formato BacklogCard v1 (API-001…API-063). Importar em Projetos → Importar, no quadro da fila (o de `AKOOL_BOARD_ID`) ou num quadro novo "API v1" convertido com `npm run cards -- setup-flow`.
> Arquitetura aprovada: `docs/api-arquitetura.md`. Inventário das 357 operações do sistema e card de destino de cada uma: `docs/api-inventario.json`.
> Base de todo card: `infra/staging-baseline` (PR #21) ou a `main` depois que ele entrar. Este arquivo não traz credenciais nem segredos.

## Resumo

A API de hoje (`cards-api`) cobre só os cards e a fila de desenvolvimento, e qualquer token faz qualquer ação. Este backlog leva a API ao sistema inteiro:

- **Permissões por seção e subseção** no token: 7 seções, 27 subseções, níveis Nenhum < Ler < Escrever < Excluir. Administração só leitura, só para admin.
- **Qualquer IA:** um registro de ações gera o servidor MCP remoto (Claude Code, Cursor, VS Code, Gemini CLI, Codex, OpenAI Responses), a API REST e a especificação OpenAPI 3.1 (GPTs personalizados, Gemini function calling, scripts).
- **Execução como o dono do token:** cada chamada roda numa transação com os claims do usuário e o papel `akool_api`, então o RLS, os grants por coluna e os gatilhos atuais continuam valendo.
- **Segurança em camadas:** escopo conferido no gateway e no banco (policies RESTRICTIVE fail-closed), portão de validação humana, compartilhamento transversal começando em Nenhum, auditoria por chamada, idempotência, limites e lixeira de 7 dias com Desfazer.

| Prioridade | P0 | P1 | P2 | P3 | Total |
| --- | --- | --- | --- | --- | --- |
| Cards | 17 | 21 | 20 | 5 | 63 |

Esforço: 9 S, 38 M, 16 L.

## Como tocar

1. Enfileire **um lote por vez**, pela label: `npm run cards -- enqueue --label=lote-01`, depois `/fila` (ou `npm run cards -- next --count=3`).
2. Só enfileire o lote seguinte quando os cards do anterior estiverem em Concluído (`npm run cards -- queue`). A fila ordena por prioridade e esforço, não pela ordem da lista, e `cq_start` conta só os cards em andamento.
3. A primeira subtarefa de cada card com dependência confere que elas estão em Concluído; se não estiverem, o card volta com `release`.
4. Subtarefas que começam com **Você:** são suas (aprovar migration ou deploy, validar no staging, configurar segredo). Os cards de fundação só vão para produção a partir do API-031 (lote 11).

## Lotes

| Lote | Cards |
| --- | --- |
| 01 | API-001 Escopos por subseção no token: catálogo, colunas, RPCs (inclusive exclusão) e cards-api conferindo a permissão (P0/L) · API-002 Sonda no staging: papéis custom, login pelo pooler e claim de reautenticação (P0/S) · API-003 Notas rápidas: updated_at no servidor e fim da sobrescrita offline (P1/M) |
| 02 | API-004 Papéis do executor (akool_api), claims e barreiras no banco (P0/M) · API-005 Núcleo puro da API: validador de JSON Schema, erros padronizados, tsconfig das functions e guarda de imports (P0/M) · API-009 Configurações → API: tokens ativos com permissões por seção e subseção, edição e exclusão (P0/M) |
| 03 | API-006 Restore e cron sem usuário: guarda de workspace segura e convenção para gatilhos novos (P1/M) · API-007 Guardas no banco: escopo do token fail-closed, funções SECURITY DEFINER classificadas e portão de validação (P0/L) · API-008 Registro de ações, catálogo composto e manifesto de cobertura do sistema (P0/M) |
| 04 | API-010 Gateway: edge function api, executor em Deno e REST /v1 (só no staging) (P0/L) · API-011 Ciclo de vida do token: reautenticação recente, avisos, troca de senha e ações de admin (P0/M) · API-012 Metas: correção do compartilhamento, aporte atômico, goal_id travado e bootstrap de categorias (P1/M) |
| 05 | API-013 Regras de cards no servidor: integridade, updated_at, ordem, rótulos e caminhos de anexos (P1/L) · API-014 Auditoria por chamada, limites por token e idempotência (schema api_rt) (P0/M) · API-015 Servidor MCP remoto sem estado gerado do registro (P0/M) |
| 06 | API-016 Recorrentes no servidor: materialização por pg_cron, marcar como paga atômico e orçamentos automáticos (P1/L) · API-017 OpenAPI 3.1 e declarações de função para Gemini geradas do registro (P1/M) · API-018 Storage na API: autorização do objeto como o usuário e caminhos validados (P0/M) |
| 07 | API-019 Prova ponta a ponta em Projetos no staging: fila e cards no registro, cards-api como camada de compatibilidade (P0/L) · API-020 Conteúdo de notas: módulo puro que valida e normaliza blocos BlockNote (P1/M) · API-021 Regras de Estudos no servidor: gatilhos, dono do tópico e forma dos JSON (P1/M) |
| 08 | API-022 Defesa em profundidade: policies RESTRICTIVE por subseção, regra de propriedade e perfis de terceiros (P0/L) · API-023 Conteúdo de notas: Markdown ↔ blocos BlockNote e texto puro sem DOM (P1/M) · API-024 Estudos: RPCs por item, importação atômica e reagendamento no servidor (P1/M) |
| 09 | API-025 Lixeira da API com desfazer e limites de exclusão por linhas (P0/L) · API-026 Matriz de permissões escopo × ação em E2E no staging (P0/M) · API-027 Porte dos módulos de Projetos para _domain: agenda, parser de backlog, plano de importação, Markdown e estatísticas (P1/M) |
| 10 | API-028 Vendas da Loja no servidor: máquina de estados, itens e receita vinculada (P2/L) · API-029 Tela de Estudos usa as operações por item (fim da sobrescrita de listas) (P1/M) · API-030 Escrituração de empréstimos no servidor e cálculo do saldo (P3/M) |
| 11 | API-031 Revisão de segurança da fundação e corte para produção (P0/L) · API-032 Remover os objetos legados de segredo de IA (profile_secrets, set_ai_credentials, ai_has_key e afins) (P3/S) · API-033 Importador de backlog: Contexto multilinha e dependências entre cards (P3/S) |
| 12 | API-034 Estudos na API: tópicos, cards e importação de roteiros (P1/L) · API-035 CLI npm run cards e skill /fila na API nova; cards-api avisa a aposentadoria (P1/S) · API-036 Contas e categorias na API, com saldos calculados no servidor (P1/M) |
| 13 | API-037 Compras e produtos da Loja no servidor: funil, despesa vinculada e compra inicial (P2/L) · API-038 Páginas na API: árvore, metadados, criar, mover, reordenar e excluir com segurança (P1/M) · API-039 Quadros, colunas, membros e estatísticas na API (P1/M) |
| 14 | API-040 Transações na API: CRUD, lote, importação com deduplicação, comprovantes e CSV (P1/L) · API-041 Perfil e foto na API (P2/M) · API-042 Notificações filtradas por escopo e convites próprios na API (P2/M) |
| 15 | API-043 Cards na API: criar, editar com versão, mover, itens, relações, anexos e excluir (P1/L) · API-044 Notas na API: ler e escrever conteúdo com versão, Markdown, imagens e blocos de card (P1/M) · API-045 Tarefas (todos) na API, com updated_at no servidor (P2/S) |
| 16 | API-046 Orçamentos, metas e aportes na API (P2/M) · API-047 Recorrentes na API: cadastro, lançamentos, marcar como paga e pular (P2/M) · API-048 Loja na API, leituras: catálogo, estoque, compras, vendas, clientes e visão do mês (P2/M) |
| 17 | API-049 Visão geral e relatórios financeiros compostos por escopo (P2/L) · API-050 Compartilhamento na API: busca de pessoas e compartilhamento de páginas e quadros (P2/M) · API-051 Notas rápidas na API: listar, criar, editar com versão, vínculos e excluir (P2/S) |
| 18 | API-052 Loja na API, escritas: produtos, compras, vendas, itens, clientes, fornecedores e anexos (P2/L) · API-053 Estudos na API: progresso, quiz, diário e contrato do prompt (P2/M) · API-054 Desenhos (Excalidraw) na API: ler e escrever com validação e limites (P2/M) |
| 19 | API-055 Importação de backlog em Markdown e agenda automática pela API (P2/M) · API-056 Espaço compartilhado e compartilhamentos financeiros na API (P2/M) · API-057 Administração somente leitura na API: usuários, convites, auditoria e backups (P2/M) |
| 20 | API-058 Documentação e onboarding da API para todas as IAs (P2/M) · API-059 Painel inicial e grafo Rede como leituras compostas por escopo (P2/S) · API-060 Empréstimos na API: leitura, escrituração, arquivos e ações entre as partes (P3/M) |
| 21 | API-061 Aposentar a cards-api e o resolve_api_token v1 (P2/S) · API-062 OAuth para apps de chat hospedados (claude.ai, ChatGPT, Gemini): trabalho futuro documentado (P3/S) |
| 22 | API-063 Validação final em produção: cobertura total, matriz completa e checklist do usuário (P1/M) |

---

## Tópico: Fundação da API

---

### CARD API-001 — Escopos por subseção no token: catálogo, colunas, RPCs (inclusive exclusão) e cards-api conferindo a permissão

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-001 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-01, segurança, supabase, tokens |
| **Arquivos**   | `docs/api-arquitetura.md`, `supabase/migrations/<ts>_api001_token_scopes.sql`, `supabase/functions/_api/catalog.ts`, `supabase/functions/_api/scopes.ts`, `supabase/functions/_api/scopes.test.ts`, `supabase/functions/_api/catalogParity.test.ts`, `supabase/functions/cards-api/index.ts`, `supabase/functions/cards-api/scopeMap.ts`, `supabase/functions/cards-api/scopeMap.test.ts`, `src/types/db.ts`, `src/types/database.ts`, `supabase/checks/api001-token-scopes.sql`, `docs/matriz-rls.md` |

**Problema:** O token pessoal (public.api_tokens) é tudo ou nada: resolve_api_token devolve só o user_id, e a cards-api deixa qualquer token fazer qualquer ação de Projetos, inclusive validar cards e converter o quadro; para abrir a API ao sistema inteiro, o token precisa guardar um nível (Nenhum/Ler/Escrever/Excluir) por subseção, validado no banco, sem quebrar o /fila.

**Contexto:** Lote 01. Sem dependências. Aceite: Criar token falha com mensagem clara para subseção inexistente, nível acima do máximo, admin.* sem ser admin, validade acima do teto e escrita sem AAL2 para quem tem MFA; a tela atual continua gerando token; o token migrado roda npm run cards -- boards, cards, card, queue e next; validate e setup-flow respondem 403 dizendo a permissão; o CI passa com gen:types --check. Excluir o token usado pela CLI faz npm run cards -- boards responder 401. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Ler docs/api-arquitetura.md (§0–§6 e Apêndice A), já versionado com este backlog, e conferir se algo mudou desde a aprovação; se mudou, registrar a diferença no plano do lote
- [ ] Criar supabase/functions/_api/catalog.ts, puro e importável pelo src (como _shared/scrub.ts): 7 seções e 27 subseções, cada uma com chave, nível máximo e admin_only
- [ ] Declarar no catalog.ts as visões compostas (meta, painel, documentos.rede, financas.relatorios), sem nível próprio
- [ ] Criar _api/scopes.ts com a hierarquia excluir ⊃ escrever ⊃ ler, allows() e normalizeScopes(), com testes vitest
- [ ] Na migration, criar private.api_scope_catalog semeada com o catálogo; catalogParity.test.ts lê a migration e compara com catalog.ts
- [ ] Em api_tokens, criar scopes jsonb not null default '{}' com CHECK de forma, e last_client text
- [ ] Conferir o attacl atual de api_tokens e conceder SELECT da coluna nova só se a tabela usar grants por coluna (nunca REVOKE de tabela)
- [ ] Dropar create_api_token(text, integer) e criar create_api_token(p_name, p_expires_in_days, p_scopes jsonb default null), com p_scopes nulo = preset legado; refazer revoke e grant
- [ ] Testar a chamada de 2 argumentos nomeados via PostgREST (sem PGRST203), que é a que a tela atual faz
- [ ] Validar no create: chaves e níveis contra o catálogo; validade só 7, 30, 90 ou 365, com teto de 90 dias para Escrever/Excluir e 30 para admin.*
- [ ] Validar no create: admin.* só com is_admin() e com linha em audit_log; AAL2 obrigatório para Escrever, Excluir ou admin quando o usuário tem fator MFA verificado
- [ ] Validar no create: recusar claims com akool_api e subir o limite de ativos de 10 para 20
- [ ] Criar update_api_token_scopes(p_id, p_scopes) e revoke_all_my_api_tokens(), só para o dono e só de sessão do app, com as mesmas regras
- [ ] Criar delete_api_token(p_id): só o dono, só de sessão do app (recusa claims com akool_api), apaga a linha em qualquer estado; revoke de public e anon, grant para authenticated; token ativo excluído deixa de resolver na hora
- [ ] Criar resolve_api_token_v2(p_hash), só para service_role, devolvendo user_id, token_id, prefixo, email, escopos efetivos (sem admin.* se o dono deixou de ser admin) e expires_at
- [ ] Em resolve_api_token_v2, regravar last_used_at só se tiver mais de 60 s; a v1 continua até o API-061
- [ ] Migrar os tokens ativos para {projetos.quadros: read, projetos.cards: read, projetos.fila: write}, sem projetos.validacao
- [ ] cards-api passa a usar resolve_api_token_v2 e um mapa estático em scopeMap.ts, com teste das 17 ações
- [ ] Mapa da cards-api: boards, cards e card exigem leitura; queue.* e card.note/check/complete/block/release, projetos.fila escrever; card.validate, projetos.validacao escrever; board.setup_flow, projetos.quadros excluir
- [ ] Sem a permissão, a cards-api responde 403 com o campo required e dizendo como ativar
- [ ] Criar o override ApiScopes em src/types/db.ts e rodar npm run gen:types
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api001-token-scopes.sql
- [ ] No harness: excluir um token ativo e conferir que resolve_api_token_v2 volta nulo; excluir o token de outro usuário dá P0002; chamar com claims akool_api é recusado
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, get_advisors e docs/matriz-rls.md
- [ ] Deploy da cards-api no staging e npm run cards -- boards, queue e next contra o staging
- [ ] Produção: aplicar a migration só após confirmação do usuário e, logo depois, deploy da cards-api (Deploy function → production); depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção depois do ensaio ROLLBACK
- [ ] Você: Aprovar o deploy da cards-api em produção logo após a migration
- [ ] Você: Rodar npm run cards -- boards com o token atual e confirmar
- [ ] Você: Saber que validate pela IA passa a exigir ativar Validação no token (tela do API-009)

---

### CARD API-002 — Sonda no staging: papéis custom, login pelo pooler e claim de reautenticação

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-002 |
| **Prioridade** | P0 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-01, segurança, supabase, spike |
| **Arquivos**   | `docs/api-arquitetura.md`, `supabase/checks/api002-roles-probe.sql` |

**Problema:** O executor (API-004) depende de fatos não verificados no Postgres 17.6 do Supabase: se o postgres tem ADMIN OPTION sobre authenticated, se o Supavisor aceita o login akool_api_login.<ref>, se policies TO authenticated e grants por coluna valem por herança, e se o JWT traz amr com horário para checar reautenticação recente; sem a resposta, o plano do executor seria aprovado às cegas.

**Contexto:** Lote 01. Sem dependências. Aceite: docs/api-arquitetura.md registra plano A ou B com a evidência; no plano A, a conexão pelo pooler como akool_api_login funciona e set role authenticated falha; o formato do claim amr está documentado. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Sonda só leitura no staging: select current_user pelo caminho do MCP apply_migration (ensaio DO … RAISE)
- [ ] Ler pg_auth_members de authenticated (admin_option, inherit_option, set_option) do papel postgres
- [ ] Ensaio dentro de BEGIN … ROLLBACK: create role akool_api nologin; grant authenticated to akool_api with inherit true, set false; grant akool_api to postgres with inherit false, set true
- [ ] No mesmo ensaio: create role akool_api_login login noinherit; grant akool_api to akool_api_login with set true; grant akool_api_login to postgres with admin option, inherit false, set true
- [ ] Se o ensaio passar, aplicar os papéis no staging de forma idempotente (o API-004 reaproveita)
- [ ] Com a senha definida pelo usuário, conectar pelo Supavisor (porta 6543) com um script descartável fora do repo e anotar o cache de credenciais
- [ ] Como akool_api com claims de um usuário de teste: conferir que policies TO authenticated e o grant por coluna de profiles valem
- [ ] Conferir que set role authenticated falha como akool_api_login e como akool_api, e que após reset role akool_api_login não lê tabela pública
- [ ] Conferir no JWT de uma sessão de teste do staging o claim amr (método e timestamp) para o API-011; se não houver, registrar o fallback (MFA obrigatório para token de escrita)
- [ ] Registrar em docs/api-arquitetura.md §1.2 a decisão (plano A ou plano B) com a saída da sonda; no plano B, remover os papéis do staging
- [ ] Salvar o harness em supabase/checks/api002-roles-probe.sql para o API-004 reaproveitar
- [ ] Você: Definir no SQL Editor do staging a senha do papel akool_api_login quando o ensaio passar
- [ ] Você: Aprovar a aplicação dos papéis no staging

---

## Tópico: Documentos

---

### CARD API-003 — Notas rápidas: updated_at no servidor e fim da sobrescrita offline

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-003 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-01, confiabilidade, notas-rápidas, offline, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api003_quick_notes_updated_at.sql`, `supabase/checks/api003-quick-notes.sql`, `src/hooks/useQuickNotes.ts`, `src/lib/offlineSync.ts`, `src/lib/offlineStore.ts`, `src/components/QuickNotes.tsx`, `src/lib/offlineSync.test.ts`, `src/lib/offlineStore.test.ts`, `src/i18n/translations.pt-BR.ts`, `src/i18n/translations.en.ts` |

**Problema:** quick_notes não tem gatilho de updated_at: o app carimba a hora do navegador, o rascunho offline guarda version:null e é reenviado sem condição (offlineSync.ts:40-44) e o overlay regrava conteúdo e linked_items a partir de estado velho, então toda edição feita fora daquele navegador (outra aba, outro aparelho, a API) é apagada em silêncio.

**Contexto:** Lote 01. Sem dependências. Aceite: Uma edição feita em outra aba não é mais sobrescrita pelo rascunho offline nem pelo overlay aberto: o app mostra o conflito e mantém o rascunho; updated_at vem do servidor e a ordem da lista não depende do relógio do aparelho; os testes atualizados passam. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Migration: gatilho quick_notes_updated_at BEFORE UPDATE com public.update_updated_at()
- [ ] useQuickNotes.updateNote para de enviar updated_at, grava com .eq('updated_at', base) e .select('id, updated_at'), guarda a versão devolvida e encadeia as gravações de cada nota
- [ ] persistQuickDraft guarda como version o updated_at da primeira edição não sincronizada
- [ ] sendQuickNote grava com .eq('updated_at', draft.version); 0 linhas com a nota existente é conflito e o rascunho fica (como saveVersionedContent)
- [ ] Rascunhos antigos com version:null viram conflito e nunca são enviados às cegas
- [ ] QuickNotes.tsx: o textarea ressincroniza com a nota quando não está em foco; vínculos são adicionados e removidos sobre a versão mais recente
- [ ] Aviso de conflito (toast com recarregar), com chaves i18n nas duas línguas
- [ ] Atualizar offlineSync.test.ts (:63-67) e offlineStore.test.ts (:32) e cobrir o caso de conflito
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api003-quick-notes.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Teste manual no staging com duas abas e com o navegador offline
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção após o ensaio
- [ ] Você: Testar no staging editando a mesma nota em duas abas e editando offline

---

## Tópico: Fundação da API

---

### CARD API-004 — Papéis do executor (akool_api), claims e barreiras no banco

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-004 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-02, segurança, supabase, rls |
| **Arquivos**   | `supabase/migrations/<ts>_api004_executor_roles.sql`, `supabase/functions/_api/claims.ts`, `supabase/functions/_api/claims.test.ts`, `supabase/checks/api004-executor.sql`, `supabase/checks/schema-snapshot.sql`, `scripts/supabase-drift.test.ts`, `supabase/functions/_shared/scrub.ts`, `supabase/functions/_shared/scrub.test.ts`, `.gitleaks.toml`, `supabase/functions/.env.example`, `docs/deploy-coolify.md`, `scripts/repo-hygiene.test.ts`, `scripts/local-supabase.test.ts`, `docs/matriz-rls.md` |

**Problema:** Hoje a cards-api chama RPCs como service_role com p_actor e ignora todo o RLS; repetir isso em 49 tabelas duplicaria o RLS e desligaria guardas que dependem de auth.uid(), e emitir JWT exigiria um segredo capaz de forjar qualquer usuário: a API precisa de um papel de banco que execute como o usuário, com o RLS atual, sem conseguir escapar dele.

**Contexto:** Lote 02. Depende de: API-001, API-002. Aceite: O harness termina ok no staging; set role authenticated falha como akool_api_login e akool_api; com claims de A e papel akool_api só aparecem dados de A; o drift mostra os papéis; scrub troca URLs postgres:// por [db-url]. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-001 e API-002 estão em Concluído (npm run cards -- card API-002); se não, release e avisar o usuário; ler a decisão registrada no API-002 (plano A ou B)
- [ ] Migration idempotente (a sonda já criou os papéis no staging) com os grants exatos de docs/api-arquitetura.md §1.2: authenticated com inherit true, set false; postgres com set true e inherit false; akool_api_login noinherit
- [ ] akool_api_login recebe EXECUTE só de resolve_api_token_v2
- [ ] akool_api recebe EXECUTE dos 11 cq_* revogados no SEC-012 (nunca authenticated)
- [ ] private.cq_source() devolve 'api' também quando os claims têm akool_api
- [ ] Policies RESTRICTIVE para akool_api com using(false) em api_tokens, profile_secrets, study_lookup_cache, page_presence, mindmap_contents e finance_statements (no plano B: TO authenticated condicionadas ao claim)
- [ ] _api/claims.ts puro: monta {sub, role:'authenticated', email, aal:'aal1', akool_api:{token_id, prefix, surface}} e o request.headers só com o IP; recusa sem sub ou token_id; testes vitest
- [ ] Harness supabase/checks/api004-executor.sql, no padrão de sec013-finance-consent.sql
- [ ] Casos do harness (dados): como akool_api com claims de A, só vê linhas de A; os grants por coluna de profiles valem
- [ ] Casos do harness (gatilhos): prevent_profile_privilege_escalation e guard_page_parent disparam; finance_guard_workspace aceita o workspace de A e recusa o de B; cq_actor devolve o sub
- [ ] Casos do harness (papéis): set role authenticated falha; após reset role, akool_api_login não lê tabela pública
- [ ] Bloco roles em supabase/checks/schema-snapshot.sql (atributos de akool_% e pg_auth_members com admin/inherit/set) e teste em scripts/supabase-drift.test.ts
- [ ] AKOOL_API_DB_URL vazio em supabase/functions/.env.example (formato só em comentário), em docs/deploy-coolify.md §3.1 e nos testes de repo-hygiene e local-supabase; a URL local é direta porque o pooler local fica desligado
- [ ] scrub.ts: regra postgres(ql)://usuário:senha@ → [db-url], com teste
- [ ] Regra para URL do pooler no .gitleaks.toml
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api004-executor-roles.sql, incluindo um INSERT sem claims (restore e cron)
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: a migration é inofensiva (nada conecta como akool_api_login antes do API-031); apply_migration só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção após o ensaio ROLLBACK (a senha de produção só é definida no API-031)

---

### CARD API-005 — Núcleo puro da API: validador de JSON Schema, erros padronizados, tsconfig das functions e guarda de imports

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-005 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-02, arquitetura, testes |
| **Arquivos**   | `tsconfig.json`, `tsconfig.functions.json`, `supabase/functions/_api/schema.ts`, `supabase/functions/_api/schema.test.ts`, `supabase/functions/_api/errors.ts`, `supabase/functions/_api/errors.test.ts`, `supabase/functions/_api/importBoundary.test.ts`, `supabase/migrations/README.md`, `scripts/coverage-baseline.json` |

**Problema:** Nada checa os tipos do código em supabase/functions (o tsconfig cobre só src, vite e e2e, e não há deno check no CI), o bundler do staging:reset quebra com import de fora de supabase/functions, e a cards-api devolve mensagens cruas do Postgres: antes de centenas de handlers, a API precisa de um validador de entrada, de erros estáveis e de guardas de compilação e de imports.

**Contexto:** Lote 02. Sem dependências. Aceite: npx tsc -b passa e falha de propósito com um erro de tipo em _api; o teste de fronteira falha com um import de src/; o validador recusa entrada inválida com JSON Pointer; um 42501 vira 403 e um erro sem marca vira mensagem genérica. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Criar tsconfig.functions.json (strict, lib ES2023 sem DOM, allowImportingTsExtensions, noEmit) incluindo supabase/functions/_api/** e _domain/**, excluindo runtime/** e */index.ts
- [ ] Referenciar tsconfig.functions.json no tsconfig.json para npx tsc -b checar os módulos puros
- [ ] Criar importBoundary.test.ts: fora de runtime/, _api e _domain só importam caminhos relativos .ts dentro de supabase/functions, inclusive import type; sem src/, @/, ../types, pacote nu, npm: ou jsr:
- [ ] _api/schema.ts: validador do subconjunto (type, properties, required, additionalProperties:false, enum, const, mínimos e máximos, minLength/maxLength, pattern, formatos date/date-time/uuid/email, items, minItems/maxItems, oneOf simples)
- [ ] schema.ts devolve os erros em JSON Pointer e recusa schema com palavra-chave fora do subconjunto
- [ ] _api/errors.ts: envelope {error:{code, message, required?, details?, retry_after?}}, códigos estáveis e mapa SQLSTATE→HTTP completo de docs/api-arquitetura.md §10 (inclusive 57014→504, 23503/23502/22001/22003→422 e 40P01/55P03→503)
- [ ] Mensagem do Postgres só passa quando é RAISE do app (P0001 ou hint='akool'); o resto vira texto genérico em pt-BR + code
- [ ] Documentar a convenção hint='akool' em supabase/migrations/README.md
- [ ] Testes vitest de schema e errors; grupo supabase/functions/_api no coverage-ratchet (--update)
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build

---

## Tópico: Confiabilidade

---

### CARD API-006 — Restore e cron sem usuário: guarda de workspace segura e convenção para gatilhos novos

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-006 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-03, confiabilidade, backup, supabase, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api006_guards_without_user.sql`, `supabase/checks/api006-restore.sql`, `supabase/migrations/README.md`, `docs/api-arquitetura.md`, `docs/matriz-rls.md` |

**Problema:** finance_guard_workspace recusa com 42501 o INSERT de linha com workspace_id quando auth.uid() é nulo, então restore_site_backup (service_role) já falha hoje em backups com linhas de workspace e o cron de recorrentes (API-016) também falharia; os gatilhos novos dos API-013, 021 e 028 repetiriam o defeito sem uma regra comum.

**Contexto:** Lote 03. Sem dependências. Aceite: O ensaio de restore com linhas de workspace conclui; um usuário logado continua recebendo 42501 ao mover linha para workspace de que não é membro; a regra está documentada. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Levantamento só leitura dos gatilhos e funções de gatilho que usam auth.uid() e do comportamento deles com uid nulo (restore, cron, cards-api como service_role)
- [ ] finance_guard_workspace passa a liberar contexto sem usuário (service_role, postgres, cron), como sec005_page_parent_guard e finance_loans_module, mas nunca os papéis authenticated/akool_api
- [ ] Registrar a regra em supabase/migrations/README.md e docs/api-arquitetura.md §1.5: gatilho novo pula só sem usuário e valida só colunas que mudaram
- [ ] Harness supabase/checks/api006-restore.sql: restore_site_backup com fixture mínima com linhas de workspace, dentro de BEGIN … ROLLBACK, conclui
- [ ] No mesmo harness: INSERT sem claims imitando o cron passa; sessão authenticated continua sem mover linha para workspace alheio
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção após o ensaio

---

## Tópico: Fundação da API

---

### CARD API-007 — Guardas no banco: escopo do token fail-closed, funções SECURITY DEFINER classificadas e portão de validação

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-007 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-03, segurança, supabase, rls |
| **Arquivos**   | `supabase/migrations/<ts>_api007_db_guards.sql`, `supabase/functions/_api/definerInventory.ts`, `supabase/functions/_api/definerInventory.test.ts`, `supabase/functions/cards-api/index.ts`, `supabase/functions/cards-api/scopeMap.ts`, `supabase/functions/cards-api/scopeMap.test.ts`, `supabase/checks/api007-guards.sql`, `supabase/checks/api007-grants.sql`, `docs/matriz-rls.md` |

**Problema:** Funções SECURITY DEFINER rodam como dono e não sofrem RLS, e akool_api herda o EXECUTE de authenticated em admin_add_invite_slots, admin_list_profiles, create/revoke_api_token, search_users_for_share, RPCs de workspace e cq_*, enquanto o gatilho cq_on_card_change aprova itens em revisão e reenfileira cards quando a checklist muda: sem guardas no banco, um handler com bug ou SQL injetado alcança ações proibidas pela decisão 4 e contorna o portão de validação humana.

**Contexto:** Lote 03. Depende de: API-004. Aceite: O harness mostra os bloqueios em sessão da API e nenhuma mudança em sessão do app; o teste de inventário falha quando aparece uma função SECURITY DEFINER nova sem classificação; npm run cards -- check recusa item do usuário sem Validação. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-004 está em Concluído (npm run cards -- card API-004); se não, release e avisar o usuário
- [ ] Criar private.api_scope_allows(p_subs text[], p_level text) fail-closed conforme docs/api-arquitetura.md §2.1
- [ ] Requisitos de api_scope_allows: relê api_tokens pelo token_id dos claims e exige user_id = auth.uid(), token ativo, session_user = akool_api_login (plano A) e is_admin() para admin.*
- [ ] Grant de api_scope_allows: só EXECUTE para akool_api, sem USAGE de private
- [ ] Criar private.api_is_api_session(), private.api_require(sub, level) (42501 com required no detalhe) e private.api_deny()
- [ ] definerInventory.ts: classificar toda função SECURITY DEFINER e gatilho executável por authenticated como require(sub, level), deny ou predicado puro
- [ ] Teste de paridade que lê as migrations e falha com função não classificada
- [ ] Migration aplicando api_deny no topo de: escritas admin_*, create_api_token, update_api_token_scopes, revoke_api_token, revoke_all_my_api_tokens e set_ai_credentials
- [ ] Migration aplicando api_require no topo de: admin_list_profiles, search_users_for_share, RPCs de workspace, generate_invite_code, create_project_board, bootstraps e cada cq_*
- [ ] Portão de validação: em sessão da API, cq_on_card_change exige projetos.validacao:write para aprovar ao mover para Concluído em quadro com fluxo
- [ ] Gatilho BEFORE UPDATE OF checklist que, em sessão da API, recusa mudar completed de item owner='user' sem projetos.validacao; cq_check herda a regra
- [ ] cards-api legada: antes de check, consulta cq_card e recusa itens owner='user' sem projetos.validacao (teste em scopeMap.test.ts)
- [ ] supabase/checks/api007-grants.sql: nenhuma função de private executável por PUBLIC, authenticated ou akool_api fora de uma allowlist
- [ ] Harness api007-guards.sql: claims forjados (outro sub, sem chave akool_api, token_id de outro usuário) → api_scope_allows false
- [ ] Harness: api_deny bloqueia create_api_token em sessão da API; mover para Concluído e marcar item do usuário sem Validação → 42501; sessões do app inalteradas
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api007-db-guards.sql, incluindo um INSERT sem claims (restore e cron)
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: migration (inofensiva para o app) e deploy da cards-api, cada um só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration e o deploy da cards-api em produção

---

### CARD API-008 — Registro de ações, catálogo composto e manifesto de cobertura do sistema

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-008 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-03, arquitetura |
| **Arquivos**   | `supabase/functions/_api/types.ts`, `supabase/functions/_api/registry.ts`, `supabase/functions/_api/registry.test.ts`, `supabase/functions/_api/coverage.ts`, `supabase/functions/_api/coverage.test.ts`, `supabase/functions/_api/actions/meta.ts`, `supabase/functions/_api/catalog.ts` |

**Problema:** Não existe um lugar único que descreva o que a API faz nem uma lista do que o sistema faz: a cards-api é um switch de 17 ações sem schema, e sem um registro com invariantes e um manifesto das operações do sistema não dá para gerar MCP, REST e OpenAPI do mesmo jeito nem provar que a API cobre todas as funcionalidades.

**Contexto:** Lote 03. Depende de: API-001, API-005. Aceite: registry.test.ts falha com nome MCP de 49 caracteres, com leitura sem readOnlyHint e com requires de subseção inexistente; coverage.ts lista as 357 operações e o teste mostra quantas estão pendentes por card. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-001 e API-005 estão em Concluído; se não, release e avisar o usuário
- [ ] _api/types.ts: ActionDef e ActionCtx conforme docs/api-arquitetura.md §4, inclusive ctx.request (surface, client, ip_bucket) e ganchos de auditoria, limites e idempotência que começam vazios
- [ ] _api/registry.ts e registry.test.ts com as invariantes de §4
- [ ] Invariantes de nome: ids [a-z_] em 3 segmentos e nome MCP com até 48 caracteres
- [ ] Invariantes de tipo de ação: leitura com readOnlyHint e entrada plana; exclusão com destructiveHint e nível delete
- [ ] Invariantes de escopo: requires só com subseções reais e nível até o máximo; namespaces compostos declarados em catalog.ts
- [ ] Invariantes gerais: ordem determinística; descrição até 300 caracteres, sem frases dirigidas ao modelo
- [ ] Teste: toda ação tem exemplo de entrada válido no schema e exemplo de saída válido no outputSchema
- [ ] Ações meta.token.obter e meta.acoes.listar, com definição e handler puro
- [ ] _api/coverage.ts com as 357 operações da avaliação, cada uma → action id, never:<motivo> ou pending:API-0NN; se o understand.json não estiver disponível, reconstruir por domínio a partir de docs/api-arquitetura.md §14
- [ ] coverage.test.ts falha com action id inexistente e imprime o total pendente por card
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Anexar ao card a lista de operações da avaliação (understand.json), se o agente pedir

---

### CARD API-009 — Configurações → API: tokens ativos com permissões por seção e subseção, edição e exclusão

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-009 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-02, ux, configurações, i18n |
| **Arquivos**   | `src/components/ApiTokensSection.tsx`, `src/components/apiTokens/ScopePicker.tsx`, `src/components/apiTokens/TokenList.tsx`, `src/components/apiTokens/presets.ts`, `src/lib/data/apiTokens.ts`, `src/lib/data/apiTokens.test.ts`, `src/i18n/translations.pt-BR.ts`, `src/i18n/translations.en.ts`, `scripts/data-layer-baseline.json`, `scripts/lint-baseline.json`, `e2e/app/api-tokens.spec.ts` |

**Problema:** A aba API só tem nome e Gerar, com 90 dias fixos, e na lista só existe Revogar; para usar a API com qualquer IA, o usuário precisa escolher o nível de cada seção e subseção (em lote ou uma a uma) e a validade, e depois controlar cada token ativo: editar as permissões, revogar e excluir.

**Contexto:** Lote 02. Depende de: API-001. Aceite: No staging dá para criar token por preset e por escolha manual por subseção; num token ativo, editar as permissões sem trocar o segredo, revogar e excluir; excluir revogados e expirados, um a um ou todos de uma vez; a CLI com um token excluído recebe 401; Administração não aparece para quem não é admin; os textos existem nas duas línguas; data-layer-baseline e lint-baseline não crescem e o E2E passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-001 está em Concluído; se não, release e avisar o usuário
- [ ] Criar src/lib/data/apiTokens.ts (listar, criar, editar escopos, revogar, revogar todos, excluir e limpar revogados e expirados) e tirar as 3 chamadas diretas do ApiTokensSection (o data-layer-baseline diminui)
- [ ] ScopePicker: uma linha por seção com seletor em lote, limitado ao máximo de cada subseção, e controle segmentado por subseção
- [ ] No ScopePicker, Administração só aparece para admin
- [ ] No ScopePicker, as visões compostas (Visão geral, Rede, Painel, Projetos → Resumo) aparecem como linhas informativas que mostram o que exigem
- [ ] Avisos ao escolher Excluir, Validação, Compartilhamento (inclui agir em conteúdo de outras pessoas) e Administração
- [ ] Presets em presets.ts: Somente leitura (sem Administração nem Compartilhamento) e Claude Code: fila (Quadros ler, Cards ler, Fila escrever)
- [ ] Presets em presets.ts: Entrada de dados financeiros (Transações, Orçamentos e metas e Recorrentes escrever; Contas e Categorias ler) e Personalizado
- [ ] Criação: nome, validade (7, 30, 90 ou 365; até 90 com escrita e até 30 com admin) e escopos
- [ ] Após criar, o token aparece uma vez; o erro de AAL2 explica o motivo e leva para Segurança
- [ ] Lista: escopos em chips, último uso e último cliente
- [ ] Token ativo na lista: Editar permissões (ScopePicker preenchido com o nível atual de cada subseção, de Nenhum a Excluir; o segredo não muda), Revogar e Excluir
- [ ] Token revogado ou expirado: Excluir; para a lista inteira: Revogar todos e Limpar revogados e expirados
- [ ] Excluir com confirmação em dois passos, no padrão de Revogar; para token ativo, o aviso diz que ele para de funcionar na hora e que a IA que o usa perde o acesso
- [ ] O token migrado (o do /fila) aparece com as permissões atuais (Quadros: Ler, Cards: Ler, Fila: Escrever) e pode ser editado, por exemplo para ativar Validação
- [ ] i18n: api_scope_section_*, api_scope_* e settings_api_* nas duas línguas; trocar settings_api_intro
- [ ] Teste de paridade entre catalog.ts e as chaves i18n
- [ ] Cores por token (nenhum hex novo), rótulos com <Field>, botões com nome e arquivos com até 600 linhas
- [ ] E2E no staging (e2e/app/api-tokens.spec.ts): criar com preset, editar escopos, revogar e excluir (token ativo e revogado)
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Deploy do frontend só após confirmação do usuário
- [ ] Você: Validar no staging a clareza dos níveis e dos presets
- [ ] Você: Aprovar o deploy do frontend
- [ ] Você: Editar as permissões do seu token atual (por exemplo, ativar Validação) e excluir um token de teste

---

### CARD API-010 — Gateway: edge function api, executor em Deno e REST /v1 (só no staging)

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-010 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-04, edge-functions, rest |
| **Arquivos**   | `supabase/functions/api/index.ts`, `supabase/functions/_api/http.ts`, `supabase/functions/_api/http.test.ts`, `supabase/functions/_api/runtime/db.ts`, `supabase/functions/_api/sqlSafety.test.ts`, `supabase/config.toml`, `.github/workflows/deploy-functions.yml`, `scripts/workflows.test.ts`, `scripts/staging-reset.test.ts`, `scripts/supabase-drift.mjs`, `scripts/supabase-drift.test.ts`, `supabase/drift-allowlist.json`, `scripts/coverage-baseline.json`, `docs/api.md`, `README.md`, `docs/arquitetura.md` |

**Problema:** Com papéis e registro prontos, falta o caminho que liga um token HTTP a uma transação como o usuário (conexão ao pooler, withUserTx, roteamento REST, conferência de escopo e envelope de erros); além disso, a function não pode ir para produção antes das guardas e da revisão, mas o drift da main acusa function do repo que não foi publicada.

**Contexto:** Lote 04. Depende de: API-004, API-008. Aceite: No staging, meta/token/obter com token válido devolve o usuário e os escopos efetivos; token inválido dá 401, rota inexistente 404 e entrada inválida 422 com JSON Pointer; sqlSafety e as invariantes passam; o drift da main fica verde com api em repoOnlyFunctions. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-004 e API-008 estão em Concluído; se não, release e avisar o usuário
- [ ] Criar _api/runtime/db.ts com npm:postgres@3.4.x inline e as opções de docs/api-arquitetura.md §1.4: prepare:false, max:2, idle_timeout:10, connect_timeout:5, ssl require e tipos date/timestamptz como texto
- [ ] withUserTx(principal, fn) faz um único select de set_config (claims, request.headers, role, statement_timeout); o cliente cru não é exportado
- [ ] sqlSafety.test.ts: fora de runtime/db.ts, nenhum arquivo de _api usa unsafe(, set role, reset role, set_config ou session_replication_role
- [ ] _api/http.ts puro, com dependências injetadas: confere o formato do token antes do banco e resolve com resolve_api_token_v2
- [ ] Rotas de http.ts: GET para leitura e POST para escrita e exclusão em /v1/{secao}/{subsecao}/{acao}
- [ ] Pipeline de http.ts: validação, requires + ctx.can, executor e X-Akool-Timezone
- [ ] Origem em http.ts: Origin fora de ALLOWED_ORIGINS → 403, sem CORS
- [ ] Ganchos de auditoria, limites e idempotência ficam vazios até o API-014
- [ ] Testes de http.ts com executor falso: 401, 403 com required, 404, 405, 422 com JSON Pointer e envelope de sucesso
- [ ] api/index.ts: Deno.serve, Sentry (_shared/sentry.ts), rotas /api/v1/* e espaço para /api/mcp e /api/openapi.json
- [ ] Infra: [functions.api] verify_jwt = false; opção api no deploy-functions.yml; workflows.test.ts e staging-reset.test.ts
- [ ] Grupos supabase/functions/api e _api no coverage-ratchet
- [ ] Drift: chave nova repoOnlyFunctions em supabase/drift-allowlist.json (com teste em supabase-drift.test.ts), contendo api até o corte do API-031
- [ ] Tabela de functions no README, docs/arquitetura.md e esqueleto de docs/api.md
- [ ] Staging: secret AKOOL_API_DB_URL, npm run staging:reset -- --functions --only=api e curl em /functions/v1/api/v1/meta/token/obter
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Criar o secret AKOOL_API_DB_URL (pooler em modo transação, usuário akool_api_login.<ref>) nas Edge Functions do staging

---

### CARD API-011 — Ciclo de vida do token: reautenticação recente, avisos, troca de senha e ações de admin

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-011 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-04, segurança, tokens, admin |
| **Arquivos**   | `supabase/migrations/<ts>_api011_token_lifecycle.sql`, `supabase/checks/api011-lifecycle.sql`, `supabase/functions/admin-ops/index.ts`, `supabase/functions/admin-ops/rules.ts`, `supabase/functions/admin-ops/rules.test.ts`, `src/components/UserManagementPanel.tsx`, `src/lib/data/admin.ts`, `src/lib/data/apiTokens.ts`, `src/pages/ResetPasswordPage.tsx`, `src/components/UserSettingsModal.tsx`, `src/components/Dashboard.tsx`, `src/i18n/translations.pt-BR.ts`, `src/i18n/translations.en.ts` |

**Problema:** Uma sessão do app roubada vira persistência longa: sem MFA, criar token de escrita ou ampliar escopos exige só AAL1; o token sobrevive ao re-login diário, à troca e à recuperação de senha e ao set_role; o usuário não é avisado; e o admin não consegue listar nem revogar tokens de outra pessoa sem banir.

**Contexto:** Lote 04. Depende de: API-001, API-002. Aceite: Sem MFA e com sessão antiga, criar token de escrita pede a senha de novo; criar ou ampliar gera notificação; recuperar a senha revoga os tokens; o admin com AAL2 lista e revoga o token de um usuário de teste (com audit_log); rebaixar tira admin.* e banir revoga todos. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-001 e API-002 estão em Concluído; se não, release e avisar o usuário
- [ ] Migration: para quem não tem MFA, create_api_token e update_api_token_scopes exigem autenticação de até 10 minutos (claim amr, conforme o API-002) ao criar token com Escrever/Excluir ou ao ampliar escopos
- [ ] Chamar _notify(user, 'api_token_created') na criação e _notify(user, 'api_token_scopes_widened') na ampliação
- [ ] Mostrar os dois tipos novos na lista de notificações, com chaves i18n nas duas línguas
- [ ] UI: quando o RPC recusa por autenticação antiga, pedir a senha de novo e repetir a operação
- [ ] ResetPasswordPage (recuperação) revoga todos os tokens
- [ ] Troca de senha no UserSettingsModal oferece Revogar também os tokens de API, marcado por padrão
- [ ] admin-ops: ações list_api_tokens(user_id) e revoke_api_token(token_id) com admin + AAL2 e linha em audit_log
- [ ] admin-ops: set_role, ao rebaixar, remove admin.* dos tokens; ban_user e revoke_sessions revogam todos
- [ ] Regras do admin-ops em rules.ts, com teste
- [ ] UI de Usuários: tokens do usuário (nome, prefixo, escopos, último uso, último cliente) com botão Revogar
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api011-lifecycle.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: migration e deploy da admin-ops, cada um só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration e o deploy da admin-ops em produção
- [ ] Você: Testar com um usuário de teste: criar token de escrita com sessão antiga, recuperar a senha, rebaixar e banir

---

## Tópico: Finanças

---

### CARD API-012 — Metas: correção do compartilhamento, aporte atômico, goal_id travado e bootstrap de categorias

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-012 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-04, finanças, segurança, supabase, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api012_goals_fixes.sql`, `supabase/checks/api012-goals.sql`, `src/modules/finance/useFinanceActions.ts`, `src/modules/finance/useFinanceData.ts`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** finance_goal_shares aceita insert e update conferindo só owner_id = auth.uid() (perf002_consolidate_permissive_policies.sql:125-131), então dá para compartilhar a meta de outra pessoa e driblar o consentimento do SEC-013; além disso, um aporte pode ser repontado para a meta alheia por UPDATE de goal_id, aporte e conclusão da meta são passos soltos no navegador, e o bootstrap de categorias só roda no navegador.

**Contexto:** Lote 04. Sem dependências. Aceite: O harness mostra que não dá para compartilhar meta alheia nem repontar aporte; um aporte que atinge o alvo conclui a meta na mesma transação; rodar o bootstrap de novo não duplica categorias. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Policies de finance_goal_shares exigem que a meta seja do usuário; o alvo fica travado como no SEC-002 (private.shares_freeze_target)
- [ ] UPDATE de finance_goal_contributions não pode mudar goal_id (gatilho ou policy)
- [ ] finance_goal_contribute(p_goal, p_amount_cents, p_date, p_note) atômico, com conclusão automática ao atingir o alvo
- [ ] bootstrap_finance_categories e bootstrap_workspace_categories idempotentes, chamados pelo app e pela API
- [ ] O app usa a RPC de aporte e o bootstrap do servidor
- [ ] Ensaio ROLLBACK no staging e harness supabase/checks/api012-goals.sql com os casos de IDOR e um INSERT sem claims
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção após o ensaio

---

## Tópico: Projetos

---

### CARD API-013 — Regras de cards no servidor: integridade, updated_at, ordem, rótulos e caminhos de anexos

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-013 |
| **Prioridade** | P1 |
| **Esforço**    | L |
| **Labels**     | api-v1, lote-05, projetos, supabase, integridade, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api013_project_cards_integrity.sql`, `supabase/checks/api013-project-cards.sql`, `src/modules/projects/useBoardActions.ts`, `e2e/app/board.spec.ts`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** O banco não valida cards: pai e dependências podem apontar para outro quadro ou formar ciclo (a checagem existe só no CardModal), o responsável pode ser qualquer perfil, checklist, rótulos e anexos não têm forma, updated_at e sort_order vêm do navegador, o autosave regrava a linha inteira e a busca por rótulo diferencia maiúsculas; isso precisa ir para o servidor antes de a API escrever cards.

**Contexto:** Lote 05. Depende de: API-006. Aceite: O harness recusa pai de outro quadro, ciclo, responsável de fora e JSON fora da forma; o kanban continua funcionando no staging (arrastar, editar, subtarefas, Gantt); duas abas editando o mesmo card dão conflito em vez de sobrescrever; o filtro de rótulo acha Segurança e segurança; npm run cards continua funcionando e o restore de ensaio conclui. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-006 está em Concluído; se não, release e avisar o usuário
- [ ] Levantamento só leitura dos dados que violariam as regras (pai ou dependência de outro quadro, ciclos, responsável de fora, JSON fora da forma, anexos fora da pasta do quadro) e correção combinada com o usuário
- [ ] Gatilho BEFORE INSERT/UPDATE private.project_card_integrity(), validando só colunas que mudaram e pulando contexto sem usuário (§1.5)
- [ ] Regras de relação: parent_card_id e depends_on no mesmo quadro e sem ciclo; responsável é o dono ou tem share; linked_page_id legível
- [ ] Regras de forma: checklist, labels e attachments com formato definido; anexos sob ${uid}/${board}/; sort_order = max+1 quando vier nulo
- [ ] Gatilho updated_at em project_cards
- [ ] useBoardActions grava com .eq('updated_at', base) e recarrega o card em conflito
- [ ] Rótulos: cq_cards e cq_enqueue comparam com lower(), sem mudar o que o usuário digitou
- [ ] Ensaio ROLLBACK e harness supabase/checks/api013-project-cards.sql com os casos de recusa e um restore de staging em BEGIN … ROLLBACK
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] E2E e2e/app/board.spec.ts no staging
- [ ] npm run cards -- check, block, complete e next contra o staging (a cards-api ainda roda como service_role)
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir o que fazer com os dados que o levantamento apontar como fora das regras
- [ ] Você: Usar o kanban no staging antes de aprovar
- [ ] Você: Aprovar a migration em produção após o ensaio

---

## Tópico: Fundação da API

---

### CARD API-014 — Auditoria por chamada, limites por token e idempotência (schema api_rt)

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-014 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-05, segurança, auditoria, rate-limit |
| **Arquivos**   | `supabase/migrations/<ts>_api014_audit_ratelimit_idempotency.sql`, `supabase/functions/_api/audit.ts`, `supabase/functions/_api/idempotency.ts`, `supabase/functions/_api/ratelimit.ts`, `supabase/functions/_api/audit.test.ts`, `supabase/functions/_api/idempotency.test.ts`, `supabase/functions/_api/ratelimit.test.ts`, `supabase/functions/_api/http.ts`, `src/components/apiTokens/TokenActivity.tsx`, `src/lib/data/apiTokens.ts`, `supabase/checks/api014-audit.sql`, `docs/matriz-rls.md` |

**Problema:** Uma API que escreve em todas as seções precisa deixar rastro de cada chamada sem guardar dados pessoais, impedir que um agente duplique dinheiro ao repetir uma requisição e limitar abuso por token e por IP; a cards-api só limita por usuário (fail-open) e não registra nada, e private.request_ip() fica nulo fora da PostgREST.

**Contexto:** Lote 05. Depende de: API-010. Aceite: No staging, toda chamada (sucesso, 4xx e 429) gera uma linha em private.api_calls sem argumentos e com ip_bucket; a mesma Idempotency-Key devolve a mesma resposta sem duplicar, e duas requisições simultâneas dão 409 na segunda; a 121ª chamada no minuto recebe 429; Configurações → API mostra a atividade. Excluir um token mantém as chamadas dele em Atividade. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-010 está em Concluído; se não, release e avisar o usuário
- [ ] Criar o schema api_rt com USAGE só para akool_api e akool_api_login
- [ ] api_rt.authorize(hash, ip_bucket, nivel) resolve o token e aplica os limites numa ida
- [ ] private.api_calls com os campos de docs/api-arquitetura.md §9.1, inclusive ip_bucket via private.ip_bucket_key e token_prefix/token_name copiados na chamada, sem FK para api_tokens (excluir o token preserva o histórico) e sem argumentos nem conteúdo
- [ ] api_rt.audit_write lê token_id dos claims; escrita auditada dentro da transação do usuário; negações e falhas auditadas fora
- [ ] O gateway monta request.headers só com o IP observado
- [ ] O gatilho do SEC-018 e cq_source rotulam api:<prefixo> quando há akool_api
- [ ] private.api_idempotency e api_rt.idem_begin/idem_finish com pg_try_advisory_xact_lock (§9.2)
- [ ] Idempotência: Idempotency-Key no REST e idempotency_key no MCP
- [ ] Limites de §9.3 via public.check_rate_limit, com 429 e Retry-After
- [ ] Se o limitador falhar: fail-open com log para leitura e escrita, fail-closed para Excluir
- [ ] Gravar last_client do token: clientInfo do MCP ou User-Agent, até 80 caracteres
- [ ] pg_cron api-housekeeping diário: apaga api_calls com mais de 90 dias, idempotência com mais de 24 h e linhas de idempotência de tokens que não existem mais
- [ ] list_my_api_calls(p_token_id, p_before), só para o dono, e painel Atividade em Configurações → API (últimas 50); chamadas de token excluído aparecem como "token excluído", com nome e prefixo
- [ ] Ligar os ganchos no http.ts; testes vitest de audit, idempotency e ratelimit
- [ ] Ensaio ROLLBACK e harness supabase/checks/api014-audit.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: migration inofensiva sem a function publicada, só após confirmação do usuário; depois npm run drift -- --write
- [ ] Staging: npm run staging:reset -- --functions --only=api
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção

---

### CARD API-015 — Servidor MCP remoto sem estado gerado do registro

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-015 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-05, mcp, ia |
| **Arquivos**   | `supabase/functions/_api/mcp.ts`, `supabase/functions/_api/mcp.test.ts`, `supabase/functions/_api/fixtures/mcp-2025.json`, `supabase/functions/_api/fixtures/mcp-2026.json`, `supabase/functions/api/index.ts`, `docs/api.md` |

**Problema:** Claude Code, Codex, Gemini CLI, Cursor, VS Code e as APIs da OpenAI e da Anthropic falam MCP, mas não há servidor; ele precisa rodar na edge (sem estado, 2 s de CPU), atender clientes da era initialize, em que o Claude Code ainda está, e também a revisão 2026-07-28, e mostrar só as ferramentas que o token pode usar.

**Contexto:** Lote 05. Depende de: API-010. Aceite: O Claude Code conecta ao staging pelo .mcp.json, lista só as ferramentas permitidas (meta_token_obter e meta_acoes_listar nesta fase) e as executa; o MCP Inspector funciona; os testes das duas eras passam; GET dá 405 e token inválido dá 401 com WWW-Authenticate. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-010 está em Concluído; se não, release e avisar o usuário
- [ ] _api/mcp.ts puro: JSON-RPC por POST com resposta application/json, sem SSE, sem sessão e sem Mcp-Session-Id; GET/DELETE → 405; lote recusado
- [ ] Era 2025: initialize negociando 2025-11-25, 2025-06-18 e 2025-03-26; notifications/initialized → 202; ping
- [ ] Era 2026-07-28: server/discover, _meta.protocolVersion, resultType e cabeçalhos conferidos; versão não suportada → -32022
- [ ] tools/list filtrado pelos escopos efetivos, em ordem determinística, com ?secoes=
- [ ] Cada ferramenta usa nome, title, description, inputSchema, outputSchema e annotations do registro, com openWorldHint:false
- [ ] tools/call pelo pipeline do REST, com surface=mcp e clientInfo em ctx.request.client
- [ ] Resposta de tools/call: structuredContent + bloco text
- [ ] Erros de tools/call: isError:true com a permissão que falta; ferramenta inexistente ou não permitida → -32602
- [ ] _meta anthropic/maxResultSizeChars nas leituras grandes; resposta acima do limite cortada com next_cursor
- [ ] 401 com WWW-Authenticate: Bearer realm=akool; Origin fora da lista → 403
- [ ] Testes de conformidade com fixtures das duas eras
- [ ] Staging: MCP Inspector e Claude Code com .mcp.json (servidor akool, cabeçalho Authorization com ${AKOOL_API_TOKEN})
- [ ] Confirmar que o gateway do Supabase aceita a chamada sem header apikey
- [ ] Documentar o plano B (@modelcontextprotocol/server v2 com createMcpHandler) em docs/api.md
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Configurar o .mcp.json do staging no seu Claude Code com a variável AKOOL_API_TOKEN e confirmar que as ferramentas aparecem

---

## Tópico: Finanças

---

### CARD API-016 — Recorrentes no servidor: materialização por pg_cron, marcar como paga atômico e orçamentos automáticos

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-016 |
| **Prioridade** | P1 |
| **Esforço**    | L |
| **Labels**     | api-v1, lote-06, finanças, supabase, pg_cron, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api016_finance_recurring_server.sql`, `supabase/checks/api016-recurring.sql`, `src/modules/finance/useFinanceData.ts`, `src/modules/finance/useFinanceActions.ts`, `src/modules/finance/useAutoRecurringBudgets.ts`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** Os lançamentos de recorrentes e os orçamentos automáticos só são criados quando o navegador abre Finanças (useFinanceData.ts:18-61), e marcar como paga são 3 gravações soltas (useFinanceActions.ts:303-344) que sempre criam transação pessoal, mesmo para recorrente do workspace; um recorrente criado pela API nunca geraria contas a pagar.

**Contexto:** Lote 06. Depende de: API-006. Aceite: Um recorrente criado só pelo banco ganha lançamentos pelo cron; marcar como paga cria transação e lançamento numa só transação; recorrente do workspace gera transação e orçamento do workspace sem erro no cron; a tela de Recorrentes mostra no staging o mesmo de antes. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-006 está em Concluído; se não, release e avisar o usuário
- [ ] public.finance_materialize_recurring(p_user, p_until): lançamentos pendentes do mês atual e do seguinte, respeitando total_installments
- [ ] finance_materialize_recurring roda em America/Sao_Paulo e é idempotente (unique recurring_id, due_date)
- [ ] Orçamentos automáticos (regra do useAutoRecurringBudgets) dentro da materialização, com o workspace do recorrente quando houver
- [ ] pg_cron diário finance-recurring-materialize rodando sem usuário (aceito pela guarda do API-006) e backfill único
- [ ] finance_mark_entry_paid(p_entry, p_amount_cents, p_date, p_account) atômico: cria a transação herdando workspace_id e marca o lançamento como pago
- [ ] finance_mark_entry_paid desativa o recorrente ao fim das parcelas
- [ ] finance_skip_entry(p_entry)
- [ ] INSERT em finance_recurring_entries exige recorrente do usuário (fecha o pre-occupy entre membros)
- [ ] O app troca a materialização do navegador e os 3 writes pelas RPCs
- [ ] Ensaio ROLLBACK e harness supabase/checks/api016-recurring.sql, com o cron rodando sem claims
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir se parcelas puladas contam para encerrar o recorrente (hoje só as pagas contam)
- [ ] Você: Conferir a tela de Recorrentes no staging
- [ ] Você: Aprovar a migration e o cron em produção

---

## Tópico: Fundação da API

---

### CARD API-017 — OpenAPI 3.1 e declarações de função para Gemini geradas do registro

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-017 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-06, openapi, ia |
| **Arquivos**   | `supabase/functions/_api/openapi.ts`, `supabase/functions/_api/openapi.test.ts`, `supabase/functions/_api/gemini.ts`, `supabase/functions/_api/gemini.test.ts`, `supabase/functions/api/index.ts`, `docs/api.md` |

**Problema:** GPTs personalizados (Actions), scripts e agentes genéricos consomem OpenAPI, e a API do Gemini usa declarações de função num subconjunto do OpenAPI 3.0; sem esses documentos gerados do mesmo registro, a API fica restrita a clientes MCP.

**Contexto:** Lote 06. Depende de: API-010. Aceite: /api/openapi.json abre sem erro no Swagger Editor; com token só aparecem as ações permitidas e ?secoes= reduz o documento; os testes de limite e o de gemini-functions (sem additionalProperties) passam. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-010 está em Concluído; se não, release e avisar o usuário
- [ ] GET /api/openapi.json: OpenAPI 3.1.0 com paths /v1/..., operationId, tags por seção, schemas de entrada e saída, bearerAuth, servers e envelope de erro
- [ ] Filtragem do documento: sem token, completo; com token, só as ações permitidas; ?secoes= filtra
- [ ] x-openai-isConsequential (false em leitura, true no resto); teste dos limites do GPT Actions (summary até 300, parâmetro até 700)
- [ ] GET /api/gemini-functions.json: subconjunto OpenAPI 3.0 do Gemini (sem additionalProperties, const vira enum, sem oneOf), com teste
- [ ] Teste estrutural em vitest, sem dependência nova; conferência manual no Swagger Editor
- [ ] Exemplo de cliente em docs/api.md (fetch em Node e requests em Python)
- [ ] Staging: npm run staging:reset -- --functions --only=api
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Opcional: importar o OpenAPI do staging num GPT personalizado de teste e chamar meta.token.obter

---

### CARD API-018 — Storage na API: autorização do objeto como o usuário e caminhos validados

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-018 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-06, segurança, storage, supabase |
| **Arquivos**   | `supabase/functions/_api/runtime/storage.ts`, `supabase/functions/_api/storagePaths.ts`, `supabase/functions/_api/storagePaths.test.ts`, `supabase/migrations/<ts>_api018_storage_paths.sql`, `supabase/checks/api018-storage.sql`, `docs/api-arquitetura.md`, `docs/matriz-rls.md` |

**Problema:** Assinar ou apagar com o service_role o caminho guardado numa linha autorizada abre IDOR: colunas como finance_transactions.photo_url são texto livre sem CHECK e o service_role ignora as policies dos buckets, então daria para ler ou apagar o arquivo de outra pessoa apontando a própria linha para ele, e membros de workspace passariam a abrir os comprovantes uns dos outros.

**Contexto:** Lote 06. Depende de: API-004, API-008. Aceite: Os testes com caminho de outro usuário, de membro de workspace e com .. falham com 403; nenhum código assina ou apaga objeto sem authorizeObject; o CHECK de photo_url está ativo (ou pendente de validate com plano acordado). Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-004 e API-008 estão em Concluído; se não, release e avisar o usuário
- [ ] _api/storagePaths.ts puro: monta e valida caminhos (uid, id do pai, nome gerado no servidor, sem .. nem URL absoluta) e os limites de MIME e tamanho de cada bucket
- [ ] Testes de storagePaths com caminho de outro usuário, de membro de workspace e com ..
- [ ] _api/runtime/storage.ts com authorizeObject(tx, bucket, name, op) conforme docs/api-arquitetura.md §2.6
- [ ] authorizeObject, leitura: select em storage.objects dentro da transação do usuário
- [ ] authorizeObject, escrita e exclusão: prefixo uid e id do pai autorizado
- [ ] Só depois de authorizeObject o service_role assina (300 s; 1 h em note-images), envia ou agenda a exclusão
- [ ] Interface scheduleDelete para a lixeira (API-025); nenhuma função assina ou apaga caminho vindo de linha sem authorizeObject
- [ ] Levantamento só leitura do formato de finance_transactions.photo_url e das colunas de anexo da Loja
- [ ] Migration com CHECK de prefixo do dono (NOT VALID, e validate depois de corrigir os dados com o usuário)
- [ ] Harness supabase/checks/api018-storage.sql: membro de workspace não lê comprovante do outro como akool_api; caminho alheio numa linha própria não passa
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api018-storage-paths.sql, incluindo um INSERT sem claims (restore e cron)
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir como corrigir dados de photo_url fora do padrão, se o levantamento achar
- [ ] Você: Aprovar a migration em produção

---

### CARD API-019 — Prova ponta a ponta em Projetos no staging: fila e cards no registro, cards-api como camada de compatibilidade

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-019 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-07, projetos, fila, compatibilidade, mcp |
| **Arquivos**   | `supabase/functions/_api/actions/projetos/quadros.ts`, `supabase/functions/_api/actions/projetos/cards.ts`, `supabase/functions/_api/actions/projetos/fila.ts`, `supabase/functions/_api/actions/projetos/validacao.ts`, `supabase/functions/cards-api/index.ts`, `supabase/functions/cards-api/legacy.ts`, `supabase/functions/cards-api/legacy.test.ts`, `supabase/functions/_api/coverage.ts`, `src/lib/cardQueue.ts`, `docs/api.md` |

**Problema:** Antes de espalhar a API, é preciso provar a fundação inteira num domínio real (executor como usuário, registro, REST, MCP, OpenAPI, escopos, auditoria e limites) mantendo a CLI npm run cards e o /fila funcionando, sem publicar nada disso em produção antes das guardas e da revisão.

**Contexto:** Lote 07. Depende de: API-014, API-015, API-017. Aceite: No staging, o /fila roda um lote completo pela cards-api compatível e pelas ferramentas MCP, com saída da CLI idêntica à de hoje; a auditoria registra as três superfícies; a falta de escopo dá 403 com a permissão; a OpenAPI lista as ações de Projetos; a produção continua com a cards-api do API-007. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-014, API-015 e API-017 estão em Concluído; se não, release e avisar o usuário
- [ ] Ações de projetos.quadros sobre os cq_*, executadas como akool_api sem p_actor: listar e converter_fluxo (nível excluir)
- [ ] Ações de projetos.cards: listar e obter
- [ ] Ações de projetos.fila: listar, enfileirar, proximo, iniciar_lote, mover, remover e repriorizar
- [ ] Mais ações de projetos.fila: registrar_fase, marcar_subtarefas, concluir, bloquear e liberar
- [ ] Ação projetos.validacao.validar
- [ ] Saídas idênticas às de hoje, no JSON que formatCardMarkdown e formatQueueLines leem
- [ ] Duas leituras pelo caminho RLS direto, sem SECURITY DEFINER: projetos.quadros.obter (quadro, colunas e contagens)
- [ ] projetos.cards.buscar (texto, rótulos, prioridade, coluna e prazo, com cursor; compartilhados só com incluir_compartilhados)
- [ ] cards-api vira camada fina: o mesmo contrato {action,...} → {data}/{error}, mapeado para o registro e o executor (surface=legacy)
- [ ] legacy.test.ts cobre as 17 ações e os erros
- [ ] Staging com token do preset Claude Code: fila: npm run cards -- boards, cards, card, queue, next --count=3, note, check, complete, block e release, sem mudança na CLI
- [ ] O mesmo fluxo pelas ferramentas MCP no Claude Code e por curl no REST
- [ ] Conferir em private.api_calls as superfícies legacy, mcp e rest
- [ ] Token sem projetos.fila recebe 403 nas três superfícies; marcar item do usuário sem Validação recebe 403
- [ ] Não publicar a api nem a cards-api nova em produção (o corte é no API-031); linhas de Projetos em coverage.ts e exemplo em docs/api.md
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Rodar um lote do /fila no staging pela CLI e pelo MCP no seu Claude Code, com token do staging

---

## Tópico: Documentos

---

### CARD API-020 — Conteúdo de notas: módulo puro que valida e normaliza blocos BlockNote

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-020 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-07, documentos, blocknote, pré-requisito |
| **Arquivos**   | `supabase/functions/_domain/blocknote/schema.ts`, `supabase/functions/_domain/blocknote/normalize.ts`, `supabase/functions/_domain/blocknote/blocknote.test.ts`, `supabase/functions/_domain/blocknote/fixtures/`, `src/lib/projectImport.ts`, `src/components/NoteEditor.tsx`, `scripts/coverage-baseline.json` |

**Problema:** Uma IA que grave uma nota com tipo ou estilo de bloco desconhecido derruba o BlockNote para todo mundo que abre a página, porque blockToNode lança exceção, e blocos parciais aparecem vazios no PDF; não há validação no servidor, e o @blocknote/server-util precisa de DOM, inviável na edge.

**Contexto:** Lote 07. Depende de: API-005. Aceite: Todas as fixtures (notas reais anonimizadas e um caso de cada tipo de bloco) passam pela validação e pela normalização e carregam no BlockNoteEditor do teste sem exceção; tipo ou estilo desconhecido e projectCard com snapshot inválido são recusados com o caminho do erro. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-005 está em Concluído; se não, release e avisar o usuário
- [ ] _domain/blocknote/schema.ts: validador do formato completo do BlockNote 0.50 com o schema do NoteEditor (defaultBlockSpecs + diagram + projectCard)
- [ ] schema.ts cobre tipos, props com padrões, InlineContent (text e link com os estilos permitidos), tableContent e children; erros em JSON Pointer
- [ ] Bloco diagram: props string; elements = JSON de array Excalidraw; appState; collapsed 'true' ou 'false'
- [ ] Bloco projectCard: snapshot no formato ProjectCardSnapshot; tipo local em _domain, com src/lib/projectImport.ts importando o tipo de lá
- [ ] normalize.ts: gera ids, completa as props padrão e converte PartialBlocks para a forma completa
- [ ] Limites: até 2 MB de JSON, 5.000 blocos e profundidade 10
- [ ] Teste de compatibilidade com // @vitest-environment happy-dom e BlockNoteEditor.create({ schema }) sem montar, usando fixtures de notas sem dados pessoais
- [ ] Grupo supabase/functions/_domain no coverage-ratchet (--update)
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Fornecer (ou autorizar exportar) 3 a 5 notas reais, sem dados sensíveis, para servirem de fixtures

---

## Tópico: Estudos

---

### CARD API-021 — Regras de Estudos no servidor: gatilhos, dono do tópico e forma dos JSON

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-021 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-07, estudos, supabase, integridade, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api021_study_rules.sql`, `supabase/checks/api021-study.sql`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** Estudos não tem regra no servidor: updated_at, started_at/completed_at, sort_order e a forma de checkpoints, resources, quiz e blocks vivem só no navegador, o RLS não confere se o topic_id é do usuário (dá para pendurar card no tópico de outra pessoa) e URLs aceitam qualquer esquema; um JSON malformado vindo de uma IA quebra a tela.

**Contexto:** Lote 07. Depende de: API-006. Aceite: O harness recusa card em tópico de outro usuário, URL javascript: e quiz sem options; a tela de Estudos funciona no staging como antes. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-006 está em Concluído; se não, release e avisar o usuário
- [ ] Levantamento só leitura de dados fora da forma e de URLs que não sejam http(s), com correção combinada com o usuário
- [ ] Gatilhos seguindo §1.5: updated_at em study_topics e study_cards; started_at e completed_at derivados do status
- [ ] Gatilhos seguindo §1.5: sort_order = max+1 quando vier nulo; topic_id de cards e logs precisa ser do auth.uid()
- [ ] Funções de validação + CHECK para checkpoints, resources (só http/https), quiz (escolha com options e resposta válida) e blocks, com limites de tamanho e quantidade
- [ ] Ensaio ROLLBACK e harness supabase/checks/api021-study.sql, com um INSERT sem claims
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Conferir no staging que a tela atual de Estudos continua funcionando (ainda grava arrays inteiros, agora validados)
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir o que fazer com dados fora da forma, se o levantamento achar
- [ ] Você: Aprovar a migration em produção após o ensaio

---

## Tópico: Fundação da API

---

### CARD API-022 — Defesa em profundidade: policies RESTRICTIVE por subseção, regra de propriedade e perfis de terceiros

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-022 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-08, segurança, rls, supabase |
| **Arquivos**   | `supabase/migrations/<ts>_api022_restrictive_scopes.sql`, `supabase/functions/_api/tableScopes.ts`, `supabase/functions/_api/tableScopes.test.ts`, `supabase/checks/api022-restrictive.sql`, `docs/matriz-rls.md`, `docs/api-arquitetura.md` |

**Problema:** Até aqui só o gateway confere o escopo: um handler com bug que leia ou escreva tabela de outra seção vazaria dados sem erro, uma página compartilhada por um estranho viraria canal de exfiltração, e o grant herdado da coluna profiles.email entrega o e-mail de qualquer pessoa relacionada para qualquer token; o banco precisa recusar sozinho o que o escopo não cobre, sem afetar as sessões do app.

**Contexto:** Lote 08. Depende de: API-007, API-019. Aceite: Dentro do executor, um token sem a subseção não lê nem grava a tabela correspondente, mesmo que um handler tente; escrever numa página compartilhada comigo sem Compartilhamento falha no banco; os E2E do app passam sem mudança; os testes de paridade e a prova de Projetos passam. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-007 e API-019 estão em Concluído; se não, release e avisar o usuário
- [ ] _api/tableScopes.ts: para cada tabela pública, subseções de leitura e de escrita, nível de DELETE (excluir, salvo lista de exceções) e expressão de dono, ou negada
- [ ] Migration: replicar o mapa em private.api_table_scope
- [ ] Gerar num DO as policies AS RESTRICTIVE TO akool_api com (select private.api_scope_allows(...)) para SELECT, INSERT, UPDATE e DELETE
- [ ] Regra de propriedade (§2.3): escrita em recurso de outra pessoa, ou em linha financeira com workspace_id/shared_with_user_id, exige também compartilhamento.pessoas:write
- [ ] profiles: própria linha → perfil.dados; outras linhas → compartilhamento.pessoas:read; UPDATE e DELETE só com id = auth.uid()
- [ ] Criar private.api_profile_cards(uuid[]) para nomes e avatares de perfis relacionados
- [ ] notifications por tipo (§8), com teste que lista os literais de tipo nas migrations
- [ ] invite_codes: próprios e de todos; audit_log, site_backups e site_backup_settings só para leitura de admin; SELECT de pages para leitores de notas, desenhos e tarefas
- [ ] Testes de paridade: toda tabela das migrations classificada; as subseções exigidas por cada ação cobrem as tables que ela declara
- [ ] Harness api022: token só com documentos.paginas não vê finance_transactions e, no nível Ler, não insere em pages
- [ ] Harness: claims forjados veem 0 linhas em todas as tabelas; token só com estudos.diario não lê o email de outros perfis
- [ ] Harness: DELETE com nível Escrever falha fora das exceções; EXPLAIN mostra InitPlan; sessões do app não mudam
- [ ] Rodar de novo a prova do API-019 e os E2E do app (board, finance, pages)
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api022-restrictive-scopes.sql, incluindo um INSERT sem claims (restore e cron)
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: migration inofensiva para o app, só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção após o ensaio ROLLBACK

---

## Tópico: Documentos

---

### CARD API-023 — Conteúdo de notas: Markdown ↔ blocos BlockNote e texto puro sem DOM

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-023 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-08, documentos, blocknote, pré-requisito |
| **Arquivos**   | `supabase/functions/_domain/blocknote/markdown.ts`, `supabase/functions/_domain/blocknote/render.ts`, `supabase/functions/_domain/blocknote/markdown.test.ts` |

**Problema:** IAs escrevem e leem Markdown, mas as notas são JSON BlockNote e a conversão oficial precisa de DOM, inviável na edge; sem um conversor puro nos dois sentidos, a API obrigaria cada IA a montar blocos à mão.

**Contexto:** Lote 08. Depende de: API-020. Aceite: O Markdown de exemplo vira blocos aceitos pelo validador e carregáveis no BlockNoteEditor do teste e volta a um Markdown equivalente; a conversão da maior fixture fica dentro do orçamento de CPU. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-020 está em Concluído; se não, release e avisar o usuário
- [ ] markdown.ts: Markdown → blocos sem DOM, para blocos: títulos 1 a 6, parágrafo, listas aninhadas, checklist, citação, código com linguagem, tabela e divisor
- [ ] markdown.ts, formatação em linha: links, negrito, itálico, código e tachado
- [ ] Imagem no Markdown só é aceita com caminho do bucket note-images
- [ ] render.ts: blocos → Markdown e texto puro, documentando as perdas (cores, alinhamento, larguras de tabela)
- [ ] Ida e volta: o Markdown de exemplo vira blocos válidos no schema do API-020 e volta a um Markdown equivalente
- [ ] Teste de desempenho com a maior fixture, para caber no limite de CPU da edge
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build

---

## Tópico: Estudos

---

### CARD API-024 — Estudos: RPCs por item, importação atômica e reagendamento no servidor

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-024 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-08, estudos, supabase, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api024_study_rpcs.sql`, `supabase/checks/api024-study-rpcs.sql`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** Checkpoints, recursos e quiz só mudam regravando o array inteiro, a trava do quiz vive no navegador, e importar ou reagendar um tópico são várias gravações soltas que deixam lixo quando falham no meio.

**Contexto:** Lote 08. Depende de: API-021. Aceite: As RPCs por item alteram só o item; o quiz recusa a segunda resposta; uma importação com erro não deixa tópico vazio; o reagendamento usa a data passada. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-021 está em Concluído; se não, release e avisar o usuário
- [ ] RPCs SECURITY INVOKER concedidas a authenticated e akool_api: study_checkpoint_add, edit, remove e toggle
- [ ] RPCs study_resource_add e study_resource_remove
- [ ] study_quiz_answer (trava após a primeira resposta) e study_quiz_reset
- [ ] study_cards_append(topic, jsonb), study_import_topic(jsonb) atômico e study_reschedule(topic, p_today date)
- [ ] Ensaio ROLLBACK e harness supabase/checks/api024-study-rpcs.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção após o ensaio

---

## Tópico: Fundação da API

---

### CARD API-025 — Lixeira da API com desfazer e limites de exclusão por linhas

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-025 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-09, segurança, confiabilidade, supabase |
| **Arquivos**   | `supabase/migrations/<ts>_api025_api_trash.sql`, `supabase/checks/api025-trash.sql`, `supabase/functions/_api/ratelimit.ts`, `supabase/functions/_api/runtime/storage.ts`, `src/components/apiTokens/TokenActivity.tsx`, `src/lib/data/apiTokens.ts`, `src/i18n/translations.pt-BR.ts`, `src/i18n/translations.en.ts`, `docs/matriz-rls.md` |

**Problema:** Os limites contam chamadas e não linhas (20 exclusões por minuto × 100 por lote = 2.000 linhas por minuto), o limitador é fail-open, o banco só exige Escrever para DELETE e não há lixeira: depois de uma exclusão em massa por injeção ou bug, a única recuperação é restaurar o backup global, que sobrescreve 38 tabelas de todos os usuários.

**Contexto:** Lote 09. Depende de: API-014, API-018, API-022. Aceite: No staging, uma exclusão em cascata feita pela API aparece em Atividade e o Desfazer restaura as linhas e os arquivos; passar do teto diário de linhas falha sem apagar nada; exclusões feitas pelo app não mudam de comportamento. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-014, API-018 e API-022 estão em Concluído; se não, release e avisar o usuário
- [ ] private.api_trash (call_id, token_id, user_id, tabela, linha jsonb, ordem, deleted_at)
- [ ] Gatilho AFTER DELETE genérico private.api_trash_capture() em toda tabela de tableScopes, ativo só em sessão da API e cobrindo as cascatas
- [ ] Contador de linhas apagadas por token por dia no mesmo gatilho; acima do teto (padrão 500, em tabela de config) → 42501 e rollback
- [ ] Exclusões do Storage pela API vão para private.api_storage_pending (scheduleDelete do API-018) e só saem depois de 7 dias
- [ ] api_undo_call(p_call_id), só para o dono e de sessão do app: reinsere em ordem de dependência como o usuário, cancela as exclusões pendentes e relata conflitos
- [ ] Botão Desfazer em Configurações → API → Atividade, com i18n nas duas línguas
- [ ] No gateway, o limitador de exclusão passa a ser fail-closed (ratelimit.ts)
- [ ] api-housekeeping apaga lixeira e pendências com mais de 7 dias
- [ ] Harness api025: apagar uma página com subárvore pela API grava a lixeira; desfazer restaura
- [ ] Harness: o teto diário barra; exclusões feitas pelo app não entram na lixeira
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness supabase/checks/api025-api-trash.sql, incluindo um INSERT sem claims (restore e cron)
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration em produção
- [ ] Você: Testar o Desfazer no staging

---

### CARD API-026 — Matriz de permissões escopo × ação em E2E no staging

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-026 |
| **Prioridade** | P0 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-09, testes, e2e, segurança |
| **Arquivos**   | `e2e/api/scope-matrix.spec.ts`, `e2e/api/apiClient.ts`, `playwright.config.ts`, `e2e/env.ts`, `docs/api.md` |

**Problema:** Cada card de domínio vai acrescentar ações; sem um teste automático que tente cada ação com o escopo errado, uma regressão de permissão só apareceria em produção.

**Contexto:** Lote 09. Depende de: API-019, API-022. Aceite: A matriz roda no staging cobrindo 100% das ações registradas até aqui; toda ação sem a subseção exigida responde 403 sem efeito colateral; o token descartável termina revogado. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-019 e API-022 estão em Concluído; se não, release e avisar o usuário
- [ ] Projeto Playwright api (e2e/api/scope-matrix.spec.ts) dependente do setup de login, com a trava de produção do e2e/env.ts
- [ ] Um token descartável por execução, com escopos trocados entre os casos por update_api_token_scopes (o segredo não muda) e revogado no fim
- [ ] Gerado do registro, para cada ação: token com todos os escopos menos o exigido → 403 insufficient_scope, sem efeito colateral
- [ ] Para cada ação: nível abaixo do exigido → 403
- [ ] Para cada leitura: token mínimo → 200 e saída válida no outputSchema
- [ ] Casos fixos: tools/list do MCP e OpenAPI filtrados; token revogado ou expirado → 401
- [ ] Casos fixos: escrita em página compartilhada comigo sem Compartilhamento → 403; mover para Concluído sem Validação → 403
- [ ] Ritmo: respeitar Retry-After e espaçar as chamadas para caber nos limites por usuário e por IP
- [ ] admin.* coberto pelo harness SQL, já que o E2E_USER entra só com senha; se houver admin de teste com TOTP no ambiente, incluir
- [ ] docs/api.md: como rodar (npm run test:e2e -- --project=api); a matriz entra na definição de pronto dos cards de ação
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Garantir E2E_USER e E2E_PASSWORD do staging no ambiente (já usados pelo QA-003)

---

## Tópico: Projetos

---

### CARD API-027 — Porte dos módulos de Projetos para _domain: agenda, parser de backlog, plano de importação, Markdown e estatísticas

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-027 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-09, projetos, arquitetura, pré-requisito |
| **Arquivos**   | `supabase/functions/_domain/autoSchedule.ts`, `supabase/functions/_domain/backlogMarkdownParser.ts`, `supabase/functions/_domain/importPlan.ts`, `supabase/functions/_domain/cardMarkdown.ts`, `supabase/functions/_domain/projectStats.ts`, `supabase/functions/_domain/i18n.pt-BR.ts`, `src/lib/autoSchedule.ts`, `src/lib/backlogMarkdownParser.ts`, `src/lib/importProjectCards.ts`, `src/lib/cardMarkdown.ts`, `src/lib/projectStats.ts`, `src/lib/ganttLayout.ts`, `src/lib/projectCardFilters.ts`, `scripts/coverage-baseline.json` |

**Problema:** Agenda automática, importação de backlog, Markdown de card e estatísticas existem só em src/lib, com imports que o bundler das functions não segue (../types, i18n do app, cliente supabase), então a API não conseguiria repetir o que a tela faz sem duplicar código.

**Contexto:** Lote 09. Depende de: API-005. Aceite: Os testes de src/lib passam via reexport; o teste de fronteira de imports passa para os arquivos novos; npx tsc -b checa _domain; a importação e a agenda na tela funcionam no staging como antes. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-005 está em Concluído; se não, release e avisar o usuário
- [ ] Portar autoSchedule com o fechamento transitivo (addDays/diffDays de ganttLayout, todayStr/isOverdue de projectCardFilters, projectStats, priorities), usando tipos locais
- [ ] Portar backlogMarkdownParser e projectStats para _domain
- [ ] Dividir importProjectCards: _domain/importPlan.ts puro (com normalizeSearch de graph); a gravação fica em src/lib (supabase) e no handler (tx)
- [ ] cardMarkdown com TFn injetado e dicionário pt-BR em _domain/i18n.pt-BR.ts, levando junto cardLinks.linkDisplay
- [ ] src/lib/* passam a reexportar e os testes atuais continuam passando
- [ ] node scripts/coverage-ratchet.mjs --allow-moves
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build

---

## Tópico: Loja

---

### CARD API-028 — Vendas da Loja no servidor: máquina de estados, itens e receita vinculada

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-028 |
| **Prioridade** | P2 |
| **Esforço**    | L |
| **Labels**     | api-v1, lote-10, finanças, loja, supabase, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api028_store_sales_server.sql`, `supabase/checks/api028-store-sales.sql`, `supabase/functions/_domain/financeStoreCalc.ts`, `supabase/functions/_domain/saleTransitions.ts`, `src/lib/financeStoreCalc.ts`, `src/modules/finance/store/saleTransitions.ts`, `src/modules/finance/store/useFinanceStore.ts`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** Quase toda regra de vendas vive só no navegador (estados em saleTransitions.ts:39-66, datas, trava de estoque, snapshots de custo médio, valores ≥ 0) e a receita vinculada em finance_transactions é gravada em passos não atômicos (useFinanceStore.ts:165-171, 376-442); gravar direto nas tabelas, como uma IA faria, quebraria lucro e estoque.

**Contexto:** Lote 10. Depende de: API-005, API-006. Aceite: No staging, o fluxo negociando → vendido → enviado → entregue e o cancelamento geram e removem a receita vinculada numa só transação; venda acima do estoque é recusada; lucro e capital parado ficam iguais aos de antes nos dados de teste. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-005 e API-006 estão em Concluído; se não, release e avisar o usuário
- [ ] Levantamento só leitura de valores negativos e estados inválidos
- [ ] CHECKs de dinheiro ≥ 0 e gatilhos updated_at nas tabelas da Loja
- [ ] Gatilho de visibilidade dos ids referenciados (produto, cliente, conta, categoria), seguindo §1.5
- [ ] Portar financeStoreCalc e saleTransitions para _domain e criar a função SQL de custo médio equivalente, com teste de paridade por fixtures
- [ ] store_sale_create(jsonb): venda + itens, snapshots de product_name e unit_cost_at_sale e preço padrão = target_price
- [ ] store_sale_create trava venda acima do estoque e quantidade maior que 1 em item único
- [ ] store_sale_set_status: só passos vizinhos ou cancelar; carimba as datas
- [ ] store_sale_set_status cria ou remove a receita vinculada quando há conta
- [ ] store_sale_update e store_sale_items_add/update/remove (ressincronizam a receita = líquido recebido)
- [ ] store_sale_generate_income e store_sale_delete (apaga a receita vinculada)
- [ ] useFinanceStore.ts passa a chamar as RPCs
- [ ] Ensaio ROLLBACK e harness supabase/checks/api028-store-sales.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Usar a Loja no staging (criar venda, mudar status, cancelar) antes de aprovar
- [ ] Você: Aprovar a migration em produção

---

## Tópico: Estudos

---

### CARD API-029 — Tela de Estudos usa as operações por item (fim da sobrescrita de listas)

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-029 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-10, estudos, confiabilidade, ux |
| **Arquivos**   | `src/modules/study/useStudyTopics.ts`, `src/modules/study/studyMutations.ts`, `src/modules/study/StudyCardItem.tsx`, `src/modules/study/StudyTopicDetail.tsx`, `src/modules/study/StudyRoadmapStep.tsx` |

**Problema:** A tela de Estudos carrega uma vez e regrava checkpoints, recursos e quiz como array inteiro a partir de estado velho, sem realtime nem refetch, então o que a API adicionar some na próxima edição na tela; além disso, updated_at, started_at, completed_at e sort_order ainda são carimbados pelo navegador.

**Contexto:** Lote 10. Depende de: API-024. Aceite: Com a tela de Estudos aberta, um item adicionado por outra aba não some na edição seguinte; conflito em campo escalar recarrega o card; a importação é atômica. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-024 está em Concluído; se não, release e avisar o usuário
- [ ] Trocar as gravações de array inteiro (StudyCardItem.tsx:60,73,82,89,96,104-118; useStudyTopics.ts:320-325) pelas RPCs por item
- [ ] Campos escalares gravados com .eq('updated_at', base) e .select('id, updated_at'); em conflito, recarregar o card
- [ ] Parar de carimbar updated_at, started_at, completed_at e sort_order no cliente
- [ ] Importar e reagendar via study_import_topic e study_reschedule
- [ ] Recarregar ao voltar o foco ou a visibilidade da aba
- [ ] Testes vitest dos hooks e teste manual no staging com duas abas
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Deploy do frontend só após confirmação do usuário
- [ ] Você: Usar Estudos no staging (marcar checkpoint, responder quiz, importar roteiro) antes de aprovar

---

## Tópico: Empréstimos

---

### CARD API-030 — Escrituração de empréstimos no servidor e cálculo do saldo

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-030 |
| **Prioridade** | P3 |
| **Esforço**    | M |
| **Labels**     | api-v1, lote-10, finanças, empréstimos, supabase, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api030_loans_bookkeeping.sql`, `supabase/checks/api030-loans.sql`, `supabase/functions/_domain/loanCalc.ts`, `supabase/functions/_domain/loanCalc.test.ts`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** O backend de empréstimos existe sem tela no repo, o src/lib/loanCalc.ts citado nas migrations não existe, as 8 RPCs dependem de auth.uid() e foram revogadas para service_role, e o RLS deixa o credor forjar status, requested_by, approved_by, reported_by, confirmed_by e ligar borrower_user_id sem loan_link_borrower.

**Contexto:** Lote 10. Depende de: API-005, API-006. Aceite: O harness mostra que o credor não forja aprovação nem pagamento confirmado pelo tomador; o saldo calculado bate com exemplos acordados com o usuário. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-005 e API-006 estão em Concluído; se não, release e avisar o usuário
- [ ] Confirmar com o usuário a regra de saldo (juros simples mensais sobre o principal, term_months, rolagem do vencimento, quando vira paid ou defaulted)
- [ ] Implementar _domain/loanCalc.ts e a função SQL loan_balance(loan), com testes
- [ ] RPCs de escrituração do credor para tomador e empréstimo (travando os campos de estado)
- [ ] RPCs de escrituração do credor para pagamento (registrado como confirmed) e garantia
- [ ] Policies ou gatilhos (§1.5) que impedem o credor de forjar status, requested_by, approved_by, reported_by e confirmed_by
- [ ] Os mesmos gatilhos impedem ligar borrower_user_id sem loan_link_borrower
- [ ] Grant dos 8 loan_* a akool_api, nunca a authenticated (no plano B, ver docs/api-arquitetura.md)
- [ ] Ensaio ROLLBACK e harness supabase/checks/api030-loans.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Confirmar se o módulo de empréstimos é usado e qual é a regra de cálculo
- [ ] Você: Aprovar a migration em produção

---

## Tópico: Fundação da API

---

### CARD API-031 — Revisão de segurança da fundação e corte para produção

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-031 |
| **Prioridade** | P0 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-11, segurança, revisão, produção |
| **Arquivos**   | `supabase/functions/_api/`, `supabase/functions/api/index.ts`, `supabase/functions/cards-api/index.ts`, `supabase/drift-allowlist.json`, `supabase/migrations/`, `docs/api.md` |

**Problema:** A fundação muda o modelo de ameaça do Akool (um bearer sem segundo fator passa a alcançar todas as seções, e uma conexão direta ao Postgres troca de papel a cada chamada), então ela precisa de uma revisão dedicada; só depois a function api e a cards-api compatível podem ir para produção.

**Contexto:** Lote 11. Depende de: API-009, API-011, API-018, API-025, API-026. Aceite: Nenhum achado alto aberto; advisors sem alerta novo; modelo de ameaças documentado; api e cards-api compatível publicadas em produção com o drift zerado; um lote do /fila e uma chamada MCP funcionam em produção. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-009, API-011, API-018, API-025 e API-026 estão em Concluído; se não, release e avisar o usuário
- [ ] Rodar /security-review e /code-review (high) no diff da fundação, e get_advisors (segurança e performance) no staging
- [ ] Checklist de vazamento: token em logs e no Sentry, texto do Postgres em 4xx, PII na auditoria, respostas gigantes
- [ ] Checklist de acesso: Origin, injeção de SQL em todos os campos de texto, reset role e set role, claims forjados
- [ ] Checklist de identidade e conteúdo: token de outro usuário, admin rebaixado, caminhos do Storage, descrições sem instruções ao modelo
- [ ] Teste de abuso no staging com token mínimo: enumeração, limites, idempotência com corpo trocado, lote acima do teto e teto diário de exclusão
- [ ] Modelo de ameaças em docs/api.md: a tríade dados privados + conteúdo não confiável + saída, a regra de propriedade e por que Compartilhamento começa em Nenhum
- [ ] No modelo de ameaças, registrar também o residual de recurso próprio já compartilhado
- [ ] Corrigir os achados altos neste card e abrir cards novos para os médios
- [ ] Corte: conferir pelo drift que todas as migrations da fundação estão aplicadas em produção; o usuário define a senha de akool_api_login e o secret AKOOL_API_DB_URL
- [ ] Deploy em produção da api e da cards-api compatível (Deploy function → production), só após confirmação do usuário
- [ ] Tirar api de repoOnlyFunctions; npm run drift -- --write
- [ ] Fumaça em produção: um lote real do /fila pela cards-api compatível, o MCP no Claude Code com token de produção e as linhas em private.api_calls
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Ler o relatório e decidir sobre os achados médios
- [ ] Você: Definir a senha do papel akool_api_login em produção e criar o secret AKOOL_API_DB_URL
- [ ] Você: Aprovar o deploy da api e da cards-api em produção
- [ ] Você: Rodar um lote real do /fila e configurar o MCP de produção no seu Claude Code

---

## Tópico: Confiabilidade

---

### CARD API-032 — Remover os objetos legados de segredo de IA (profile_secrets, set_ai_credentials, ai_has_key e afins)

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-032 |
| **Prioridade** | P3 |
| **Esforço**    | S |
| **Labels**     | api-v1, lote-11, segurança, limpeza, supabase |
| **Arquivos**   | `supabase/migrations/<ts>_api032_drop_legacy_ai.sql`, `supabase/functions/site-backup/tables.ts`, `supabase/functions/site-backup/tables.test.ts`, `supabase/functions/_api/tableScopes.ts`, `supabase/functions/_api/definerInventory.ts`, `src/types/database.ts`, `docs/matriz-rls.md` |

**Problema:** Depois do SEC-015 continuam no banco profile_secrets, set_ai_credentials, profiles.ai_has_key, study_lookup_cache (com o prune) e mindmap_contents; sem uso, eles só aumentam a superfície que a API precisa negar e que o backup carrega.

**Contexto:** Lote 11. Sem dependências. Aceite: Os objetos legados somem do schema e do retrato; os grants por coluna de profiles ficam iguais; o app, o backup e os testes de paridade funcionam. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Levantamento só leitura: referências no src e nas functions a cada objeto, e só a contagem de linhas (sem ler conteúdo)
- [ ] Migration que dropa os objetos sem uso (com decisão do usuário sobre os dados), preservando os grants por coluna de profiles
- [ ] Atualizar site-backup/tables.ts e o teste, _api/tableScopes.ts e definerInventory.ts, e rodar gen:types
- [ ] Ensaio ROLLBACK e harness, e conferir o attacl de profiles antes e depois
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir se os dados dessas tabelas podem ser descartados
- [ ] Você: Aprovar a migration em produção

---

## Tópico: Projetos

---

### CARD API-033 — Importador de backlog: Contexto multilinha e dependências entre cards

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-033 |
| **Prioridade** | P3 |
| **Esforço**    | S |
| **Labels**     | api-v1, lote-11, projetos, importação |
| **Arquivos**   | `supabase/functions/_domain/backlogMarkdownParser.ts`, `supabase/functions/_domain/importPlan.ts`, `src/lib/importProjectCards.ts`, `src/lib/backlogMarkdownParser.test.ts`, `docs/imports/backlog-card-sample.md` |

**Problema:** O parser guarda só a primeira linha do Contexto e não tem campo de dependências, então critérios de aceite em várias linhas e a ordem entre cards se perdem na importação; este backlog contornou isso com Contexto de uma linha e a dependência na primeira subtarefa.

**Contexto:** Lote 11. Depende de: API-027. Aceite: Um backlog com Contexto de três linhas e Depende de importa com o texto completo e com depends_on preenchido; os backlogs antigos importam igual a antes. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-027 está em Concluído; se não, release e avisar o usuário
- [ ] CONTEXT_RE passa a capturar o Contexto até o próximo marcador (**Subtarefas, ---, ### CARD), com teste do caso multilinha
- [ ] Campo novo na tabela, | Depende de | API-001, API-002 |, lido como lista de IDs externos
- [ ] importPlan resolve os IDs no quadro e a gravação preenche depends_on, com aviso para ID não encontrado
- [ ] Atualizar docs/imports/backlog-card-sample.md e os testes do parser
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build

---

## Tópico: Estudos

---

### CARD API-034 — Estudos na API: tópicos, cards e importação de roteiros

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-034 |
| **Prioridade** | P1 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-12, estudos |
| **Arquivos**   | `supabase/functions/_api/actions/estudos/conteudo.ts`, `supabase/functions/_api/actions/estudos/conteudo.test.ts`, `supabase/functions/_domain/study/markdownParser.ts`, `supabase/functions/_domain/study/progress.ts`, `supabase/functions/_domain/study/quiz.ts`, `supabase/functions/_domain/study/schedule.ts`, `src/lib/studyMarkdownParser.ts`, `src/lib/studyProgress.ts`, `src/lib/studyQuiz.ts`, `src/lib/studySchedule.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** O módulo de Estudos foi feito para receber roteiros gerados por IA, mas o caminho hoje é copiar o prompt, colar a resposta e importar na tela; qualquer IA deveria conseguir criar e importar tópicos e cards e consultar o planejamento, usando as regras do servidor.

**Contexto:** Lote 12. Depende de: API-024, API-029, API-031. Aceite: Uma IA importa um roteiro de 10 cards numa chamada e o tópico aparece no app; repetir com a mesma chave não duplica; excluir tópico sem o nível Excluir dá 403; a matriz E2E passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-024, API-029 e API-031 estão em Concluído; se não, release e avisar o usuário
- [ ] Portar para _domain/study studyMarkdownParser, studyProgress, studyQuiz e studySchedule (com o fechamento entre eles e tipos locais); src/lib reexporta; coverage-ratchet --allow-moves
- [ ] Ações de tópico: listar_topicos (filtros, cursor) e obter_topico (cards ordenados, etapas e progresso calculado)
- [ ] Ações de tópico: criar_topico, atualizar_topico (expected_updated_at) e alterar_status (planned ou paused)
- [ ] excluir_topico: nível excluir, dry_run com contagens, lixeira
- [ ] estudos.conteudo.importar: JSON estruturado ou o Markdown do contrato, via study_import_topic atômico, com idempotency e até 100 cards
- [ ] Ações de card: criar_card, anexar_cards (study_cards_append), atualizar_card (versão) e editar_checkpoints (por id)
- [ ] Ações de card: adicionar_recurso, remover_recurso, reagendar (study_reschedule com tz e hoje) e excluir_card
- [ ] Leituras calculadas: visao_geral, estatisticas e planejamento
- [ ] Preencher as linhas de Estudos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging importando um roteiro real gerado por uma IA
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Fundação da API

---

### CARD API-035 — CLI npm run cards e skill /fila na API nova; cards-api avisa a aposentadoria

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-035 |
| **Prioridade** | P1 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-12, cli, fila |
| **Arquivos**   | `scripts/cards.ts`, `scripts/cards.test.ts`, `.claude/skills/fila/SKILL.md`, `supabase/functions/cards-api/index.ts`, `docs/api.md`, `README.md` |

**Problema:** Depois do corte, a CLI e o /fila ainda passam pela cards-api, uma segunda porta de entrada para manter; a CLI precisa usar o REST novo com o mesmo comportamento, e a cards-api precisa avisar que vai sair.

**Contexto:** Lote 12. Depende de: API-031. Aceite: npm run cards -- <todos os comandos> funciona contra a function api com o mesmo texto de saída e o /fila roda um lote; a cards-api responde com Deprecation e a data da janela está registrada. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-031 está em Concluído; se não, release e avisar o usuário
- [ ] scripts/cards.ts chama /functions/v1/api/v1/projetos/... com os mesmos comandos, a mesma saída e os mesmos códigos de saída
- [ ] Em 403, a CLI diz qual permissão ativar em Configurações → API
- [ ] Teste da CLI com servidor falso (scripts/cards.test.ts) cobrindo a saída de boards, queue e next
- [ ] SKILL.md: escopos necessários (Quadros ler, Cards ler, Fila escrever; Validação só se o usuário quiser aprovar pelo chat)
- [ ] SKILL.md: uso opcional das ferramentas MCP; em 401 ou 403, pedir ao usuário
- [ ] A cards-api responde com o cabeçalho Deprecation e um aviso no corpo; registrar em docs/api.md a data de início da janela de 30 dias
- [ ] Deploy da cards-api em produção só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Rodar um lote do /fila depois da troca
- [ ] Você: Aprovar o deploy da cards-api em produção

---

## Tópico: Finanças

---

### CARD API-036 — Contas e categorias na API, com saldos calculados no servidor

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-036 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-12, finanças |
| **Arquivos**   | `supabase/functions/_api/actions/financas/contas.ts`, `supabase/functions/_api/actions/financas/categorias.ts`, `supabase/functions/_api/actions/financas/contas.test.ts`, `supabase/functions/_domain/financeCalc.ts`, `supabase/functions/_domain/money.ts`, `src/lib/financeCalc.ts`, `src/lib/money.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Contas, categorias e saldos são a referência de toda entrada financeira, mas o saldo só existe no navegador e esbarra no teto de 1000 linhas, e as colunas aceitam decimais: uma IA que mande 12.50 em reais grava R$ 0,125.

**Contexto:** Lote 12. Depende de: API-012, API-031. Aceite: O saldo da API bate centavo a centavo com a tela no staging; decimal é recusado com mensagem sobre centavos; excluir categoria sem o nível Excluir dá 403; criar conta de workspace sem Compartilhamento dá 403; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-012 e API-031 estão em Concluído; se não, release e avisar o usuário
- [ ] Portar financeCalc e money para _domain (o fechamento é só de tipos); src/lib reexporta; --allow-moves
- [ ] financas.contas.listar: próprias e do workspace (workspace exige compartilhamento.pessoas:ler)
- [ ] financas.contas.saldos: calculados no servidor, sem o teto de 1000 linhas
- [ ] financas.contas.criar com initial_balance_cents e credit_limit_cents inteiros (decimal recusado) e atualizar
- [ ] financas.contas.excluir: nível excluir, dry_run com as transações afetadas
- [ ] financas.categorias.listar (bootstrap no primeiro acesso), criar e atualizar
- [ ] financas.categorias.excluir: nível excluir, com aviso de que apaga orçamentos de todos no workspace
- [ ] Preencher as linhas de Finanças em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Conferir os saldos no staging com dados de teste
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Loja

---

### CARD API-037 — Compras e produtos da Loja no servidor: funil, despesa vinculada e compra inicial

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-037 |
| **Prioridade** | P2 |
| **Esforço**    | L |
| **Labels**     | api-v1, lote-13, finanças, loja, supabase, pré-requisito |
| **Arquivos**   | `supabase/migrations/<ts>_api037_store_purchases_server.sql`, `supabase/checks/api037-store-purchases.sql`, `src/modules/finance/store/useFinanceStore.ts`, `docs/matriz-rls.md`, `src/types/database.ts` |

**Problema:** Criar produto com a compra inicial, o funil de compras (cotação → comprado → recebido) e a despesa vinculada são passos não atômicos no navegador, e hoje dá até para gerar despesa de uma compra ainda em cotação.

**Contexto:** Lote 13. Depende de: API-028. Aceite: No staging, criar produto com compra, avançar no funil e voltar para cotação criam e removem a despesa numa transação; o capital parado e o custo médio ficam iguais aos de antes. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-028 está em Concluído; se não, release e avisar o usuário
- [ ] store_product_create(jsonb): produto + compra inicial, com fornecedor inline opcional e despesa vinculada opcional (nunca para cotação)
- [ ] store_purchase_create, update e set_status com o funil quoting → purchased → received
- [ ] Em set_status, purchased gera a despesa quando pedido e voltar para quoting remove a despesa
- [ ] store_purchase_generate_expense, store_purchase_delete (remove a despesa vinculada) e store_product_archive
- [ ] store_product_delete com a regra decidida pelo usuário para as despesas das compras apagadas em cascata
- [ ] Gatilhos novos seguem §1.5; useFinanceStore.ts usa as RPCs
- [ ] Ensaio ROLLBACK e harness supabase/checks/api037-store-purchases.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir o que acontece com as despesas ao excluir um produto
- [ ] Você: Usar a Loja no staging antes de aprovar
- [ ] Você: Aprovar a migration em produção

---

## Tópico: Documentos

---

### CARD API-038 — Páginas na API: árvore, metadados, criar, mover, reordenar e excluir com segurança

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-038 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-13, documentos |
| **Arquivos**   | `supabase/functions/_api/actions/documentos/paginas.ts`, `supabase/functions/_api/actions/documentos/paginas.test.ts`, `supabase/functions/_domain/pageTree.ts`, `src/lib/pageTree.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Documentos é a base de notas, desenhos e tarefas, e não há API para a árvore de páginas; a montagem da árvore no PagesContext perde subárvores de co_owner e filhos criados por editores, criar página são 2 ou 3 inserts soltos, e a exclusão é definitiva, em cascata, com 0 linhas silencioso parecendo sucesso.

**Contexto:** Lote 13. Depende de: API-031. Aceite: No staging, uma IA lista a árvore com os papéis certos, cria, renomeia, move e reordena, e a página aparece no app sem recarregar; páginas compartilhadas comigo só aparecem com incluir_compartilhados; excluir com filhas sem confirm_subtree é recusado e o Desfazer restaura; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-031 está em Concluído; se não, release e avisar o usuário
- [ ] Portar pageTree para _domain (src/lib reexporta)
- [ ] documentos.paginas.listar: árvore pelo RLS (CTE recursiva) com papel efetivo calculado no servidor, incluindo subárvores de co_owner e filhos de editores
- [ ] Na listagem, as compartilhadas comigo só vêm com incluir_compartilhados (exige compartilhamento.pessoas:ler), marcadas owner_is_me:false e untrusted:true
- [ ] obter, buscar (título, ilike escapado) e favoritas_recentes
- [ ] criar: a página e as linhas de conteúdo do tipo (note, drawing, both, todo) numa transação, com idempotency
- [ ] atualizar: título até 200, ícone até 8, tipo e favorita
- [ ] mover (guard_page_parent vira 422 ou 403 legível) e reordenar
- [ ] excluir: nível excluir, só o dono; dry_run com a contagem da subárvore; confirm_subtree obrigatório quando há filhas
- [ ] Na exclusão, 0 linhas vira 404 ou 403, e os objetos de note-images ficam agendados pela lixeira
- [ ] Preencher as linhas de Documentos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging com uma página compartilhada com você e uma sua
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Projetos

---

### CARD API-039 — Quadros, colunas, membros e estatísticas na API

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-039 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-13, projetos |
| **Arquivos**   | `supabase/functions/_api/actions/projetos/quadros.ts`, `supabase/functions/_api/actions/projetos/quadros.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** A API só lê o resumo de quadros e mexe na fila; criar e editar quadros, gerenciar colunas (inclusive WIP e reordenação), ver membros e a visão geral só existem na UI.

**Contexto:** Lote 13. Depende de: API-027, API-031. Aceite: Uma IA com Quadros: Escrever cria um quadro e colunas que aparecem no app; excluir coluna com cards exige confirm_cards e o nível Excluir; os membros saem sem e-mail; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-027 e API-031 estão em Concluído; se não, release e avisar o usuário
- [ ] projetos.quadros.criar (create_project_board, colunas padrão) e atualizar (dono)
- [ ] projetos.quadros.excluir: nível excluir, só o dono, com confirm_name e lixeira
- [ ] criar_coluna e atualizar_coluna, que avisa quando renomear muda o fluxo (cq_stage_kind antes e depois)
- [ ] reordenar_colunas e excluir_coluna (nível excluir; dry_run com os cards afetados; confirm_cards)
- [ ] listar_membros via private.api_profile_cards (sem e-mail) e estatisticas (projectStats portado no API-027)
- [ ] Quadros compartilhados comigo só com incluir_compartilhados
- [ ] Preencher as linhas de Projetos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging criando um quadro de teste pela IA
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Finanças

---

### CARD API-040 — Transações na API: CRUD, lote, importação com deduplicação, comprovantes e CSV

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-040 |
| **Prioridade** | P1 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-14, finanças, transações |
| **Arquivos**   | `supabase/functions/_api/actions/financas/transacoes.ts`, `supabase/functions/_api/actions/financas/transacoes.test.ts`, `supabase/functions/_domain/statementImport.ts`, `supabase/functions/_domain/financeCsv.ts`, `src/lib/statementImport.ts`, `src/lib/investmentClassifier.ts`, `src/lib/financeCsv.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Lançar transações é o caso central de usar IA para inserir dados, mas não há API, a deduplicação de extrato é heurística do navegador, uma chamada repetida duplicaria dinheiro e o CSV não escapa fórmulas.

**Contexto:** Lote 14. Depende de: API-036. Aceite: Uma IA lança 20 despesas de um extrato colado sem duplicar ao repetir a chamada, e os valores aparecem certos na tela; compartilhar sem Compartilhamento dá 403; comprovante de outro membro do workspace não abre; o CSV abre sem executar fórmula; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-036 está em Concluído; se não, release e avisar o usuário
- [ ] Portar statementImport (com investmentClassifier) e financeCsv para _domain; src/lib reexporta; --allow-moves
- [ ] financas.transacoes.listar: mês YYYY-MM, escopo próprio, compartilhado ou workspace, filtros e cursor; workspace e compartilhadas exigem compartilhamento.pessoas:ler
- [ ] financas.transacoes.historico e obter
- [ ] criar: amount_cents inteiro > 0, tipo, data, conta e categoria visíveis, idempotency obrigatória
- [ ] No criar, shared_with_user_id ou workspace_id exige compartilhamento.pessoas:escrever
- [ ] atualizar e excluir
- [ ] excluir_lote: até 100 itens, nível excluir, com os comprovantes agendados pela lixeira
- [ ] importar: linhas já extraídas, deduplicação e movimentações internas com o statementImport portado, dry_run, idempotency, até 500 linhas
- [ ] Comprovantes: enviar (jpeg/png/webp/heic até 10 MB), url (300 s) e remover, sempre por authorizeObject
- [ ] exportar_csv escapando =, +, - e @ no início da célula; corrigir também src/lib/financeCsv.ts
- [ ] Preencher as linhas de Finanças em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging com um extrato fictício lançado pelo Claude
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Perfil

---

### CARD API-041 — Perfil e foto na API

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-041 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-14, perfil |
| **Arquivos**   | `supabase/functions/_api/actions/perfil/dados.ts`, `supabase/functions/_api/actions/perfil/dados.test.ts`, `supabase/migrations/<ts>_api041_profile_checks.sql`, `supabase/checks/api041-profile.sql`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** O perfil não tem API, e as regras dele vivem só nos grants e na UI: language, nome e onboarding não têm validação no banco, e a foto depende do bucket avatars sem caminho controlado.

**Contexto:** Lote 14. Depende de: API-031. Aceite: Uma IA atualiza nome, idioma e foto, mas não consegue mudar papel, e-mail nem o perfil de outra pessoa; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-031 está em Concluído; se não, release e avisar o usuário
- [ ] perfil.dados.obter: subconjunto seguro, sem last_login_date, is_active e ai_has_key
- [ ] perfil.dados.atualizar, com lista fechada de campos: display_name (trim, até 80), language pt-BR ou en e theme
- [ ] Mais campos do atualizar: avatar_emoji, avatar_color hex e finance_dashboard_view simple ou detailed
- [ ] marcar_tour_visto: merge de uma chave do onboarding com data ISO
- [ ] enviar_avatar: 2 MiB, jpeg/png/webp, caminho <uid>/<uuid>.<ext> por authorizeObject, apagando a foto anterior
- [ ] remover_avatar e url_avatar
- [ ] Levantamento só leitura e migration com CHECK de language e do tamanho de display_name (NOT VALID se houver dados fora)
- [ ] Ensaio ROLLBACK e harness supabase/checks/api041-profile.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Preencher as linhas de Perfil em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration e o deploy da api em produção

---

### CARD API-042 — Notificações filtradas por escopo e convites próprios na API

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-042 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-14, notificações, convites |
| **Arquivos**   | `supabase/functions/_api/actions/perfil/notificacoes.ts`, `supabase/functions/_api/actions/perfil/convites.ts`, `supabase/functions/_api/actions/perfil/notificacoes.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Notificações carregam valores de empréstimo e e-mails de terceiros (loan_*, workspace_invite, member_joined, member_left), então um token só com Notificações não pode ver tudo, e gerar convite permite que um terceiro crie conta.

**Contexto:** Lote 14. Depende de: API-031. Aceite: Um token só com Notificações não vê notificações loan_*, workspace_* nem member_*; a contagem de não lidas vem do servidor; o sexto convite do dia é recusado; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-031 está em Concluído; se não, release e avisar o usuário
- [ ] perfil.notificacoes.listar: cursor, tipos filtrados por escopo conforme docs/api-arquitetura.md §8
- [ ] perfil.notificacoes.contar_nao_lidas: contagem no servidor, sem o teto de 50
- [ ] marcar_lida e marcar_todas_lidas (só mudam read) e excluir (nível excluir)
- [ ] perfil.convites.listar (created_by = eu, mesmo para admin) e saldo (invite_slots_remaining)
- [ ] perfil.convites.gerar: até 5 por dia por token, inclusive para admin, com idempotency
- [ ] Conferir que a notificação de convite de workspace só aparece com compartilhamento.pessoas:ler e que responder ao convite fica no API-056
- [ ] Preencher as linhas de Perfil em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir se algum token seu poderá gerar convites (padrão: Nenhum)
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Projetos

---

### CARD API-043 — Cards na API: criar, editar com versão, mover, itens, relações, anexos e excluir

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-043 |
| **Prioridade** | P1 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-15, projetos, cards |
| **Arquivos**   | `supabase/functions/_api/actions/projetos/cards.ts`, `supabase/functions/_api/actions/projetos/cards.test.ts`, `supabase/functions/_domain/cardMarkdown.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** A API não cria cards nem edita campos (datas, responsável, rótulos, links, relações, página vinculada), não move, não gerencia anexos e devolve um card sem datas, responsável e relações; é o grosso do uso de IA em Projetos.

**Contexto:** Lote 15. Depende de: API-013, API-039. Aceite: Uma IA cria um card com checklist, datas e responsável, move entre colunas e anexa uma imagem, e tudo aparece no kanban aberto; versão velha dá 409; mover para Concluído num quadro com fluxo sem Validação dá 403; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-013 e API-039 estão em Concluído; se não, release e avisar o usuário
- [ ] projetos.cards.obter_completo (forma completa, coluna e status na fila) e criar (todos os campos; idempotency)
- [ ] projetos.cards.atualizar: PATCH com expected_updated_at, versão velha → 409
- [ ] mover: coluna e posição via reorder_project_cards; para Concluído em quadro com fluxo, o banco exige projetos.validacao
- [ ] concluir e reabrir
- [ ] Checklist por item: adicionar, editar, marcar e remover por id; itens owner='user' só com Validação
- [ ] Rótulos (adicionar, remover) e links (só http/https)
- [ ] Relações (pai e dependências) e responsável (membro do quadro)
- [ ] vincular_pagina (exige documentos.paginas:ler) e reagendar (datas)
- [ ] exportar_markdown (cardMarkdown portado, rótulos do dicionário pt-BR) e recentes
- [ ] excluir: nível excluir, com lixeira
- [ ] Anexos: enviar (imagem base64 até 10 MB, caminho ${uid}/${board}/${card}/...), url (300 s) e remover, por authorizeObject
- [ ] Escrever em card de quadro de outra pessoa exige compartilhamento.pessoas:escrever (conferido no banco)
- [ ] Preencher as linhas de Projetos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging pedindo ao Claude para montar 3 cards num quadro de teste
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Documentos

---

### CARD API-044 — Notas na API: ler e escrever conteúdo com versão, Markdown, imagens e blocos de card

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-044 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-15, documentos, notas |
| **Arquivos**   | `supabase/functions/_api/actions/documentos/notas.ts`, `supabase/functions/_api/actions/documentos/notas.test.ts`, `supabase/functions/_domain/blocknote/schema.ts`, `supabase/functions/_domain/blocknote/markdown.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Escrever notas é o principal uso de inserir dados com IA, mas a escrita substitui o documento inteiro e depende da versão, e imagens externas são apagadas pelo cliente (SEC-014); sem uma API que valide os blocos, aceite Markdown, respeite a versão e envie imagens, uma IA corromperia ou sobrescreveria notas.

**Contexto:** Lote 15. Depende de: API-023, API-038. Aceite: Uma IA lê uma nota em Markdown, anexa seções e uma imagem, e a nota abre normalmente no app e no PDF; versão velha dá 409; bloco inválido é recusado com o caminho do erro; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-023 e API-038 estão em Concluído; se não, release e avisar o usuário
- [ ] documentos.notas.obter: blocos completos, Markdown, texto e versão; 404 se a página não for legível; nota de outra pessoa marcada untrusted
- [ ] substituir: blocos ou Markdown; expected_updated_at obrigatório (versão velha → 409); force explícito com destructiveHint
- [ ] substituir cria a linha de note_contents quando ela faltar
- [ ] anexar (no fim ou depois de um bloco), substituir_bloco e remover_bloco por id, lendo e gravando na mesma transação
- [ ] Gravar pages.updated_at quando o conteúdo muda pela API
- [ ] enviar_imagem: base64 até 10 MB, MIME do bucket, caminho ${uid}/${pageId}/... por authorizeObject, só com page_is_writable
- [ ] url_imagem: URL assinada por 1 h
- [ ] inserir_card_projeto (exige projetos.cards:ler): bloco projectCard com o snapshot montado no servidor
- [ ] Staging: editar pela API com a nota aberta no app; o editor recebe pelo realtime sem conflito falso
- [ ] Preencher as linhas de Documentos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging pedindo ao Claude para escrever um resumo numa nota sua e abrir a nota no app
- [ ] Você: Aprovar o deploy da api em produção

---

### CARD API-045 — Tarefas (todos) na API, com updated_at no servidor

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-045 |
| **Prioridade** | P2 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-15, documentos, tarefas |
| **Arquivos**   | `supabase/migrations/<ts>_api045_todos_updated_at.sql`, `supabase/checks/api045-todos.sql`, `supabase/functions/_api/actions/documentos/tarefas.ts`, `supabase/functions/_api/actions/documentos/tarefas.test.ts`, `src/components/TodoList.tsx`, `supabase/functions/_api/coverage.ts` |

**Problema:** todos não tem gatilho de updated_at, o sort_order é Date.now() do navegador, a policy de update não trava user_id nem page_id, e uma IA não consegue listar nem criar tarefas.

**Contexto:** Lote 15. Depende de: API-038. Aceite: Uma IA cria e conclui tarefas numa página de tarefas e elas aparecem no app em tempo real; mudar page_id pela API é impossível; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-038 está em Concluído; se não, release e avisar o usuário
- [ ] Migration: gatilho todos_updated_at e sort_order padrão no servidor; TodoList.tsx para de enviar updated_at
- [ ] documentos.tarefas.listar (por página, abertas primeiro) e listar_minhas (criadas por mim em páginas legíveis)
- [ ] criar (só em página do tipo todo gravável), concluir e excluir (nível excluir)
- [ ] atualizar: texto, concluída, prioridade e prazo, com versão opcional; nunca muda user_id nem page_id
- [ ] Ensaio ROLLBACK e harness supabase/checks/api045-todos.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Preencher as linhas de Documentos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar a migration e o deploy da api em produção

---

## Tópico: Finanças

---

### CARD API-046 — Orçamentos, metas e aportes na API

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-046 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-16, finanças, orçamentos, metas |
| **Arquivos**   | `supabase/functions/_api/actions/financas/orcamentos_metas.ts`, `supabase/functions/_api/actions/financas/orcamentos_metas.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Orçamentos, metas e aportes só têm UI, e o status deles (gasto contra limite, progresso) é calculado no navegador.

**Contexto:** Lote 16. Depende de: API-012, API-036. Aceite: Uma IA cria um orçamento e uma meta e faz um aporte que conclui a meta, e os números batem com a tela; repetir o aporte com a mesma chave não duplica; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-012 e API-036 estão em Concluído; se não, release e avisar o usuário
- [ ] financas.orcamentos_metas.listar_orcamentos e status_orcamentos (gasto × limite no mês, calculado no servidor)
- [ ] criar_orcamento, atualizar_orcamento e excluir_orcamento; workspace ou compartilhado exige compartilhamento.pessoas:escrever
- [ ] Metas: listar_metas (progresso e status efetivo), criar_meta, atualizar_meta, alterar_status_meta e excluir_meta (nível excluir)
- [ ] Aportes: listar_aportes, aportar (finance_goal_contribute; idempotency) e excluir_aporte
- [ ] Preencher as linhas de Finanças em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

### CARD API-047 — Recorrentes na API: cadastro, lançamentos, marcar como paga e pular

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-047 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-16, finanças, recorrentes |
| **Arquivos**   | `supabase/functions/_api/actions/financas/recorrentes.ts`, `supabase/functions/_api/actions/financas/recorrentes.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Com a materialização no servidor (API-016), os recorrentes podem ser expostos sem que um recorrente criado pela API fique sem lançamentos.

**Contexto:** Lote 16. Depende de: API-016, API-040. Aceite: Um recorrente criado pela IA ganha lançamentos sem abrir o app; marcar como paga cria a transação uma vez só, mesmo repetindo a chamada; sem Transações: Escrever, marcar_paga dá 403; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-016 e API-040 estão em Concluído; se não, release e avisar o usuário
- [ ] financas.recorrentes.listar e lancamentos (do mês, com o previsto de receitas e despesas)
- [ ] criar, atualizar, pausar e retomar
- [ ] excluir: nível excluir; os lançamentos somem e as transações ficam
- [ ] marcar_paga (exige também financas.transacoes:escrever; idempotency) e pular
- [ ] Preencher as linhas de Finanças em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Loja

---

### CARD API-048 — Loja na API, leituras: catálogo, estoque, compras, vendas, clientes e visão do mês

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-048 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-16, loja |
| **Arquivos**   | `supabase/functions/_api/actions/financas/loja_leitura.ts`, `supabase/functions/_api/actions/financas/loja_leitura.test.ts`, `supabase/functions/_domain/financeStoreCalc.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Estoque, custo médio, lucro e capital parado são derivados no navegador, então uma IA que leia as tabelas cruas chegaria a números diferentes dos da tela.

**Contexto:** Lote 16. Depende de: API-028, API-031. Aceite: Estoque, custo médio e lucro da API batem com a tela no staging; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-028 e API-031 estão em Concluído; se não, release e avisar o usuário
- [ ] financas.loja.resumo: capital parado e receita, custo e lucro do mês YYYY-MM (financeStoreCalc do API-028)
- [ ] produtos_listar e produto_obter: estoque derivado, custo médio e histórico de compras
- [ ] compras_listar (funil) e vendas_listar (líquido recebido e lucro)
- [ ] clientes_listar (com estatísticas; são dados pessoais de terceiros) e fornecedores_listar
- [ ] anexo_url: URL de 300 s, por authorizeObject, só do próprio uploader, como a policy de store-files
- [ ] Paridade com a tela usando dados de teste
- [ ] Preencher as linhas da Loja em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Finanças

---

### CARD API-049 — Visão geral e relatórios financeiros compostos por escopo

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-049 |
| **Prioridade** | P2 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-17, finanças, relatórios |
| **Arquivos**   | `supabase/functions/_api/actions/financas/relatorios.ts`, `supabase/functions/_api/actions/financas/relatorios.test.ts`, `supabase/functions/_domain/financeGraph.ts`, `supabase/functions/_domain/financePhase.ts`, `supabase/functions/_domain/unifiedCards.ts`, `src/lib/financeGraph.ts`, `src/lib/financePhase.ts`, `src/modules/finance/myprojects/unifiedCards.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** O resumo do mês, a visão do workspace, a rede de fluxo e o painel Projetos são calculados no navegador; para uma IA analisar finanças, esses números precisam vir do servidor, montados só com o que o token pode ler.

**Contexto:** Lote 17. Depende de: API-040, API-046, API-047. Aceite: A visão geral da API bate com a tela no staging; um token só com Transações recebe os blocos de receitas e despesas sem os de metas e orçamentos; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-040, API-046 e API-047 estão em Concluído; se não, release e avisar o usuário
- [ ] Portar financeGraph (fechamento: financeCalc e tipos de graph), financePhase e unifiedCards (tipo local em vez do tipo do hook useFinanceStore); src reexporta; --allow-moves
- [ ] financas.relatorios.visao_geral(mes): cada bloco (transações, contas, recorrentes, metas, orçamentos) só sai com a leitura da subseção de origem
- [ ] visao_workspace: os gastos por membro exigem compartilhamento.pessoas:ler
- [ ] rede: fluxo de 1, 3, 6 ou 12 meses
- [ ] resumo_projetos: vendas exigem financas.loja:ler; metas exigem financas.orcamentos_metas:ler
- [ ] Agregações no SQL para caber no limite de CPU da edge; teste de paridade com a tela
- [ ] Preencher as linhas de Finanças em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Conferir no staging que os números batem com a tela
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Compartilhamento

---

### CARD API-050 — Compartilhamento na API: busca de pessoas e compartilhamento de páginas e quadros

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-050 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-17, compartilhamento, segurança |
| **Arquivos**   | `supabase/functions/_api/actions/compartilhamento/pessoas.ts`, `supabase/functions/_api/actions/compartilhamento/pessoas.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Compartilhar é escalada de privilégio e a busca de usuários devolve e-mails (um e-mail exato acha qualquer perfil), por isso essas ações ficam numa subseção transversal, desligada por padrão e sempre somada à leitura do item compartilhado.

**Contexto:** Lote 17. Depende de: API-038, API-039. Aceite: Sem compartilhamento.pessoas, nenhuma dessas ações aparece no MCP nem funciona; com ela, dá para compartilhar uma página com um usuário de teste e o acesso aparece no app dele; a API não concede co_owner; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-038 e API-039 estão em Concluído; se não, release e avisar o usuário
- [ ] compartilhamento.pessoas.buscar: search_users_for_share, mantendo o limite de 40 por minuto; e-mail só no resultado de busca exata
- [ ] Páginas: pagina_listar e pagina_compartilhar (viewer ou editor; co_owner só pela UI); exigem também documentos.paginas:ler
- [ ] Páginas: pagina_alterar_papel e pagina_remover (nível excluir); exigem também documentos.paginas:ler
- [ ] Quadros: quadro_listar e quadro_compartilhar (só o dono); exigem também projetos.quadros:ler
- [ ] Quadros: quadro_alterar_papel e quadro_remover (só o dono); exigem também projetos.quadros:ler
- [ ] Nomes MCP com até 48 caracteres (teste do registro)
- [ ] Preencher as linhas de Compartilhamento em _api/coverage.ts e rodar a matriz E2E com um segundo usuário de teste
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar com um segundo usuário de teste no staging
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Documentos

---

### CARD API-051 — Notas rápidas na API: listar, criar, editar com versão, vínculos e excluir

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-051 |
| **Prioridade** | P2 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-17, notas-rápidas |
| **Arquivos**   | `supabase/functions/_api/actions/documentos/notas_rapidas.ts`, `supabase/functions/_api/actions/documentos/notas_rapidas.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Notas rápidas são o jeito mais simples de uma IA anotar algo para o usuário, mas não há API, e os vínculos são um array inteiro sem validação de forma.

**Contexto:** Lote 17. Depende de: API-003, API-031. Aceite: Uma IA cria uma nota rápida vinculada a um card; com o overlay aberto no app, a nota não é sobrescrita; versão velha dá 409; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-003 e API-031 estão em Concluído; se não, release e avisar o usuário
- [ ] documentos.notas_rapidas.listar e criar (cor yellow, green, pink, blue ou purple; idempotency)
- [ ] atualizar: conteúdo e cor com expected_updated_at, versão velha → 409
- [ ] vincular_item (page ou card; alvo legível, exige documentos.paginas:ler ou projetos.cards:ler; id gerado no servidor) e desvincular_item
- [ ] excluir (nível excluir)
- [ ] Testar no staging com o overlay aberto no app (sem sobrescrita, graças ao API-003)
- [ ] Preencher as linhas de Documentos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Loja

---

### CARD API-052 — Loja na API, escritas: produtos, compras, vendas, itens, clientes, fornecedores e anexos

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-052 |
| **Prioridade** | P2 |
| **Esforço**    | L |
| **Labels**     | api, api-v1, lote-18, loja, finanças |
| **Arquivos**   | `supabase/functions/_api/actions/financas/loja_escrita.ts`, `supabase/functions/_api/actions/financas/loja_escrita.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Com as regras de vendas e compras no servidor (API-028 e API-037), a Loja pode ser escrita por IA, desde que toda mexida em transação vinculada exija também a permissão de Transações.

**Contexto:** Lote 18. Depende de: API-037, API-040, API-048. Aceite: Uma IA registra compra e venda completas, e estoque, lucro e fluxo de caixa ficam iguais aos de uma operação feita na tela; sem Transações: Escrever, gerar_receita dá 403; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-037, API-040 e API-048 estão em Concluído; se não, release e avisar o usuário
- [ ] Produtos: criar (com compra inicial), atualizar, arquivar e excluir (nível excluir)
- [ ] Compras: criar, atualizar, alterar_status, gerar_despesa e excluir
- [ ] Vendas: criar (com itens), atualizar, alterar_status, gerar_receita e excluir
- [ ] Itens de venda: adicionar, atualizar preço e remover
- [ ] Clientes (criar, atualizar, excluir) e fornecedores (criar)
- [ ] Anexos em store-files: enviar (15 MB; jpeg/png/webp/gif/pdf) e remover, por authorizeObject
- [ ] ctx.can: ação que cria, altera ou apaga transação vinculada exige financas.transacoes:escrever
- [ ] ctx.can: workspace exige compartilhamento.pessoas:escrever; idempotency nas criações
- [ ] Preencher as linhas da Loja em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging uma venda feita pelo Claude
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Estudos

---

### CARD API-053 — Estudos na API: progresso, quiz, diário e contrato do prompt

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-053 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-18, estudos |
| **Arquivos**   | `supabase/functions/_api/actions/estudos/progresso.ts`, `supabase/functions/_api/actions/estudos/diario.ts`, `supabase/functions/_api/actions/estudos/progresso.test.ts`, `supabase/functions/_domain/study/prompt.ts`, `src/lib/studyPrompt.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Uma IA que gera roteiros não pode conseguir marcar o aprendizado como feito, mas o usuário pode querer que outra IA registre progresso e diário; também falta expor o contrato do prompt para qualquer IA gerar roteiros no formato certo.

**Contexto:** Lote 18. Depende de: API-034. Aceite: Um token sem estudos.progresso não marca checkpoint nem responde quiz; o contrato do prompt devolvido pela API é o mesmo da tela; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-034 está em Concluído; se não, release e avisar o usuário
- [ ] Portar studyPrompt para _domain/study; src/lib reexporta
- [ ] estudos.progresso: marcar_checkpoint (study_checkpoint_toggle) e responder_quiz (trava após a primeira resposta)
- [ ] estudos.progresso: reiniciar_quiz e alterar_status (studying ou completed)
- [ ] estudos.diario: listar (por tópico ou global, agrupado por dia local), criar e excluir (nível excluir)
- [ ] estudos.conteudo.contrato_prompt e validar_markdown (prévia sem gravar)
- [ ] Preencher as linhas de Estudos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Documentos

---

### CARD API-054 — Desenhos (Excalidraw) na API: ler e escrever com validação e limites

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-054 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-18, documentos, desenhos |
| **Arquivos**   | `supabase/functions/_api/actions/documentos/desenhos.ts`, `supabase/functions/_domain/excalidraw.ts`, `supabase/functions/_domain/excalidraw.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Desenhos Excalidraw guardam elementos verbosos e imagens em base64 na própria linha, e o canvas aberto só percebe mudanças pela soma das versões dos elementos, então uma escrita ingênua por IA corromperia a cena ou passaria despercebida.

**Contexto:** Lote 18. Depende de: API-038. Aceite: Uma IA adiciona um diagrama simples (caixas, setas e texto) que abre corretamente no app, inclusive com o canvas aberto; elemento inválido é recusado; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-038 está em Concluído; se não, release e avisar o usuário
- [ ] documentos.desenhos.obter: elementos (sem os excluídos, por padrão) e app_state; files só com include_files
- [ ] substituir, adicionar_elementos e remover_elementos com expected_updated_at
- [ ] _domain/excalidraw.ts: validação dos campos base por tipo (rectangle, ellipse, diamond, arrow, line, freedraw, text, image, frame)
- [ ] excalidraw.ts também gera o índice fracionário, incrementa version e versionNonce e estima o tamanho de texto
- [ ] Limites: cena até 2 MB, até 2.000 elementos, cada imagem até 2 MB
- [ ] Testar no staging com o canvas aberto
- [ ] Preencher as linhas de Documentos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Projetos

---

### CARD API-055 — Importação de backlog em Markdown e agenda automática pela API

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-055 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-19, projetos, importação |
| **Arquivos**   | `supabase/functions/_api/actions/projetos/cards_importacao.ts`, `supabase/functions/_api/actions/projetos/cards_importacao.test.ts`, `supabase/functions/_domain/backlogMarkdownParser.ts`, `supabase/functions/_domain/importPlan.ts`, `supabase/functions/_domain/autoSchedule.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Importar backlogs (como este) e gerar o cronograma só funcionam na tela, não são atômicos e não deduplicam; uma IA que gera cards em lote precisa de importação atômica com prévia.

**Contexto:** Lote 19. Depende de: API-027, API-033, API-043. Aceite: Importar o mesmo arquivo duas vezes não duplica cards; o dry_run mostra os mesmos avisos da tela de importação; o cronograma da API é igual ao do botão Gerar cronograma; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-027, API-033 e API-043 estão em Concluído; se não, release e avisar o usuário
- [ ] projetos.cards.importar_backlog: Markdown BacklogCard v1 com o parser portado, e dry_run devolvendo avisos e cards
- [ ] importar_backlog grava tudo numa transação, deduplica pelo ID externo, preenche depends_on a partir de Depende de (API-033), aceita até 200 cards e usa idempotency
- [ ] projetos.cards.gerar_cronograma: autoSchedule portado, modos preencher e replanejar, dry_run, gravação via schedule_project_cards
- [ ] Testar no staging importando docs/imports/backlog-card-sample.md
- [ ] Preencher as linhas de Projetos em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Compartilhamento

---

### CARD API-056 — Espaço compartilhado e compartilhamentos financeiros na API

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-056 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-19, finanças, compartilhamento |
| **Arquivos**   | `supabase/functions/_api/actions/compartilhamento/workspace.ts`, `supabase/functions/_api/actions/compartilhamento/workspace.test.ts`, `supabase/migrations/<ts>_api056_workspace_detach_suppliers.sql`, `supabase/checks/api056-workspace.sql`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** O coworkspace e os compartilhamentos de metas existem só na UI e nas notificações, e aceitar um convite dá a outras pessoas acesso às suas finanças; além disso, sair ou remover membro não desvincula finance_suppliers, que continuam visíveis ao workspace antigo.

**Contexto:** Lote 19. Depende de: API-012, API-040, API-050. Aceite: Aceitar convite só funciona com compartilhamento.pessoas:escrever; sair do workspace desvincula também os fornecedores; meta_listar mostra os compartilhamentos da meta; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-012, API-040 e API-050 estão em Concluído; se não, release e avisar o usuário
- [ ] compartilhamento.pessoas.workspace_obter (membros com e-mail e convites enviados), workspace_criar e workspace_renomear
- [ ] convidar (invite_member, com o limite de 20 por hora do SEC-016; idempotency) e convites_recebidos
- [ ] convite_aceitar e convite_recusar, também a partir da notificação
- [ ] workspace_sair e membro_remover (nível excluir)
- [ ] meta_listar, meta_compartilhar e meta_remover (com a correção do API-012) e parceiros_perfis
- [ ] Migration: leave_workspace e remove_workspace_member passam a desvincular também finance_suppliers
- [ ] Ensaio ROLLBACK e harness supabase/checks/api056-workspace.sql
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Preencher as linhas de Compartilhamento em _api/coverage.ts e rodar a matriz E2E com dois usuários de teste
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar com dois usuários de teste no staging
- [ ] Você: Aprovar a migration e o deploy da api em produção

---

## Tópico: Administração

---

### CARD API-057 — Administração somente leitura na API: usuários, convites, auditoria e backups

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-057 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-19, admin, segurança |
| **Arquivos**   | `supabase/functions/_api/actions/admin/usuarios.ts`, `supabase/functions/_api/actions/admin/convites.ts`, `supabase/functions/_api/actions/admin/auditoria.ts`, `supabase/functions/_api/actions/admin/backups.ts`, `supabase/checks/api057-admin.sql`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Pela decisão do usuário, a administração entra na API só para leitura e só para admins; como o bearer não tem segundo fator, a segurança vem do token criado com AAL2, da validade curta e do is_admin() conferido a cada chamada.

**Contexto:** Lote 19. Depende de: API-011, API-031. Aceite: Um admin com token criado em AAL2 lê usuários, auditoria e backups; ao ser rebaixado, as ações somem na hora; um não admin nunca as vê; nenhuma ação de escrita de admin existe no registro. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-011 e API-031 estão em Concluído; se não, release e avisar o usuário
- [ ] admin.usuarios.listar e buscar: id, e-mail, nome, papel, ativo, criado_em, cotas e avatar, com paginação e busca no servidor
- [ ] admin.usuarios não devolve last_sign_in nem last_login_date
- [ ] admin.convites.listar (com status calculado) e cotas
- [ ] admin.auditoria.listar: cursor e filtro por ação e data; a descrição avisa que tem PII
- [ ] admin.backups.visao_geral, listar e configuracoes
- [ ] Harness supabase/checks/api057-admin.sql: token admin de quem foi rebaixado perde as ações; não admin nunca as vê
- [ ] Preencher as linhas de Administração em _api/coverage.ts; a matriz cobre admin.* pelo harness SQL
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Decidir se algum token seu terá escopo de admin (recomendado: só quando precisar, com 7 dias de validade)
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Documentação

---

### CARD API-058 — Documentação e onboarding da API para todas as IAs

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-058 |
| **Prioridade** | P2 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-20, documentação, onboarding, i18n |
| **Arquivos**   | `docs/api.md`, `scripts/api-docs.mjs`, `scripts/api-docs.test.ts`, `src/components/apiTokens/ConnectGuide.tsx`, `src/i18n/translations.pt-BR.ts`, `src/i18n/translations.en.ts`, `README.md`, `docs/arquitetura.md`, `docs/matriz-rls.md`, `docs/deploy-coolify.md`, `package.json` |

**Problema:** A API só é útil se cada IA souber se conectar, e hoje a única instrução é colar o token no .env.local para npm run cards, com um texto na aba API dizendo que o token é só para o Claude Code.

**Contexto:** Lote 20. Depende de: API-017, API-035. Aceite: Seguindo só docs/api.md, dá para conectar o Claude Code, o Gemini CLI e um script Python ao staging; o painel Como conectar mostra os snippets com a URL certa; o teste de atualização da documentação passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-017 e API-035 estão em Concluído; se não, release e avisar o usuário
- [ ] docs/api.md completo conforme docs/api-arquitetura.md §16
- [ ] Tabela de ações gerada por npm run api:docs (scripts/api-docs.mjs), com teste que falha se estiver desatualizada
- [ ] Snippets de agentes de código, com o token sempre vindo do ambiente: Claude Code (.mcp.json ou headersHelper), Codex CLI (bearer_token_env_var) e Gemini CLI (httpUrl + headers)
- [ ] Snippets de editores e apps locais: Cursor, Windsurf, VS Code (input do tipo password), LM Studio e Open WebUI
- [ ] Snippets de APIs e scripts: OpenAI Responses (mcp tool), Claude Messages (mcp_servers), GPT personalizado (OpenAPI com ?secoes=) e script Python ou Node
- [ ] Teste que recusa snippet com ${…} entre aspas duplas na linha de comando e servidor com nome diferente de akool
- [ ] Cabeçalho x-region com a região do banco nos snippets
- [ ] Quais clientes exigem OAuth (claude.ai, ChatGPT, app Gemini), com link para o API-062
- [ ] Painel Como conectar (ConnectGuide.tsx) com abas por cliente e a URL preenchida; settings_api_intro nas duas línguas
- [ ] Atualizar README, docs/arquitetura.md, docs/matriz-rls.md e docs/deploy-coolify.md; a landing (src/i18n/landingContent.ts), se já estiver na main
- [ ] Boas práticas: menor privilégio, um token por cliente, validade curta para escrita, Compartilhamento e Administração em Nenhum, prompt injection
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Deploy do frontend só após confirmação do usuário
- [ ] Você: Revisar os textos (landing e Configurações) e aprovar
- [ ] Você: Aprovar o deploy do frontend

---

## Tópico: Painel

---

### CARD API-059 — Painel inicial e grafo Rede como leituras compostas por escopo

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-059 |
| **Prioridade** | P2 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-20, painel, documentos |
| **Arquivos**   | `supabase/functions/_api/actions/painel/inicio.ts`, `supabase/functions/_api/actions/documentos/rede.ts`, `supabase/functions/_domain/docsGraph.ts`, `src/lib/docsGraph.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** O painel inicial e a Rede juntam dados de várias seções; como subseção própria, vazariam o que o token não pode ler, então precisam ser leituras compostas que mostram cada bloco só com a permissão de origem.

**Contexto:** Lote 20. Depende de: API-036, API-038, API-039, API-042, API-051. Aceite: Um token só com Documentos recebe o painel sem blocos de Finanças e Projetos; a Rede mostra só os tipos de nó permitidos; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-036, API-038, API-039, API-042 e API-051 estão em Concluído; se não, release e avisar o usuário
- [ ] painel.inicio.obter: páginas recentes e favoritas, tarefas, notas rápidas, resumo financeiro, próximos cards e notificações
- [ ] No painel, cada bloco só sai com a leitura da sua subseção, e pelo menos uma é obrigatória
- [ ] Portar docsGraph (fechamento: avatar e graph) para _domain; src/lib reexporta
- [ ] documentos.rede.obter: nós de quadros e cards só com projetos.cards:ler e notas rápidas só com documentos.notas_rapidas:ler
- [ ] Na Rede, colaboradores vêm via api_profile_cards, sem e-mail
- [ ] Preencher as linhas do painel em _api/coverage.ts e rodar a matriz E2E (npm run test:e2e -- --project=api)
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Empréstimos

---

### CARD API-060 — Empréstimos na API: leitura, escrituração, arquivos e ações entre as partes

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-060 |
| **Prioridade** | P3 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-20, empréstimos, compartilhamento |
| **Arquivos**   | `supabase/functions/_api/actions/financas/emprestimos.ts`, `supabase/functions/_api/actions/financas/emprestimos.test.ts`, `supabase/functions/_api/coverage.ts`, `docs/api.md` |

**Problema:** Com a escrituração no servidor (API-030), os empréstimos podem ser expostos, mas as ações que criam obrigação com outra pessoa ou a notificam precisam de uma permissão extra.

**Contexto:** Lote 20. Depende de: API-030, API-031, API-050. Aceite: Sem Compartilhamento, nenhuma ação entre as partes aparece; o credor registra pagamentos e o saldo bate com o acordado; a matriz passa. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-030, API-031 e API-050 estão em Concluído; se não, release e avisar o usuário
- [ ] financas.emprestimos: listar_tomadores (documento mascarado), listar, obter (com pagamentos e garantias) e saldo (loanCalc do API-030)
- [ ] Escrituração de tomador, empréstimo, pagamento e garantia pelas RPCs do API-030 (excluir no nível Excluir)
- [ ] Arquivos em loan-files: enviar, url e excluir, por authorizeObject
- [ ] Avisar na descrição que loan-files está fora do backup
- [ ] Entre as partes, exigindo compartilhamento.pessoas:escrever: solicitar, aprovar, rejeitar e cancelar_solicitacao
- [ ] Entre as partes, exigindo compartilhamento.pessoas:escrever: informar_pagamento, confirmar_pagamento e rejeitar_pagamento
- [ ] Entre as partes, exigindo compartilhamento.pessoas:escrever: vincular_tomador e desvincular_tomador
- [ ] Preencher as linhas de Empréstimos em _api/coverage.ts e rodar a matriz E2E com dois usuários de teste
- [ ] Staging: npm run staging:reset -- --functions --only=api e validação do usuário
- [ ] Produção: Deploy function → production (api) a partir do ref do PR, antes do merge, só após confirmação do usuário
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Validar no staging com dois usuários de teste, se o módulo estiver em uso
- [ ] Você: Aprovar o deploy da api em produção

---

## Tópico: Fundação da API

---

### CARD API-061 — Aposentar a cards-api e o resolve_api_token v1

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-061 |
| **Prioridade** | P2 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-21, limpeza |
| **Arquivos**   | `supabase/functions/cards-api/`, `supabase/config.toml`, `.github/workflows/deploy-functions.yml`, `scripts/workflows.test.ts`, `scripts/staging-reset.test.ts`, `supabase/drift-allowlist.json`, `supabase/migrations/<ts>_api061_drop_legacy_resolve.sql`, `supabase/functions/_api/definerInventory.ts`, `supabase/functions/_api/coverage.ts`, `README.md` |

**Problema:** Depois da janela de 30 dias com Deprecation, a cards-api, o resolve_api_token v1 e o EXECUTE de service_role nos cq_* são uma segunda porta de entrada sem uso que continua sendo superfície de ataque.

**Contexto:** Lote 21. Depende de: API-035. Aceite: A cards-api some do repo e dos painéis sem quebrar npm run cards nem o /fila; o drift fica zerado; service_role não executa mais os cq_*. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-035 está em Concluído e que a janela de 30 dias registrada em docs/api.md acabou; se não, release e avisar o usuário
- [ ] Remover a cards-api do repo, do config.toml, do deploy-functions.yml, de workflows.test.ts e de staging-reset.test.ts
- [ ] No mesmo PR, pôr cards-api em remoteOnlyFunctions do supabase/drift-allowlist.json
- [ ] Migration: dropar resolve_api_token (v1) e revogar de service_role o EXECUTE dos cq_*
- [ ] Atualizar definerInventory.ts e as linhas legacy de coverage.ts
- [ ] Ensaio ROLLBACK no staging (DO … RAISE) e harness
- [ ] Depois de aplicar no staging: npm run staging:reset -- --migrations, npm run gen:types, get_advisors e docs/matriz-rls.md
- [ ] Produção: apply_migration com o mesmo nome só após confirmação do usuário; depois npm run drift -- --write
- [ ] Depois que o usuário apagar a function no painel (staging e produção), tirar cards-api de remoteOnlyFunctions
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Confirmar o fim da janela de 30 dias
- [ ] Você: Apagar a function cards-api no painel do Supabase (staging e produção) depois da remoção no repo
- [ ] Você: Aprovar a migration em produção

---

## Tópico: Documentação

---

### CARD API-062 — OAuth para apps de chat hospedados (claude.ai, ChatGPT, Gemini): trabalho futuro documentado

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-062 |
| **Prioridade** | P3 |
| **Esforço**    | S |
| **Labels**     | api, api-v1, lote-21, oauth, documentação, futuro |
| **Arquivos**   | `docs/api-oauth-futuro.md`, `docs/api.md` |

**Problema:** claude.ai (web, desktop, mobile), ChatGPT (modo desenvolvedor) e o app Gemini só aceitam MCP com OAuth ou sem autenticação, nenhum deles aceita token pessoal, e esse caminho ficou fora do escopo agora, mas precisa estar registrado para quando o usuário quiser.

**Contexto:** Lote 21. Depende de: API-058. Aceite: docs/api-oauth-futuro.md descreve o fluxo, as decisões e os cards estimados, e docs/api.md aponta para ele. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-058 está em Concluído; se não, release e avisar o usuário
- [ ] Documentar o fluxo de autorização: Supabase OAuth 2.1 Server (beta) com DCR
- [ ] Documentar o consentimento: tela que reaproveita o ScopePicker e grava o grant (user_id, client_id), já que o Supabase não tem escopos customizados
- [ ] Documentar a descoberta: PRM (RFC 9728) com resource igual à URL exata do MCP e 401 com WWW-Authenticate resource_metadata
- [ ] Documentar a verificação: chaves assimétricas e SUPABASE_JWKS, e audience via Custom Access Token Hook
- [ ] Documentar como o token OAuth se liga ao mesmo executor (claims com akool_api e grant em vez de token_id) e os callbacks do claude.ai e do ChatGPT
- [ ] Limitações: CIMD e RFC 8707 não documentados no Supabase; app Gemini só nos EUA; OAuth Server ainda em beta
- [ ] Critérios para reabrir o tema e estimativa em cards (consentimento, grants, PRM, verificação no gateway, testes por cliente)
- [ ] Você: Decidir quando (e se) abrir o trabalho de OAuth

---

## Tópico: Fundação da API

---

### CARD API-063 — Validação final em produção: cobertura total, matriz completa e checklist do usuário

| Campo          | Valor |
| -------------- | ----- |
| **ID**         | API-063 |
| **Prioridade** | P1 |
| **Esforço**    | M |
| **Labels**     | api, api-v1, lote-22, validação, produção |
| **Arquivos**   | `supabase/functions/_api/coverage.ts`, `e2e/api/scope-matrix.spec.ts`, `docs/api.md`, `supabase/functions/_api/registry.ts` |

**Problema:** Depois de todos os domínios, é preciso confirmar de ponta a ponta que a API cobre o sistema inteiro, que cada permissão se comporta como prometido e que a produção está igual ao repositório antes do uso diário com dados reais.

**Contexto:** Lote 22. Depende de: API-026, API-031, API-034, API-041, API-044, API-045, API-049, API-052, API-053, API-054, API-055, API-056, API-057, API-059, API-060, API-061, API-062. Aceite: coverage.ts não tem pendências, a matriz completa passa, os advisors estão limpos, o drift está zerado e o usuário fez o checklist em produção sem pendências. Arquitetura: docs/api-arquitetura.md.

**Subtarefas Kanban:**

- [ ] Conferir que API-026, API-031, API-034, API-041, API-044, API-045, API-049 e API-052 estão em Concluído; se não, release e avisar o usuário
- [ ] Conferir que API-053 a API-057 e API-059 a API-062 estão em Concluído; se não, release e avisar o usuário
- [ ] _api/coverage.ts sem nenhum pending: cada uma das 357 operações virou ação ou never com motivo
- [ ] Matriz E2E completa no staging cobrindo 100% das ações do registro
- [ ] Drift de produção zerado: migrations, papéis e functions publicadas iguais ao repo, com a cards-api fora
- [ ] get_advisors de segurança e performance em produção, sem alerta novo
- [ ] Checklist em produção com o usuário: criar tokens pelos presets; no Claude Code, ler e escrever em cada seção liberada
- [ ] Checklist em produção: confirmar 403 numa seção negada, desfazer uma exclusão e conferir a Atividade
- [ ] docs/api.md com a versão 1.0.0 do registro e o changelog
- [ ] Fechamento: npm test, npm run lint:ci, npx tsc -b e npm run build
- [ ] Você: Executar o checklist de produção com o Claude Code
- [ ] Você: Revogar os tokens de teste ao final

---
