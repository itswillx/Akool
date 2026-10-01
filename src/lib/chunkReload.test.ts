import { describe, expect, it, vi } from 'vitest'
import { claimReload, entryScriptFromHtml, hasNewVersion, installChunkReload, isChunkLoadError } from './chunkReload'

const BUILT_INDEX = `<!doctype html><html><head>
<script>document.documentElement.dataset.theme = localStorage.theme</script>
<script type="module" crossorigin src="/assets/index-CfABH_yW.js"></script>
<link rel="modulepreload" crossorigin href="/assets/chunk-a.js">
</head><body><div id="root"></div></body></html>`

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/Dashboard-a1.js', // Chrome
    'error loading dynamically imported module: https://x/assets/Dashboard-a1.js', // Firefox
    'Importing a module script failed.', // Safari
    'Unable to preload CSS for /assets/finance-b2.css', // helper do Vite
  ])('reconhece %j', message => {
    expect(isChunkLoadError(new Error(message))).toBe(true)
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('não confunde com erro comum', () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'id')"))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true)
  })
})

describe('entryScriptFromHtml', () => {
  it('acha o script de entrada do build, ignorando o script inline', () => {
    expect(entryScriptFromHtml(BUILT_INDEX)).toBe('/assets/index-CfABH_yW.js')
  })

  it('aceita os atributos em outra ordem e com aspas simples', () => {
    expect(entryScriptFromHtml(`<script src='/assets/index-x.js' type='module'></script>`)).toBe('/assets/index-x.js')
  })

  it('devolve null sem script de módulo', () => {
    expect(entryScriptFromHtml('<script src="/legacy.js"></script>')).toBeNull()
    expect(entryScriptFromHtml('')).toBeNull()
  })
})

describe('hasNewVersion', () => {
  it('só é true quando o servidor serve outro script de entrada', async () => {
    expect(await hasNewVersion('/assets/index-old.js', async () => BUILT_INDEX)).toBe(true)
    expect(await hasNewVersion('/assets/index-CfABH_yW.js', async () => BUILT_INDEX)).toBe(false)
  })

  it('falha de rede, HTML sem script ou página sem entrada contam como "não"', async () => {
    expect(await hasNewVersion('/assets/index-old.js', async () => { throw new Error('offline') })).toBe(false)
    expect(await hasNewVersion('/assets/index-old.js', async () => '<html></html>')).toBe(false)
    expect(await hasNewVersion(null, async () => BUILT_INDEX)).toBe(false)
  })
})

function memoryStorage() {
  const map = new Map<string, string>()
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) }
}

describe('claimReload', () => {
  it('libera um reload e trava os próximos 30 s', () => {
    const storage = memoryStorage()
    expect(claimReload(storage, 1_000_000)).toBe(true)
    expect(claimReload(storage, 1_000_000 + 29_999)).toBe(false)
    expect(claimReload(storage, 1_000_000 + 30_000)).toBe(true)
  })

  it('sem storage (ou storage que lança) não recarrega, para nunca entrar em loop', () => {
    expect(claimReload(null)).toBe(false)
    const broken = { getItem: () => { throw new Error('SecurityError') }, setItem: () => {} }
    expect(claimReload(broken)).toBe(false)
  })
})

describe('installChunkReload', () => {
  function fakeWindow(serverIndex: () => Promise<string>) {
    const target = new EventTarget()
    const reload = vi.fn()
    const fetch = vi.fn(async () => new Response(await serverIndex()))
    const storage = memoryStorage()
    const win = {
      addEventListener: target.addEventListener.bind(target),
      document: { querySelector: () => ({ getAttribute: () => '/assets/index-old.js' }) },
      fetch,
      location: { reload },
      sessionStorage: storage,
    } as unknown as Window
    const fire = () => target.dispatchEvent(new Event('vite:preloadError'))
    return { win, fire, reload, fetch }
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  it('recarrega uma vez quando saiu versão nova', async () => {
    const { win, fire, reload, fetch } = fakeWindow(async () => BUILT_INDEX)
    installChunkReload(win, '/')
    fire()
    fire() // eventos seguidos do mesmo chunk: uma checagem só
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('/', { cache: 'no-store' })
    expect(reload).toHaveBeenCalledTimes(1)

    fire() // falhou de novo logo depois do reload: a guarda segura
    await settle()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('não recarrega em falha passageira (mesma versão ou servidor fora)', async () => {
    const same = fakeWindow(async () => BUILT_INDEX.replace('index-CfABH_yW', 'index-old'))
    installChunkReload(same.win, '/')
    same.fire()
    await settle()
    expect(same.reload).not.toHaveBeenCalled()

    const offline = fakeWindow(async () => { throw new Error('offline') })
    installChunkReload(offline.win, '/')
    offline.fire()
    await settle()
    expect(offline.reload).not.toHaveBeenCalled()
  })
})
