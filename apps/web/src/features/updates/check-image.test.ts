import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageUpdate } from '@stacky/shared'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api', () => ({ api }))

import { checkImage, describeCheck } from './check-image'

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
