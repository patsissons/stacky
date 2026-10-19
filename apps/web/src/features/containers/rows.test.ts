import { describe, expect, it } from 'vitest'
import type { ImageUpdate, StackSummary } from '@stacky/shared'
import { buildRows, matchesStatus, planUpdates, portUrl, type ContainerRow } from './rows'

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

describe('planUpdates', () => {
  const row = (over: Partial<ContainerRow>): ContainerRow => ({
    id: `${over.stack ?? 'app'}-${over.service ?? 'web'}-${over.number ?? 1}`,
    name: 'c',
    service: 'web',
    number: 1,
    stack: 'app',
    managed: true,
    isSelf: false,
    state: 'running',
    statusText: 'Up',
    image: 'nginx:1.27',
    registry: 'docker.io',
    repository: 'library/nginx',
    tag: '1.27',
    ports: [],
    createdAt: 1,
    ...over,
  })
  const update = (ref: string, over: Partial<ImageUpdate>): [string, ImageUpdate] => [
    ref,
    {
      ref,
      registry: 'docker.io',
      repository: 'library/x',
      tag: ref.split(':')[1] ?? 'latest',
      status: 'update_available',
      checkedAt: 0,
      source: 'native',
      ...over,
    },
  ]

  it('bumps newer tags, re-pulls changed digests and does each service once', () => {
    const byRef = new Map([
      update('nginx:1.27', { newerTag: '1.28', digestChanged: true }),
      update('redis:7', { digestChanged: true }),
      update('pg:16', { status: 'up_to_date' }),
    ])
    const plan = planUpdates(
      [
        row({ service: 'web', number: 1 }),
        row({ service: 'web', number: 2 }),
        row({ service: 'cache', image: 'redis:7', tag: '7' }),
        row({ service: 'db', image: 'pg:16', tag: '16' }),
      ],
      byRef,
    )
    expect(plan.steps).toEqual([
      { stack: 'app', service: 'web', kind: 'bump', tag: '1.27', newerTag: '1.28' },
      { stack: 'app', service: 'cache', kind: 'pull', tag: '7' },
    ])
    expect(plan.skipped).toEqual([])
  })

  it('skips ignored updates, external stacks and stacky itself', () => {
    const byRef = new Map([
      update('nginx:1.27', { newerTag: '1.28' }),
      update('redis:7', { digestChanged: true, ignored: true }),
    ])
    const plan = planUpdates(
      [
        row({ stack: 'ext', managed: false }),
        row({ stack: 'stacky', isSelf: true }),
        row({ service: 'cache', image: 'redis:7' }),
      ],
      byRef,
    )
    expect(plan.steps).toEqual([])
    expect(plan.skipped.map((s) => s.stack)).toEqual(['ext', 'stacky'])
  })
})
