import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StackSummary } from '@stacky/shared'
import { openDatabase } from '../db'
import { SettingsStore } from '../db/settings'
import { silentLogger } from '../lib/logger'
import { UpdateChecker, WUD_KEY } from './checker'
import { RegistryError } from './registry'

function stack(
  images: {
    service: string
    image: string
    imageId: string
    name?: string
    updateSchedule?: string
    tagInclude?: string
    tagExclude?: string
    linkTemplate?: string
    createdAt?: number
  }[],
  isSelf = false,
): StackSummary {
  return {
    name: 'app',
    managed: true,
    status: 'running',
    isSelf,
    urls: [],
    services: images.map((i) => ({
      name: i.service,
      image: i.image,
      state: 'running',
      containers: [
        {
          id: `c-${i.service}`,
          name: i.name ?? `app-${i.service}-1`,
          project: 'app',
          service: i.service,
          number: 1,
          image: i.image,
          imageId: i.imageId,
          state: 'running',
          statusText: 'Up',
          createdAt: i.createdAt ?? 0,
          ports: [],
          updateSchedule: i.updateSchedule,
          tagInclude: i.tagInclude,
          tagExclude: i.tagExclude,
          linkTemplate: i.linkTemplate,
        },
      ],
    })),
  }
}

let close: () => void
let settings: SettingsStore
let db: ReturnType<typeof openDatabase>['db']
let now: number

beforeEach(() => {
  const opened = openDatabase(':memory:')
  db = opened.db
  close = () => opened.sqlite.close()
  settings = new SettingsStore(db)
  now = Date.parse('2026-10-20T12:00:00Z')
})
afterEach(() => close())

function checker(
  stacks: StackSummary[],
  digests: Record<string, string[]>,
  registry: {
    manifestDigest: (r: { tag: string }) => Promise<string>
    listTags: () => Promise<string[]>
  },
  wud?: unknown,
  schedule = 'never',
) {
  const state = { list: () => stacks } as never
  const docker = {
    getImage: (id: string) => ({
      inspect: async () => ({ RepoDigests: (digests[id] ?? []).map((d) => `repo@${d}`) }),
    }),
  } as never
  return new UpdateChecker(
    state,
    docker,
    registry as never,
    db,
    settings,
    silentLogger,
    schedule,
    () => wud as never,
    () => now,
    0,
  )
}

describe('UpdateChecker', () => {
  it('finds digest changes and newer tags, and keeps results', async () => {
    const c = checker(
      [
        stack([
          { service: 'web', image: 'nginx:1.27.3', imageId: 'i1' },
          { service: 'cache', image: 'redis:latest', imageId: 'i2' },
          { service: 'db', image: 'postgres:17.1', imageId: 'i3' },
        ]),
      ],
      { i1: ['sha256:a'], i2: ['sha256:old'], i3: ['sha256:pg'] },
      {
        manifestDigest: async (r) =>
          r.tag === 'latest' ? 'sha256:new' : r.tag === '17.1' ? 'sha256:pg' : 'sha256:a',
        listTags: async () => ['1.27.3', '1.28.0', '17.1', '17.2'],
      },
    )
    await c.checkAll()
    const byRef = Object.fromEntries(c.summary().updates.map((u) => [u.ref, u]))
    expect(byRef['nginx:1.27.3']).toMatchObject({
      status: 'update_available',
      newerTag: '1.28.0',
      kind: 'minor',
    })
    expect(byRef['redis:latest']).toMatchObject({
      status: 'update_available',
      kind: 'digest',
      digestChanged: true,
    })
    expect(byRef['postgres:17.1']).toMatchObject({
      status: 'update_available',
      newerTag: '17.2',
      kind: 'minor',
    })
    expect(c.summary().lastCheckAt).toBeDefined()
  })

  it('skips local builds and pinned digests, and reports registry errors without guessing', async () => {
    const c = checker(
      [
        stack([
          { service: 'built', image: 'myapp:dev', imageId: 'local' },
          { service: 'pinned', image: 'nginx@sha256:abc', imageId: 'i1' },
          { service: 'limited', image: 'alpine:latest', imageId: 'i2' },
        ]),
      ],
      { i1: ['sha256:abc'], i2: ['sha256:x'] },
      {
        manifestDigest: async () => {
          throw new RegistryError('registry rate limit reached', 429)
        },
        listTags: async () => [],
      },
    )
    await c.checkAll()
    const byRef = Object.fromEntries(c.summary().updates.map((u) => [u.ref, u]))
    expect(byRef['myapp:dev']).toMatchObject({ status: 'skipped' })
    expect(byRef['nginx@sha256:abc']).toMatchObject({
      status: 'skipped',
      message: 'pinned to a digest',
    })
    expect(byRef['alpine:latest']).toMatchObject({ status: 'error' })
    expect(byRef['alpine:latest']?.message).toMatch(/rate limit/)
  })

  it('marks ignored updates', async () => {
    const c = checker(
      [stack([{ service: 'web', image: 'nginx:1.27.3', imageId: 'i1' }])],
      { i1: ['sha256:a'] },
      { manifestDigest: async () => 'sha256:a', listTags: async () => ['1.28.0'] },
    )
    await c.checkAll()
    c.ignore('nginx:1.27.3', '1.28.0')
    expect(c.summary().updates[0]?.ignored).toBe(true)
    c.ignore('nginx:1.27.3', undefined)
    expect(c.summary().updates[0]?.ignored).toBeUndefined()
  })

  it('falls back to WUD when the native check fails', async () => {
    settings.set(WUD_KEY, { enabled: true, url: 'http://wud:3000', token: 't' })
    const wud = {
      watch: async () => {},
      containers: async () => [
        { container: 'app-web-1', updateAvailable: true, newerTag: '1.28.0', kind: 'minor' },
      ],
    }
    const c = checker(
      [stack([{ service: 'web', image: 'nginx:1.27.3', imageId: 'i1' }])],
      { i1: ['sha256:a'] },
      {
        manifestDigest: async () => {
          throw new RegistryError('access denied', 401)
        },
        listTags: async () => [],
      },
      wud,
    )
    await c.checkAll()
    expect(c.summary().updates[0]).toMatchObject({
      source: 'wud',
      status: 'update_available',
      newerTag: '1.28.0',
    })
  })

  it('only considers tags that pass the include and exclude labels', async () => {
    const c = checker(
      [
        stack([
          { service: 'web', image: 'nginx:1.26.0', imageId: 'i1', tagInclude: '^1\\.26\\.' },
          { service: 'db', image: 'postgres:17.1', imageId: 'i2', tagExclude: '^18\\.' },
        ]),
      ],
      { i1: ['sha256:a'], i2: ['sha256:a'] },
      {
        manifestDigest: async () => 'sha256:a',
        listTags: async () => ['1.26.0', '1.26.3', '1.28.0', '17.1', '17.4', '18.0'],
      },
    )
    await c.checkAll()
    const byRef = Object.fromEntries(c.summary().updates.map((u) => [u.ref, u]))
    expect(byRef['nginx:1.26.0']).toMatchObject({ newerTag: '1.26.3', tagInclude: '^1\\.26\\.' })
    expect(byRef['postgres:17.1']).toMatchObject({ newerTag: '17.4', tagExclude: '^18\\.' })
  })

  it('ignores invalid or conflicting tag filter labels', async () => {
    const c = checker(
      [
        stack([
          { service: 'web', image: 'nginx:1.26.0', imageId: 'i1', tagInclude: '(' },
          { service: 'a', image: 'redis:7.0', imageId: 'i1', tagInclude: '^7\\.' },
          { service: 'b', image: 'redis:7.0', imageId: 'i1', tagInclude: '^8\\.' },
        ]),
      ],
      { i1: ['sha256:a'] },
      { manifestDigest: async () => 'sha256:a', listTags: async () => ['1.28.0', '7.2', '8.0'] },
    )
    await c.checkAll()
    const byRef = Object.fromEntries(c.summary().updates.map((u) => [u.ref, u]))
    expect(byRef['nginx:1.26.0']).toMatchObject({ newerTag: '1.28.0' })
    expect(byRef['nginx:1.26.0']?.tagInclude).toBeUndefined()
    expect(byRef['nginx:1.26.0']?.tagFilterError).toMatch(/not a valid regular expression/)
    expect(byRef['redis:7.0']).toMatchObject({ newerTag: '8.0' })
    expect(byRef['redis:7.0']?.tagFilterError).toMatch(/different stacky.tag.include labels/)
  })

  it('builds release links from the link template label', async () => {
    const template =
      'https://github.com/nginx/nginx/releases/tag/release-${major}.${minor}.${patch}'
    const c = checker(
      [
        stack([
          { service: 'web', image: 'nginx:1.27.3', imageId: 'i1', linkTemplate: template },
          { service: 'db', image: 'postgres:17.1', imageId: 'i1', linkTemplate: 'see ${original}' },
        ]),
      ],
      { i1: ['sha256:a'] },
      { manifestDigest: async () => 'sha256:a', listTags: async () => ['1.28.0'] },
    )
    await c.checkAll()
    const byRef = Object.fromEntries(c.summary().updates.map((u) => [u.ref, u]))
    expect(byRef['nginx:1.27.3']).toMatchObject({
      linkTemplate: template,
      currentLink: 'https://github.com/nginx/nginx/releases/tag/release-1.27.3',
      newerLink: 'https://github.com/nginx/nginx/releases/tag/release-1.28.0',
    })
    expect(byRef['postgres:17.1']?.currentLink).toBeUndefined()
    expect(byRef['postgres:17.1']?.linkTemplateError).toMatch(/not an http/)
  })

  it('builds release links for updates reported by WUD', async () => {
    settings.set(WUD_KEY, { enabled: true, url: 'http://wud:3000', token: 't' })
    const wud = {
      watch: async () => {},
      containers: async () => [
        { container: 'app-web-1', updateAvailable: true, newerTag: '1.28.0', kind: 'minor' },
      ],
    }
    const c = checker(
      [
        stack([
          {
            service: 'web',
            image: 'nginx:1.27.3',
            imageId: 'i1',
            linkTemplate: 'https://example.com/v${original}',
          },
        ]),
      ],
      { i1: ['sha256:a'] },
      {
        manifestDigest: async () => {
          throw new RegistryError('access denied', 401)
        },
        listTags: async () => [],
      },
      wud,
    )
    await c.checkAll()
    expect(c.summary().updates[0]).toMatchObject({
      source: 'wud',
      newerLink: 'https://example.com/v1.28.0',
    })
  })

  it('stops a running check before it touches the closed database', async () => {
    let release!: () => void
    const pending = new Promise<void>((r) => (release = r))
    const c = checker(
      [stack([{ service: 'web', image: 'nginx:1.27.3', imageId: 'i1' }])],
      {},
      {
        manifestDigest: async () => {
          await pending
          return 'sha256:a'
        },
        listTags: async () => [],
      },
    )
    const check = c.checkAll()
    c.stop()
    close()
    release()
    await expect(check).resolves.toBeUndefined()
    await expect(c.checkAll()).resolves.toBeUndefined()
    // afterEach closes again; better-sqlite3 allows that
  })
})

describe('UpdateChecker schedules', () => {
  const HOUR = 3_600_000
  const registry = { manifestDigest: async () => 'sha256:a', listTags: async () => [] }
  const checked: string[] = []
  const tracking = {
    manifestDigest: async (r: { tag: string }) => {
      checked.push(r.tag)
      return 'sha256:a'
    },
    listTags: async () => [],
  }
  beforeEach(() => {
    checked.length = 0
  })

  it('checks never-checked images first, then each on its own schedule', async () => {
    const c = checker(
      [
        stack([
          { service: 'web', image: 'nginx:latest', imageId: 'i1' },
          { service: 'db', image: 'postgres:latest', imageId: 'i1', updateSchedule: 'weekly' },
          { service: 'off', image: 'redis:latest', imageId: 'i1', updateSchedule: 'never' },
        ]),
      ],
      { i1: ['sha256:a'] },
      tracking,
      undefined,
      '6h',
    )
    await c.checkDue()
    // the never-scheduled image isn't checked even the first time
    expect(checked.sort()).toEqual(['latest', 'latest'])
    expect(
      c
        .summary()
        .updates.map((u) => u.ref)
        .sort(),
    ).toEqual(['nginx:latest', 'postgres:latest'])

    checked.length = 0
    now += 6 * HOUR + 1
    await c.checkDue()
    expect(c.summary().updates.find((u) => u.ref === 'nginx:latest')?.checkedAt).toBe(now)
    expect(c.summary().updates.find((u) => u.ref === 'postgres:latest')?.checkedAt).toBeLessThan(
      now,
    )
    expect(checked).toHaveLength(1)
    expect(c.summary().updates.find((u) => u.ref === 'postgres:latest')?.scheduleLabel).toBe(
      'weekly',
    )
  })

  it('uses the earliest schedule when containers share an image', async () => {
    const c = checker(
      [
        stack([
          { service: 'a', image: 'nginx:latest', imageId: 'i1', updateSchedule: 'monthly' },
          { service: 'b', image: 'nginx:latest', imageId: 'i1', updateSchedule: '1h' },
        ]),
      ],
      { i1: ['sha256:a'] },
      registry,
    )
    await c.checkDue()
    expect(c.summary().nextCheckAt).toBe(now + HOUR)
    expect(c.summary().updates[0]?.scheduleLabel).toBe('1h')
  })

  it('falls back to the global schedule for an invalid label', async () => {
    const c = checker(
      [stack([{ service: 'web', image: 'nginx:latest', imageId: 'i1', updateSchedule: 'often' }])],
      { i1: ['sha256:a'] },
      registry,
      undefined,
      '2h',
    )
    await c.checkDue()
    const [u] = c.summary().updates
    expect(u?.scheduleLabel).toBeUndefined()
    expect(u?.scheduleError).toMatch(/not a schedule/)
    expect(c.summary().nextCheckAt).toBe(now + 2 * HOUR)
  })

  it('checks an image again once its tag filter labels change', async () => {
    const stacks = [stack([{ service: 'web', image: 'nginx:1.26.0', imageId: 'i1' }])]
    const c = checker(stacks, { i1: ['sha256:a'] }, tracking, undefined, 'weekly')
    await c.checkDue()
    expect(checked).toEqual(['1.26.0'])
    await c.checkDue()
    expect(checked).toHaveLength(1)
    stacks[0]!.services[0]!.containers[0]!.tagInclude = '^1\\.26\\.'
    expect(c.summary().nextCheckAt).toBe(now)
    await c.checkDue()
    expect(checked).toHaveLength(2)
    await c.checkDue()
    expect(checked).toHaveLength(2)
  })

  it('checks an image again once a container is recreated after its check', async () => {
    const stacks = [stack([{ service: 'web', image: 'nginx:1.26.0', imageId: 'i1' }])]
    const c = checker(stacks, { i1: ['sha256:a'] }, tracking, undefined, 'weekly')
    await c.checkDue()
    await c.checkDue()
    expect(checked).toHaveLength(1)
    now += 60_000
    stacks[0]!.services[0]!.containers[0]!.createdAt = now - 1000
    await c.checkDue()
    expect(checked).toHaveLength(2)
    await c.checkDue()
    expect(checked).toHaveLength(2)
  })

  it("re-checks stacky's own image while a newer release isn't reflected yet", async () => {
    let remote = 'sha256:a'
    const registry = {
      manifestDigest: async (r: { tag: string }) => {
        checked.push(r.tag)
        return remote
      },
      listTags: async () => [],
    }
    const c = checker(
      [
        stack(
          [{ service: 'stacky', image: 'ghcr.io/patsissons/stacky:latest', imageId: 'i1' }],
          true,
        ),
      ],
      { i1: ['sha256:a'] },
      registry,
      undefined,
      'weekly',
    )
    let release = false
    c.selfRelease = () => release
    await c.checkDue()
    expect(checked).toHaveLength(1)
    release = true
    now += 10 * 60_000
    await c.checkDue()
    expect(checked).toHaveLength(1)
    now += 6 * 60_000
    // the image is in the registry now
    remote = 'sha256:b'
    await c.checkDue()
    expect(checked).toHaveLength(2)
    expect(c.summary().updates[0]?.status).toBe('update_available')
    now += 60 * 60_000
    await c.checkDue()
    expect(checked).toHaveLength(2)
  })

  it('only re-checks often for the image of stacky itself', async () => {
    const c = checker(
      [stack([{ service: 'web', image: 'nginx:latest', imageId: 'i1' }])],
      { i1: ['sha256:a'] },
      tracking,
      undefined,
      'weekly',
    )
    c.selfRelease = () => true
    await c.checkDue()
    now += 60 * 60_000
    await c.checkDue()
    expect(checked).toHaveLength(1)
  })

  it("re-checks stacky's own image after a release even when its schedule is never", async () => {
    const c = checker(
      [
        stack(
          [{ service: 'stacky', image: 'ghcr.io/patsissons/stacky:latest', imageId: 'i1' }],
          true,
        ),
      ],
      { i1: ['sha256:a'] },
      tracking,
      undefined,
      'never',
    )
    await c.checkAll()
    expect(checked).toHaveLength(1)
    now += 60 * 60_000
    await c.checkDue()
    expect(checked).toHaveLength(1)
    c.selfRelease = () => true
    await c.checkDue()
    expect(checked).toHaveLength(2)
    await c.checkDue()
    expect(checked).toHaveLength(2)
    now += 16 * 60_000
    await c.checkDue()
    expect(checked).toHaveLength(3)
  })

  it("checks only stacky's own image on request and reports its results", async () => {
    const c = checker(
      [
        stack([{ service: 'web', image: 'nginx:latest', imageId: 'i1' }]),
        stack(
          [{ service: 'stacky', image: 'ghcr.io/patsissons/stacky:latest', imageId: 'i2' }],
          true,
        ),
      ],
      { i1: ['sha256:a'], i2: ['sha256:old'] },
      tracking,
    )
    const reported: string[] = []
    c.onSelfChecked = (u) => reported.push(`${u.ref} ${u.status}`)
    await c.checkSelf()
    expect(checked).toEqual(['latest'])
    expect(reported).toEqual(['ghcr.io/patsissons/stacky:latest update_available'])
    await c.checkAll()
    expect(checked).toHaveLength(3)
    expect(reported).toHaveLength(2)
  })

  it('does nothing on a self check without a stacky container', async () => {
    const c = checker(
      [stack([{ service: 'web', image: 'nginx:latest', imageId: 'i1' }])],
      {
        i1: ['sha256:a'],
      },
      tracking,
    )
    await c.checkSelf()
    expect(checked).toHaveLength(0)
  })

  it('saves the global schedule in settings and can reset it', () => {
    const c = checker([], {}, registry, undefined, '6h')
    expect(c.schedule()).toEqual({ schedule: '6h', default: '6h', saved: false })
    c.setSchedule(' Weekly ')
    expect(c.schedule()).toEqual({ schedule: 'Weekly', default: '6h', saved: true })
    expect(() => c.setSchedule('sometimes')).toThrow(/not a schedule/)
    c.setSchedule(null)
    expect(c.schedule().saved).toBe(false)
  })
})
