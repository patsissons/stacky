import { afterEach, describe, expect, it } from 'vitest'
import type { ImageUpdate } from '@stacky/shared'
import { ReleaseChecker } from './release'
import { syncSelfRelease } from './sync'

function setup(running: string) {
  const clock = { now: 0 }
  const github = { tag: 'v0.14.2', fetches: 0 }
  const fetchImpl = (async () => {
    github.fetches++
    return new Response(JSON.stringify({ tag_name: github.tag, html_url: 'https://x' }))
  }) as typeof fetch
  const releases = new ReleaseChecker(true, fetchImpl, () => clock.now)
  const selfChecks: number[] = []
  const updates = {
    selfRelease: undefined as (() => string | undefined) | undefined,
    onSelfChecked: undefined as ((result: ImageUpdate) => void) | undefined,
    checkSelf: async () => void selfChecks.push(clock.now),
  }
  stop = syncSelfRelease(releases, updates, running)
  return { clock, github, releases, updates, selfChecks }
}

function result(status: ImageUpdate['status'], newerTag?: string): ImageUpdate {
  return {
    ref: 'ghcr.io/patsissons/stacky:0.14.1',
    registry: 'ghcr.io',
    repository: 'patsissons/stacky',
    tag: '0.14.1',
    checkedAt: 0,
    source: 'native',
    status,
    newerTag,
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

let stop: (() => void) | undefined
afterEach(() => stop?.())

describe('syncSelfRelease', () => {
  it('looks for the release at start and checks the image once a newer one is found', async () => {
    const { github, updates, selfChecks } = setup('0.14.1')
    await settle()
    expect(github.fetches).toBe(1)
    expect(updates.selfRelease?.()).toBe('0.14.2')
    expect(selfChecks).toHaveLength(1)
  })

  it('looks for a newer release when the image is ahead of the one known', async () => {
    const { clock, github, updates, selfChecks } = setup('0.14.1')
    await settle()
    clock.now += 10 * 60_000
    // the badge matches the release: nothing to look for
    updates.onSelfChecked?.(result('update_available', '0.14.2'))
    updates.onSelfChecked?.(result('up_to_date'))
    await settle()
    expect(github.fetches).toBe(1)
    // the registry has 0.15.0, so its release is out
    github.tag = 'v0.15.0'
    updates.onSelfChecked?.(result('update_available', '0.15.0'))
    await settle()
    expect(github.fetches).toBe(2)
    expect(updates.selfRelease?.()).toBe('0.15.0')
    expect(selfChecks).toHaveLength(2)
  })

  it('looks for a release when the image changed and none is known', async () => {
    const { clock, github, updates } = setup('0.14.2')
    await settle()
    expect(updates.selfRelease?.()).toBeUndefined()
    clock.now += 10 * 60_000
    github.tag = 'v0.15.0'
    updates.onSelfChecked?.(result('update_available'))
    await settle()
    expect(github.fetches).toBe(2)
    expect(updates.selfRelease?.()).toBe('0.15.0')
  })
})
