-- Baseline das storage policies (SEC-001, item 2 do checklist).
--
-- `supabase db dump`/reconstrucao de schema NAO cobre o schema `storage`
-- (buckets e suas RLS policies em storage.objects) — ver
-- 20260509000000_baseline_remote_schema.sql e migrations/README.md. Este
-- arquivo cobre so' o que NUNCA teve versao no repo (levantado via
-- pg_policies/storage.buckets ao vivo, 2026-08-10): os 7 buckets usados pelo
-- app e as policies de note-images/transaction-photos/project-card-images que
-- faltavam. bank-statements/avatars/project-expense-files/store-files ja tem
-- criacao de bucket + policies completas em arquivos posteriores (idempotentes
-- via ON CONFLICT/DROP POLICY IF EXISTS) — nao redefinidas aqui para nao
-- duplicar logica.
--
-- Timestamp logo apos o baseline de schema para que buckets existam antes de
-- 20260708140000_sec_private_buckets.sql (que so' ajusta policies/flags,
-- assume os buckets ja criados). Idempotente: seguro reaplicar.

-- ---------------------------------------------------------------------------
-- Buckets (ON CONFLICT DO NOTHING: seguro mesmo se um arquivo posterior
-- também tentar criar o mesmo bucket).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('note-images', 'note-images', false, 10485760,
    array['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','image/heic','image/heif'])
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('transaction-photos', 'transaction-photos', false, 10485760,
    array['image/jpeg','image/png','image/webp','image/gif'])
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('project-card-images', 'project-card-images', false)
  on conflict (id) do nothing;

-- Os 4 buckets abaixo ja tem CREATE proprio em arquivos posteriores
-- (finance_statements.sql, profile_avatars.sql, finance_projects_module.sql,
-- finance_store_module.sql); incluidos aqui tambem, com ON CONFLICT DO
-- NOTHING, so' para este arquivo ficar auto-suficiente se rodado isolado.
insert into storage.buckets (id, name, public)
  values ('bank-statements', 'bank-statements', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('project-expense-files', 'project-expense-files', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('store-files', 'store-files', false)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- note-images: leitura autenticada aberta (compartilhamento de paginas usa
-- URLs assinadas de qualquer autenticado); escrita restrita ao dono
-- (primeiro segmento do path = auth.uid()). SELECT ja e' redefinida por
-- sec_private_buckets.sql (note_images_authenticated_read) — nao repetida aqui.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can upload note images" on storage.objects;
create policy "Authenticated users can upload note images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Authenticated users can update their note images" on storage.objects;
create policy "Authenticated users can update their note images" on storage.objects
  for update to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Authenticated users can delete their note images" on storage.objects;
create policy "Authenticated users can delete their note images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- transaction-photos: dado pessoal (recibo financeiro), leitura/escrita
-- restritas ao dono. Nunca teve arquivo — so' era citada em comentario por
-- sec_private_buckets.sql ("policy owner_read_tx_photos ja existe").
-- ---------------------------------------------------------------------------

drop policy if exists owner_read_tx_photos on storage.objects;
create policy owner_read_tx_photos on storage.objects
  for select to authenticated
  using (bucket_id = 'transaction-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists owner_upload_tx_photos on storage.objects;
create policy owner_upload_tx_photos on storage.objects
  for insert to authenticated
  with check (bucket_id = 'transaction-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists owner_delete_tx_photos on storage.objects;
create policy owner_delete_tx_photos on storage.objects
  for delete to authenticated
  using (bucket_id = 'transaction-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- project-card-images: leitura autenticada aberta (mesmo racional de
-- note-images); escrita restrita ao dono. SELECT ja e' redefinida por
-- sec_private_buckets.sql (project_card_images_authenticated_read).
-- ---------------------------------------------------------------------------

drop policy if exists project_card_images_insert on storage.objects;
create policy project_card_images_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists project_card_images_delete on storage.objects;
create policy project_card_images_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-card-images' and (storage.foldername(name))[1] = auth.uid()::text);
