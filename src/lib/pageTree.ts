import type { Page } from '../types'

// PERF-007: a árvore de páginas. O refresh reconstruía todos os nós, então o
// memo do PageItem não pegava nem o que não tinha mudado, e toda a árvore
// re-renderizava a cada evento do realtime.

/** Lista plana → árvore (filhos sob o pai; sem pai conhecido vira raiz). */
export function buildTree(flat: Page[]): Page[] {
  const map: Record<string, Page> = {}
  const roots: Page[] = []
  flat.forEach(p => { map[p.id] = { ...p, children: [] } })
  flat.forEach(p => {
    if (p.parent_id && map[p.parent_id]) {
      map[p.parent_id].children!.push(map[p.id])
    } else {
      roots.push(map[p.id])
    }
  })
  return roots
}

export function flattenTree(list: Page[]): Page[] {
  return list.flatMap(p => [p, ...flattenTree(p.children ?? [])])
}

function sameFields(a: Page, b: Page): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  keys.delete('children')
  for (const key of keys) {
    if (a[key as keyof Page] !== b[key as keyof Page]) return false
  }
  return true
}

/**
 * Devolve `next`, mas reaproveitando os objetos de `prev` que não mudaram: o
 * nó antigo volta quando os campos são iguais e os filhos também são os mesmos
 * objetos. Se nada mudou, a própria lista `prev` volta.
 */
export function reconcileTree(prev: Page[], next: Page[]): Page[] {
  const old = new Map(flattenTree(prev).map(p => [p.id, p]))

  const reconcileList = (list: Page[], prevList: Page[] | undefined): Page[] => {
    const out = list.map(node => {
      const before = old.get(node.id)
      const children = reconcileList(node.children ?? [], before?.children)
      if (before && sameFields(before, node) && children === (before.children ?? EMPTY)) return before
      return children === node.children ? node : { ...node, children }
    })
    const same = prevList !== undefined && prevList.length === out.length && out.every((n, i) => n === prevList[i])
    return same ? prevList : (out.length === 0 ? EMPTY : out)
  }

  return reconcileList(next, prev)
}

const EMPTY: Page[] = []

/** A página com esse id em qualquer uma das árvores. */
export function findPage(trees: Page[][], id: string): Page | null {
  for (const tree of trees) {
    const stack = [...tree]
    while (stack.length) {
      const page = stack.pop()!
      if (page.id === id) return page
      if (page.children?.length) stack.push(...page.children)
    }
  }
  return null
}
