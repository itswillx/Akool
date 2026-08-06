import { useCallback, useEffect, useState } from 'react'

// Preferências de visualização de um board, persistidas por `storageKey`.
// Cada board tem o seu namespace, então esconder "Cancelada" nas Vendas não
// esconde nada nas Etapas.

export type BoardView = 'kanban' | 'list'

function isView(value: unknown): value is BoardView {
  return value === 'kanban' || value === 'list'
}

/** Lê um JSON do localStorage tolerando lixo — um valor podre não pode derrubar a aba. */
function readJson<T>(key: string, fallback: T, guard: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as unknown
    return guard(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(i => typeof i === 'string')

export interface BoardPrefs {
  /** O que renderizar AGORA (já com o override de mobile aplicado). */
  view: BoardView
  setView: (v: BoardView) => void
  hidden: Set<string>
  toggleColumn: (columnId: string) => void
  sortId: string | null
  setSortId: (id: string | null) => void
}

/**
 * @param storageKey namespace, ex.: 'finance_board_sales'
 * @param isMobile   força a lista sem sobrescrever a preferência gravada
 * @param defaultHidden colunas que nascem escondidas (ex.: 'cancelled')
 */
export function useBoardPrefs(
  storageKey: string,
  isMobile: boolean,
  defaultHidden: string[] = [],
): BoardPrefs {
  const viewKey = `${storageKey}:view`
  const hiddenKey = `${storageKey}:hidden`
  const sortKey = `${storageKey}:sort`

  // Kanban é o padrão (decisão de produto): a visão de etapas é o motivo do
  // board existir, a lista é o fallback.
  const [stored, setStored] = useState<BoardView>(() => {
    const raw = localStorage.getItem(viewKey)
    return isView(raw) ? raw : 'kanban'
  })
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(readJson(hiddenKey, defaultHidden, isStringArray)),
  )
  const [sortId, setSortId] = useState<string | null>(() => localStorage.getItem(sortKey))

  useEffect(() => { localStorage.setItem(viewKey, stored) }, [viewKey, stored])
  useEffect(() => { localStorage.setItem(hiddenKey, JSON.stringify([...hidden])) }, [hiddenKey, hidden])
  useEffect(() => {
    if (sortId === null) localStorage.removeItem(sortKey)
    else localStorage.setItem(sortKey, sortId)
  }, [sortKey, sortId])

  const toggleColumn = useCallback((columnId: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(columnId)) next.delete(columnId)
      else next.add(columnId)
      return next
    })
  }, [])

  // Colunas lado a lado não cabem em 375px, e o DnD conflita com o scroll. O
  // valor gravado NÃO é sobrescrito: voltar ao desktop devolve o kanban.
  return {
    view: isMobile ? 'list' : stored,
    setView: setStored,
    hidden,
    toggleColumn,
    sortId,
    setSortId,
  }
}
