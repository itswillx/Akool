-- SEC-011: limite de tamanho e allowlist de MIME nos buckets que faltavam,
-- espelhando src/lib/uploadValidation.ts. O Storage recusa na própria API de
-- upload, mesmo que o cliente seja contornado. Só file_size_limit e
-- allowed_mime_types; políticas não mudam. Complementa
-- 20260812130000_sec_storage_upload_limits.sql.

-- avatars: o app sobe o JPEG gerado pelo recorte (src/lib/imageCrop.ts). PNG e
-- WebP ficam permitidos para uma troca futura de formato.
update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg','image/png','image/webp']
where id = 'avatars';

-- transaction-photos: já estava assim em produção; aqui para o repositório
-- bater (a baseline cria o bucket com ON CONFLICT DO NOTHING).
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
where id = 'transaction-photos';

-- project-expense-files: legado (o módulo de obras saiu), mas a política de
-- upload do próprio usuário continua valendo. Mesmo contrato do store-files.
update storage.buckets
set file_size_limit = 15728640,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
where id = 'project-expense-files';

-- bank-statements: legado (o frontend não sobe mais extrato), com a política
-- de upload ainda aberta. Só formatos de extrato: CSV, texto, PDF e OFX/QFX.
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['text/csv','text/plain','application/pdf','application/x-ofx','application/vnd.intu.qfx']
where id = 'bank-statements';
