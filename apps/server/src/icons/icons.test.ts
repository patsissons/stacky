import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { IconCache, IconUrls, iconName, sniffImageType, untrustedImageHeaders } from './icons'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')

describe('iconName', () => {
  it('derives selfh.st names from images', () => {
    expect(iconName('lscr.io/linuxserver/heimdall:v2.8.3')).toBe('sh:heimdall')
    expect(iconName('louislam/uptime-kuma:1')).toBe('sh:uptime-kuma')
    expect(iconName('nginx')).toBe('sh:nginx')
    expect(iconName('postgres:17')).toBe('sh:postgresql')
    expect(iconName('ghcr.io/org/my_app@sha256:abc')).toBe('sh:my-app')
  })

  it("uses stacky's own logo for its image", () => {
    expect(iconName('ghcr.io/patsissons/stacky:0.5.0')).toBe('stacky')
    expect(iconName('patsissons/stacky')).toBe('stacky')
    expect(iconName('someone/stacky')).toBe('sh:stacky')
  })

  it('honours the labels in priority order', () => {
    expect(iconName('x', { 'wud.display.icon': 'selfhst:jellyfin' })).toBe('sh:jellyfin')
    expect(iconName('x', { 'dev.stacky.icon': 'Plex' })).toBe('sh:plex')
    expect(
      iconName('x', {
        'stacky.display.icon': 'mdi:docker',
        'dev.stacky.icon': 'plex',
        'wud.display.icon': 'sh:jellyfin',
      }),
    ).toBe('mdi:docker')
    expect(iconName('x', { 'stacky.display.icon': '  ', 'dev.stacky.icon': 'plex' })).toBe(
      'sh:plex',
    )
    expect(iconName('nginx', { 'stacky.display.icon': 'stacky' })).toBe('stacky')
  })

  it("understands What's Up Docker's icon prefixes", () => {
    const label = (v: string) => iconName('nginx', { 'stacky.display.icon': v })
    expect(label('sh:plex')).toBe('sh:plex')
    expect(label('hl:home-assistant')).toBe('hl:home-assistant')
    expect(label('si:traefikproxy')).toBe('si:traefikproxy')
    expect(label('fa:server')).toBe('fas:server')
    expect(label('fab:docker')).toBe('fab:docker')
    expect(label('far:bell')).toBe('far:bell')
    // unknown prefixes and junk fall back to the image
    expect(label('xx:plex')).toBe('sh:nginx')
    expect(label('../etc/passwd')).toBe('sh:nginx')
  })

  it('registers icon URLs and refers to them by hash', () => {
    const urls = new IconUrls()
    const id = iconName('nginx', { 'stacky.display.icon': 'https://example.com/a.svg' }, urls)
    expect(id).toMatch(/^url:[0-9a-f]{24}$/)
    expect(urls.get(id!.slice(4))).toBe('https://example.com/a.svg')
    expect(iconName('nginx', { 'stacky.display.icon': 'ftp://example.com/a.png' }, urls)).toBe(
      'sh:nginx',
    )
  })

  it('keeps a bounded number of URLs', () => {
    const urls = new IconUrls()
    const first = urls.register('https://example.com/0.png')
    for (let i = 1; i <= 500; i++) urls.register(`https://example.com/${i}.png`)
    expect(urls.get(first)).toBeUndefined()
    expect(urls.get(urls.register('https://example.com/500.png'))).toBeDefined()
  })
})

describe('sniffImageType', () => {
  it('trusts signatures over the declared type', () => {
    expect(sniffImageType(PNG, 'application/octet-stream')).toBe('image/png')
    expect(sniffImageType(SVG, 'text/plain')).toBe('image/svg+xml')
    expect(sniffImageType(Buffer.from('<html>'), 'image/svg+xml')).toBeUndefined()
    expect(sniffImageType(Buffer.from('????'), 'image/avif')).toBe('image/avif')
    expect(sniffImageType(Buffer.from('nope'), 'text/html')).toBeUndefined()
  })

  it('locks SVG down when served', () => {
    expect(untrustedImageHeaders('image/svg+xml')['content-security-policy']).toContain(
      "default-src 'none'",
    )
    expect(untrustedImageHeaders('image/png')).toEqual({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
    })
  })
})

describe('IconCache', () => {
  let dir: string
  let calls: string[]
  const fetchImpl = (async (url: string) => {
    calls.push(url)
    if (url.endsWith('/nginx.png'))
      return new Response(PNG, { headers: { 'content-type': 'image/png' } })
    if (url.endsWith('/docker.svg') || url.endsWith('/logo'))
      return new Response(SVG, { headers: { 'content-type': 'text/plain' } })
    return new Response('nope', { status: 404 })
  }) as typeof fetch

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-icons-'))
    calls = []
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('fetches selfh.st icons once, caches, and remembers misses', async () => {
    const cache = new IconCache(dir, 'https://cdn.test/icons', fetchImpl)
    expect((await cache.get('sh', 'nginx'))?.data.length).toBe(8)
    expect((await cache.get('sh', 'nginx'))?.type).toBe('image/png')
    expect(fs.existsSync(path.join(dir, 'nginx.png'))).toBe(true)
    expect(await cache.get('sh', 'unknown')).toBeUndefined()
    expect(await cache.get('sh', 'unknown')).toBeUndefined()
    expect(calls).toEqual([
      'https://cdn.test/icons/png/nginx.png',
      'https://cdn.test/icons/png/unknown.png',
    ])
    expect(await cache.get('sh', '../etc/passwd')).toBeUndefined()
    expect(await cache.get('nope', 'nginx')).toBeUndefined()
  })

  it('fetches the other sets from their CDNs with their own type', async () => {
    const cache = new IconCache(dir, 'https://cdn.test/icons', fetchImpl)
    const icon = await cache.get('mdi', 'docker')
    expect(icon?.type).toBe('image/svg+xml')
    expect(calls[0]).toBe('https://cdn.jsdelivr.net/npm/@mdi/svg/svg/docker.svg')
    expect((await cache.get('mdi', 'docker'))?.type).toBe('image/svg+xml')
    expect(calls).toHaveLength(1)
  })

  it('only fetches URLs a label registered', async () => {
    const urls = new IconUrls()
    const cache = new IconCache(dir, undefined, fetchImpl, urls)
    expect(await cache.getUrl('0'.repeat(24))).toBeUndefined()
    expect(await cache.getUrl('../../x')).toBeUndefined()
    const hash = urls.register('https://example.com/logo')
    expect((await cache.getUrl(hash))?.type).toBe('image/svg+xml')
    expect(calls).toEqual(['https://example.com/logo'])
    // cached, even once the registry forgets it (e.g. after a restart)
    expect((await new IconCache(dir, undefined, fetchImpl).getUrl(hash))?.type).toBe(
      'image/svg+xml',
    )
  })

  it('serves only what is cached when the icon sets are disabled', async () => {
    await new IconCache(dir, 'https://cdn.test/icons', fetchImpl).get('sh', 'nginx')
    const offline = new IconCache(dir, undefined, fetchImpl)
    expect((await offline.get('sh', 'nginx'))?.type).toBe('image/png')
    expect(await offline.get('sh', 'other')).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})
