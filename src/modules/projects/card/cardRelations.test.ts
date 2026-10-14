import { describe, expect, it } from 'vitest'
import { dependentIds, descendantIds } from './cardRelations'

describe('relações que fechariam ciclo', () => {
  it('descendentes seguem o parent_card_id em qualquer profundidade', () => {
    const cards = [
      { id: 'a', parent_card_id: null }, { id: 'b', parent_card_id: 'a' },
      { id: 'c', parent_card_id: 'b' }, { id: 'd', parent_card_id: null },
    ]
    expect([...descendantIds('a', cards)].sort()).toEqual(['b', 'c'])
    expect(descendantIds('d', cards).size).toBe(0)
  })

  it('dependentes seguem depends_on ao contrário, sem travar em ciclo antigo', () => {
    const cards = [
      { id: 'a', depends_on: [] }, { id: 'b', depends_on: ['a'] },
      { id: 'c', depends_on: ['b', 'c'] }, { id: 'd', depends_on: ['x'] },
    ]
    expect([...dependentIds('a', cards)].sort()).toEqual(['b', 'c'])
    expect(dependentIds('d', cards).size).toBe(0)
  })
})
