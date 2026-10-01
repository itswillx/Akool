// REL-005: depois de um deploy, uma aba aberta com a versão anterior pede
// chunks que não existem mais no servidor. Todo import() do build passa pelo
// helper de preload do Vite, que dispara `vite:preloadError` quando falha; aqui
// se decide se vale recarregar a página: só quando saiu versão nova (o script
// de entrada do index.html mudou) e no máximo uma vez a cada 30 s, para nunca
// entrar em loop. Falha passageira de rede não recarrega sozinha: o erro chega
// ao ErrorBoundary, que oferece "Recarregar página".

const RELOAD_KEY = 'akool:chunk-reload-at'
const RELOAD_GUARD_MS = 30_000

// Mensagens de import() de chunk que falhou: Chrome, Firefox, Safari e o CSS
// que o helper do Vite pré-carrega.
const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return CHUNK_ERROR_RE.test(message)
}

/** O script de entrada (`/assets/index-<hash>.js`) de um index.html. */
export function entryScriptFromHtml(html: string): string | null {
  for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
    if (!/\btype=["']module["']/i.test(tag)) continue
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)
    if (src) return src[1]
  }
  return null
}

/** Se o servidor já serve outro script de entrada, ou seja, saiu versão nova. */
export async function hasNewVersion(currentEntry: string | null, fetchIndex: () => Promise<string>): Promise<boolean> {
  if (!currentEntry) return false
  try {
    const latest = entryScriptFromHtml(await fetchIndex())
    return latest !== null && latest !== currentEntry
  } catch {
    return false
  }
}

/** Guarda contra loop: reserva o reload automático se o último foi há mais de 30 s. */
export function claimReload(storage: Pick<Storage, 'getItem' | 'setItem'> | null, now = Date.now()): boolean {
  if (!storage) return false
  try {
    const last = Number(storage.getItem(RELOAD_KEY) ?? 0)
    if (Number.isFinite(last) && now - last < RELOAD_GUARD_MS) return false
    storage.setItem(RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

function sessionStorageOf(win: Window): Storage | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

/** Liga o listener do Vite. Chamado uma vez, no main.tsx. */
export function installChunkReload(win: Window, indexUrl: string): void {
  let checking = false
  win.addEventListener('vite:preloadError', () => {
    // Um chunk com várias dependências dispara vários eventos seguidos.
    if (checking) return
    checking = true
    const current = win.document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null
    const fetchIndex = async () => {
      const res = await win.fetch(indexUrl, { cache: 'no-store' })
      if (!res.ok) throw new Error(`index.html: HTTP ${res.status}`)
      return res.text()
    }
    void hasNewVersion(current, fetchIndex)
      .then(isNew => {
        if (isNew && claimReload(sessionStorageOf(win))) win.location.reload()
      })
      .finally(() => { checking = false })
  })
}
