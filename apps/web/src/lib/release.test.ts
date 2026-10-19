import { describe, expect, it } from 'vitest'
import { releaseUrl } from './release'

describe('releaseUrl', () => {
  it('links release versions to their GitHub tag', () => {
    expect(releaseUrl('0.5.0')).toBe('https://github.com/patsissons/stacky/releases/tag/v0.5.0')
    expect(releaseUrl('v1.2.3')).toBe('https://github.com/patsissons/stacky/releases/tag/v1.2.3')
    expect(releaseUrl('1.0.0-rc.1')).toBe(
      'https://github.com/patsissons/stacky/releases/tag/v1.0.0-rc.1',
    )
  })

  it('has no link for dev and unknown builds', () => {
    expect(releaseUrl('dev')).toBeUndefined()
    expect(releaseUrl('')).toBeUndefined()
    expect(releaseUrl(undefined)).toBeUndefined()
    expect(releaseUrl('main-abc123')).toBeUndefined()
  })
})
