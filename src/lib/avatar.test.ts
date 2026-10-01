import { describe, expect, it } from 'vitest'
import { avatarColor, AVATAR_COLORS, initials, safeHexColor } from './avatar'

describe('avatar', () => {
  it('SEC-014: só cor #rrggbb chega ao CSS', () => {
    expect(safeHexColor('#4f6ef7')).toBe('#4f6ef7')
    expect(safeHexColor('#ABCDEF')).toBe('#ABCDEF')
    expect(safeHexColor('url(https://rastreador.example.com/p.gif)')).toBeNull()
    expect(safeHexColor('red; background-image: url(x)')).toBeNull()
    expect(safeHexColor('#fff')).toBeNull()
    expect(safeHexColor(null)).toBeNull()
  })

  it('cor e inicial derivadas da semente', () => {
    expect(AVATAR_COLORS).toContain(avatarColor('ana@example.com'))
    expect(avatarColor('ana@example.com')).toBe(avatarColor('ana@example.com'))
    expect(initials('  bruno')).toBe('B')
    expect(initials('')).toBe('?')
  })
})
