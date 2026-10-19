import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const HASH_RE = /^[0-9a-f]{24}$/

/** Labels that pick a container's icon, highest priority first. */
export const ICON_LABELS = ['stacky.display.icon', 'dev.stacky.icon', 'wud.display.icon'] as const

/** Icon id of stacky's own logo; the web UI renders it without a request. */
export const STACKY_ICON = 'stacky'

/** Icon sets, by the prefixes What's Up Docker uses in `wud.display.icon`. */
export const ICON_SETS = ['sh', 'hl', 'si', 'mdi', 'fas', 'far', 'fab'] as const
export type IconSet = (typeof ICON_SETS)[number]

const PREFIXES: Record<string, IconSet> = {
  sh: 'sh',
  selfhst: 'sh',
  hl: 'hl',
  si: 'si',
  mdi: 'mdi',
  fa: 'fas',
  fas: 'fas',
  far: 'far',
  fab: 'fab',
}

const JSDELIVR = 'https://cdn.jsdelivr.net'
/** Where each set's files live; selfh.st follows `STACKY_ICON_CDN`. */
const SOURCES: Record<IconSet, (name: string, selfhst: string) => string> = {
  sh: (n, cdn) => `${cdn}/png/${n}.png`,
  hl: (n) => `${JSDELIVR}/gh/homarr-labs/dashboard-icons/png/${n}.png`,
  si: (n) => `${JSDELIVR}/npm/simple-icons/icons/${n}.svg`,
  mdi: (n) => `${JSDELIVR}/npm/@mdi/svg/svg/${n}.svg`,
  fas: (n) => `${JSDELIVR}/npm/@fortawesome/fontawesome-free/svgs/solid/${n}.svg`,
  far: (n) => `${JSDELIVR}/npm/@fortawesome/fontawesome-free/svgs/regular/${n}.svg`,
  fab: (n) => `${JSDELIVR}/npm/@fortawesome/fontawesome-free/svgs/brands/${n}.svg`,
}

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
const SELF_REPO = /(^|\/)patsissons\/stacky$/
const MISSING_TTL_MS = 24 * 60 * 60 * 1000
const MAX_ICON_BYTES = 512 * 1024
const MAX_URLS = 500

/**
 * Icon URLs seen in container labels, by hash. Only these can be fetched, so the icon
 * route never becomes an open proxy for arbitrary URLs.
 */
export class IconUrls {
  private urls = new Map<string, string>()

  register(url: string): string {
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 24)
    this.urls.delete(hash)
    this.urls.set(hash, url)
    if (this.urls.size > MAX_URLS) this.urls.delete(this.urls.keys().next().value!)
    return hash
  }

  get(hash: string): string | undefined {
    return this.urls.get(hash)
  }
}

/** Shared by the container lister (which registers) and the icon cache (which fetches). */
export const iconUrls = new IconUrls()

/** The icon label a container sets, if any. */
export function iconLabel(labels: Record<string, string> = {}): string | undefined {
  for (const key of ICON_LABELS) {
    const value = labels[key]?.trim()
    if (value) return value
  }
  return undefined
}

/** Parses an icon label: `name`, `<set>:name`, `stacky` or an http(s) URL. */
export function parseIconLabel(label: string, urls: IconUrls = iconUrls): string | undefined {
  const value = label.trim()
  if (/^https?:\/\/\S+$/i.test(value)) {
    try {
      return `url:${urls.register(new URL(value).toString())}`
    } catch {
      return undefined
    }
  }
  const m = /^(?:([a-z]+):)?([a-z0-9][a-z0-9-]*)$/i.exec(value)
  if (!m) return undefined
  const name = m[2]!.toLowerCase()
  if (!m[1] && name === STACKY_ICON) return STACKY_ICON
  const set = m[1] ? PREFIXES[m[1].toLowerCase()] : 'sh'
  return set && NAME_RE.test(name) ? `${set}:${name}` : undefined
}

/**
 * The icon id for a container: an explicit `stacky.display.icon` / `dev.stacky.icon` /
 * `wud.display.icon` label, stacky's own logo for its image, else the selfh.st icon named
 * after the image's repository.
 */
export function iconName(
  image: string,
  labels: Record<string, string> = {},
  urls: IconUrls = iconUrls,
): string | undefined {
  const label = iconLabel(labels)
  const fromLabel = label ? parseIconLabel(label, urls) : undefined
  if (fromLabel) return fromLabel
  const repo = image.split('@')[0]!.replace(/:[^/]*$/, '')
  if (SELF_REPO.test(repo)) return STACKY_ICON
  const last = repo.split('/').pop() ?? ''
  const name = last
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
  return NAME_RE.test(name) ? `sh:${ALIASES[name] ?? name}` : undefined
}

export interface Icon {
  data: Buffer
  type: string
}

/**
 * Serves app icons (selfh.st and the other sets What's Up Docker knows, plus URLs from
 * labels), fetched once and cached in the data dir (misses are remembered for a day), so
 * browsers never call a CDN.
 */
export class IconCache {
  constructor(
    private readonly dir: string,
    /** selfh.st base URL; empty disables the icon sets (URL labels still work). */
    private readonly cdn: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly urls: IconUrls = iconUrls,
  ) {}

  /** An icon from one of the sets; `sh` keeps the original `<name>.png` cache layout. */
  async get(set: string, name: string): Promise<Icon | undefined> {
    if (!(ICON_SETS as readonly string[]).includes(set) || !NAME_RE.test(name)) return undefined
    if (!this.cdn) return this.read(this.file(set as IconSet, name), set)
    const url = SOURCES[set as IconSet](name, this.cdn.replace(/\/$/, ''))
    return this.cached(this.file(set as IconSet, name), url, set === 'sh')
  }

  /** An icon from a URL a container label registered. */
  async getUrl(hash: string): Promise<Icon | undefined> {
    if (!HASH_RE.test(hash)) return undefined
    const file = path.join(this.dir, 'url', hash)
    const url = this.urls.get(hash)
    if (!url) return this.read(file, 'url')
    return this.cached(file, url, false)
  }

  private file(set: IconSet, name: string) {
    return set === 'sh' ? path.join(this.dir, `${name}.png`) : path.join(this.dir, set, name)
  }

  /** Reads a cached icon; the type sits next to it except for legacy selfh.st PNGs. */
  private async read(file: string, set: string): Promise<Icon | undefined> {
    try {
      const data = await fs.readFile(file)
      const type = set === 'sh' ? 'image/png' : (await fs.readFile(`${file}.type`, 'utf8')).trim()
      return type.startsWith('image/') ? { data, type } : undefined
    } catch {
      return undefined
    }
  }

  private async cached(file: string, url: string, legacy: boolean): Promise<Icon | undefined> {
    const hit = await this.read(file, legacy ? 'sh' : '')
    if (hit) return hit
    const missing = `${file}.missing`
    try {
      const stat = await fs.stat(missing)
      if (Date.now() - stat.mtimeMs < MISSING_TTL_MS) return undefined
    } catch {
      // never missed
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = Buffer.from(await res.arrayBuffer())
      if (data.length > MAX_ICON_BYTES) throw new Error('icon too large')
      const type = sniffImageType(data, res.headers.get('content-type') ?? '')
      if (!type || (legacy && type !== 'image/png')) throw new Error('not an image')
      await fs.writeFile(file, data)
      if (!legacy) await fs.writeFile(`${file}.type`, type)
      return { data, type }
    } catch {
      await fs.writeFile(missing, '')
      return undefined
    }
  }
}

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
])

/** The image type of some bytes, from their signature or (failing that) the declared type. */
export function sniffImageType(data: Buffer, declared: string): string | undefined {
  const hex = data.subarray(0, 12).toString('hex')
  if (hex.startsWith('89504e47')) return 'image/png'
  if (hex.startsWith('ffd8ff')) return 'image/jpeg'
  if (hex.startsWith('47494638')) return 'image/gif'
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp'
  if (hex.startsWith('00000100')) return 'image/x-icon'
  const head = data.subarray(0, 2048).toString('utf8').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i.test(head))
    return 'image/svg+xml'
  const type = declared.split(';')[0]!.trim().toLowerCase()
  return IMAGE_TYPES.has(type) && type !== 'image/svg+xml' ? type : undefined
}

/** Headers for serving an image stacky did not create: never sniffed, SVG never scripted. */
export function untrustedImageHeaders(type: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': type,
    'x-content-type-options': 'nosniff',
  }
  if (type === 'image/svg+xml') {
    headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }
  return headers
}
