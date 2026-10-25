import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { resolveHostName } from './host-name'

const docker = (info: () => Promise<unknown>) => ({ info }) as never

describe('resolveHostName', () => {
  it('prefers STACKY_DISPLAY_NAME', async () => {
    const name = await resolveHostName(
      'living-room',
      docker(async () => ({ Name: 'nas' })),
    )
    expect(name).toBe('living-room')
  })

  it("uses the Docker host's name", async () => {
    expect(
      await resolveHostName(
        undefined,
        docker(async () => ({ Name: ' nas ' })),
      ),
    ).toBe('nas')
  })

  it("falls back to this machine's name when Docker can't say", async () => {
    const failing = docker(async () => {
      throw new Error('connect ENOENT')
    })
    expect(await resolveHostName(undefined, failing)).toBe(os.hostname())
    expect(
      await resolveHostName(
        undefined,
        docker(async () => ({ Name: '' })),
      ),
    ).toBe(os.hostname())
    const hanging = docker(() => new Promise(() => {}))
    expect(await resolveHostName(undefined, hanging, 10)).toBe(os.hostname())
  })
})
