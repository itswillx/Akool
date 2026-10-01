import { supabase } from './supabase'
import { clearSignedUrlCache } from './storageUrl'
import { KEEP_ON_SIGN_OUT } from './localKeys'

// SEC-017: no logout, nada do usuário fica no navegador para quem usar o
// mesmo computador depois. Apaga TUDO do localStorage menos as chaves abaixo
// (lista de exceções, e não de chaves: chave nova nunca escapa), limpa o
// sessionStorage (rascunhos de card), o cache de signed URLs e fecha os
// canais de realtime.

// QA-006: o que sobrevive ao logout vem do inventário de chaves (localKeys.ts).
export { KEEP_ON_SIGN_OUT } from './localKeys'

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
