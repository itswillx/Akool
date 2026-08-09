import { describe, it, expect } from 'vitest'
import {
  applySearch, applyValueFilter, capGraph, degreeMap, dropIsolated,
  graphValueBounds, neighborsOf, normalizeSearch,
  type GraphEdgeBase, type GraphNodeBase,
} from './graph'

const node = (id: string, label: string, value: number): GraphNodeBase => ({
  id, kind: 'thing', refId: id, label, icon: '🔵', color: '#3b82f6', value,
})
const edge = (a: string, b: string, weight: number): GraphEdgeBase => ({
  id: `${a}|${b}`, source: a, target: b, weight, kind: 'link',
})

// a—b (peso 5), a—c (peso 9); d é isolado.
const graph = {
  nodes: [node('a', 'Saúde', 100), node('b', 'Mercado', 40), node('c', 'Salário', 300), node('d', 'Sozinho', 10)],
  edges: [edge('a', 'b', 5), edge('a', 'c', 9)],
}

describe('normalizeSearch', () => {
  it('strips accents and case', () => {
    expect(normalizeSearch('  SAÚDE ')).toBe('saude')
    expect(normalizeSearch('Ação')).toBe('acao')
  })
})

describe('graphValueBounds', () => {
  it('returns min/max of node values', () => {
    expect(graphValueBounds(graph)).toEqual({ min: 10, max: 300 })
  })
  it('returns zeros for an empty graph', () => {
    expect(graphValueBounds({ nodes: [], edges: [] })).toEqual({ min: 0, max: 0 })
  })
})

describe('applyValueFilter', () => {
  it('drops nodes outside the range and orphaned edges', () => {
    const out = applyValueFilter(graph, 50, null)
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'c'])
    expect(out.edges.map(e => e.id)).toEqual(['a|c']) // a|b perdeu b
  })
  it('treats a null max as no ceiling and returns the same object when nothing is cut', () => {
    expect(applyValueFilter(graph, 0, null)).toBe(graph)
  })
  it('honours an explicit max', () => {
    expect(applyValueFilter(graph, 0, 100).nodes.map(n => n.id)).toEqual(['a', 'b', 'd'])
  })
})

describe('applySearch', () => {
  it('keeps matches plus direct neighbors, flagging only the neighbors', () => {
    const out = applySearch(graph, 'saude')
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(out.nodes.find(n => n.id === 'a')!.dimmed).toBeUndefined()
    expect(out.nodes.find(n => n.id === 'b')!.dimmed).toBe(true)
    expect(out.nodes.find(n => n.id === 'd')).toBeUndefined()
  })
  it('is a no-op for a blank term', () => {
    expect(applySearch(graph, '   ')).toBe(graph)
  })
})

describe('neighborsOf', () => {
  it('returns neighbors heaviest first', () => {
    expect(neighborsOf(graph, 'a').map(n => n.node.id)).toEqual(['c', 'b'])
  })
  it('returns nothing for an isolated node', () => {
    expect(neighborsOf(graph, 'd')).toEqual([])
  })
})

describe('degreeMap', () => {
  it('counts incident edges, zero included', () => {
    const deg = degreeMap(graph)
    expect(deg.get('a')).toBe(2)
    expect(deg.get('b')).toBe(1)
    expect(deg.get('d')).toBe(0)
  })
})

describe('dropIsolated', () => {
  it('removes zero-degree nodes and keeps every edge', () => {
    const out = dropIsolated(graph)
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(out.edges).toEqual(graph.edges)
  })
  it('is a no-op when nothing is isolated', () => {
    const dense = { nodes: [node('a', 'A', 1), node('b', 'B', 1)], edges: [edge('a', 'b', 1)] }
    expect(dropIsolated(dense)).toBe(dense)
  })
})

describe('capGraph', () => {
  it('is a no-op when the graph already fits', () => {
    expect(capGraph(graph, 10)).toBe(graph)
  })
  it('keeps the highest-value nodes, preserving input order', () => {
    const out = capGraph(graph, 2)
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'c']) // 100 e 300, na ordem original
    expect(out.edges.map(e => e.id)).toEqual(['a|c'])
  })
  it('breaks ties by id so the cut is deterministic', () => {
    const tied = {
      nodes: [node('z', 'Z', 5), node('m', 'M', 5), node('a', 'A', 5)],
      edges: [],
    }
    expect(capGraph(tied, 2).nodes.map(n => n.id)).toEqual(['m', 'a'])
    expect(capGraph(tied, 2)).toEqual(capGraph(tied, 2))
  })
})
