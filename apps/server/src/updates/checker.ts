import { EventEmitter } from 'node:events'
import type Docker from 'dockerode'
import type { ImageUpdate, UpdatesSummary } from '@stacky/shared'
import type { Db } from '../db'
import { imageUpdates } from '../db/schema'
import type { SettingsStore } from '../db/settings'
import type { Logger } from '../lib/logger'
import { compareVersions } from '../self/image-ref'
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
import { renderLink } from './links'
import { isVersionTag, newestTag, type TagFilter } from './tags'
import { WudClient, type WudSettings } from './wud'

const IGNORED_KEY = 'updates.ignored'
export const WUD_KEY = 'integrations.wud'
export const SCHEDULE_KEY = 'updates.schedule'
const CONCURRENCY = 4
const TICK_MS = 60_000
/** How often stacky's own image is re-checked while a newer release isn't reflected yet. */
const SELF_RECHECK_MS = 15 * 60_000

interface InUse {
  ref: string
  imageIds: Set<string>
  containers: Set<string>
  /** Names of the stacks those containers belong to. */
  stacks: Set<string>
  /** When the newest of its containers was created; a check from before that is out of date. */
  createdAt: number
  /** Used by stacky's own stack. */
  self: boolean
  /** `stacky.update.schedule` of each container; undefined for containers without the label. */
  schedules: Set<string | undefined>
  /** The distinct tag filter and link template labels set by its containers. */
  tagIncludes: Set<string>
  tagExcludes: Set<string>
  linkTemplates: Set<string>
}

/** The tag filter an image's labels ask for; invalid or conflicting labels are left out. */
interface ResolvedFilter {
  include?: string
  exclude?: string
  filter: TagFilter
  error?: string
}

/** The one label value containers sharing an image agree on, or why there isn't one. */
function agreed(values: Set<string>, label: string): { value?: string; error?: string } {
  if (values.size > 1)
    return { error: `containers using this image have different ${label} labels` }
  return { value: [...values][0] }
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
  private stopped = false
  private parsed = new Map<string, Schedule | ScheduleError>()
  private regexes = new Map<string, RegExp | SyntaxError>()
  private warned = new Set<string>()
  /** The newer stacky release, if one is known; stacky's own image is re-checked often until it shows it. */
  selfRelease: (() => string | undefined) | undefined
  /** Called with each new result for stacky's own image, so the release check can follow it. */
  onSelfChecked: ((result: ImageUpdate) => void) | undefined

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

  /** Also ends a running check before its next database write: the database closes next. */
  stop() {
    this.stopped = true
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
    const stored = new Map(
      this.db
        .select({
          ref: imageUpdates.ref,
          checkedAt: imageUpdates.checkedAt,
          data: imageUpdates.data,
        })
        .from(imageUpdates)
        .all()
        .map((r) => [r.ref, r]),
    )
    const global = this.parse(this.schedule().schedule)
    const result = new Map<string, Due>()
    for (const target of inUse.values()) {
      const last = stored.get(target.ref)
      const filter = this.filterFor(target)
      // a result from before a container was recreated, or found with other tag filters, is
      // stale (a deploy that restarted stacky loses its follow-up check): check as if never checked
      const lastCheckedAt =
        last &&
        last.checkedAt >= target.createdAt &&
        last.data.tagInclude === filter.include &&
        last.data.tagExclude === filter.exclude
          ? last.checkedAt
          : undefined
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
            : nextRun(schedule, lastCheckedAt, now, this.jitterMs)
        const due: Due = { at, label: labelError ? undefined : label, labelError }
        if (!best || (at !== undefined && (best.at === undefined || at < best.at))) best = due
        else if (labelError) best.labelError ??= labelError
      }
      // the GitHub release goes out before its image reaches the registry: keep looking, even
      // on a `never` schedule, so the image badge catches up with the release banner (also when it
      // already shows an older version than the release)
      const release = target.self ? this.selfRelease?.() : undefined
      const behind =
        release !== undefined &&
        (last?.data.status !== 'update_available' ||
          (last.data.newerTag !== undefined && compareVersions(release, last.data.newerTag) > 0))
      if (behind) {
        const soon = lastCheckedAt === undefined ? now : lastCheckedAt + SELF_RECHECK_MS
        best ??= { at: undefined }
        best.at = best.at === undefined ? soon : Math.min(best.at, soon)
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

  /** Checks stacky's own image now (e.g. when a new release is found). */
  async checkSelf() {
    const refs = [...this.inUse().values()].filter((t) => t.self).map((t) => t.ref)
    if (refs.length > 0) await this.checkAll(refs)
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
            stacks: new Set(),
            createdAt: 0,
            self: false,
            schedules: new Set(),
            tagIncludes: new Set(),
            tagExcludes: new Set(),
            linkTemplates: new Set(),
          }
          entry.imageIds.add(c.imageId)
          entry.containers.add(c.name)
          entry.stacks.add(stack.name)
          entry.createdAt = Math.max(entry.createdAt, c.createdAt)
          if (stack.isSelf) entry.self = true
          entry.schedules.add(c.updateSchedule?.trim() || undefined)
          if (c.tagInclude?.trim()) entry.tagIncludes.add(c.tagInclude.trim())
          if (c.tagExclude?.trim()) entry.tagExcludes.add(c.tagExclude.trim())
          if (c.linkTemplate?.trim()) entry.linkTemplates.add(c.linkTemplate.trim())
          map.set(ref, entry)
        }
      }
    }
    return map
  }

  private regex(source: string): RegExp | SyntaxError {
    let hit = this.regexes.get(source)
    if (!hit) {
      try {
        hit = new RegExp(source)
      } catch (err) {
        if (!(err instanceof SyntaxError)) throw err
        hit = err
      }
      this.regexes.set(source, hit)
    }
    return hit
  }

  /** The tag filter from an image's `stacky.tag.include` / `stacky.tag.exclude` labels. */
  private filterFor(target: InUse): ResolvedFilter {
    const result: ResolvedFilter = { filter: {} }
    const labels = [
      ['include', target.tagIncludes, 'stacky.tag.include'],
      ['exclude', target.tagExcludes, 'stacky.tag.exclude'],
    ] as const
    for (const [key, values, label] of labels) {
      const { value, error } = agreed(values, label)
      const re = value === undefined ? undefined : this.regex(value)
      const problem =
        error ??
        (re instanceof SyntaxError ? `${label} is not a valid regular expression` : undefined)
      if (problem) {
        result.error ??= problem
        const warning = `${target.ref}: ${problem}`
        if (!this.warned.has(warning)) {
          this.warned.add(warning)
          this.logger.warn(`${problem}; ignoring it`, { ref: target.ref, value })
        }
      } else if (value && re instanceof RegExp) {
        result[key] = value
        result.filter[key] = re
      }
    }
    return result
  }

  /** Release links for an update, from its containers' `stacky.link.template` label. */
  private links(u: ImageUpdate, target: InUse): Partial<ImageUpdate> {
    const { value: template, error } = agreed(target.linkTemplates, 'stacky.link.template')
    if (error) return { linkTemplateError: error }
    if (!template) return {}
    const current = renderLink(template, u.tag)
    const newer = u.newerTag ? renderLink(template, u.newerTag) : undefined
    const failed = [current, newer].find((r) => r && 'error' in r)
    return {
      linkTemplate: template,
      ...(failed && 'error' in failed
        ? { linkTemplateError: failed.error }
        : {
            ...(current && 'url' in current ? { currentLink: current.url } : {}),
            ...(newer && 'url' in newer ? { newerLink: newer.url } : {}),
          }),
    }
  }

  /** Names of the containers that run an image right now. */
  containersUsing(ref: string): string[] {
    return [...(this.inUse().get(ref)?.containers ?? [])]
  }

  /** Names of the stacks with a container that runs an image right now. */
  stacksUsing(ref: string): string[] {
    return [...(this.inUse().get(ref)?.stacks ?? [])]
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
        const target = inUse.get(r.ref)!
        const filterError = this.filterFor(target).error
        const u = {
          ...r.data,
          ...(d?.label ? { scheduleLabel: d.label } : {}),
          ...(d?.labelError ? { scheduleError: d.labelError } : {}),
          ...(filterError ? { tagFilterError: filterError } : {}),
          ...this.links(r.data, target),
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
    if (this.checking || this.stopped) return
    this.checking = true
    this.emit('change', this.summary())
    try {
      const targets = [...this.inUse().values()].filter((t) => !only || only.includes(t.ref))
      const wud = await this.wudResults()
      const queue = [...targets]
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let t = queue.shift(); t; t = queue.shift()) {
          const result = this.mergeWud(await this.check(t), t, wud)
          if (this.stopped) return
          this.save(result)
          this.emit('change', this.summary())
          if (t.self) this.onSelfChecked?.(result)
        }
      })
      await Promise.all(workers)
      this.lastCheckAt = this.now()
    } finally {
      this.checking = false
      if (!this.stopped) this.emit('change', this.summary())
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
    const filter = this.filterFor(target)
    const base = {
      ref: target.ref,
      registry: parsed.registry,
      repository: parsed.repository,
      tag: parsed.tag,
      checkedAt: this.now(),
      source: 'native' as const,
      ...(filter.include ? { tagInclude: filter.include } : {}),
      ...(filter.exclude ? { tagExclude: filter.exclude } : {}),
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
        newer = newestTag(parsed.tag, await this.registry.listTags(parsed, 10), filter.filter)
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
