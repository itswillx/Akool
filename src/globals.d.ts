// Constantes de build (vite.config.ts → define). REL-011.

/** DSN do Sentry no build (VITE_SENTRY_DSN); '' desliga o SDK, que nem entra no bundle. */
declare const __SENTRY_DSN__: string
/** Versão do build (SOURCE_COMMIT do Coolify ou SENTRY_RELEASE); '' quando não há. */
declare const __APP_RELEASE__: string
/** Onde o app serve as fontes do Excalidraw (SEC-009): /excalidraw-assets/<versão>/. */
declare const __EXCALIDRAW_ASSET_PATH__: string

interface Window {
  /** Lido pelo Excalidraw ao carregar fontes; sem ele, ele busca no CDN esm.sh. */
  EXCALIDRAW_ASSET_PATH?: string | string[]
}
