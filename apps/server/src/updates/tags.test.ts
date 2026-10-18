import { describe, expect, it } from 'vitest'
import { isVersionTag, newestTag, tagShape, updateKind } from './tags'

describe('tagShape', () => {
  it('replaces numbers so only like-for-like tags compete', () => {
    expect(tagShape('1.27.3-alpine')).toBe('#.#.#-alpine')
    expect(tagShape('v2.8.3-ls364')).toBe('v#.#.#-ls#')
  })
})

describe('updateKind', () => {
  it('classifies the first changed position like WUD does', () => {
    expect(updateKind('1.2.3', '2.0.0')).toBe('major')
    expect(updateKind('v2.11.0', 'v2.16.1')).toBe('minor')
    expect(updateKind('3.24.1', '3.24.2')).toBe('patch')
    expect(updateKind('v2.8.3-ls364', 'v2.8.3-ls367')).toBe('prerelease')
  })
})

describe('newestTag', () => {
  const tags = [
    '1.26.0',
    '1.27.3',
    '1.27.4',
    '1.28.0',
    '1.28.0-alpine',
    '2.0.0-rc1',
    'latest',
    'mainline',
    '20240101',
  ]

  it('finds the newest tag of the same shape', () => {
    expect(newestTag('1.27.3', tags)).toEqual({ tag: '1.28.0', kind: 'minor' })
    expect(newestTag('1.27.3-alpine', [...tags, '1.29.1-alpine'])).toEqual({
      tag: '1.29.1-alpine',
      kind: 'minor',
    })
  })

  it('returns nothing when current is newest or not a version', () => {
    expect(newestTag('1.28.0', tags)).toBeUndefined()
    expect(newestTag('latest', tags)).toBeUndefined()
  })

  it('ignores tags from a different numbering scheme', () => {
    expect(newestTag('1', ['2', '20240101'])).toEqual({ tag: '2', kind: 'major' })
  })

  it('handles linuxserver build numbers', () => {
    expect(newestTag('v2.8.3-ls364', ['v2.8.3-ls367', 'v2.8.3-ls365'])).toEqual({
      tag: 'v2.8.3-ls367',
      kind: 'prerelease',
    })
  })

  it('knows version tags', () => {
    expect(isVersionTag('1.2')).toBe(true)
    expect(isVersionTag('latest')).toBe(false)
  })
})
