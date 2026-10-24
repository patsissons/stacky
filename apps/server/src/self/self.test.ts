import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { setServiceImage } from './compose-edit'
import { compareVersions, isMovingTag, splitRef, withTag } from './image-ref'
import { JobStore, type SelfUpdateJob } from './jobs'
import { ReleaseChecker } from './release'

describe('image refs', () => {
  it('splits and retags references, including registries with ports', () => {
    expect(splitRef('ghcr.io/patsissons/stacky:0.2.0')).toEqual({
      repository: 'ghcr.io/patsissons/stacky',
      tag: '0.2.0',
    })
    expect(splitRef('localhost:5000/stacky')).toEqual({ repository: 'localhost:5000/stacky' })
    expect(withTag('localhost:5000/stacky:old@sha256:abc', 'new')).toBe('localhost:5000/stacky:new')
  })

  it('knows which tags move', () => {
    expect(isMovingTag('latest')).toBe(true)
    expect(isMovingTag('edge')).toBe(true)
    expect(isMovingTag('0.4')).toBe(true)
    expect(isMovingTag('0.4.1')).toBe(false)
    expect(isMovingTag('v1.2.3-rc.1')).toBe(false)
  })

  it('compares versions', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
  })
})

describe('setServiceImage', () => {
  it('changes only the image line and keeps comments', () => {
    const text = `# stacky manages itself
services:
  stacky:
    image: ghcr.io/patsissons/stacky:0.1.0 # pinned
    ports:
      - 5005:5005
  other:
    image: nginx
`
    const out = setServiceImage(text, 'stacky', 'ghcr.io/patsissons/stacky:0.2.0')
    expect(out).toBe(text.replace('0.1.0', '0.2.0'))
  })

  it('fails clearly for unknown services', () => {
    expect(() => setServiceImage('services: {}\n', 'stacky', 'x')).toThrow(/not found/)
  })
})

describe('JobStore', () => {
  it('writes, reads, lists newest first and prunes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-jobs-'))
    const store = new JobStore(dir)
    const job = (id: string, createdAt: number): SelfUpdateJob => ({
      id,
      operationId: 'op',
      action: 'update',
      state: 'pending',
      project: 'stacky',
      service: 'stacky',
      workingDir: '/opt/stacks/stacky',
      configFiles: ['/opt/stacks/stacky/compose.yaml'],
      envFiles: [],
      from: { ref: 'a', imageId: 'sha256:1', version: '0.1.0' },
      to: { ref: 'a' },
      createdAt,
    })
    await store.write(job('j1', 1))
    await store.write(job('j2', 2))
    expect((await store.latest())?.id).toBe('j2')
    await store.prune(1)
    expect((await store.list()).map((j) => j.id)).toEqual(['j2'])
    await expect(store.read('../evil')).rejects.toThrow()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('ReleaseChecker', () => {
  it('reports newer releases only', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ tag_name: 'v0.3.0', html_url: 'https://x' }))) as typeof fetch
    const checker = new ReleaseChecker(true, fetchImpl)
    expect((await checker.available('0.2.0'))?.version).toBe('0.3.0')
    expect(await checker.available('0.3.0')).toBeUndefined()
    expect(await checker.available('dev')).toBeUndefined()
    expect(await new ReleaseChecker(false, fetchImpl).latest()).toBeUndefined()
  })

  it('peeks at the fetched release without fetching', async () => {
    let fetches = 0
    const fetchImpl = (async () => {
      fetches++
      return new Response(JSON.stringify({ tag_name: 'v0.3.0', html_url: 'https://x' }))
    }) as typeof fetch
    const checker = new ReleaseChecker(true, fetchImpl)
    expect(checker.peek('0.2.0')).toBeUndefined()
    expect(fetches).toBe(0)
    await checker.latest()
    expect(checker.peek('0.2.0')?.version).toBe('0.3.0')
    expect(checker.peek('0.3.0')).toBeUndefined()
    expect(fetches).toBe(1)
  })

  it('refreshes past the cache, but not more than every few minutes', async () => {
    let now = 0
    let tag = 'v0.3.0'
    let fetches = 0
    const fetchImpl = (async () => {
      fetches++
      return new Response(JSON.stringify({ tag_name: tag, html_url: 'https://x' }))
    }) as typeof fetch
    const checker = new ReleaseChecker(true, fetchImpl, () => now)
    await checker.latest()
    tag = 'v0.4.0'
    now += 60_000
    expect((await checker.latest())?.version).toBe('0.3.0')
    expect((await checker.refresh())?.version).toBe('0.3.0')
    expect(fetches).toBe(1)
    now += 5 * 60_000
    expect((await checker.refresh())?.version).toBe('0.4.0')
    expect(fetches).toBe(2)
    // concurrent refreshes share one request
    now += 10 * 60_000
    await Promise.all([checker.refresh(), checker.refresh(), checker.latest()])
    expect(fetches).toBe(3)
    expect(await new ReleaseChecker(false, fetchImpl).refresh()).toBeUndefined()
  })

  it('announces a different release, not a repeat of the same one', async () => {
    let now = 0
    let tag = 'v0.3.0'
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ tag_name: tag, html_url: 'https://x' }))) as typeof fetch
    const checker = new ReleaseChecker(true, fetchImpl, () => now)
    const seen: (string | undefined)[] = []
    checker.on('change', (r) => seen.push(r?.version))
    await checker.latest()
    now += 60 * 60_000
    await checker.latest()
    expect(seen).toEqual(['0.3.0'])
    tag = 'v0.4.0'
    now += 60 * 60_000
    await checker.latest()
    expect(seen).toEqual(['0.3.0', '0.4.0'])
  })
})
