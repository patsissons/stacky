import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface ImageRef {
  /** Registry as written by users: docker.io, ghcr.io, lscr.io, localhost:5000 ... */
  registry: string
  /** Host to talk to (Docker Hub's API lives at registry-1.docker.io). */
  host: string
  repository: string
  tag: string
  digest?: string
}

/** Normalises an image reference the way the docker CLI does. */
export function parseImageRef(ref: string): ImageRef {
  let rest = ref.trim()
  let digest: string | undefined
  const at = rest.indexOf('@')
  if (at >= 0) {
    digest = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }
  let tag = 'latest'
  const colon = rest.lastIndexOf(':')
  if (colon > rest.lastIndexOf('/')) {
    tag = rest.slice(colon + 1)
    rest = rest.slice(0, colon)
  }
  const first = rest.split('/')[0] ?? ''
  const explicit =
    rest.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')
  const registry = explicit ? first : 'docker.io'
  let repository = explicit ? rest.slice(first.length + 1) : rest
  if (registry === 'docker.io' && !repository.includes('/')) repository = `library/${repository}`
  const host = registry === 'docker.io' ? 'registry-1.docker.io' : registry
  return { registry, host, repository, tag, digest }
}

export function formatRef(ref: ImageRef): string {
  const repo =
    ref.registry === 'docker.io'
      ? ref.repository.replace(/^library\//, '')
      : `${ref.registry}/${ref.repository}`
  return `${repo}:${ref.tag}`
}

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message)
  }
}

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
].join(', ')

/** Credentials from a docker config.json (`auths` entries; credential helpers are not supported). */
export function loadDockerCredentials(
  file = path.join(process.env.DOCKER_CONFIG ?? path.join(os.homedir(), '.docker'), 'config.json'),
): Map<string, string> {
  const creds = new Map<string, string>()
  try {
    const config = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      auths?: Record<string, { auth?: string }>
    }
    for (const [server, entry] of Object.entries(config.auths ?? {})) {
      if (!entry.auth) continue
      const host = server.replace(/^https?:\/\//, '').split('/')[0]!
      creds.set(host === 'index.docker.io' ? 'docker.io' : host, entry.auth)
    }
  } catch {
    // no config: anonymous access only
  }
  return creds
}

/** Registry hosts of the providers What's Up Docker names in `WUD_REGISTRY_<PROVIDER>_*`. */
const PROVIDER_HOSTS: Record<string, string | undefined> = {
  HUB: 'docker.io',
  GHCR: 'ghcr.io',
  LSCR: 'lscr.io',
  QUAY: 'quay.io',
  GITLAB: 'registry.gitlab.com',
  CUSTOM: undefined,
  GITEA: undefined,
  FORGEJO: undefined,
}
// the last segment is the key (USERNAME, TOKEN, URL ...); a name in between is optional
const ENV_RE = /^(STACKY|WUD)_REGISTRY_([A-Z0-9]+)_(?:([A-Z0-9_]+?)_)?([A-Z]+)$/

/**
 * Credentials from `STACKY_REGISTRY_<PROVIDER>[_<NAME>]_<KEY>` variables, or What's Up Docker's
 * `WUD_REGISTRY_*` ones, by registry host. `STACKY_` wins over `WUD_`, then names in order.
 */
export function loadEnvCredentials(
  env: Record<string, string | undefined>,
  warn: (message: string, meta: Record<string, unknown>) => void = () => {},
): Map<string, string> {
  const groups = new Map<
    string,
    { prefix: string; provider: string; name: string; values: Record<string, string> }
  >()
  for (const [key, value] of Object.entries(env)) {
    const m = ENV_RE.exec(key)
    if (!m || !value?.trim()) continue
    const [, prefix, provider, name = ''] = m
    const id = `${prefix}_REGISTRY_${provider}${name ? `_${name}` : ''}`
    const group = groups.get(id) ?? { prefix: prefix!, provider: provider!, name, values: {} }
    group.values[m[4]!] = value.trim()
    groups.set(id, group)
  }
  const ordered = [...groups.entries()].sort(
    ([, a], [, b]) =>
      Number(a.prefix !== 'STACKY') - Number(b.prefix !== 'STACKY') || a.name.localeCompare(b.name),
  )
  const creds = new Map<string, string>()
  for (const [id, { provider, values: v }] of ordered) {
    if (!(provider in PROVIDER_HOSTS)) {
      warn('unsupported registry provider; ignoring its variables', { variables: `${id}_*` })
      continue
    }
    let host = PROVIDER_HOSTS[provider]
    if (v.URL && provider !== 'HUB') {
      try {
        host = new URL(v.URL.includes('://') ? v.URL : `https://${v.URL}`).host
      } catch {
        host = undefined
      }
    }
    const user =
      provider === 'QUAY' && v.NAMESPACE && v.ACCOUNT
        ? `${v.NAMESPACE}+${v.ACCOUNT}`
        : (v.USERNAME ?? v.LOGIN ?? (provider === 'GITLAB' ? '' : undefined))
    const secret = v.TOKEN ?? v.PASSWORD
    const auth =
      v.AUTH ??
      (user !== undefined && secret
        ? Buffer.from(`${user}:${secret}`).toString('base64')
        : undefined)
    if (!host || !auth) {
      warn(
        host
          ? 'incomplete registry credentials; ignoring them'
          : 'registry URL missing or invalid; ignoring its credentials',
        { variables: `${id}_*` },
      )
      continue
    }
    if (!creds.has(host)) creds.set(host, auth)
  }
  return creds
}

/**
 * Minimal registry v2 client: manifest digests (HEAD, which Docker Hub does
 * not count against pull limits) and tag lists, with the bearer token flow.
 */
export class RegistryClient {
  private tokens = new Map<string, { token: string; expires: number }>()

  constructor(
    private readonly credentials: Map<string, string> = new Map(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async manifestDigest(ref: ImageRef): Promise<string> {
    const url = `${scheme(ref.host)}://${ref.host}/v2/${ref.repository}/manifests/${ref.tag}`
    const res = await this.request(ref, url, 'HEAD', MANIFEST_TYPES)
    const digest = res.headers.get('docker-content-digest')
    if (digest) return digest
    // some registries omit the header on HEAD; hash the manifest body instead
    const body = await this.request(ref, url, 'GET', MANIFEST_TYPES)
    return `sha256:${createHash('sha256')
      .update(Buffer.from(await body.arrayBuffer()))
      .digest('hex')}`
  }

  async listTags(ref: ImageRef, maxPages = 20): Promise<string[]> {
    const tags: string[] = []
    let next: string | undefined =
      `${scheme(ref.host)}://${ref.host}/v2/${ref.repository}/tags/list?n=1000`
    for (let page = 0; next && page < maxPages; page++) {
      const res = await this.request(ref, next, 'GET', 'application/json')
      const body = (await res.json()) as { tags?: string[] | null }
      tags.push(...(body.tags ?? []))
      const link = res.headers.get('link')
      const m = link && /<([^>]+)>;\s*rel="next"/.exec(link)
      next = m ? new URL(m[1]!, `${scheme(ref.host)}://${ref.host}`).toString() : undefined
    }
    return tags
  }

  private async request(
    ref: ImageRef,
    url: string,
    method: string,
    accept: string,
  ): Promise<Response> {
    const scope = `repository:${ref.repository}:pull`
    const headers: Record<string, string> = { accept, 'user-agent': 'stacky' }
    const cached = this.tokens.get(`${ref.host}|${scope}`)
    if (cached && cached.expires > Date.now()) headers.authorization = `Bearer ${cached.token}`
    else if (this.credentials.has(ref.registry))
      headers.authorization = `Basic ${this.credentials.get(ref.registry)}`

    let res = await this.send(url, method, headers)
    if (res.status === 401) {
      const challenge = res.headers.get('www-authenticate') ?? ''
      if (/^bearer/i.test(challenge)) {
        headers.authorization = `Bearer ${await this.token(ref, challenge, scope)}`
        res = await this.send(url, method, headers)
      }
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'))
      throw new RegistryError(
        'registry rate limit reached',
        429,
        Number.isFinite(retry) ? retry * 1000 : undefined,
      )
    }
    if (res.status === 401 || res.status === 403) {
      throw new RegistryError('access denied (private image? add credentials)', res.status)
    }
    if (res.status === 404) throw new RegistryError('image or tag not found in the registry', 404)
    if (!res.ok) throw new RegistryError(`registry responded with HTTP ${res.status}`, res.status)
    return res
  }

  private async send(url: string, method: string, headers: Record<string, string>) {
    try {
      return await this.fetchImpl(url, { method, headers, signal: AbortSignal.timeout(20_000) })
    } catch (err) {
      throw new RegistryError(
        `cannot reach the registry: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private async token(ref: ImageRef, challenge: string, scope: string): Promise<string> {
    const params = Object.fromEntries(
      [...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!.toLowerCase(), m[2]!]),
    )
    if (!params.realm) throw new RegistryError('registry sent an invalid auth challenge')
    const url = new URL(params.realm)
    if (params.service) url.searchParams.set('service', params.service)
    url.searchParams.set('scope', params.scope ?? scope)
    const headers: Record<string, string> = { 'user-agent': 'stacky' }
    const basic = this.credentials.get(ref.registry)
    if (basic) headers.authorization = `Basic ${basic}`
    const res = await this.send(url.toString(), 'GET', headers)
    if (!res.ok)
      throw new RegistryError(`registry token request failed (HTTP ${res.status})`, res.status)
    const body = (await res.json()) as {
      token?: string
      access_token?: string
      expires_in?: number
    }
    const token = body.token ?? body.access_token
    if (!token) throw new RegistryError('registry returned no token')
    this.tokens.set(`${ref.host}|${scope}`, {
      token,
      expires: Date.now() + Math.max(30, (body.expires_in ?? 60) - 10) * 1000,
    })
    return token
  }
}

function scheme(host: string) {
  return host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https'
}
