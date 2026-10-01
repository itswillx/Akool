// REL-011: erros de produção no Sentry. Sem VITE_SENTRY_DSN no build o SDK nem
// entra no bundle (o import dinâmico fica atrás de uma constante de build) e
// tudo aqui vira no-op. Com o DSN: sem PII (sendDefaultPii off, scrub em cada
// evento e breadcrumb, usuário só com o id), sem tracing, e erros de antes do
// SDK carregar ficam numa fila curta.
import type { Breadcrumb, ErrorEvent } from '@sentry/react'
import { scrubDeep } from '../../supabase/functions/_shared/scrub'

export type ObservabilityStatus = 'off' | 'loading' | 'on' | 'failed'

/** O pedaço do SDK que o app usa (facilita o teste com um SDK falso). */
export interface SentryLike {
  init(options: Record<string, unknown>): unknown
  captureException(error: unknown, hint?: { extra?: Record<string, unknown> }): string
  captureMessage(message: string, level?: 'info' | 'warning' | 'error'): string
  setUser(user: { id: string } | null): void
}

const MAX_QUEUE = 20

/** Evento sem PII. O usuário fica só com o id; IP, e-mail e cookies saem. */
export function scrubEvent<T extends ErrorEvent>(event: T): T {
  const clean = scrubDeep(event)
  if (clean.user) clean.user = clean.user.id ? { id: String(clean.user.id) } : undefined
  if (clean.request) {
    delete clean.request.cookies
    delete clean.request.headers
  }
  return clean
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Console pode ter qualquer coisa (payloads inteiros): fica de fora.
  if (crumb.category === 'console') return null
  return scrubDeep(crumb)
}

export function createObservability(options: {
  dsn: string
  release: string
  environment: string
  loadSdk: () => Promise<SentryLike>
}) {
  let status: ObservabilityStatus = options.dsn ? 'loading' : 'off'
  let sdk: SentryLike | null = null
  const queue: { error: unknown; context?: Record<string, unknown> }[] = []

  const ready = options.dsn
    ? options.loadSdk().then(loaded => {
      loaded.init({
        dsn: options.dsn,
        release: options.release || undefined,
        environment: options.environment,
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      })
      sdk = loaded
      status = 'on'
      for (const item of queue.splice(0)) loaded.captureException(item.error, { extra: item.context })
    }).catch(() => {
      // Sem Sentry (bloqueador de anúncio, rede) o app segue igual.
      status = 'failed'
      queue.length = 0
    })
    : Promise.resolve()

  return {
    ready,
    status: () => status,
    reportError(error: unknown, context?: Record<string, unknown>) {
      if (sdk) sdk.captureException(error, { extra: context })
      else if (status === 'loading' && queue.length < MAX_QUEUE) queue.push({ error, context })
    },
    setUser(id: string | null) {
      sdk?.setUser(id ? { id } : null)
    },
    /** Para o admin conferir a configuração (painel de auditoria). */
    sendTestEvent(): boolean {
      if (!sdk) return false
      sdk.captureMessage('Akool: evento de teste do painel de auditoria', 'info')
      return true
    },
  }
}

type Observability = ReturnType<typeof createObservability>

let instance: Observability | null = null

/** Liga o Sentry do app. Chamado uma vez, no main.tsx. */
export function initObservability(): void {
  if (instance) return
  instance = createObservability({
    dsn: __SENTRY_DSN__,
    release: __APP_RELEASE__,
    environment: import.meta.env.MODE,
    // Constante de build: sem DSN o ramo some e o SDK não é empacotado. Só as 4
    // funções usadas: com o namespace inteiro, Replay, Feedback e tracing iam
    // junto para o chunk.
    loadSdk: async () => {
      if (!__SENTRY_DSN__) throw new Error('sem DSN')
      const { init, captureException, captureMessage, setUser } = await import('@sentry/react')
      return { init, captureException, captureMessage, setUser }
    },
  })
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  instance?.reportError(error, context)
}

export function setObservabilityUser(id: string | null): void {
  instance?.setUser(id)
}

export function observabilityStatus(): ObservabilityStatus {
  return instance?.status() ?? 'off'
}

export function sendTestEvent(): boolean {
  return instance?.sendTestEvent() ?? false
}
