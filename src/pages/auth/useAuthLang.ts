import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { LOCAL_KEYS } from '../../lib/localKeys'
import { getT, isLangLoaded, loadLang, subscribeLangs, toLang } from '../../i18n/translations'
import type { Lang } from '../../i18n/translations'
import type { Translate } from './authView'

// Idioma das telas de entrada (landing, login, MFA, redefinição): o escolhido
// no seletor PT/EN, guardado na mesma chave que o AuthContext grava a partir
// do perfil, então o authT() das mensagens de login e o LanguageProvider
// (depois de entrar) seguem a escolha.

function readStoredLang(): Lang {
  try {
    return toLang(localStorage.getItem(LOCAL_KEYS.authLang))
  } catch {
    return 'pt-BR'
  }
}

function storeLang(lang: Lang) {
  try {
    localStorage.setItem(LOCAL_KEYS.authLang, lang)
  } catch {
    // Sem storage (modo privado restrito): o idioma vale só nesta visita.
  }
}

export function useAuthLang(): { lang: Lang; uiLang: Lang; t: Translate; changeLang: (lang: Lang) => void } {
  const [lang, setLang] = useState<Lang>(readStoredLang)
  // PERF-009: o inglês chega por download; até lá a tela inteira fica em pt-BR
  // (texto e rótulos no mesmo idioma, nunca misturados).
  const loaded = useSyncExternalStore(subscribeLangs, () => isLangLoaded(lang))
  const uiLang: Lang = loaded ? lang : 'pt-BR'
  const t = useMemo(() => getT(uiLang), [uiLang])
  useEffect(() => { if (!loaded) loadLang(lang).catch(() => {}) }, [lang, loaded])
  // UX-006: leitor de tela e tradutor do navegador leem o idioma daqui.
  useEffect(() => { document.documentElement.lang = uiLang }, [uiLang])
  const changeLang = useCallback((next: Lang) => {
    storeLang(next)
    setLang(next)
  }, [])
  return { lang, uiLang, t, changeLang }
}
