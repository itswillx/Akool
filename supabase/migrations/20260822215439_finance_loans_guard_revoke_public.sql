-- Importada do remoto em 25/09/2026 (supabase_migrations.schema_migrations, versão 20260822215439).
-- SQL idêntico ao aplicado em produção (md5 073458671264dcbd3e073be0b08f36fe); não editar.

-- As duas funcoes de TRIGGER do modulo nasceram com EXECUTE para PUBLIC, ao
-- contrario de finance_guard_workspace() e finance_guard_invite_update(), que
-- ja tinham o revoke. Chamar uma delas direto por /rest/v1/rpc/ falharia
-- ("trigger functions can only be called as triggers"), mas expor a superficie
-- e divergir do padrao do proprio repo nao tem beneficio nenhum.
--
-- Causa: funcao criada via MCP nasce com EXECUTE para PUBLIC -- o
-- `alter default privileges` de 20260708110000:58 comprovadamente nao pega.
-- Mesmo motivo pelo qual os grants das 8 RPCs foram escritos a mao.

REVOKE EXECUTE ON FUNCTION public.finance_guard_loan_borrower() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.finance_guard_loan_payment() FROM anon, authenticated, public;