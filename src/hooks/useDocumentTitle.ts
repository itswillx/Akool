import { useEffect } from 'react'

const APP_NAME = 'Akool'

/**
 * UX-006: título da aba por seção ("Finanças · Akool"), para distinguir abas
 * e para o leitor de tela anunciar onde se está. Volta a "Akool" ao desmontar
 * (sair da conta).
 */
export function useDocumentTitle(section: string | null | undefined) {
  useEffect(() => {
    document.title = section ? `${section} · ${APP_NAME}` : APP_NAME
    return () => { document.title = APP_NAME }
  }, [section])
}
