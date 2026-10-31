import { describe, expect, it } from 'vitest'
import type { ImageUpdate, StackSummary } from '@stacky/shared'
import {
  buildRows,
  groupByStack,
  matchesStatus,
  planUpdates,
  portUrl,
  stackHasUpdate,
  stackImageRefs,
  type ContainerRow,
} from './rows'

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

  it('links to the configured Docker host', () => {
    expect(portUrl({ hostPort: 8080, containerPort: 80, protocol: 'tcp' }, 'op.example.io')).toBe(
      'http://op.example.io:8080',
    )
    expect(portUrl({ hostPort: 8080, containerPort: 80, protocol: 'tcp' }, '[fd00::10]')).toBe(
      'http://[fd00::10]:8080',
    )
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

describe('groupByStack', () => {
  it('collects each stack’s services in plan order', () => {
    const step = (stack: string, service: string) => ({
      stack,
      service,
      kind: 'pull' as const,
      tag: 'latest',
    })
    expect(
      groupByStack([step('media', 'plex'), step('db', 'postgres'), step('media', 'sonarr')]),
    ).toEqual([
      { stack: 'media', services: ['plex', 'sonarr'] },
      { stack: 'db', services: ['postgres'] },
    ])
  })
})

describe('stackHasUpdate', () => {
  const running = (image: string, serviceImage = image) =>
    stack({
      services: [
        {
          name: 'web',
          image: serviceImage,
          state: 'running',
          containers: [
            {
              id: 'c1',
              name: 'app-web-1',
              project: 'app',
              service: 'web',
              number: 1,
              image,
              imageId: 'sha256:x',
              state: 'running',
              statusText: 'Up',
              createdAt: 1,
              ports: [],
            },
          ],
        },
      ],
    })
  const byRef = (over: Partial<ImageUpdate>) =>
    new Map<string, ImageUpdate>([
      [
        'nginx:1.27',
        {
          ref: 'nginx:1.27',
          registry: 'docker.io',
          repository: 'library/nginx',
          tag: '1.27',
          status: 'update_available',
          checkedAt: 1,
          source: 'native',
          ...over,
        },
      ],
    ])

  it('is true when a container has an available update', () => {
    expect(stackHasUpdate(running('nginx:1.27'), byRef({}))).toBe(true)
  })

  it('is false when no container has one', () => {
    expect(stackHasUpdate(running('redis:7'), byRef({}))).toBe(false)
    expect(stackHasUpdate(running('nginx:1.27'), byRef({ status: 'up_to_date' }))).toBe(false)
  })

  it('leaves out ignored updates and failed checks', () => {
    expect(stackHasUpdate(running('nginx:1.27'), byRef({ ignored: true }))).toBe(false)
    expect(stackHasUpdate(running('nginx:1.27'), byRef({ status: 'error' }))).toBe(false)
  })

  it('finds the update through the compose image when the engine reports an image id', () => {
    expect(stackHasUpdate(running('sha256:abc', 'nginx:1.27'), byRef({}))).toBe(true)
  })
})

describe('stackImageRefs', () => {
  const container = (id: string, image: string) => ({
    id,
    name: id,
    project: 'app',
    service: 'web',
    number: 1,
    image,
    imageId: 'sha256:x',
    state: 'running' as const,
    statusText: 'Up',
    createdAt: 1,
    ports: [],
  })

  it('lists each image once, preferring the compose image over an image id', () => {
    expect(
      stackImageRefs(
        stack({
          services: [
            {
              name: 'web',
              image: 'nginx:1.27',
              state: 'running',
              containers: [container('c1', 'nginx:1.27'), container('c2', 'sha256:abc')],
            },
            {
              name: 'cache',
              image: 'redis:7',
              state: 'running',
              containers: [container('c3', 'redis:7')],
            },
            { name: 'db', image: 'postgres:16', state: 'not_created', containers: [] },
          ],
        }),
      ),
    ).toEqual(['nginx:1.27', 'redis:7'])
  })
})
