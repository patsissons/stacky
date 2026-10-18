import { describe, expect, it } from 'vitest'
import type { ComposeContainer } from '../docker/containers'
import { buildStackSummaries, type ManagedStack } from './summaries'

function container(over: Partial<ComposeContainer>): ComposeContainer {
  return {
    id: 'id-' + (over.name ?? 'x'),
    name: over.name ?? 'x',
    project: 'app',
    service: 'web',
    number: 1,
    image: 'nginx',
    imageId: 'sha256:1',
    state: 'running',
    statusText: 'Up',
    createdAt: 0,
    ports: [],
    labels: {},
    ...over,
  }
}

function managed(name: string, services: string[], projectName?: string): ManagedStack {
  return {
    name,
    dir: `/opt/stacks/${name}`,
    composeFile: 'compose.yaml',
    parsed: {
      services: services.map((s) => ({ name: s, image: `${s}:1` })),
      urls: [],
      projectName,
    },
  }
}

describe('buildStackSummaries', () => {
  it('lists undeployed stacks as inactive with not_created services', () => {
    const [s] = buildStackSummaries([managed('app', ['web', 'db'])], [])
    expect(s).toMatchObject({ name: 'app', managed: true, status: 'inactive' })
    expect(s!.services.map((x) => [x.name, x.state, x.image])).toEqual([
      ['web', 'not_created', 'web:1'],
      ['db', 'not_created', 'db:1'],
    ])
  })

  it('matches containers by working dir, then by project name', () => {
    const stacks = buildStackSummaries(
      [managed('app', ['web']), managed('other', ['api'], 'custom-name')],
      [
        container({ name: 'app-web-1', workingDir: '/opt/stacks/app', project: 'renamed' }),
        container({ name: 'custom-api-1', project: 'custom-name', service: 'api' }),
      ],
    )
    expect(stacks.find((s) => s.name === 'app')!.status).toBe('running')
    expect(stacks.find((s) => s.name === 'other')!.status).toBe('running')
    expect(stacks.filter((s) => !s.managed)).toHaveLength(0)
  })

  it('surfaces compose projects outside the stacks dir as external stacks, after managed ones', () => {
    const stacks = buildStackSummaries(
      [managed('zeta', ['web'])],
      [
        container({
          name: 'dockge-dockge-1',
          project: 'dockge',
          service: 'dockge',
          workingDir: '/opt/dockge',
        }),
      ],
    )
    expect(stacks.map((s) => [s.name, s.managed])).toEqual([
      ['zeta', true],
      ['dockge', false],
    ])
    expect(stacks[1]).toMatchObject({ path: '/opt/dockge', status: 'running' })
  })

  it('includes services that only exist as containers (e.g. removed from compose)', () => {
    const [s] = buildStackSummaries(
      [managed('app', ['web'])],
      [container({ name: 'app-web-1' }), container({ name: 'app-old-1', service: 'old' })],
    )
    expect(s!.services.map((x) => x.name)).toEqual(['web', 'old'])
  })

  it('flags the stack running stacky itself and active operations', () => {
    const [s] = buildStackSummaries(
      [managed('stacky', ['stacky'])],
      [container({ id: 'abcdef123456', project: 'stacky', service: 'stacky' })],
      { selfContainerId: 'abcdef', activeOperations: new Map([['stacky', 'op1']]) },
    )
    expect(s).toMatchObject({ isSelf: true, activeOperationId: 'op1' })
  })

  it('does not leak internal container fields', () => {
    const [s] = buildStackSummaries(
      [managed('app', ['web'])],
      [container({ labels: { secret: 'x' }, workingDir: '/opt/stacks/app' })],
    )
    expect(s!.services[0]!.containers[0]).not.toHaveProperty('labels')
  })
})
