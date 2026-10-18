import { EventEmitter } from 'node:events'
import type Docker from 'dockerode'
import type { ImageUpdate, UpdatesSummary } from '@stacky/shared'
import type { Db } from '../db'
import { imageUpdates } from '../db/schema'
import type { SettingsStore } from '../db/settings'
import type { Logger } from '../lib/logger'
import type { StackState } from '../stacks/state'
import { parseImageRef, RegistryError, type RegistryClient } from './registry'
import { isVersionTag, newestTag } from './tags'
import { WudClient, type WudSettings } from './wud'

const IGNORED_KEY = 'updates.ignored'
export const WUD_KEY = 'integrations.wud'
const CONCURRENCY = 4

interface InUse {
  ref: string
  imageIds: Set<string>
  containers: Set<string>
}

interface CheckerEvents {
  change: [UpdatesSummary]
}

/**
 * Checks the images of running containers for updates: a new digest for the
 * same tag, and newer version tags of the same shape. Results persist across
 * restarts; checks run on a schedule and on demand.
 */
export class UpdateChecker extends EventEmitter<CheckerEvents> {
  private checking = false
  private lastCheckAt: number | undefined
  private nextCheckAt: number | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly state: StackState,
    private readonly docker: Docker,
    private readonly registry: RegistryClient,
    private readonly db: Db,
    private readonly settings: SettingsStore,
    private readonly logger: Logger,
    private readonly intervalMs = 6 * 60 * 60 * 1000,
    private readonly wudFactory: (s: WudSettings) => WudClient = (s) => new WudClient(s),
  ) {
    super()
  }

  start(initialDelayMs = 60_000) {
    if (this.intervalMs <= 0) return
    const schedule = (delay: number) => {
      // jitter spreads checks so many stacky instances don't hit registries at once
      const jittered = delay + Math.floor(Math.random() * Math.min(delay / 10, 5 * 60_000))
      this.nextCheckAt = Date.now() + jittered
      this.timer = setTimeout(() => {
        void this.checkAll().finally(() => schedule(this.intervalMs))
      }, jittered)
      this.timer.unref()
    }
    schedule(initialDelayMs)
  }

  stop() {
    clearTimeout(this.timer)
  }

  /** Distinct image references used by containers right now. */
  private inUse(): Map<string, InUse> {
    const map = new Map<string, InUse>()
    for (const stack of this.state.list()) {
      for (const service of stack.services) {
        for (const c of service.containers) {
          const ref = c.image.startsWith('sha256:') ? service.image : c.image
          if (!ref || ref.includes('${')) continue
          const entry = map.get(ref) ?? { ref, imageIds: new Set(), containers: new Set() }
          entry.imageIds.add(c.imageId)
          entry.containers.add(c.name)
          map.set(ref, entry)
        }
      }
    }
    return map
  }

  summary(): UpdatesSummary {
    const ignored = this.settings.get<Record<string, string>>(IGNORED_KEY) ?? {}
    const inUse = this.inUse()
    const rows = this.db.select().from(imageUpdates).all()
    const updates = rows
      .filter((r) => inUse.has(r.ref))
      .map((r) => {
        const u = r.data
        const value = u.newerTag ?? u.remoteDigest
        return value && ignored[u.ref] === value ? { ...u, ignored: true } : u
      })
    return {
      updates,
      checking: this.checking,
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
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
      this.lastCheckAt = Date.now()
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
      checkedAt: Date.now(),
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
