import { supabase } from './supabase'
import { SUPABASE_URL } from './env'

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

/**
 * SEC-014: o que não é objeto do bucket só passa se não sair do navegador nem
 * do projeto: prévia local (`data:`/`blob:`) ou URL do próprio Supabase. URL
 * de terceiros vira vazio — senão, uma imagem externa num avatar, nota ou
 * anexo entregaria IP, navegador e horário de quem abre a quem a hospeda.
 */
export function passThrough(stored: string): string {
  if (/^(data|blob):/i.test(stored)) return stored
  try {
    if (SUPABASE_URL && new URL(stored).host === new URL(SUPABASE_URL).host) return stored
  } catch { /* não é URL: um path de outro bucket, por exemplo */ return stored }
  return /^https?:\/\//i.test(stored) ? '' : stored
}

// SEC-017: arquivos financeiros (comprovantes, extratos, Loja, empréstimos,
// despesas de projeto) valem 5 min; o resto, 1 h. Um link vazado ou deixado
// numa aba aberta deixa de funcionar logo.
export const SHORT_LIVED_BUCKETS = new Set(['transaction-photos', 'store-files', 'bank-statements', 'loan-files', 'project-expense-files'])

export function defaultExpiresIn(bucket: string): number {
  return SHORT_LIVED_BUCKETS.has(bucket) ? 300 : 3600
}

/** SEC-017: no logout, nenhuma signed URL do usuário anterior fica em memória. */
export function clearSignedUrlCache(): void {
  cache.clear()
  inflight.clear()
}

// PERF-014: o mesmo avatar em 10 lugares disparava 10 createSignedUrl ao
// mesmo tempo. Agora quem pede um arquivo que já está a caminho recebe a mesma
// promise, e os pedidos de um bucket feitos no mesmo "tick" (uma lista que
// renderiza de uma vez) viram uma chamada createSignedUrls.
const inflight = new Map<string, Promise<string>>()

interface PendingSign { path: string; stored: string; resolve: (url: string) => void }
const batches = new Map<string, { bucket: string; expiresIn: number; items: PendingSign[] }>()

/** Entradas vencidas saem quando o cache cresce (o logout limpa tudo). */
function remember(key: string, url: string, exp: number): void {
  cache.set(key, { url, exp })
  if (cache.size <= 200) return
  const now = Date.now()
  for (const [k, v] of cache) if (v.exp <= now) cache.delete(k)
}

async function signBatch(bucket: string, expiresIn: number, items: PendingSign[]): Promise<void> {
  const now = Date.now()
  try {
    if (items.length === 1) {
      const [item] = items
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(item.path, expiresIn)
      if (error || !data?.signedUrl) { item.resolve(item.stored); return }
      remember(`${bucket}/${item.path}`, data.signedUrl, now + expiresIn * 1000)
      item.resolve(data.signedUrl)
      return
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(items.map(i => i.path), expiresIn)
    if (error || !data) { for (const i of items) i.resolve(i.stored); return }
    const byPath = new Map(data.map(d => [d.path, d]))
    for (const item of items) {
      const signed = byPath.get(item.path)
      if (signed?.signedUrl && !signed.error) {
        remember(`${bucket}/${item.path}`, signed.signedUrl, now + expiresIn * 1000)
        item.resolve(signed.signedUrl)
      } else {
        item.resolve(item.stored)
      }
    }
  } catch {
    // Falha de rede: o mesmo de antes (o valor guardado, que vira uma imagem
    // quebrada, e não uma exceção na tela).
    for (const i of items) i.resolve(i.stored)
  }
}

function enqueueSign(bucket: string, expiresIn: number, item: PendingSign): void {
  const key = `${bucket}|${expiresIn}`
  const batch = batches.get(key)
  if (batch) { batch.items.push(item); return }
  batches.set(key, { bucket, expiresIn, items: [item] })
  queueMicrotask(() => {
    const ready = batches.get(key)
    batches.delete(key)
    if (ready) void signBatch(ready.bucket, ready.expiresIn, ready.items)
  })
}

// Resolve um valor armazenado para uma signed URL utilizavel (com cache em
// memoria enquanto valida). expiresIn em segundos.
export async function resolveSignedUrl(
  bucket: string,
  stored: string,
  expiresIn = defaultExpiresIn(bucket),
): Promise<string> {
  const path = extractStoragePath(bucket, stored)
  if (!path) return passThrough(stored)
  const key = `${bucket}/${path}`
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now() + 60_000) return hit.url
  const running = inflight.get(key)
  if (running) return running
  const promise = new Promise<string>(resolve => enqueueSign(bucket, expiresIn, { path, stored, resolve }))
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
