-- SEC: note-images e project-card-images tinham SELECT liberado para
-- QUALQUER autenticado (bucket_id = '...' sem checar dono/compartilhamento) --
-- ver comentario em 20260708140000_sec_private_buckets.sql que ja sinalizava
-- isso como baseline temporario. Os paths de upload ja incluem o segundo
-- segmento com pageId/boardId desde antes daquela migracao
-- (NoteEditor.tsx / ProjectsPanel.tsx: `${uid}/${pageId}/...` e
-- `${uid}/${boardId}/${cardId}/...`), entao nao ha reestruturacao de path
-- necessaria: so' reescrever a policy de SELECT para usar esse segmento e
-- reaproveitar as funcoes de acesso ja usadas pelas tabelas `pages` e
-- `project_boards`/`project_cards`.

-- ---------------------------------------------------------------------------
-- Helper: cast seguro de texto para uuid. (storage.foldername(name))[2] pode
-- nao ser um uuid valido em objetos legados/malformados; sem isso um cast
-- direto (`::uuid`) estoura "invalid input syntax" e derruba a query inteira
-- em vez de so' excluir a linha da policy.
-- ---------------------------------------------------------------------------

create or replace function public.try_cast_uuid(p_text text)
returns uuid
language plpgsql
stable
set search_path to ''
as $function$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$function$;

revoke execute on function public.try_cast_uuid(text) from anon, public;
grant execute on function public.try_cast_uuid(text) to authenticated;

-- ---------------------------------------------------------------------------
-- note-images: leitura restrita ao dono (path[1] = auth.uid(), cobre tambem
-- imagens orfas cuja pagina foi apagada) OU a quem tem acesso a pagina via
-- page_is_readable (dono OU page_shares da propria pagina ou de qualquer
-- ancestral -- mesma logica ja usada nas policies de `pages`).
-- ---------------------------------------------------------------------------

drop policy if exists "note_images_authenticated_read" on storage.objects;
create policy "note_images_owner_or_shared_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.page_is_readable(public.try_cast_uuid((storage.foldername(name))[2]))
    )
  );

-- ---------------------------------------------------------------------------
-- project-card-images: mesmo racional, usando user_can_access_board (dono OU
-- project_shares com role >= viewer -- mesma logica ja usada nas policies de
-- `project_boards`/`project_columns`/`project_cards`).
-- ---------------------------------------------------------------------------

drop policy if exists "project_card_images_authenticated_read" on storage.objects;
create policy "project_card_images_owner_or_shared_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-card-images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.user_can_access_board(public.try_cast_uuid((storage.foldername(name))[2]), 'viewer')
    )
  );

-- ---------------------------------------------------------------------------
-- avatars: decisao explicita de NAO restringir. avatars_authenticated_read
-- (20260727160000_profile_avatars.sql) continua liberando SELECT para
-- qualquer autenticado -- avatares aparecem para qualquer pessoa com quem
-- haja compartilhamento de pagina/board/meta, dado de baixa sensibilidade.
-- Nada a alterar aqui; comentario apenas para nao reabrir a discussao.
-- ---------------------------------------------------------------------------
