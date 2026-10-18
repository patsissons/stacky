import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IconCache, iconName } from './icons'

describe('iconName', () => {
  it('derives names from images and honours labels', () => {
    expect(iconName('lscr.io/linuxserver/heimdall:v2.8.3')).toBe('heimdall')
    expect(iconName('louislam/uptime-kuma:1')).toBe('uptime-kuma')
    expect(iconName('nginx')).toBe('nginx')
    expect(iconName('postgres:17')).toBe('postgresql')
    expect(iconName('ghcr.io/org/my_app@sha256:abc')).toBe('my-app')
    expect(iconName('x', { 'wud.display.icon': 'selfhst:jellyfin' })).toBe('jellyfin')
    expect(iconName('x', { 'dev.stacky.icon': 'Plex' })).toBe('plex')
  })
})

describe('IconCache', () => {
  it('fetches once, caches, and remembers misses', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-icons-'))
    let calls = 0
    const fetchImpl = (async (url: string) => {
      calls++
      return url.endsWith('/nginx.png')
        ? new Response(Buffer.from([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })
        : new Response('nope', { status: 404 })
    }) as typeof fetch
    const cache = new IconCache(dir, 'https://cdn.test/icons', fetchImpl)
    expect((await cache.get('nginx'))?.data.length).toBe(4)
    expect((await cache.get('nginx'))?.type).toBe('image/png')
    expect(await cache.get('unknown')).toBeUndefined()
    expect(await cache.get('unknown')).toBeUndefined()
    expect(calls).toBe(2)
    expect(await cache.get('../etc/passwd')).toBeUndefined()
    expect(await new IconCache(dir, undefined, fetchImpl).get('other')).toBeUndefined()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
