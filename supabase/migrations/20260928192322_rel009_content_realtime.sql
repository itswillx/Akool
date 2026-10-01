-- REL-009: conteúdo de nota e desenho no realtime.
--
-- O useCollaborativeContent (NoteEditor/DrawingCanvas) se inscrevia em
-- note_contents e drawing_contents, mas as tabelas nunca estiveram na
-- publication supabase_realtime: nenhum evento chegava, e quem via uma página
-- compartilhada só enxergava a versão nova ao reabrir. Com as tabelas
-- publicadas, quem só está olhando recebe a versão salva, e quem está
-- editando esbarra no aviso de conflito do save condicional (updated_at).
--
-- O realtime respeita o RLS de SELECT (page_is_readable), então cada um só
-- recebe as páginas que já podia ler. Só INSERT/UPDATE interessam aqui; o
-- editor não assina DELETE.
do $$
declare
  t text;
begin
  foreach t in array array['note_contents', 'drawing_contents'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
