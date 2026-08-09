import { useCallback, useEffect, useState } from 'react'
import type { Page } from '../../types'
import { fetchDocsGraphData, type DocsGraphRemote } from '../../lib/docsGraphData'
import type { DocsGraphSource } from '../../lib/docsGraph'
import { useAuth } from '../../contexts/AuthContext'
import { useQuickNotes } from '../../hooks/useQuickNotes'

// Casca fina sobre fetchDocsGraphData + useQuickNotes. As páginas chegam por
// prop (o DocumentsPanel já achata a árvore do PagesContext), então este hook
// só busca o que falta.
//
// Nada aqui é realtime: o kanban pode mudar noutra aba, por isso o `reload`
// exposto vira um botão na barra de filtros.

const EMPTY: DocsGraphRemote = {
  boards: [], columns: [], cards: [], pageShares: [], boardShares: [], profiles: new Map(),
}

export function useDocsGraphData(pages: Page[]): {
  source: DocsGraphSource
  loading: boolean
  error: boolean
  reload: () => void
} {
  const { user } = useAuth()
  const { notes } = useQuickNotes(user?.id)
  const [remote, setRemote] = useState<DocsGraphRemote>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  // Chaveado pelos ids das páginas (string), não pelo array: o PagesContext
  // remonta a árvore a cada refresh e uma nova referência dispararia um
  // recarregamento inteiro sem nada ter mudado.
  const pageKey = pages.map(p => p.id).join(',')
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    let active = true
    setLoading(true)
    setError(false)
    fetchDocsGraphData(userId, pageKey ? pageKey.split(',') : [])
      .then(data => {
        if (!active) return
        setRemote(data)
        setLoading(false)
      })
      .catch(() => {
        if (!active) return
        setError(true)
        setLoading(false)
      })
    return () => { active = false }
  }, [userId, pageKey, nonce])

  const reload = useCallback(() => setNonce(n => n + 1), [])

  return {
    source: { ...remote, pages, notes },
    loading,
    error,
    reload,
  }
}
