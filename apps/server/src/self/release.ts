import { APP_REPO } from '@stacky/shared'
import { compareVersions } from './image-ref'

export interface ReleaseInfo {
  version: string
  url: string
  publishedAt?: string
}

const REPO = APP_REPO
const CACHE_MS = 6 * 60 * 60 * 1000

/** Latest published stacky release from GitHub, cached for six hours. */
export class ReleaseChecker {
  private cached: { at: number; release?: ReleaseInfo } | undefined

  constructor(
    private readonly enabled: boolean,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async latest(): Promise<ReleaseInfo | undefined> {
    if (!this.enabled) return undefined
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.release
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
      this.cached = { at: Date.now(), release }
      return release
    } catch {
      // try again later, but don't hammer the API on every request
      this.cached = { at: Date.now() - CACHE_MS + 15 * 60 * 1000, release: this.cached?.release }
      return this.cached.release
    }
  }

  /** The newer release, if the running version is behind it. */
  async available(current: string): Promise<ReleaseInfo | undefined> {
    const latest = await this.latest()
    if (!latest || !/^\d/.test(current)) return undefined
    return compareVersions(latest.version, current) > 0 ? latest : undefined
  }
}
