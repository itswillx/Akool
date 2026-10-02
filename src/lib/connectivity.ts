import { useSyncExternalStore } from 'react'

// REL-012: estado da conexão, pelos eventos `online`/`offline` do navegador
// (navigator.onLine). Pequeno de propósito: entra no boot para o banner.

export function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** Avisa a cada mudança (online ou offline); devolve a função de cancelar. */
export function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** Chama `onBack` só quando a conexão volta (offline → online). */
export function onReconnect(onBack: () => void): () => void {
  let was = isOnline()
  return subscribeOnline(() => {
    const now = isOnline()
    if (now && !was) onBack()
    was = now
  })
}

const alwaysOnline = () => true

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, isOnline, alwaysOnline)
}
