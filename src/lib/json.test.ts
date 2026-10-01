import { describe, expect, it } from 'vitest'
import { isJsonObject } from './json'

describe('isJsonObject', () => {
  it('accepts only plain objects', () => {
    expect(isJsonObject({ valid: true })).toBe(true)
    expect(isJsonObject([])).toBe(false)
    expect(isJsonObject(null)).toBe(false)
    expect(isJsonObject('valid')).toBe(false)
    expect(isJsonObject(undefined)).toBe(false)
  })
})
