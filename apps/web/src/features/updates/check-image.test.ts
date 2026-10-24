import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageUpdate } from '@stacky/shared'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api', () => ({ api }))

import { checkImage, checkImages, describeCheck, describeStackCheck } from './check-image'

const result = (overrides: Partial<ImageUpdate>): ImageUpdate => ({
  ref: 'nginx:1.27',
  registry: 'docker.io',
  repository: 'library/nginx',
  tag: '1.27',
  status: 'up_to_date',
  checkedAt: 10,
  source: 'native',
  ...overrides,
})

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({ updates: [], checking: true })
})

describe('checkImage', () => {
  it('asks for that ref only and waits for a newer result', async () => {
    api.get
      .mockResolvedValueOnce({ updates: [result({ checkedAt: 5 })], checking: true })
      .mockResolvedValueOnce({ updates: [result({ checkedAt: 20 })], checking: false })
    const got = await checkImage('nginx:1.27', 5, { poll: 1 })
    expect(api.post).toHaveBeenCalledWith('/api/updates/check', { refs: ['nginx:1.27'] })
    expect(got?.checkedAt).toBe(20)
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('gives up when no newer result arrives in time', async () => {
    api.get.mockResolvedValue({ updates: [result({ checkedAt: 5 })], checking: true })
    await expect(checkImage('nginx:1.27', 5, { poll: 1, timeout: 5 })).resolves.toBeUndefined()
  })
})

describe('describeCheck', () => {
  it('names the newer tag', () => {
    expect(
      describeCheck('nginx:1.27', result({ status: 'update_available', newerTag: '1.28' })).title,
    ).toBe('nginx:1.27: 1.28 is available')
  })
  it('explains a rebuilt tag, an up-to-date image, a failure and a missing result', () => {
    expect(
      describeCheck('nginx:1.27', result({ status: 'update_available', digestChanged: true }))
        .title,
    ).toMatch(/new image for this tag/)
    expect(describeCheck('nginx:1.27', result({})).title).toBe('nginx:1.27 is up to date')
    const failed = describeCheck('nginx:1.27', result({ status: 'error', message: 'rate limited' }))
    expect(failed.tone).toBe('error')
    expect(failed.description).toBe('rate limited')
    expect(describeCheck('nginx:1.27', undefined).tone).toBe('warning')
  })
})

describe('checkImages', () => {
  it('asks for those refs and waits for the check to finish after the baseline', async () => {
    api.post.mockResolvedValue({ updates: [], checking: true, lastCheckAt: 5 })
    api.get
      .mockResolvedValueOnce({
        updates: [result({ checkedAt: 20 })],
        checking: true,
        lastCheckAt: 5,
      })
      .mockResolvedValueOnce({
        updates: [result({ checkedAt: 20 }), result({ ref: 'redis:7', checkedAt: 3 })],
        checking: false,
        lastCheckAt: 25,
      })
    const got = await checkImages(['nginx:1.27', 'redis:7', 'app:${TAG}'], { poll: 1 })
    expect(api.post).toHaveBeenCalledWith('/api/updates/check', {
      refs: ['nginx:1.27', 'redis:7', 'app:${TAG}'],
    })
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(got.get('nginx:1.27')?.checkedAt).toBe(20)
    // checked before the baseline, and skipped by the checker: no result
    expect(got.has('redis:7')).toBe(true)
    expect(got.get('redis:7')).toBeUndefined()
    expect(got.get('app:${TAG}')).toBeUndefined()
  })

  it('treats a stacky that never checked as a zero baseline', async () => {
    api.get.mockResolvedValue({
      updates: [result({ checkedAt: 20 })],
      checking: false,
      lastCheckAt: 25,
    })
    const got = await checkImages(['nginx:1.27'], { poll: 1 })
    expect(got.get('nginx:1.27')?.checkedAt).toBe(20)
  })

  it('gives up when the check does not finish in time', async () => {
    api.post.mockResolvedValue({ updates: [], checking: true, lastCheckAt: 5 })
    api.get.mockResolvedValue({ updates: [], checking: true, lastCheckAt: 5 })
    await expect(checkImages(['nginx:1.27'], { poll: 1, timeout: 5 })).resolves.toEqual(new Map())
  })
})

describe('describeStackCheck', () => {
  const results = (...entries: [string, ImageUpdate | undefined][]) => new Map(entries)

  it('counts and names the updates found', () => {
    const got = describeStackCheck(
      'app',
      results(
        ['nginx:1.27', result({ status: 'update_available', newerTag: '1.28' })],
        ['redis:7', result({ ref: 'redis:7', status: 'update_available', digestChanged: true })],
      ),
    )
    expect(got).toEqual({
      tone: 'success',
      title: 'app: 2 updates available',
      description: 'nginx:1.27, redis:7',
    })
  })

  it('reports an up-to-date stack', () => {
    expect(describeStackCheck('app', results(['nginx:1.27', result({})]))).toEqual({
      tone: 'success',
      title: 'app is up to date',
    })
  })

  it('names the images it could not check', () => {
    const mixed = results(
      ['nginx:1.27', result({ status: 'update_available' })],
      ['redis:7', result({ ref: 'redis:7', status: 'error' })],
    )
    expect(describeStackCheck('app', mixed).description).toBe(
      'nginx:1.27. 1 could not be checked: redis:7',
    )
    const incomplete = describeStackCheck(
      'app',
      results(['nginx:1.27', result({})], ['app:${TAG}', undefined]),
    )
    expect(incomplete).toMatchObject({ tone: 'warning', title: 'app: check incomplete' })
    expect(incomplete.description).toBe('1 could not be checked: app:${TAG}')
  })

  it('warns when nothing arrived', () => {
    expect(describeStackCheck('app', new Map()).title).toBe('app: no result yet')
    expect(describeStackCheck('app', results(['nginx:1.27', undefined])).tone).toBe('warning')
  })
})
