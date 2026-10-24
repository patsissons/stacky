import { randomUUID } from 'node:crypto'
import type {
  NotificationChannel,
  OperationSummary,
  StackSummary,
  UpdatesSummary,
} from '@stacky/shared'
import type { SettingsStore } from '../db/settings'
import type { Logger } from '../lib/logger'
import type { SelfUpdateJob } from '../self/jobs'
import { send, type Channel, type Message } from './channels'
import type { NotifyPolicy } from './policy'

const CHANNELS_KEY = 'notifications.channels'
const NOTIFIED_UPDATES_KEY = 'notifications.notifiedUpdates'
const NOTIFIED_JOBS_KEY = 'notifications.notifiedSelfJobs'
/** A container must stay unhealthy this long before anyone is woken up. */
export const UNHEALTHY_GRACE_MS = 60_000
const BAD = new Set(['unhealthy', 'error', 'restarting'])

export type ChannelInput = Omit<Channel, 'id' | 'token'> & { id?: string; token?: string | null }

/** Turns stacky events into notifications on the configured channels. */
export class Notifier {
  private badSince = new Map<
    string,
    { since: number; notified: boolean; name: string; stack: string; state: string }
  >()
  /** Decides which stacks and containers send each event; without one, all of them do. */
  policy: Pick<NotifyPolicy, 'containerEnabled' | 'imageEnabled' | 'stackEnabled'> | undefined

  constructor(
    private readonly settings: SettingsStore,
    private readonly logger: Logger,
    /** Public URL of stacky (`STACKY_BASE_URL`); messages link back to it when set. */
    private readonly baseUrl?: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  // ---- configuration ----

  private stored(): Channel[] {
    return this.settings.get<Channel[]>(CHANNELS_KEY) ?? []
  }

  list(): NotificationChannel[] {
    return this.stored().map(({ token, ...c }) => ({ ...c, hasToken: !!token }))
  }

  /** Replaces the channel list. An omitted token keeps the saved one; `null` clears it. */
  save(inputs: ChannelInput[]): NotificationChannel[] {
    const current = new Map(this.stored().map((c) => [c.id, c]))
    const next = inputs.map((input) => {
      const id = input.id && current.has(input.id) ? input.id : randomUUID()
      const token = input.token === undefined ? current.get(id)?.token : (input.token ?? undefined)
      return { ...input, id, token: token || undefined, recipient: input.recipient || undefined }
    })
    this.settings.set(CHANNELS_KEY, next)
    return this.list()
  }

  async test(input: ChannelInput) {
    const saved = input.id ? this.stored().find((c) => c.id === input.id) : undefined
    const channel: Channel = {
      ...input,
      id: input.id ?? 'test',
      token: input.token === undefined ? saved?.token : (input.token ?? undefined),
    }
    await send(
      channel,
      {
        event: 'operation_failed',
        title: 'Test from stacky',
        body: 'Notifications are working.',
        level: 'info',
        url: this.link(),
      },
      this.fetchImpl,
    )
  }

  /** A link into stacky: the stack's page, or the containers page. */
  private link(stack?: string) {
    if (!this.baseUrl) return undefined
    const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`
    return new URL(stack ? `stacks/${encodeURIComponent(stack)}` : '', base).toString()
  }

  async emit(msg: Message) {
    msg = { ...msg, url: msg.url ?? this.link(msg.stack) }
    const targets = this.stored().filter((c) => c.enabled && c.events.includes(msg.event))
    await Promise.all(
      targets.map((c) =>
        send(c, msg, this.fetchImpl).catch((err) =>
          this.logger.warn('notification failed', { channel: c.name, err: String(err) }),
        ),
      ),
    )
  }

  // ---- event sources ----

  onOperation(op: OperationSummary) {
    if (op.state !== 'failed' || !op.error) return
    if (this.policy && !this.policy.stackEnabled(op.stack, 'operation_failed')) return
    void this.emit({
      event: 'operation_failed',
      level: 'error',
      stack: op.stack,
      title: `${op.action} ${op.stack} failed`,
      body: [op.error.message, op.error.hint].filter(Boolean).join('\n\n'),
    })
  }

  /** Notifies once per new update (per image and target version), after a check finishes. */
  onUpdates(summary: UpdatesSummary) {
    if (summary.checking) return
    const notified = { ...(this.settings.get<Record<string, string>>(NOTIFIED_UPDATES_KEY) ?? {}) }
    const fresh = summary.updates.filter((u) => {
      if (u.status !== 'update_available' || u.ignored) return false
      const value = u.newerTag ?? u.remoteDigest ?? ''
      if (notified[u.ref] === value) return false
      // not marked as notified, so turning notifications back on still reports it
      if (this.policy && !this.policy.imageEnabled(u.ref)) return false
      notified[u.ref] = value
      return true
    })
    if (fresh.length === 0) return
    this.settings.set(NOTIFIED_UPDATES_KEY, notified)
    void this.emit({
      event: 'update_available',
      level: 'info',
      title:
        fresh.length === 1
          ? `Update available: ${fresh[0]!.ref}`
          : `${fresh.length} image updates available`,
      body: fresh
        .map((u) => {
          const line = `${u.ref} → ${u.newerTag ?? 'new image for the same tag'}`
          return u.newerLink ? `${line} (${u.newerLink})` : line
        })
        .join('\n'),
    })
  }

  /** Tracks containers that turned unhealthy; `tick` notifies once they've stayed that way. */
  onStacks(stacks: StackSummary[]) {
    const seen = new Set<string>()
    for (const stack of stacks) {
      for (const service of stack.services) {
        for (const c of service.containers) {
          if (!BAD.has(c.state)) continue
          if (this.policy && !this.policy.containerEnabled(c.id, 'container_unhealthy')) continue
          seen.add(c.id)
          if (!this.badSince.has(c.id)) {
            this.badSince.set(c.id, {
              since: this.now(),
              notified: false,
              name: c.name,
              stack: stack.name,
              state: c.state,
            })
          } else this.badSince.get(c.id)!.state = c.state
        }
      }
    }
    for (const id of this.badSince.keys()) if (!seen.has(id)) this.badSince.delete(id)
    this.tick()
  }

  tick() {
    for (const entry of this.badSince.values()) {
      if (entry.notified || this.now() - entry.since < UNHEALTHY_GRACE_MS) continue
      entry.notified = true
      void this.emit({
        event: 'container_unhealthy',
        level: 'warning',
        stack: entry.stack,
        title: `${entry.name} is ${entry.state === 'error' ? 'crashing' : entry.state}`,
        body: `Container ${entry.name} in stack ${entry.stack} has been ${entry.state} for over a minute.`,
      })
    }
  }

  /** Reports a finished self-update once. */
  onSelfJob(job: Pick<SelfUpdateJob, 'id' | 'state' | 'from' | 'to' | 'error'>, version: string) {
    if (!['succeeded', 'rolled_back', 'failed'].includes(job.state)) return
    const done = this.settings.get<string[]>(NOTIFIED_JOBS_KEY) ?? []
    if (done.includes(job.id)) return
    this.settings.set(NOTIFIED_JOBS_KEY, [...done.slice(-50), job.id])
    void this.emit({
      event: 'self_update',
      level: job.state === 'succeeded' ? 'success' : 'error',
      title:
        job.state === 'succeeded' ? `stacky updated to ${version}` : 'stacky update rolled back',
      body:
        job.state === 'succeeded'
          ? `stacky is now running ${job.to.ref} (was ${job.from.version}).`
          : `The update to ${job.to.ref} failed; stacky is running ${job.from.ref} again.\n\n${job.error ?? ''}`.trim(),
    })
  }
}
