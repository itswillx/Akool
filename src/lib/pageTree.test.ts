import { describe, expect, it } from 'vitest'
import { buildTree, findPage, flattenTree, reconcileTree } from './pageTree'
import type { Page } from '../types'

const page = (id: string, parent_id: string | null = null, extra: Partial<Page> = {}): Page => ({
  id, user_id: 'me', title: id, icon: '', type: 'note', parent_id, sort_order: 0,
  is_favorite: false, created_at: '', updated_at: 't0', ...extra,
})

const flat = () => [page('a'), page('a1', 'a'), page('a2', 'a'), page('b')]

describe('buildTree', () => {
  it('nests children under their parent and keeps orphans as roots', () => {
    const tree = buildTree([...flat(), page('x', 'missing')])
    expect(tree.map(p => p.id)).toEqual(['a', 'b', 'x'])
    expect(tree[0].children?.map(p => p.id)).toEqual(['a1', 'a2'])
  })
})

describe('reconcileTree (PERF-007)', () => {
  it('gives back the same objects when nothing changed', () => {
    const prev = buildTree(flat())
    const next = buildTree(flat())
    expect(reconcileTree(prev, next)).toBe(prev)
  })

  it('a rename creates new objects only on the path to the changed page', () => {
    const prev = buildTree(flat())
    const next = buildTree([page('a'), page('a1', 'a', { title: 'renamed', updated_at: 't1' }), page('a2', 'a'), page('b')])
    const out = reconcileTree(prev, next)
    expect(out).not.toBe(prev)
    expect(out[1]).toBe(prev[1])                                  // b: intocada
    expect(out[0]).not.toBe(prev[0])                              // a: filho mudou
    expect(out[0].children?.[1]).toBe(prev[0].children?.[1])      // a2: intocada
    expect(out[0].children?.[0].title).toBe('renamed')
  })

  it('a new page appears without touching unrelated nodes', () => {
    const prev = buildTree(flat())
    const out = reconcileTree(prev, buildTree([...flat(), page('c')]))
    expect(out.map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(out[0]).toBe(prev[0])
    expect(out[1]).toBe(prev[1])
  })
})

describe('findPage / flattenTree', () => {
  it('finds a page at any depth in any tree', () => {
    const own = buildTree(flat())
    const shared = buildTree([page('s'), page('s1', 's')])
    expect(findPage([own, shared], 's1')?.id).toBe('s1')
    expect(findPage([own, shared], 'zz')).toBeNull()
    expect(flattenTree(own).map(p => p.id)).toEqual(['a', 'a1', 'a2', 'b'])
  })
})
