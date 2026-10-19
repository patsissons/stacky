import { describe, expect, it } from 'vitest'
import { iconSrc, isMonoIcon } from './icon-src'

describe('iconSrc', () => {
  it('maps icon ids to the icon routes', () => {
    expect(iconSrc('sh:plex')).toBe('/api/icons/sh/plex')
    expect(iconSrc('mdi:docker')).toBe('/api/icons/mdi/docker')
    expect(iconSrc('url:0123abcd')).toBe('/api/icons/url/0123abcd')
    expect(iconSrc('plex')).toBe('/api/icons/plex')
    expect(iconSrc('stacky')).toBeUndefined()
  })

  it('knows which sets are single-color glyphs', () => {
    expect(isMonoIcon('mdi:docker')).toBe(true)
    expect(isMonoIcon('fab:github')).toBe(true)
    expect(isMonoIcon('si:traefikproxy')).toBe(true)
    expect(isMonoIcon('sh:plex')).toBe(false)
    expect(isMonoIcon('url:abc')).toBe(false)
  })
})
