import { describe, expect, it } from 'vitest'
import { TAG_INCLUDE_LABELS } from '../updates/tags'
import { firstLabel } from './labels'

describe('firstLabel', () => {
  it('prefers stacky labels over WUD ones and skips blank values', () => {
    expect(
      firstLabel({ 'stacky.tag.include': '^2\\.', 'wud.tag.include': '^1\\.' }, TAG_INCLUDE_LABELS),
    ).toBe('^2\\.')
    expect(
      firstLabel({ 'stacky.tag.include': '  ', 'wud.tag.include': ' ^1\\. ' }, TAG_INCLUDE_LABELS),
    ).toBe('^1\\.')
    expect(firstLabel({}, TAG_INCLUDE_LABELS)).toBeUndefined()
  })
})
