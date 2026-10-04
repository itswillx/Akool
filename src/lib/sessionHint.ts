// Pista de que há sessão guardada do Supabase (chave `sb-<ref>-auth-token`):
// com ela, quem abre o app provavelmente vai direto para dentro e não precisa
// do chunk das telas de entrada; sem ela, o App pede esse chunk já no boot, em
// paralelo com a checagem de sessão. Só o nome da chave é lido, nunca o valor.
const SESSION_KEY = /^sb-.*-auth-token$/

export function hasStoredSession(storage: Pick<Storage, 'length' | 'key'> | null = readLocalStorage()): boolean {
  if (!storage) return false
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && SESSION_KEY.test(key)) return true
  }
  return false
}

function readLocalStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
