import { describe, expect, it } from 'vitest'
import type { StackSummary } from '@stacky/shared'
import { buildRows, matchesStatus, portUrl } from './rows'

const stack = (over: Partial<StackSummary>): StackSummary => ({
  name: 'app',
  managed: true,
  status: 'running',
  services: [],
  isSelf: false,
  urls: [],
  ...over,
})

describe('buildRows', () => {
  it('flattens containers across stacks and splits the image', () => {
    const rows = buildRows([
      stack({
        services: [
          {
            name: 'web',
            image: 'ghcr.io/org/web:1.2.3',
            state: 'running',
            containers: [
              {
                id: 'c1',
                name: 'app-web-1',
                project: 'app',
                service: 'web',
                number: 1,
                image: 'ghcr.io/org/web:1.2.3',
                imageId: 'sha256:x',
                state: 'running',
                statusText: 'Up',
                createdAt: 1,
                ports: [],
              },
            ],
          },
          { name: 'db', state: 'not_created', containers: [] },
        ],
      }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      stack: 'app',
      service: 'web',
      registry: 'ghcr.io',
      repository: 'org/web',
      tag: '1.2.3',
    })
  })

  it('falls back to the compose image when the engine reports an image id', () => {
    const rows = buildRows([
      stack({
        services: [
          {
            name: 'web',
            image: 'nginx:1.27',
            state: 'running',
            containers: [
              {
                id: 'c1',
                name: 'n',
                project: 'app',
                service: 'web',
                number: 1,
                image: 'sha256:abc',
                imageId: 'sha256:abc',
                state: 'running',
                statusText: 'Up',
                createdAt: 1,
                ports: [],
              },
            ],
          },
        ],
      }),
    ])
    expect(rows[0]?.tag).toBe('1.27')
  })
})

describe('matchesStatus', () => {
  it('groups container states into filters', () => {
    expect(matchesStatus('healthy', 'running')).toBe(true)
    expect(matchesStatus('unhealthy', 'problems')).toBe(true)
    expect(matchesStatus('completed', 'stopped')).toBe(true)
    expect(matchesStatus('exited', 'running')).toBe(false)
    expect(matchesStatus('error', 'all')).toBe(true)
  })
})

describe('portUrl', () => {
  it('builds links for published ports only', () => {
    expect(portUrl({ hostPort: 8080, containerPort: 80, protocol: 'tcp' }, 'nas')).toBe(
      'http://nas:8080',
    )
    expect(portUrl({ hostPort: 8443, containerPort: 443, protocol: 'tcp' }, 'nas')).toBe(
      'https://nas:8443',
    )
    expect(portUrl({ containerPort: 80, protocol: 'tcp' }, 'nas')).toBeUndefined()
  })
})
