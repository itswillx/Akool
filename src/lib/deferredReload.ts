// REL-010: recarga do quadro disparada pelo realtime. Uma rajada de eventos
// (mover um card grava a ordem de vários) vira uma recarga só, depois de
// `delayMs`. Enquanto algo local estiver em andamento (um card na mão, ou a
// ordem do drop ainda sendo gravada), a recarga espera: recarregar no meio
// puxaria o card da mão ou traria de volta a ordem antiga.

export interface DeferredReload {
  /** Chegou um evento: agenda (ou reagenda) a recarga. */
  trigger(): void
  /** O bloqueio acabou: se uma recarga ficou esperando, roda agora. */
  release(): void
  /** Desmontou ou trocou de quadro: esquece o que estava agendado. */
  cancel(): void
}

export function createDeferredReload({ delayMs, reload, isBlocked }: {
  delayMs: number
  reload: () => void
  isBlocked: () => boolean
}): DeferredReload {
  let timer: ReturnType<typeof setTimeout> | null = null
  let waiting = false

  const fire = () => {
    timer = null
    if (isBlocked()) { waiting = true; return }
    waiting = false
    reload()
  }

  return {
    trigger() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(fire, delayMs)
    },
    release() {
      if (!waiting || timer || isBlocked()) return
      waiting = false
      reload()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      waiting = false
    },
  }
}
