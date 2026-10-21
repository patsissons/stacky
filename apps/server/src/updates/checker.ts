import { EventEmitter } from 'node:events'
import type Docker from 'dockerode'
import type { ImageUpdate, UpdatesSummary } from '@stacky/shared'
import type { Db } from '../db'
import { imageUpdates } from '../db/schema'
import type { SettingsStore } from '../db/settings'
import type { Logger } from '../lib/logger'
import type { StackState } from '../stacks/state'
import { parseImageRef, RegistryError, type RegistryClient } from './registry'
import {
  MAX_JITTER_MS,
  nextRun,
  parseSchedule,
  SCHEDULE_LABEL,
  ScheduleError,
  type Schedule,
} from './schedule'
import { isVersionTag, newestTag } from './tags'
import { WudClient, type WudSettings } from './wud'

const IGNORED_KEY = 'updates.ignored'
export const WUD_KEY = 'integrations.wud'
export const SCHEDULE_KEY = 'updates.schedule'
const CONCURRENCY = 4
const TICK_MS = 60_000

interface InUse {
  ref: string
  imageIds: Set<string>
  containers: Set<string>
  /** `stacky.update.schedule` of each container; undefined for containers without the label. */
  schedules: Set<string | undefined>
}

/** When an image is next due, and which schedule decided it. */
interface Due {
  at: number | undefined
  label?: string
  labelError?: string
}

interface CheckerEvents {
  change: [UpdatesSummary]
}

/**
 * Checks the images of running containers for updates: a new digest for the
 * same tag, and newer version tags of the same shape. Results persist across
 * restarts; checks run on demand and on a schedule, set globally and per
 * container with the `stacky.update.schedule` label.
 */
export class UpdateChecker extends EventEmitter<CheckerEvents> {
  private checking = false
  private lastCheckAt: number | undefined
  private timer: NodeJS.Timeout | undefined
  private parsed = new Map<string, Schedule | ScheduleError>()
  private warned = new Set<string>()

  constructor(
    private readonly state: StackState,
    private readonly docker: Docker,
    private readonly registry: RegistryClient,
    private readonly db: Db,
    private readonly settings: SettingsStore,
    private readonly logger: Logger,
    /** Schedule used until one is saved in Settings (from `STACKY_UPDATE_SCHEDULE`). */
    private readonly defaultSchedule = '6h',
    private readonly wudFactory: (s: WudSettings) => WudClient = (s) => new WudClient(s),
    private readonly now: () => number = Date.now,
    // spreads checks so many stacky instances don't hit registries at once
    private readonly jitterMs = Math.floor(Math.random() * MAX_JITTER_MS),
  ) {
    super()
  }

  start(initialDelayMs = 60_000) {
    const tick = (delay: number) => {
      this.timer = setTimeout(() => {
        void this.checkDue().finally(() => tick(TICK_MS))
      }, delay)
      this.timer.unref()
    }
    tick(initialDelayMs)
  }

  stop() {
    clearTimeout(this.timer)
  }

  // ---- schedules ----

  /** The global schedule: saved in Settings, else the configured default. */
  schedule(): { schedule: string; default: string; saved: boolean } {
    const saved = this.settings.get<string>(SCHEDULE_KEY)
    return {
      schedule: saved ?? this.defaultSchedule,
      default: this.defaultSchedule,
      saved: !!saved,
    }
  }

  /** Saves the global schedule; `null` goes back to the default. Throws `ScheduleError`. */
  setSchedule(text: string | null) {
    if (text === null) this.settings.delete(SCHEDULE_KEY)
    else {
      parseSchedule(text)
      this.settings.set(SCHEDULE_KEY, text.trim())
    }
    this.emit('change', this.summary())
  }

  private parse(text: string): Schedule | ScheduleError {
    let hit = this.parsed.get(text)
    if (!hit) {
      try {
        hit = parseSchedule(text)
      } catch (err) {
        if (!(err instanceof ScheduleError)) throw err
        hit = err
      }
      this.parsed.set(text, hit)
    }
    return hit
  }

  /** When each image in use is next due; the earliest of its containers' schedules wins. */
  private dueTimes(inUse: Map<string, InUse>): Map<string, Due> {
    const now = this.now()
    const checkedAt = new Map(
      this.db
        .select({ ref: imageUpdates.ref, checkedAt: imageUpdates.checkedAt })
        .from(imageUpdates)
        .all()
        .map((r) => [r.ref, r.checkedAt]),
    )
    const global = this.parse(this.schedule().schedule)
    const result = new Map<string, Due>()
    for (const target of inUse.values()) {
      let best: Due | undefined
      for (const label of target.schedules) {
        const parsed = label === undefined ? global : this.parse(label)
        const labelError = parsed instanceof ScheduleError ? parsed.message : undefined
        if (labelError && !this.warned.has(label!)) {
          this.warned.add(label!)
          this.logger.warn(`invalid ${SCHEDULE_LABEL} label; using the global schedule`, {
            label,
            err: labelError,
          })
        }
        const schedule = parsed instanceof ScheduleError ? global : parsed
        const at =
          schedule instanceof ScheduleError
            ? undefined
            : nextRun(schedule, checkedAt.get(target.ref), now, this.jitterMs)
        const due: Due = { at, label: labelError ? undefined : label, labelError }
        if (!best || (at !== undefined && (best.at === undefined || at < best.at))) best = due
        else if (labelError) best.labelError ??= labelError
      }
      if (best) result.set(target.ref, best)
    }
    return result
  }

  /** Checks the images whose schedule says they're due. */
  async checkDue() {
    const now = this.now()
    const due = [...this.dueTimes(this.inUse())]
      .filter(([, d]) => d.at !== undefined && d.at <= now)
      .map(([ref]) => ref)
    if (due.length > 0) await this.checkAll(due)
  }

  /** Distinct image references used by containers right now. */
  private inUse(): Map<string, InUse> {
    const map = new Map<string, InUse>()
    for (const stack of this.state.list()) {
      for (const service of stack.services) {
        for (const c of service.containers) {
          const ref = c.image.startsWith('sha256:') ? service.image : c.image
          if (!ref || ref.includes('${')) continue
          const entry = map.get(ref) ?? {
            ref,
            imageIds: new Set(),
            containers: new Set(),
            schedules: new Set(),
          }
          entry.imageIds.add(c.imageId)
          entry.containers.add(c.name)
          entry.schedules.add(c.updateSchedule?.trim() || undefined)
          map.set(ref, entry)
        }
      }
    }
    return map
  }

  summary(): UpdatesSummary {
    const ignored = this.settings.get<Record<string, string>>(IGNORED_KEY) ?? {}
    const inUse = this.inUse()
    const due = this.dueTimes(inUse)
    const rows = this.db.select().from(imageUpdates).all()
    const updates = rows
      .filter((r) => inUse.has(r.ref))
      .map((r) => {
        const d = due.get(r.ref)
        const u = {
          ...r.data,
          ...(d?.label ? { scheduleLabel: d.label } : {}),
          ...(d?.labelError ? { scheduleError: d.labelError } : {}),
        }
        const value = u.newerTag ?? u.remoteDigest
        return value && ignored[u.ref] === value ? { ...u, ignored: true } : u
      })
    const next = [...due.values()]
      .map((d) => d.at)
      .filter((at) => at !== undefined)
      .sort((a, b) => a - b)[0]
    return {
      updates,
      checking: this.checking,
      lastCheckAt: this.lastCheckAt,
      // a never-checked image is due "now"; the next tick picks it up
      nextCheckAt: next === undefined ? undefined : Math.max(next, this.now()),
    }
  }

  ignore(ref: string, value: string | undefined) {
    const ignored = { ...(this.settings.get<Record<string, string>>(IGNORED_KEY) ?? {}) }
    if (value) ignored[ref] = value
    else delete ignored[ref]
    this.settings.set(IGNORED_KEY, ignored)
    this.emit('change', this.summary())
  }

  /** Checks every image in use (or just `only`). Returns immediately if a check is running. */
  async checkAll(only?: string[]): Promise<void> {
    if (this.checking) return
    this.checking = true
    this.emit('change', this.summary())
    try {
      const targets = [...this.inUse().values()].filter((t) => !only || only.includes(t.ref))
      const wud = await this.wudResults()
      const queue = [...targets]
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          const result = this.mergeWud(await this.check(t), t, wud)
          this.save(result)
          this.emit('change', this.summary())
        }
      })
      await Promise.all(workers)
      this.lastCheckAt = this.now()
    } finally {
      this.checking = false
      this.emit('change', this.summary())
    }
  }

  private save(result: ImageUpdate) {
    this.db
      .insert(imageUpdates)
      .values({ ref: result.ref, data: result, checkedAt: result.checkedAt })
      .onConflictDoUpdate({
        target: imageUpdates.ref,
        set: { data: result, checkedAt: result.checkedAt },
      })
      .run()
  }

  async check(target: InUse): Promise<ImageUpdate> {
    const parsed = parseImageRef(target.ref)
    const base = {
      ref: target.ref,
      registry: parsed.registry,
      repository: parsed.repository,
      tag: parsed.tag,
      checkedAt: this.now(),
      source: 'native' as const,
    }
    if (parsed.digest) return { ...base, status: 'skipped', message: 'pinned to a digest' }

    const local = new Set<string>()
    for (const id of target.imageIds) {
      try {
        const info = await this.docker.getImage(id).inspect()
        for (const d of info.RepoDigests ?? []) local.add(d.split('@')[1]!)
      } catch {
        // image removed since the container was created
      }
    }
    if (local.size === 0) {
      return { ...base, status: 'skipped', message: 'built locally or not pulled from a registry' }
    }

    try {
      const remote = await this.registry.manifestDigest(parsed)
      const digestChanged = !local.has(remote)
      let newer: ReturnType<typeof newestTag>
      if (isVersionTag(parsed.tag)) {
        newer = newestTag(parsed.tag, await this.registry.listTags(parsed, 10))
      }
      const available = digestChanged || !!newer
      return {
        ...base,
        status: available ? 'update_available' : 'up_to_date',
        digestChanged,
        newerTag: newer?.tag,
        kind: newer?.kind ?? (digestChanged ? 'digest' : undefined),
        localDigest: [...local][0],
        remoteDigest: remote,
      }
    } catch (err) {
      const message =
        err instanceof RegistryError && err.status === 429
          ? 'registry rate limit reached; will retry on the next check'
          : err instanceof Error
            ? err.message
            : String(err)
      this.logger.debug('update check failed', { ref: target.ref, message })
      return { ...base, status: 'error', message }
    }
  }

  private async wudResults() {
    const settings = this.settings.get<WudSettings & { enabled?: boolean }>(WUD_KEY)
    if (!settings?.enabled || !settings.url) return undefined
    try {
      const client = this.wudFactory(settings)
      await client.watch().catch(() => {})
      return new Map((await client.containers()).map((r) => [r.container, r]))
    } catch (err) {
      this.logger.warn('WUD unavailable', { err: String(err) })
      return undefined
    }
  }

  /** Native results win; WUD fills in where the native check could not answer. */
  private mergeWud(
    native: ImageUpdate,
    target: InUse,
    wud: Map<string, Awaited<ReturnType<WudClient['containers']>>[number]> | undefined,
  ): ImageUpdate {
    if (!wud || native.status === 'up_to_date' || native.status === 'update_available')
      return native
    const hit = [...target.containers].map((name) => wud.get(name)).find(Boolean)
    if (!hit) return native
    return {
      ...native,
      source: 'wud',
      status: hit.updateAvailable ? 'update_available' : 'up_to_date',
      newerTag: hit.newerTag,
      kind: hit.kind,
      digestChanged: hit.kind === 'digest',
      message: undefined,
    }
  }
}
