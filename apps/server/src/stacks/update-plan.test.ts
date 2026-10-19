import { describe, expect, it } from 'vitest'
import type { ImageUpdate, ServiceSummary, StackSummary } from '@stacky/shared'
import { planServices, planStackUpdates } from './update-plan'

function service(
  name: string,
  image: string,
  opts: { containers?: number; composeImage?: string } = {},
): ServiceSummary {
  const { containers = 1, composeImage = image } = opts
  return {
    name,
    image: composeImage,
    state: 'running',
    containers: Array.from({ length: containers }, (_, i) => ({
      id: `${name}-${i}`,
      name: `app-${name}-${i + 1}`,
      project: 'app',
      service: name,
      number: i + 1,
      image,
      imageId: `sha256:${name}`,
      state: 'running',
      statusText: 'Up',
      createdAt: 0,
      ports: [],
    })),
  }
}

function stack(...services: ServiceSummary[]): StackSummary {
  return { name: 'app', managed: true, status: 'running', services, isSelf: false, urls: [] }
}

function update(ref: string, patch: Partial<ImageUpdate>): ImageUpdate {
  const [repository, tag = 'latest'] = ref.split(':')
  return {
    ref,
    registry: 'docker.io',
    repository: repository!,
    tag,
    status: 'update_available',
    checkedAt: 0,
    source: 'native',
    ...patch,
  }
}

const compose = `services:
  web:
    image: nginx:1.27.3 # pinned
  db:
    image: postgres:16
`

describe('planStackUpdates', () => {
  const s = stack(service('web', 'nginx:1.27.3'), service('db', 'postgres:16'))

  it('prefetches newer tags by the reference the containers run', () => {
    const plan = planStackUpdates(s, [update('nginx:1.27.3', { newerTag: '1.28.0' })])
    expect(plan).toEqual({
      bumps: [{ service: 'web', from: 'nginx:1.27.3', to: 'nginx:1.28.0' }],
      rebuilt: [],
      skipped: [],
    })
  })

  it('treats a new digest for the same tag as a rebuilt service', () => {
    const plan = planStackUpdates(s, [update('postgres:16', { digestChanged: true })])
    expect(plan.rebuilt).toEqual(['db'])
    expect(plan.bumps).toEqual([])
  })

  it('prefers a newer tag over a new digest', () => {
    const plan = planStackUpdates(s, [
      update('nginx:1.27.3', { newerTag: '1.28.0', digestChanged: true }),
    ])
    expect(planServices(plan)).toEqual(['web'])
    expect(plan.rebuilt).toEqual([])
  })

  it('leaves out ignored, up to date and failed checks', () => {
    const plan = planStackUpdates(s, [
      update('nginx:1.27.3', { newerTag: '1.28.0', ignored: true }),
      update('postgres:16', { status: 'error', digestChanged: true }),
    ])
    expect(planServices(plan)).toEqual([])
  })

  it('skips services without containers and honours the services filter', () => {
    const plan = planStackUpdates(
      stack(service('web', 'nginx:1.27.3', { containers: 0 }), service('db', 'postgres:16')),
      [
        update('nginx:1.27.3', { newerTag: '1.28.0' }),
        update('postgres:16', { digestChanged: true }),
      ],
    )
    expect(planServices(plan)).toEqual(['db'])
    const only = planStackUpdates(
      s,
      [
        update('nginx:1.27.3', { newerTag: '1.28.0' }),
        update('postgres:16', { digestChanged: true }),
      ],
      { only: ['web'] },
    )
    expect(planServices(only)).toEqual(['web'])
  })

  it('looks up a bare image id through the compose image', () => {
    const plan = planStackUpdates(
      stack(service('web', 'sha256:abc', { composeImage: 'nginx:1.27.3' })),
      [update('nginx:1.27.3', { newerTag: '1.28.0' })],
    )
    expect(plan.bumps[0]?.to).toBe('nginx:1.28.0')
  })

  it('rejects tags that are not valid docker tags', () => {
    const plan = planStackUpdates(s, [update('nginx:1.27.3', { newerTag: '1.28; rm -rf /' })])
    expect(plan.bumps).toEqual([])
    expect(plan.skipped[0]?.service).toBe('web')
  })

  describe('against the compose file', () => {
    const updates = [update('nginx:1.27.3', { newerTag: '1.28.0' })]

    it('bumps the image: line', () => {
      const plan = planStackUpdates(s, updates, { compose })
      expect(plan.bumps).toEqual([{ service: 'web', from: 'nginx:1.27.3', to: 'nginx:1.28.0' }])
    })

    it('keeps a service already edited to the newer tag, with nothing to change', () => {
      const plan = planStackUpdates(s, updates, {
        compose: compose.replace('1.27.3', '1.28.0'),
      })
      expect(plan.bumps).toEqual([{ service: 'web', from: 'nginx:1.28.0', to: 'nginx:1.28.0' }])
    })

    it('skips an image set from a variable', () => {
      const plan = planStackUpdates(s, updates, {
        compose: compose.replace('nginx:1.27.3', 'nginx:${NGINX_TAG}'),
      })
      expect(plan.bumps).toEqual([])
      expect(plan.skipped).toEqual([{ service: 'web', reason: 'image set from a variable' }])
    })

    it('skips an image: line that changed since the check', () => {
      const plan = planStackUpdates(s, updates, { compose: compose.replace('1.27.3', '1.29.0') })
      expect(plan.bumps).toEqual([])
      expect(plan.skipped).toEqual([
        { service: 'web', reason: 'compose file changed since the check' },
      ])
    })
  })
})
