import { supabase } from './supabase'
import { clearSignedUrlCache } from './storageUrl'

// SEC-017: no logout, nada do usuário fica no navegador para quem usar o
// mesmo computador depois. Apaga TUDO do localStorage menos as chaves abaixo
// (lista de exceções, e não de chaves: chave nova nunca escapa), limpa o
// sessionStorage (rascunhos de card), o cache de signed URLs e fecha os
// canais de realtime.

/** O que sobrevive ao logout: preferências da tela de login e controle técnico. */
export const KEEP_ON_SIGN_OUT = new Set([
  'excalinotion_auth_lang', // idioma da tela de login
  'excalinotion_theme',     // tema claro/escuro antes do login
  'akool:chunk-reload-at',  // trava contra loop de recarga (chunkReload.ts)
])

export function clearLocalUserData(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!KEEP_ON_SIGN_OUT.has(key)) localStorage.removeItem(key)
    }
  } catch { /* storage bloqueado: nada a limpar */ }
  try { sessionStorage.clear() } catch { /* idem */ }
  clearSignedUrlCache()
  void supabase.removeAllChannels()
}
