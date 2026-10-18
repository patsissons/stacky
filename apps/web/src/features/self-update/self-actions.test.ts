import { describe, expect, it } from 'vitest'
import type { SelfInfo } from '@stacky/shared'
import { updateTarget } from './self-actions'
import { isSelfOperation } from './store'

const info = (over: Partial<SelfInfo>): SelfInfo => ({ available: true, version: '0.1.0', ...over })

describe('updateTarget', () => {
  it('pins the new version only when stacky runs a pinned tag', () => {
    const latestRelease = { version: '0.2.0', url: 'https://x' }
    expect(updateTarget(info({ movingTag: false, latestRelease }))).toBe('0.2.0')
    expect(updateTarget(info({ movingTag: true, latestRelease }))).toBeUndefined()
    expect(updateTarget(info({ movingTag: false }))).toBeUndefined()
  })
})

describe('isSelfOperation', () => {
  it('recognises operations against stacky itself', () => {
    expect(isSelfOperation('update stacky')).toBe(true)
    expect(isSelfOperation('deploy')).toBe(false)
  })
})
