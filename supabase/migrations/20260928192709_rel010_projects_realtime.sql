-- REL-010: cards e colunas de Projetos no realtime.
--
-- Quem colabora num quadro compartilhado só via as mudanças dos outros ao
-- recarregar: project_cards e project_columns não estavam na publication
-- supabase_realtime (só a fila, project_card_queue). O ProjectsPanel assina
-- INSERT/UPDATE filtrados por board_id e recarrega o quadro em silêncio.
--
-- O realtime respeita o RLS de SELECT (user_can_access_board), então cada um
-- só recebe os quadros que já podia ler. DELETE não é assinado no app: o
-- Postgres Changes não filtra DELETE por RLS nem por coluna.
do $$
declare
  t text;
begin
  foreach t in array array['project_cards', 'project_columns'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
