# Plano de Execução — Akool / Excalinotion

> Roadmap de execução dos **65 cards** do backlog (`docs/imports/`), priorizado por risco e
> dependências, ancorado no **estado real do código** em 2026-06-30.
> Temas: **SEC** (Segurança) · **PERF** (Performance) · **ARCH** (Arquitetura) · **REL**
> (Confiabilidade) · **DEV** (DevOps) · **QA** (Qualidade) · **UX** (UX/A11y).

Este é um documento de planejamento — os cards já existem nos arquivos de import. Para popular o
Kanban: importar `backlog-card-sample.md` (smoke test) e depois `backlog-resto.md` (64 cards) via
**Projects → Importar**.

---

## 1. Estado atual do sistema (o que já avançou)

Entender isto evita retrabalho — alguns cards já estão parcialmente feitos:

| Observação | Impacto no backlog |
| ---------- | ------------------ |
| `src/modules/finance/` e `src/modules/backup/` já extraídos (com `index.ts`, README e `useSiteBackup.test.ts`) | **ARCH-001, PERF-004, ARCH-010 parcialmente feitos**; falta `core/`, `projects/`, `workspace/`, `admin/` |
| Cards apontam `src/components/FinancePanel.tsx` / `BackupPanel.tsx` | **Paths defasados** — hoje em `src/modules/finance\|backup/`. Ajustar ao executar |
| `react-router-dom@7` instalado, **mas não usado** | Decisão em **PERF-009 / ARCH-003**: implementar router ou remover a dependência |
| Vitest 4 configurado, `npm test`, specs existentes | **QA-003 tem base**; falta CI (DEV-001) para rodá-los automaticamente |
| `@tanstack/react-query` **ausente** | **PERF-012** e a base de cache do **PERF-002** partem do zero |
| Deploy duplo: `netlify.toml` + `nixpacks.toml` (Coolify) | **SEC-011** (CSP) mira Netlify; validar qual ambiente é o ativo |
| `supabase/config.toml` **ausente** | **ARCH-007** válido; bloqueia stack local (DEV-004) e teste de migrations/functions |
| Migration `20260629120000_admin_invite_rpc_grants.sql`: RPCs `admin_*_invite` (SECURITY DEFINER + check `role='admin'`, grant a `authenticated`) | **Padrão-template** para **SEC-002** (admin-ops) e **SEC-008** (mover ações admin) |

---

## 2. Princípios de sequenciamento

1. **P0 primeiro** — exposição de dados e corrupção de banco: `SEC-001/003/004`, `REL-001`, `SEC-002`.
2. **Habilitadores antes dos dependentes** — versionar o banco (`SEC-001`) e a stack local
   (`ARCH-007`/`DEV-004`) antes de mexer em RLS/functions; CI (`DEV-001`) cedo para checar os PRs.
3. **Decisão antes de implementação** — `ARCH-008` (integrar vs remover functions órfãs) gateia `SEC-004`.
4. **Aproveitar o que já existe** — continuar a modularização (finance/backup), não recomeçar.

### Mapa de dependências (arestas principais)

```
ARCH-007 + DEV-004 ─┐
                    ├─▶ testar localmente SEC-001 / SEC-002 / REL-001
SEC-001 ────────────┼─▶ SEC-003 (storage policies)
                    ├─▶ SEC-007 (RPC profiles)
                    └─▶ SEC-008 (RLS bloqueia update de role)
ARCH-008 (decisão) ─────▶ SEC-004
migration admin invite ─▶ SEC-002 · SEC-005 · SEC-008
ARCH-001 ───────────────▶ PERF-004 · PERF-005 · ARCH-002 · ARCH-010
DEV-001 (CI) ───────────▶ QA-001 · QA-002 · QA-003
PERF-012 (TanStack) ────▶ base de PERF-002 / PERF-003
```

---

## 3. Roadmap

### 🔒 Semana 1 — Fundação segura: versionar o banco e fechar exposição de dados (P0)

> A falha clássica de mercado (anon key pública **+ RLS frágil** = vazamento). Fecha primeiro.

- **Dia 1–2 — `SEC-001`** Versionar schema + políticas RLS (L) — *âncora*.
  Em paralelo: **`ARCH-007`** (`supabase/config.toml`) + **`DEV-004`** (`supabase start` local) para
  conseguir testar a migration antes de aplicar no remoto.
- **Dia 3 — `DEV-002`** (.env docs) + **`DEV-003`** (gitignore de artefatos) [rápidos] +
  **`DEV-001`** (CI: `lint` + `tsc -b` + `vite build`) para gatear os PRs seguintes.
- **Dia 4–5 — `SEC-003`** Buckets privados + `createSignedUrl` (P0) — depende das storage policies do
  `SEC-001`. Prioridade máxima em `transaction-photos` (recibos = PII).

**Saída:** banco versionado e revisável no Git, buckets sensíveis fechados, CI rodando.

### 🛡️ Semana 2 — Controle de acesso: admin, segredos e auth (P0/P1)

- **`ARCH-008`** Decidir destino das functions órfãs (integrar vs remover) — **primeiro**, gateia `SEC-004`.
- **`SEC-004`** Proteger `ai_api_key` (Vault/pgcrypto, mascarar UI) conforme a decisão.
- **`SEC-002`** Edge function `admin-ops` + **`SEC-008`** mover ações admin — reusar o padrão do
  migration `admin_*_invite` (RPC SECURITY DEFINER com check `role='admin'`).
- **`SEC-005`** Atomicidade de invite codes (consumo via trigger no signup) — estende o mesmo migration.
- **`SEC-006`** Sessão `is_active` (logout imediato de user desativado).
- **`SEC-009`** CORS padronizado + **`SEC-010`** auditoria de uso de service role.

**Saída:** ações admin server-side com audit trail, segredos protegidos, auth endurecida.

### ♻️ Semana 3 — Confiabilidade de dados + performance percebida (P0/P1)

- **`REL-001`** Backup restore transacional (P0) — hoje deleta 24 tabelas e re-insere; falha parcial
  = DB corrompido. Snapshot pré-restore + transação/staging + rollback.
- **`REL-007`** Auto-backup só via cron + **`REL-003`** rollback em optimistic updates (módulo backup).
- **`PERF-001`** Paginar transações + **`PERF-003`** otimizar `PagesContext` refresh — ganhos visíveis.
- **`PERF-002`** Eliminar `reload()` do FinancePanel — iniciar; avaliar **`PERF-012`** (TanStack) como base.

**Saída:** restore seguro, finance/workspace perceptivelmente mais rápidos.

### 🧱 Sprint 4 — Modularização & escala (P1/P2, ~2 semanas)

- **`ARCH-001`** Continuar a estrutura modular: criar `core/`, `projects/`, `workspace/`, `admin/`
  sobre o que já existe.
- **`PERF-004`** Finalizar split do FinancePanel + **`PERF-005`** split do ProjectsPanel.
- **`ARCH-002`** Camada de repositórios + **`ARCH-004`** gerar tipos do Supabase + **`ARCH-010`**
  contratos de módulo.
- **`PERF-006/008/009`** Lazy i18n, lazy modals/Excalidraw, otimização de build — inclui a decisão
  **`ARCH-003`** (router) vs remover `react-router-dom`.

**Saída:** nenhum arquivo > 400 LOC, bundle inicial menor, fronteiras de módulo claras.

### 🤝 Sprint 5 — Colaboração robusta & qualidade (P2, ~2 semanas)

- **`REL-004`** Conflitos note/drawing · **`REL-005`** realtime em Projects · **`PERF-007`**
  realtime/presence — unificar padrão de canais (`useSupabaseChannel`). **`REL-002`** fila offline.
- **`QA-001`** TS strict · **`QA-002`** ESLint type-aware · **`QA-003`** estender testes ·
  **`QA-005`** modal/sheet compartilhado.
- **`SEC-011`** CSP/headers · **`SEC-012`** rate limit · **`PERF-010`** compressão de imagem ·
  **`PERF-011`** debounce padronizado.

**Saída:** colaboração multiusuário robusta, gates de qualidade no CI.

### ✨ Sprint 6 — Polish & P3 (contínuo)

- **`UX-001..008`** — a11y de drawer/modais, tabs WAI-ARIA, toast/feedback de erro, onboarding,
  i18n restante, emojis do PageHeader.
- **`ARCH-003/005/006/009`** · **`REL-006/008`** (notifications realtime, health/monitoring) ·
  **`DEV-005/006/007/008`** (deploy functions, previews, README, dependabot) ·
  **`QA-004/006/007`** (E2E, tipar APIs, naming).

---

## 4. Resumo por prioridade

| Prioridade | Cards | Quando |
| ---------- | ----- | ------ |
| **P0** | SEC-001, SEC-003, SEC-004, SEC-002, REL-001 | Semanas 1–3 |
| **P1** | SEC-005/006/007/008/009/010, PERF-001/002/003/004, ARCH-001/007, DEV-001/002/003 | Semanas 1–3 + Sprint 4 |
| **P2** | PERF-005..012, ARCH-002/003/004/006/008/010, REL-002/003/004/005/007, DEV-004/005, QA-001/002/003/005, SEC-011/012, UX-001/002/003/007 | Sprints 4–5 |
| **P3** | ARCH-005/009, REL-006/008, DEV-006/007/008, QA-004/006/007, UX-004/005/006/008 | Sprint 6 |

> Solo/meio-período: o roadmap completo é ~2–3 meses. As Semanas 1–3 entregam todo o risco P0
> (exposição de dados + corrupção de banco) — é o que mais reduz risco por hora investida.
