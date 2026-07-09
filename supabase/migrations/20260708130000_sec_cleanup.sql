-- SEC (P2): higiene.
-- 1) Remover tabela de teste esquecida em producao.
drop table if exists public.test_pages_insert;

-- 2) DELETE de pagina restrito ao dono. Editores compartilhados (page_is_writable)
--    continuam editando conteudo, mas nao podem apagar a pagina do dono.
drop policy if exists pages_delete on public.pages;
create policy pages_delete on public.pages
  for delete using (user_id = (select auth.uid()));
