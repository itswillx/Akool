# Teste — card BacklogCard v1 (SEC-001) e um exemplo de dependência

> Smoke test para importação Kanban. Use antes do arquivo completo.
> O EXE-001 só mostra o campo `Depende de` (depende do SEC-001): apague-o do quadro depois do teste.

## Tópico: Segurança

---

### CARD SEC-001 — Versionar schema completo e políticas RLS


| Campo          | Valor                                      |
| -------------- | ------------------------------------------ |
| **ID**         | SEC-001                                    |
| **Prioridade** | P0                                         |
| **Esforço**    | L                                          |
| **Labels**     | segurança, supabase, migrations            |
| **Arquivos**   | `supabase/migrations/`, dashboard Supabase |


**Problema:** Apenas `[supabase/migrations/20250622120000_site_backups.sql](supabase/migrations/20250622120000_site_backups.sql)` existe no repo. Tabelas `pages`, `profiles`, `finance_`*, RPCs e RLS vivem só no projeto remoto.

**Contexto:**
- Aceite: `supabase db diff` contra o projeto remoto não mostra diferença.
- Aceite: toda tabela de `public` tem RLS ligado, com as policies em migrations.
- Aceite: o CI falha quando o banco diverge das migrations.

**Subtarefas Kanban:**

- [ ] Rodar `supabase db pull` ou export manual de todas as tabelas
- [ ] Exportar todas as policies RLS (`pg_policies`) para migrations
- [ ] Exportar functions/triggers (`validate_invite_code`, signup hooks)
- [ ] Exportar storage policies dos 4 buckets
- [ ] Revisar cada policy: SELECT/INSERT/UPDATE/DELETE por role
- [ ] Documentar matriz role × tabela × operação
- [ ] Adicionar migration check no CI (falha se drift)
- [ ] Criar checklist de review obrigatório antes de deploy DB

---

### CARD EXE-001 — Exemplo de dependência entre cards


| Campo          | Valor   |
| -------------- | ------- |
| **ID**         | EXE-001 |
| **Prioridade** | P3      |
| **Esforço**    | S       |
| **Labels**     | exemplo |
| **Depende de** | SEC-001 |


**Problema:** Mostra o campo `Depende de`: o card entra no quadro já dependendo do SEC-001.
O Problema e o Contexto podem ter várias linhas, até o próximo marcador.

**Subtarefas Kanban:**

- [ ] Conferir a dependência do SEC-001 no card e no Gantt
- [ ] Apagar este card do quadro
