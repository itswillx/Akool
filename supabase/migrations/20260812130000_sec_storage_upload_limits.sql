-- SEC: allowlist de MIME + limite de tamanho nos buckets com upload client-side,
-- espelhando src/lib/uploadValidation.ts. Defesa em profundidade: mesmo que o
-- cliente seja contornado, o Storage do Supabase rejeita content-type/tamanho
-- fora do permitido na própria API de criação de objeto.
--
-- Só altera file_size_limit/allowed_mime_types; não mexe em RLS/policies de
-- SELECT (essas foram tratadas em 20260812120000_sec_storage_share_scoped_read.sql).

-- note-images: remove image/svg+xml (vetor de XSS armazenado mesmo como "imagem",
-- por poder embutir <script>/<foreignObject>).
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
where id = 'note-images';

-- project-card-images: só raster, sem PDF/SVG.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'project-card-images';

-- store-files: anexos financeiros (notas, recibos, fotos) — imagem + PDF.
update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
where id = 'store-files';
