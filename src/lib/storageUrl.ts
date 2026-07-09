import { supabase } from './supabase'

// Buckets migrados para privados (SEC): a leitura passa a exigir signed URLs.
// O que fica persistido no banco pode ser tanto o path novo (ex.: "uid/123.jpg")
// quanto uma URL publica antiga; ambos sao resolvidos aqui.

// Extrai o path do objeto a partir de um valor armazenado (path cru ou URL
// publica/assinada antiga). Retorna null se nao for possivel determinar.
export function extractStoragePath(bucket: string, stored: string): string | null {
  if (!stored) return null
  // Previews locais (FileReader / URL.createObjectURL) nao sao objetos de storage.
  if (/^(data|blob):/i.test(stored)) return null
  if (!/^https?:\/\//i.test(stored)) {
    // Ja e' um path; remove barra inicial e prefixo de bucket duplicado.
    return stored.replace(/^\/+/, '').replace(new RegExp(`^${bucket}/`), '')
  }
  // URL publica: .../storage/v1/object/public/<bucket>/<path>
  // URL assinada: .../storage/v1/object/sign/<bucket>/<path>?token=...
  const marker = new RegExp(`/storage/v1/object/(?:public|sign)/${bucket}/([^?]+)`)
  const m = stored.match(marker)
  if (m) return decodeURIComponent(m[1])
  return null
}

const cache = new Map<string, { url: string; exp: number }>()

// Resolve um valor armazenado para uma signed URL utilizavel (com cache em
// memoria enquanto valida). expiresIn em segundos.
export async function resolveSignedUrl(
  bucket: string,
  stored: string,
  expiresIn = 3600,
): Promise<string> {
  const path = extractStoragePath(bucket, stored)
  if (!path) return stored // fallback: devolve o valor original
  const key = `${bucket}/${path}`
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && hit.exp > now + 60_000) return hit.url
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) return stored
  cache.set(key, { url: data.signedUrl, exp: now + expiresIn * 1000 })
  return data.signedUrl
}
