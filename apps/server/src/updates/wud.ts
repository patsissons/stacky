import type { UpdateKind } from '@stacky/shared'

export interface WudSettings {
  url: string
  token?: string
}

/** The parts of a WUD container we use (WUD 9 REST API). */
interface WudContainer {
  name: string
  updateAvailable?: boolean
  image?: { tag?: { value?: string } }
  result?: { tag?: string; digest?: string }
  updateKind?: { kind?: 'tag' | 'digest'; semverDiff?: string; remoteValue?: string }
}

export interface WudResult {
  container: string
  updateAvailable: boolean
  newerTag?: string
  kind?: UpdateKind
}

/** Reads update information from a What's Up Docker instance. */
export class WudClient {
  constructor(
    private readonly settings: WudSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, method = 'GET') {
    const res = await this.fetchImpl(new URL(path, this.settings.url), {
      method,
      headers: {
        accept: 'application/json',
        ...(this.settings.token ? { authorization: `Bearer ${this.settings.token}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.status === 401 || res.status === 403) throw new Error('WUD rejected the API token')
    if (!res.ok) throw new Error(`WUD responded with HTTP ${res.status}`)
    return res.json() as Promise<unknown>
  }

  /** Asks WUD to re-check every container now. */
  async watch() {
    await this.call('/api/containers/watch', 'POST')
  }

  async containers(): Promise<WudResult[]> {
    const list = (await this.call('/api/containers')) as WudContainer[]
    return list.map((c) => {
      const kind = c.updateKind
      const newerTag = kind?.kind === 'tag' ? (kind.remoteValue ?? c.result?.tag) : undefined
      const semver = kind?.semverDiff
      return {
        container: c.name,
        updateAvailable: !!c.updateAvailable,
        newerTag,
        kind: !c.updateAvailable
          ? undefined
          : kind?.kind === 'digest'
            ? 'digest'
            : semver === 'major' || semver === 'minor' || semver === 'patch'
              ? semver
              : 'prerelease',
      }
    })
  }
}
