-- SEC (P0): tornar buckets privados. Hoje note-images, project-card-images e
-- transaction-photos sao public=true => qualquer URL e' acessivel sem login
-- (recibos financeiros e imagens expostos na internet). getPublicUrl ignora RLS.
-- O frontend passa a usar createSignedUrl (ver mudancas em React).

update storage.buckets set public = false
  where id in ('note-images','project-card-images','transaction-photos');

-- ---------------------------------------------------------------------------
-- Ajuste das policies de SELECT em storage.objects.
-- transaction-photos: dados pessoais, nao compartilhados entre usuarios ->
--   mantem leitura apenas do dono (policy owner_read_tx_photos ja existe).
-- note-images e project-card-images: precisam ser visiveis por quem recebe o
--   compartilhamento (pagina/board). Baseline: qualquer autenticado pode assinar
--   a URL (bloqueia internet anonima). Refino por-share e' follow-up (exige
--   reestruturar os paths dos objetos, que hoje contem apenas o uid do dono).
-- ---------------------------------------------------------------------------

-- note-images: substituir leitura owner-only por leitura autenticada.
drop policy if exists "Authenticated users can read their own note images" on storage.objects;
create policy "note_images_authenticated_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'note-images');

-- project-card-images: fechar leitura para role public (inclui anon) ->
-- restringir a authenticated e remover a listagem ampla flagada pelo advisor.
drop policy if exists project_card_images_select on storage.objects;
create policy "project_card_images_authenticated_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-card-images');
