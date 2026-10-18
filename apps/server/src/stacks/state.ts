import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type Docker from 'dockerode'
import type { StackSummary } from '@stacky/shared'
import type { ComposeContainer, ContainerLister } from '../docker/containers'
import type { Logger } from '../lib/logger'
import { parseCompose, type ParsedCompose } from './compose-file'
import type { StackRepository } from './repository'
import { buildStackSummaries, type ManagedStack } from './summaries'

const DEBOUNCE_MS = 250
const SAFETY_REFRESH_MS = 30_000

interface StackStateEvents {
  change: [StackSummary[]]
}

/**
 * Live model of every stack. Refreshes (debounced) on docker container events,
 * on file changes in the stacks directory, and periodically as a safety net,
 * and emits `change` only when the snapshot actually differs.
 */
export class StackState extends EventEmitter<StackStateEvents> {
  private snapshot: StackSummary[] = []
  private containers: ComposeContainer[] = []
  private serialized = ''
  private parsedCache = new Map<string, { mtimeMs: number; parsed: ParsedCompose }>()
  private activeOperations = new Map<string, string>()
  private timer: NodeJS.Timeout | undefined
  private refreshing: Promise<void> | undefined
  private pending = false
  private watchers = new Map<string, fs.FSWatcher>()
  private interval: NodeJS.Timeout | undefined
  private eventStream: NodeJS.ReadableStream | undefined
  private stopped = false
  selfContainerId: string | undefined

  constructor(
    private readonly repo: StackRepository,
    private readonly docker: Docker,
    private readonly lister: ContainerLister,
    private readonly logger: Logger,
  ) {
    super()
  }

  async start() {
    await this.refreshNow()
    this.watchStacksDir()
    void this.listenToDocker()
    this.interval = setInterval(() => this.schedule(), SAFETY_REFRESH_MS)
    this.interval.unref()
  }

  stop() {
    this.stopped = true
    clearInterval(this.interval)
    clearTimeout(this.timer)
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
    ;(this.eventStream as unknown as { destroy?: () => void } | undefined)?.destroy?.()
  }

  list(): StackSummary[] {
    return this.snapshot
  }

  get(name: string): StackSummary | undefined {
    return (
      this.snapshot.find((s) => s.name === name && s.managed) ??
      this.snapshot.find((s) => s.name === name)
    )
  }

  /** Raw containers (with labels) from the latest refresh. */
  allContainers(): ComposeContainer[] {
    return this.containers
  }

  setActiveOperation(stack: string, operationId: string) {
    this.activeOperations.set(stack, operationId)
    this.schedule(0)
  }

  /** Clears the marker only if it still belongs to this operation (another may have started). */
  clearActiveOperation(stack: string, operationId: string, next?: string) {
    if (this.activeOperations.get(stack) !== operationId) return
    if (next) this.activeOperations.set(stack, next)
    else this.activeOperations.delete(stack)
    this.schedule(0)
  }

  activeOperation(stack: string): string | undefined {
    return this.activeOperations.get(stack)
  }

  /** Request a refresh soon (coalesces bursts of events). */
  schedule(delay = DEBOUNCE_MS) {
    if (this.stopped) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refreshNow(), delay)
  }

  async refreshNow(): Promise<void> {
    if (this.refreshing) {
      this.pending = true
      return this.refreshing
    }
    this.refreshing = this.doRefresh()
      .catch((err) => this.logger.warn('stack refresh failed', { err: String(err) }))
      .finally(() => {
        this.refreshing = undefined
        if (this.pending) {
          this.pending = false
          this.schedule(0)
        }
      })
    return this.refreshing
  }

  private async doRefresh() {
    const dirs = await this.repo.list()
    const managed: ManagedStack[] = await Promise.all(
      dirs.map(async (d) => ({ ...d, parsed: await this.parse(path.join(d.dir, d.composeFile)) })),
    )
    let containers: ComposeContainer[] = []
    try {
      containers = await this.lister.list()
    } catch (err) {
      this.logger.warn('docker unavailable; showing stacks from disk only', { err: String(err) })
    }
    this.containers = containers
    const snapshot = buildStackSummaries(managed, containers, {
      selfContainerId: this.selfContainerId,
      activeOperations: this.activeOperations,
    })
    this.syncDirWatchers(dirs.map((d) => d.dir))
    const serialized = JSON.stringify(snapshot)
    if (serialized !== this.serialized) {
      this.serialized = serialized
      this.snapshot = snapshot
      this.emit('change', snapshot)
    }
  }

  private async parse(file: string): Promise<ParsedCompose> {
    try {
      const stat = await fs.promises.stat(file)
      const cached = this.parsedCache.get(file)
      if (cached && cached.mtimeMs === stat.mtimeMs) return cached.parsed
      const parsed = parseCompose(await fs.promises.readFile(file, 'utf8'))
      this.parsedCache.set(file, { mtimeMs: stat.mtimeMs, parsed })
      return parsed
    } catch (err) {
      return { services: [], urls: [], error: { message: String(err) } }
    }
  }

  private watchStacksDir() {
    this.watch(this.repo.stacksDir)
  }

  /** Non-recursive watchers: the stacks dir plus each stack dir (stacks may hold large data dirs). */
  private syncDirWatchers(dirs: string[]) {
    const wanted = new Set([this.repo.stacksDir, ...dirs])
    for (const [dir, w] of this.watchers) {
      if (!wanted.has(dir)) {
        w.close()
        this.watchers.delete(dir)
      }
    }
    for (const dir of dirs) this.watch(dir)
  }

  private watch(dir: string) {
    if (this.watchers.has(dir) || this.stopped) return
    try {
      const w = fs.watch(dir, { persistent: false }, () => this.schedule())
      w.on('error', () => {
        w.close()
        this.watchers.delete(dir)
      })
      this.watchers.set(dir, w)
    } catch {
      // directory vanished or watching unsupported; the safety refresh covers it
    }
  }

  private async listenToDocker() {
    let backoff = 1000
    while (!this.stopped) {
      try {
        const stream = await this.docker.getEvents({ filters: { type: ['container'] } })
        this.eventStream = stream
        backoff = 1000
        this.schedule(0)
        await new Promise<void>((resolve) => {
          stream.on('data', () => this.schedule())
          stream.on('end', resolve)
          stream.on('close', resolve)
          stream.on('error', () => resolve())
        })
      } catch (err) {
        this.logger.debug('docker events unavailable', { err: String(err) })
      }
      if (this.stopped) return
      await new Promise((r) => setTimeout(r, backoff).unref())
      backoff = Math.min(backoff * 2, 30_000)
    }
  }
}
