import { LOCAL_KEYS } from './localKeys'

// O ThemeProvider só monta depois do login e nunca tira a classe `dark`: sem
// isto, a página pública abria clara num carregamento novo e escura depois de
// sair. Roda no boot (main.tsx), antes do primeiro paint, para as telas de
// entrada (landing, login, MFA, redefinição) já nascerem no tema do aparelho,
// sem o flash claro → escuro da transição do body.

export type StoredTheme = 'light' | 'dark'

export function readStoredTheme(): StoredTheme {
  try {
    return localStorage.getItem(LOCAL_KEYS.theme) === 'dark' ? 'dark' : 'light'
  } catch {
    // Sem storage (modo privado restrito): tema claro.
    return 'light'
  }
}

export function applyStoredTheme(doc: Document = document): void {
  doc.documentElement.classList.toggle('dark', readStoredTheme() === 'dark')
}
