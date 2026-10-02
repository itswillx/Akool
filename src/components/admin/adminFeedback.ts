import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { ADMIN_OPS_ERROR_KEYS } from '../../lib/data/admin'

// ARCH-008: a faixa de feedback do painel de admin (some sozinha em 3,5 s),
// partilhada pelas abas de usuários e convites.

export interface AdminFeedbackMessage { type: 'success' | 'error'; msg: string }

export function useAdminFeedback() {
  const { t } = useLanguage()
  const [feedback, setFeedback] = useState<AdminFeedbackMessage | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const showFeedback = useCallback((type: 'success' | 'error', msg: string) => {
    setFeedback({ type, msg })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setFeedback(null), 3500)
  }, [])

  /** Erro da edge admin-ops: os conhecidos saem traduzidos, o resto como veio. */
  const showOpsError = useCallback((msg: string) => {
    const key = ADMIN_OPS_ERROR_KEYS[msg]
    showFeedback('error', key ? t(key) : msg)
  }, [showFeedback, t])

  return { feedback, showFeedback, showOpsError }
}

export type AdminFeedback = ReturnType<typeof useAdminFeedback>
