import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatRef,
  loadDockerCredentials,
  loadEnvCredentials,
  parseImageRef,
  RegistryClient,
  RegistryError,
} from './registry'

describe('parseImageRef', () => {
  it('normalises Docker Hub shorthand', () => {
    expect(parseImageRef('nginx')).toEqual({
      registry: 'docker.io',
      host: 'registry-1.docker.io',
      repository: 'library/nginx',
      tag: 'latest',
      digest: undefined,
    })
    expect(parseImageRef('lscr.io/linuxserver/heimdall:v2.8.3-ls364')).toMatchObject({
      registry: 'lscr.io',
      repository: 'linuxserver/heimdall',
      tag: 'v2.8.3-ls364',
    })
    expect(parseImageRef('localhost:5000/app@sha256:abc')).toMatchObject({
      registry: 'localhost:5000',
      tag: 'latest',
      digest: 'sha256:abc',
    })
    expect(formatRef(parseImageRef('nginx:1.27'))).toBe('nginx:1.27')
  })
})

describe('loadDockerCredentials', () => {
  it('reads auths from config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-cfg-'))
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        auths: { 'https://index.docker.io/v1/': { auth: 'dTpw' }, 'ghcr.io': { auth: 'Zzpo' } },
      }),
    )
    const creds = loadDockerCredentials(file)
    expect(creds.get('docker.io')).toBe('dTpw')
    expect(creds.get('ghcr.io')).toBe('Zzpo')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('loadEnvCredentials', () => {
  const b64 = (s: string) => Buffer.from(s).toString('base64')

  it('maps WUD-style providers to registry hosts', () => {
    const creds = loadEnvCredentials({
      WUD_REGISTRY_LSCR_PRIVATE_USERNAME: 'me',
      WUD_REGISTRY_LSCR_PRIVATE_TOKEN: 'ghp_x',
      STACKY_REGISTRY_HUB_LOGIN: 'hubber',
      STACKY_REGISTRY_HUB_PASSWORD: 'pw',
      STACKY_REGISTRY_GHCR_MY_ORG_USERNAME: 'org',
      STACKY_REGISTRY_GHCR_MY_ORG_TOKEN: 't',
      STACKY_REGISTRY_QUAY_ROBOT_NAMESPACE: 'acme',
      STACKY_REGISTRY_QUAY_ROBOT_ACCOUNT: 'ci',
      STACKY_REGISTRY_QUAY_ROBOT_TOKEN: 'q',
      STACKY_REGISTRY_CUSTOM_HOME_URL: 'https://registry.home:5000',
      STACKY_REGISTRY_CUSTOM_HOME_AUTH: b64('a:b'),
      STACKY_REGISTRY_GITLAB_WORK_TOKEN: 'glpat',
      PATH: '/usr/bin',
    })
    expect(Object.fromEntries(creds)).toEqual({
      'lscr.io': b64('me:ghp_x'),
      'docker.io': b64('hubber:pw'),
      'ghcr.io': b64('org:t'),
      'quay.io': b64('acme+ci:q'),
      'registry.home:5000': b64('a:b'),
      'registry.gitlab.com': b64(':glpat'),
    })
  })

  it('prefers STACKY_ variables, then names in order', () => {
    const creds = loadEnvCredentials({
      WUD_REGISTRY_GHCR_A_USERNAME: 'wud',
      WUD_REGISTRY_GHCR_A_TOKEN: 'w',
      STACKY_REGISTRY_GHCR_B_USERNAME: 'b',
      STACKY_REGISTRY_GHCR_B_TOKEN: 'tb',
      STACKY_REGISTRY_GHCR_A_USERNAME: 'a',
      STACKY_REGISTRY_GHCR_A_TOKEN: 'ta',
    })
    expect(creds.get('ghcr.io')).toBe(b64('a:ta'))
  })

  it('skips cloud providers and incomplete entries without logging secrets', () => {
    const warnings: unknown[] = []
    const creds = loadEnvCredentials(
      {
        WUD_REGISTRY_ECR_PRIVATE_ACCESSKEYID: 'x',
        WUD_REGISTRY_ECR_PRIVATE_SECRETACCESSKEY: 'y',
        WUD_REGISTRY_ECR_PRIVATE_REGION: 'eu-west-1',
        STACKY_REGISTRY_ACR_X_TOKEN: 'secret-acr',
        STACKY_REGISTRY_LSCR_TOKEN: 'secret-only',
        STACKY_REGISTRY_CUSTOM_NOURL_LOGIN: 'u',
        STACKY_REGISTRY_CUSTOM_NOURL_PASSWORD: 'secret-pw',
      },
      (message, meta) => warnings.push({ message, ...meta }),
    )
    expect(creds.size).toBe(0)
    expect(warnings).toHaveLength(4)
    expect(JSON.stringify(warnings)).not.toMatch(/secret/)
  })
})

describe('RegistryClient', () => {
  it('sends credentials from variables with the token request', async () => {
    const seen: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>).authorization ?? ''
      if (url.startsWith('https://ghcr.io/token')) {
        seen.push(auth)
        return new Response(JSON.stringify({ token: 'T' }))
      }
      if (auth !== 'Bearer T') {
        return new Response(null, {
          status: 401,
          headers: { 'www-authenticate': 'Bearer realm="https://ghcr.io/token",service="ghcr.io"' },
        })
      }
      return new Response(null, { headers: { 'docker-content-digest': 'sha256:x' } })
    }) as typeof fetch
    const creds = loadEnvCredentials({
      WUD_REGISTRY_LSCR_PRIVATE_USERNAME: 'me',
      WUD_REGISTRY_LSCR_PRIVATE_TOKEN: 'ghp_x',
    })
    const client = new RegistryClient(creds, fetchImpl)
    expect(await client.manifestDigest(parseImageRef('lscr.io/linuxserver/sonarr:4'))).toBe(
      'sha256:x',
    )
    expect(seen).toEqual([`Basic ${Buffer.from('me:ghp_x').toString('base64')}`])
  })

  it('follows the bearer token flow and reads the digest header', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(
        `${init?.method} ${url} ${(init?.headers as Record<string, string>)?.authorization ?? ''}`,
      )
      if (url.startsWith('https://auth.example/token')) {
        return new Response(JSON.stringify({ token: 'T', expires_in: 300 }))
      }
      const auth = (init?.headers as Record<string, string>).authorization
      if (auth !== 'Bearer T') {
        return new Response(null, {
          status: 401,
          headers: {
            'www-authenticate': 'Bearer realm="https://auth.example/token",service="reg"',
          },
        })
      }
      return new Response(null, { headers: { 'docker-content-digest': 'sha256:remote' } })
    }) as typeof fetch
    const client = new RegistryClient(new Map(), fetchImpl)
    const ref = parseImageRef('ghcr.io/org/app:1.0.0')
    expect(await client.manifestDigest(ref)).toBe('sha256:remote')
    expect(await client.manifestDigest(ref)).toBe('sha256:remote')
    // the token is cached: one token request for two lookups
    expect(calls.filter((c) => c.includes('auth.example'))).toHaveLength(1)
    expect(calls.some((c) => c.includes('scope=repository%3Aorg%2Fapp%3Apull'))).toBe(true)
  })

  it('paginates tag lists', async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes('last=')) return new Response(JSON.stringify({ tags: ['3'] }))
      return new Response(JSON.stringify({ tags: ['1', '2'] }), {
        headers: { link: '</v2/org/app/tags/list?n=1000&last=2>; rel="next"' },
      })
    }) as typeof fetch
    const client = new RegistryClient(new Map(), fetchImpl)
    expect(await client.listTags(parseImageRef('ghcr.io/org/app:1'))).toEqual(['1', '2', '3'])
  })

  it('reports rate limits with retry-after', async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 429, headers: { 'retry-after': '30' } })) as typeof fetch
    const err = await new RegistryClient(new Map(), fetchImpl)
      .manifestDigest(parseImageRef('nginx:1'))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RegistryError)
    expect((err as RegistryError).retryAfterMs).toBe(30_000)
  })
})
