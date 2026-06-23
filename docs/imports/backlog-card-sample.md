# Teste — 1 card BacklogCard v1

> Smoke test para importação Kanban. Use antes do arquivo completo.

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

**Subtarefas Kanban:**

- [ ] Rodar `supabase db pull` ou export manual de todas as tabelas
- [ ] Exportar todas as policies RLS (`pg_policies`) para migrations
- [ ] Exportar functions/triggers (`validate_invite_code`, signup hooks)
- [ ] Exportar storage policies dos 4 buckets
- [ ] Revisar cada policy: SELECT/INSERT/UPDATE/DELETE por role
- [ ] Documentar matriz role × tabela × operação
- [ ] Adicionar migration check no CI (falha se drift)
- [ ] Criar checklist de review obrigatório antes de deploy DB
