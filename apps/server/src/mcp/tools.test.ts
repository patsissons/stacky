import type { ImageUpdate, StackSummary } from '@stacky/shared'
import { describe, expect, it } from 'vitest'
import { pinnedUpdateHint } from './tools'

const stack = {
  name: 'stacky',
  services: [
    {
      name: 'stacky',
      image: 'ghcr.io/patsissons/stacky:0.17.1',
      containers: [{ image: 'ghcr.io/patsissons/stacky:0.17.1' }],
    },
    { name: 'db', image: 'postgres:16', containers: [{ image: 'postgres:16' }] },
  ],
} as unknown as StackSummary

const update = (u: Partial<ImageUpdate>) =>
  ({
    ref: 'ghcr.io/patsissons/stacky:0.17.1',
    tag: '0.17.1',
    status: 'update_available',
    newerTag: '0.17.2',
    ignored: false,
    ...u,
  }) as ImageUpdate

describe('pinnedUpdateHint', () => {
  it('points at bump_image when a newer tag is known', () => {
    const hint = pinnedUpdateHint(stack, [update({})])
    expect(hint).toContain('stacky → ghcr.io/patsissons/stacky:0.17.2')
    expect(hint).toContain('bump_image')
  })

  it('only looks at the selected services', () => {
    expect(pinnedUpdateHint(stack, [update({})], ['db'])).toBeUndefined()
    expect(pinnedUpdateHint(stack, [update({})], ['stacky'])).toBeDefined()
  })

  it('stays quiet without a newer tag', () => {
    expect(pinnedUpdateHint(stack, [])).toBeUndefined()
    expect(pinnedUpdateHint(stack, [update({ status: 'up_to_date' })])).toBeUndefined()
    expect(pinnedUpdateHint(stack, [update({ ignored: true })])).toBeUndefined()
    expect(pinnedUpdateHint(stack, [update({ newerTag: undefined })])).toBeUndefined()
    expect(pinnedUpdateHint(undefined, [update({})])).toBeUndefined()
  })
})
