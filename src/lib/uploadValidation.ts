// Contexts mirror Supabase storage buckets. Each context defines its own
// allowlist + max size so a change to one upload surface can't silently
// loosen another. Keep these values in sync with the DB-level
// file_size_limit/allowed_mime_types set in
// supabase/migrations/20260812130000_sec_storage_upload_limits.sql.
export type UploadContext = 'note-image' | 'card-image' | 'finance-attachment'

interface ContextRule {
  bucket: string
  maxBytes: number
  allowedMime: readonly string[]
}

// MIME -> canonical extension. Extension is ALWAYS derived from this map,
// never from file.name — a file whose declared MIME isn't in the map (and
// therefore isn't in the allowlist) can never smuggle an attacker-chosen
// extension onto the storage path.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
}

const UPLOAD_RULES: Record<UploadContext, ContextRule> = {
  'note-image': {
    bucket: 'note-images',
    maxBytes: 10 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'],
  },
  'card-image': {
    bucket: 'project-card-images',
    maxBytes: 10 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  },
  'finance-attachment': {
    bucket: 'store-files',
    maxBytes: 15 * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'],
  },
}

export type UploadRejectionReason = 'invalid_type' | 'too_large'

export type UploadValidationResult =
  | { ok: true; file: File; ext: string }
  | { ok: false; reason: UploadRejectionReason; context: UploadContext }

export function validateUpload(context: UploadContext, file: File): UploadValidationResult {
  const rule = UPLOAD_RULES[context]
  if (!rule.allowedMime.includes(file.type)) {
    return { ok: false, reason: 'invalid_type', context }
  }
  if (file.size > rule.maxBytes) {
    return { ok: false, reason: 'too_large', context }
  }
  return { ok: true, file, ext: MIME_EXT[file.type] }
}

export function uploadContextBucket(context: UploadContext): string {
  return UPLOAD_RULES[context].bucket
}
