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
  }[],
): StackSummary {
  return {
    name: 'app',
    managed: true,
    status: 'running',
    isSelf: false,
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
          createdAt: 0,
          ports: [],
          updateSchedule: i.updateSchedule,
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
