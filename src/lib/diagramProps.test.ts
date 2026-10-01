import { describe, expect, it } from 'vitest'
import { parseDiagramProps } from './diagramProps'

describe('parseDiagramProps', () => {
  it('reads the saved elements and view', () => {
    expect(parseDiagramProps('[{"id":"a"}]', '{"zoom":{"value":2}}')).toEqual({
      ok: true, elements: [{ id: 'a' }], appState: { zoom: { value: 2 } },
    })
  })

  it('treats empty props as a new, empty diagram', () => {
    expect(parseDiagramProps('', '')).toEqual({ ok: true, elements: [], appState: {} })
  })

  it('refuses unreadable or non-list elements, so nothing overwrites them', () => {
    expect(parseDiagramProps('[{"id":"a"', '{}')).toEqual({ ok: false })
    expect(parseDiagramProps('{"id":"a"}', '{}')).toEqual({ ok: false })
  })

  it('falls back to the default view when only appState is unreadable', () => {
    expect(parseDiagramProps('[]', 'not json')).toEqual({ ok: true, elements: [], appState: {} })
    expect(parseDiagramProps('[]', '[1]')).toEqual({ ok: true, elements: [], appState: {} })
  })
})
