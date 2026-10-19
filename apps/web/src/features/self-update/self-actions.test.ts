import { describe, expect, it } from 'vitest'
import type { ImageUpdate, SelfInfo } from '@stacky/shared'
import { canUpdate, updateTarget } from './self-actions'
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

describe('canUpdate', () => {
  const imageUpdate = (over: Partial<ImageUpdate>): ImageUpdate => ({
    ref: 'ghcr.io/patsissons/stacky:latest',
    registry: 'ghcr.io',
    repository: 'patsissons/stacky',
    tag: 'latest',
    status: 'update_available',
    checkedAt: 0,
    source: 'native',
    digestChanged: true,
    ...over,
  })

  it('allows updating to a newer release', () => {
    expect(
      canUpdate(info({ latestRelease: { version: '0.2.0', url: 'https://x' } }), undefined),
    ).toBe(true)
  })

  it('allows pulling a new image behind a moving tag', () => {
    expect(canUpdate(info({ movingTag: true }), imageUpdate({}))).toBe(true)
  })

  it('has nothing to do when stacky is current', () => {
    expect(canUpdate(info({}), undefined)).toBe(false)
    expect(canUpdate(info({}), imageUpdate({ status: 'up_to_date', digestChanged: false }))).toBe(
      false,
    )
    expect(canUpdate(info({}), imageUpdate({ ignored: true }))).toBe(false)
  })
})

describe('isSelfOperation', () => {
  it('recognises operations against stacky itself', () => {
    expect(isSelfOperation('update stacky')).toBe(true)
    expect(isSelfOperation('deploy')).toBe(false)
  })
})
