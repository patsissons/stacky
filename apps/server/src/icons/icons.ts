import fs from 'node:fs/promises'
import path from 'node:path'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Image names whose selfh.st icon has a different name. */
const ALIASES: Record<string, string> = {
  alpine: 'alpine-linux',
  postgres: 'postgresql',
  mongo: 'mongodb',
  node: 'nodejs',
  httpd: 'apache',
  pihole: 'pi-hole',
  adguardhome: 'adguard-home',
  'home-assistant': 'home-assistant',
}
const MISSING_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The icon name for a container: an explicit `dev.stacky.icon` / `wud.display.icon`
 * label (`selfhst:name` or a bare name), else the image's repository name.
 */
export function iconName(image: string, labels: Record<string, string> = {}): string | undefined {
  const label = labels['dev.stacky.icon'] ?? labels['wud.display.icon']
  if (label) {
    const m = /^(?:selfhst:|sh:)?([a-z0-9-]+)$/i.exec(label.trim())
    if (m) return m[1]!.toLowerCase()
  }
  const repo = image.split('@')[0]!.replace(/:[^/]*$/, '')
  const last = repo.split('/').pop() ?? ''
  const name = last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return NAME_RE.test(name) ? (ALIASES[name] ?? name) : undefined
}

/**
 * Serves app icons from the selfh.st icon set, fetched once and cached in the
 * data dir (misses are remembered for a day), so browsers never call a CDN.
 */
export class IconCache {
  constructor(
    private readonly dir: string,
    private readonly cdn: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(name: string): Promise<{ data: Buffer; type: string } | undefined> {
    if (!NAME_RE.test(name)) return undefined
    const file = path.join(this.dir, `${name}.png`)
    const missing = path.join(this.dir, `${name}.missing`)
    try {
      return { data: await fs.readFile(file), type: 'image/png' }
    } catch {
      // not cached yet
    }
    if (!this.cdn) return undefined
    try {
      const stat = await fs.stat(missing)
      if (Date.now() - stat.mtimeMs < MISSING_TTL_MS) return undefined
    } catch {
      // never missed
    }
    await fs.mkdir(this.dir, { recursive: true })
    try {
      const res = await this.fetchImpl(`${this.cdn.replace(/\/$/, '')}/png/${name}.png`, {
        signal: AbortSignal.timeout(10_000),
      })
      const type = res.headers.get('content-type') ?? ''
      if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status}`)
      const data = Buffer.from(await res.arrayBuffer())
      if (data.length > 512 * 1024) throw new Error('icon too large')
      await fs.writeFile(file, data)
      return { data, type: 'image/png' }
    } catch {
      await fs.writeFile(missing, '')
      return undefined
    }
  }
}
