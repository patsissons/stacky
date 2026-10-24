import { EventEmitter } from 'node:events'
import { APP_REPO } from '@stacky/shared'
import { compareVersions } from './image-ref'

export interface ReleaseInfo {
  version: string
  url: string
  publishedAt?: string
}

const REPO = APP_REPO
const CACHE_MS = 60 * 60 * 1000
/** Forced refreshes are at most this often, to stay well inside GitHub's anonymous rate limit. */
const REFRESH_FLOOR_MS = 5 * 60 * 1000

interface ReleaseEvents {
  /** The latest release changed (a different version than the one fetched before). */
  change: [ReleaseInfo | undefined]
}

/** Latest published stacky release from GitHub, cached for an hour. */
export class ReleaseChecker extends EventEmitter<ReleaseEvents> {
  private cached: { at: number; release?: ReleaseInfo } | undefined
  private inflight: Promise<ReleaseInfo | undefined> | undefined
  private lastFetchAt: number | undefined

  constructor(
    private readonly enabled: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    super()
  }

  async latest(): Promise<ReleaseInfo | undefined> {
    if (!this.enabled) return undefined
    if (this.cached && this.now() - this.cached.at < CACHE_MS) return this.cached.release
    return this.fetch()
  }

  /**
   * Looks again now, ignoring the cache (e.g. after stacky's own image changed in the registry).
   * Within a few minutes of the last fetch it returns the cached release instead.
   */
  async refresh(): Promise<ReleaseInfo | undefined> {
    if (!this.enabled) return undefined
    if (this.lastFetchAt !== undefined && this.now() - this.lastFetchAt < REFRESH_FLOOR_MS)
      return this.cached?.release
    return this.fetch()
  }

  private fetch(): Promise<ReleaseInfo | undefined> {
    this.inflight ??= this.load().finally(() => (this.inflight = undefined))
    return this.inflight
  }

  private async load(): Promise<ReleaseInfo | undefined> {
    this.lastFetchAt = this.now()
    try {
      const res = await this.fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'stacky' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as {
        tag_name: string
        html_url: string
        published_at?: string
      }
      const release = {
        version: body.tag_name.replace(/^v/, ''),
        url: body.html_url,
        publishedAt: body.published_at,
      }
      const previous = this.cached?.release
      this.cached = { at: this.now(), release }
      if (previous?.version !== release.version) this.emit('change', release)
      return release
    } catch {
      // try again later, but don't hammer the API on every request
      this.cached = { at: this.now() - CACHE_MS + 15 * 60 * 1000, release: this.cached?.release }
      return this.cached.release
    }
  }

  /** The newer release already fetched, if the running version is behind it; never fetches. */
  peek(current: string): ReleaseInfo | undefined {
    const latest = this.cached?.release
    if (!latest || !/^\d/.test(current)) return undefined
    return compareVersions(latest.version, current) > 0 ? latest : undefined
  }

  /** The newer release, if the running version is behind it. */
  async available(current: string): Promise<ReleaseInfo | undefined> {
    const latest = await this.latest()
    if (!latest || !/^\d/.test(current)) return undefined
    return compareVersions(latest.version, current) > 0 ? latest : undefined
  }
}
