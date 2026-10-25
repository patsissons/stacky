import { describe, expect, it } from 'vitest'
import type { ImageUpdate } from '@stacky/shared'
import { checkedLabel } from './checked'

const now = 1_800_000_000_000
const update = (patch: Partial<ImageUpdate>): ImageUpdate => ({
  ref: 'nginx:1.27',
  registry: 'docker.io',
  repository: 'library/nginx',
  tag: '1.27',
  status: 'up_to_date',
  checkedAt: now,
  source: 'native',
  ...patch,
})

describe('checkedLabel', () => {
  it('says how long ago the image was checked', () => {
    expect(checkedLabel(update({}), now)).toBe('checked just now')
    expect(checkedLabel(update({ checkedAt: now - 3 * 3_600_000 }), now)).toBe('checked 3h ago')
    expect(checkedLabel(update({ status: 'error', checkedAt: now - 120_000 }), now)).toBe(
      'checked 2m ago',
    )
  })

  it('says when there is no result yet, and nothing for images that are never checked', () => {
    expect(checkedLabel(undefined, now)).toBe('not checked yet')
    expect(checkedLabel(update({ status: 'skipped' }), now)).toBeUndefined()
  })
})
