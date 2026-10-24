import { beforeEach, describe, expect, it } from 'vitest'
import type { StackSummary } from '@stacky/shared'
import { openDatabase } from '../db'
import { SettingsStore } from '../db/settings'
import { silentLogger } from '../lib/logger'
import { Notifier, UNHEALTHY_GRACE_MS } from './notifier'

let sent: { url: string; body: string }[]
let now: number
let notifier: Notifier

const fetchImpl = (async (url: string, init?: RequestInit) => {
  sent.push({ url, body: String(init?.body) })
  return new Response('ok')
}) as typeof fetch

beforeEach(() => {
  sent = []
  now = 1_000_000
  const { db } = openDatabase(':memory:')
  notifier = new Notifier(new SettingsStore(db), silentLogger, undefined, fetchImpl, () => now)
  notifier.save([
    {
      name: 'hook',
      type: 'webhook',
      url: 'https://hook.test',
      token: 'secret',
      enabled: true,
      events: ['operation_failed', 'update_available', 'container_unhealthy', 'self_update'],
    },
  ])
})

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Notifier', () => {
  it('never returns tokens and keeps them when saving without one', () => {
    const [c] = notifier.list()
    expect(c).toMatchObject({ hasToken: true })
    expect(JSON.stringify(notifier.list())).not.toContain('secret')
    notifier.save([{ ...c!, token: undefined }])
    expect(notifier.list()[0]?.hasToken).toBe(true)
    notifier.save([{ ...c!, token: null }])
    expect(notifier.list()[0]?.hasToken).toBe(false)
  })

  it('reports failed operations with the classified error', async () => {
    notifier.onOperation({
      id: 'op',
      stack: 'app',
      action: 'deploy',
      services: [],
      state: 'failed',
      commands: [],
      createdAt: 0,
      error: { code: 'port_in_use', message: 'Port 80 is already in use', hint: 'Change it' },
    })
    await flush()
    expect(JSON.parse(sent[0]!.body)).toMatchObject({
      event: 'operation_failed',
      title: 'deploy app failed',
    })
  })

  it('notifies about each update once', async () => {
    const summary = {
      checking: false,
      updates: [
        {
          ref: 'nginx:1.27',
          registry: 'docker.io',
          repository: 'library/nginx',
          tag: '1.27',
          status: 'update_available' as const,
          checkedAt: 0,
          source: 'native' as const,
          newerTag: '1.28',
        },
      ],
    }
    notifier.onUpdates(summary)
    notifier.onUpdates(summary)
    await flush()
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!.body).body).toContain('nginx:1.27 → 1.28')
  })

  it('adds the release link to update notifications', async () => {
    notifier.onUpdates({
      checking: false,
      updates: [
        {
          ref: 'nginx:1.27',
          registry: 'docker.io',
          repository: 'library/nginx',
          tag: '1.27',
          status: 'update_available',
          checkedAt: 0,
          source: 'native',
          newerTag: '1.28',
          newerLink: 'https://example.com/1.28',
        },
      ],
    })
    await flush()
    expect(JSON.parse(sent[0]!.body).body).toBe('nginx:1.27 → 1.28 (https://example.com/1.28)')
  })

  it('waits for a container to stay unhealthy before notifying, and only once', async () => {
    const stacks = (state: 'unhealthy' | 'running'): StackSummary[] => [
      {
        name: 'app',
        managed: true,
        status: 'unhealthy',
        isSelf: false,
        urls: [],
        services: [
          {
            name: 'web',
            state,
            containers: [
              {
                id: 'c1',
                name: 'app-web-1',
                project: 'app',
                service: 'web',
                number: 1,
                image: 'x',
                imageId: 'y',
                state,
                statusText: '',
                createdAt: 0,
                ports: [],
              },
            ],
          },
        ],
      },
    ]
    notifier.onStacks(stacks('unhealthy'))
    await flush()
    expect(sent).toHaveLength(0)
    now += UNHEALTHY_GRACE_MS + 1
    notifier.tick()
    notifier.tick()
    await flush()
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!.body).title).toBe('app-web-1 is unhealthy')
    // recovering and failing again notifies again
    notifier.onStacks(stacks('running'))
    notifier.onStacks(stacks('unhealthy'))
    now += UNHEALTHY_GRACE_MS + 1
    notifier.tick()
    await flush()
    expect(sent).toHaveLength(2)
  })

  it('skips containers and images whose notifications are off', async () => {
    const muted = new Set(['c1', 'nginx:1.27'])
    notifier.policy = {
      containerEnabled: (id) => !muted.has(id),
      imageEnabled: (ref) => !muted.has(ref),
    }
    const update = {
      ref: 'nginx:1.27',
      registry: 'docker.io',
      repository: 'library/nginx',
      tag: '1.27',
      status: 'update_available' as const,
      checkedAt: 0,
      source: 'native' as const,
      newerTag: '1.28',
    }
    notifier.onUpdates({ checking: false, updates: [update] })
    notifier.onStacks([
      {
        name: 'app',
        managed: true,
        status: 'unhealthy',
        isSelf: false,
        urls: [],
        services: [
          {
            name: 'web',
            state: 'unhealthy',
            containers: [
              {
                id: 'c1',
                name: 'app-web-1',
                project: 'app',
                service: 'web',
                number: 1,
                image: 'x',
                imageId: 'y',
                state: 'unhealthy',
                statusText: '',
                createdAt: 0,
                ports: [],
              },
            ],
          },
        ],
      },
    ])
    now += UNHEALTHY_GRACE_MS + 1
    notifier.tick()
    notifier.onOperation({
      id: 'op1',
      stack: 'app',
      action: 'deploy',
      services: [],
      state: 'failed',
      commands: [],
      createdAt: 0,
      error: { code: 'x', message: 'boom' },
    })
    await flush()
    // failed operations aren't scoped
    expect(sent.map((s) => JSON.parse(s.body).event)).toEqual(['operation_failed'])
    // a muted update isn't marked as notified, so it's reported once it's back on
    muted.clear()
    notifier.onUpdates({ checking: false, updates: [update] })
    await flush()
    expect(JSON.parse(sent[1]!.body)).toMatchObject({ event: 'update_available' })
  })

  it('reports a self-update result once', async () => {
    const job = {
      id: 'j1',
      state: 'rolled_back' as const,
      from: { ref: 'a:1', imageId: 'x', version: '1' },
      to: { ref: 'a:2' },
      error: 'unhealthy',
    }
    notifier.onSelfJob(job, '1')
    notifier.onSelfJob(job, '1')
    await flush()
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]!.body)).toMatchObject({ event: 'self_update', level: 'error' })
  })

  it('keeps the Pushover user key and returns it, unlike the token', () => {
    notifier.save([
      {
        name: 'Phone',
        type: 'pushover',
        url: 'https://api.pushover.net/1/messages.json',
        token: 'app-token',
        recipient: 'user-key',
        enabled: true,
        events: ['operation_failed'],
      },
    ])
    const [c] = notifier.list()
    expect(c).toMatchObject({ recipient: 'user-key', hasToken: true })
    expect(JSON.stringify(c)).not.toContain('app-token')
    notifier.save([{ ...c!, recipient: '' }])
    expect(notifier.list()[0]).not.toHaveProperty('recipient')
  })

  it('links messages to the stack when the public URL is known', async () => {
    const { db } = openDatabase(':memory:')
    const linked = new Notifier(
      new SettingsStore(db),
      silentLogger,
      'https://stacky.lan/ui',
      fetchImpl,
    )
    linked.save(notifier.list().map((c) => ({ ...c, token: 'x' })))
    await linked.emit({
      event: 'operation_failed',
      level: 'error',
      title: 't',
      body: 'b',
      stack: 'my app',
    })
    await linked.emit({ event: 'update_available', level: 'info', title: 't', body: 'b' })
    expect(JSON.parse(sent[0]!.body).url).toBe('https://stacky.lan/ui/stacks/my%20app')
    expect(JSON.parse(sent[1]!.body).url).toBe('https://stacky.lan/ui/')
    // without a base URL there is nothing to link to
    await notifier.emit({ event: 'update_available', level: 'info', title: 't', body: 'b' })
    expect(JSON.parse(sent[2]!.body)).not.toHaveProperty('url')
  })
})
