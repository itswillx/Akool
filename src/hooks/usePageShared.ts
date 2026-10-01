import { useEffect, useMemo, useState } from 'react'
import type { Page } from '../types'
import { supabase } from '../lib/supabase'
import { usePages } from '../contexts/PagesContext'

const noop = () => {}

/** Ids da página e dos ancestrais, da própria para a raiz ([pageId] se não achar). */
export function pageLineageIds(tree: Page[], pageId: string): string[] {
  const path: string[] = []
  const walk = (nodes: Page[]): boolean => {
    for (const node of nodes) {
      path.push(node.id)
      if (node.id === pageId || (node.children?.length && walk(node.children))) return true
      path.pop()
    }
    return false
  }
  return walk(tree) ? path.reverse() : [pageId]
}

/**
 * PERF-008: a página tem mais alguém? `is_shared` só marca o que foi
 * compartilhado comigo. A página minha que eu compartilhei (ou subpágina dela,
 * que herda o compartilhamento) só aparece em page_shares: uma consulta ao
 * abrir, e de novo quando `recheck` muda (o PageHeader passa o modal de
 * compartilhar, para valer logo depois de compartilhar).
 */
export function usePageShared(page: Page, recheck: unknown): boolean {
  const { pages } = usePages()
  const lineage = useMemo(
    () => (page.is_shared ? '' : pageLineageIds(pages, page.id).join(',')),
    [pages, page.id, page.is_shared],
  )
  const [result, setResult] = useState<{ lineage: string; shared: boolean } | null>(null)

  useEffect(() => {
    if (!lineage) return
    let cancelled = false
    supabase
      .from('page_shares')
      .select('page_id', { count: 'exact', head: true })
      .in('page_id', lineage.split(','))
      .then(({ count, error }) => {
        if (!cancelled && !error) setResult({ lineage, shared: (count ?? 0) > 0 })
      }, noop)
    return () => { cancelled = true }
  }, [lineage, recheck])

  if (page.is_shared) return true
  return result?.lineage === lineage && result.shared
}
