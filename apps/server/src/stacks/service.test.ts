import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ImageUpdate } from '@stacky/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { silentLogger } from '../lib/logger'
import { OperationEngine } from '../ops/engine'
import { StackRepository } from './repository'
import { StackService } from './service'
import { StackState } from './state'

let tmp: string
let close: () => void
let state: StackState
let engine: OperationEngine
let fakeDocker: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-svc-'))
  // portable stand-in for docker that always succeeds (/bin/true is not on macOS)
  fakeDocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-bin-')), 'docker')
  fs.writeFileSync(fakeDocker, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  const { db, sqlite } = openDatabase(':memory:')
  close = () => sqlite.close()
  const repo = new StackRepository(tmp)
  const lister = { list: async () => [] } as never
  state = new StackState(repo, {} as never, lister, silentLogger)
  engine = new OperationEngine(db, silentLogger, fakeDocker)
  new StackService(repo, state, engine, fakeDocker)
})

afterEach(() => {
  state.stop()
  close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('active operation tracking', () => {
  it('clears the busy marker even when an operation finishes before the snapshot refreshes', async () => {
    const op = engine.enqueue({
      stack: 'app',
      action: 'deploy',
      cwd: tmp,
      steps: [{ kind: 'docker', args: [] }],
    })
    await engine.wait(op.id)
    expect(state.activeOperation('app')).toBeUndefined()
  })

  it('hands the marker to the next queued operation', async () => {
    const first = engine.enqueue({
      stack: 'app',
      action: 'pull',
      cwd: tmp,
      steps: [{ kind: 'docker', args: [] }],
    })
    const second = engine.enqueue({
      stack: 'app',
      action: 'deploy',
      cwd: tmp,
      steps: [{ kind: 'docker', args: [] }],
    })
    await engine.wait(first.id)
    expect(state.activeOperation('app')).toBe(second.id)
    await engine.wait(second.id)
    expect(state.activeOperation('app')).toBeUndefined()
  })
})

describe('revisions', () => {
  it('records the deployed files when a deploy succeeds, even a very fast one', async () => {
    const { db, sqlite } = openDatabase(':memory:')
    const repo = new StackRepository(tmp)
    const st = new StackState(repo, {} as never, { list: async () => [] } as never, silentLogger)
    const eng = new OperationEngine(db, silentLogger, fakeDocker)
    const svc = new StackService(repo, st, eng, fakeDocker)
    const { RevisionStore } = await import('./revisions')
    svc.revisions = new RevisionStore(db)
    await svc.create('app', 'services:\n  web:\n    image: nginx\n')
    const op = await svc.stackAction('app', 'deploy')
    const done = await eng.wait(op.id)
    expect(done?.state, eng.output(op.id)).toBe('succeeded')
    await new Promise((r) => setTimeout(r, 10))
    const revs = svc.revisions.list('app')
    expect(revs).toHaveLength(1)
    expect(revs[0]?.compose).toContain('nginx')
    st.stop()
    sqlite.close()
  })
})

describe('update actions', () => {
  const compose = `services:
  web:
    image: nginx:1.27.3 # pinned on purpose
  db:
    image: postgres:16
`
  const container = (service: string, image: string) => ({
    id: `${service}-id`,
    name: `app-${service}-1`,
    project: 'app',
    service,
    number: 1,
    image,
    imageId: `sha256:${service}`,
    state: 'running' as const,
    statusText: 'Up',
    createdAt: 0,
    ports: [],
    labels: {},
  })
  const available = (ref: string, patch: Partial<ImageUpdate>): ImageUpdate => ({
    ref,
    registry: 'docker.io',
    repository: ref.split(':')[0]!,
    tag: ref.split(':')[1]!,
    status: 'update_available',
    checkedAt: 0,
    source: 'native',
    ...patch,
  })

  let repo: StackRepository
  let st: StackState
  let svc: StackService
  let updates: ImageUpdate[]

  beforeEach(async () => {
    repo = new StackRepository(tmp)
    const containers = [container('web', 'nginx:1.27.3'), container('db', 'postgres:16')]
    st = new StackState(repo, {} as never, { list: async () => containers } as never, silentLogger)
    svc = new StackService(repo, st, engine, fakeDocker)
    updates = [available('nginx:1.27.3', { newerTag: '1.28.0' })]
    svc.updates = { summary: () => ({ updates, checking: false }) } as never
    await svc.create('app', compose)
  })

  afterEach(() => st.stop())

  it('pull-updates prefetches the newer tag and leaves compose.yaml alone', async () => {
    const op = await svc.stackAction('app', 'pull-updates')
    expect(op.services).toEqual(['web'])
    expect(op.commands).toContain('docker pull nginx:1.28.0')
    expect((await engine.wait(op.id))?.state).toBe('succeeded')
    expect((await repo.read('app')).compose).toBe(compose)
  })

  it('deploy-updates edits only the image: line, then pulls and recreates the service', async () => {
    updates.push(available('postgres:16', { digestChanged: true }))
    const op = await svc.stackAction('app', 'deploy-updates', { prune: true })
    expect(op.services).toEqual(['web', 'db'])
    expect(op.commands).toContain('docker compose up -d --remove-orphans web db')
    expect((await engine.wait(op.id))?.state).toBe('succeeded')
    expect((await repo.read('app')).compose).toBe(compose.replace('nginx:1.27.3', 'nginx:1.28.0'))
  })

  it('honours the services filter', async () => {
    updates.push(available('postgres:16', { digestChanged: true }))
    const op = await svc.stackAction('app', 'deploy-updates', { services: ['db'] })
    expect(op.services).toEqual(['db'])
    await engine.wait(op.id)
    expect((await repo.read('app')).compose).toBe(compose)
  })

  it('refuses when there is nothing to update', async () => {
    updates = [available('nginx:1.27.3', { newerTag: '1.28.0', ignored: true })]
    await expect(svc.stackAction('app', 'pull-updates')).rejects.toMatchObject({
      status: 409,
      code: 'no_updates',
    })
  })

  it("refuses stacky's own stack", async () => {
    st.selfContainerId = 'web-id'
    await st.refreshNow()
    await expect(svc.stackAction('app', 'deploy-updates')).rejects.toMatchObject({
      code: 'self_stack',
    })
  })
})

describe('deploy preview', () => {
  const compose = 'services:\n  web:\n    image: nginx\n'
  const container = (id: string, labels: Record<string, string>) => ({
    id,
    name: `app-web-${id}`,
    project: 'app',
    service: 'web',
    number: 1,
    image: 'nginx',
    imageId: 'sha256:nginx',
    state: 'running' as const,
    statusText: 'Up',
    createdAt: 0,
    ports: [],
    labels,
  })

  let bin: string
  let st: StackState
  let svc: StackService
  let containers: ReturnType<typeof container>[]

  beforeEach(async () => {
    // records its arguments and stdin, and answers like compose would
    bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-bin-')), 'docker')
    const dir = path.dirname(bin)
    fs.writeFileSync(
      bin,
      `#!/bin/sh
case "$*" in
  *"version --short"*) echo 5.6.0 ;;
  *--dry-run*) echo "$*" > ${dir}/args; cat > ${dir}/stdin
    echo " Container app-web-1 Recreate"; echo " Container app-web-1 Recreated" ;;
esac
exit 0
`,
      { mode: 0o755 },
    )
    const repo = new StackRepository(tmp)
    containers = [container('a', { 'com.docker.compose.version': '2.29.1' })]
    st = new StackState(repo, {} as never, { list: async () => containers } as never, silentLogger)
    svc = new StackService(repo, st, engine, bin)
    await svc.create('app', compose)
  })

  afterEach(() => st.stop())

  it('dry-runs the unsaved files with the deploy options', async () => {
    const preview = await svc.preview(
      'app',
      { compose: `${compose}# edited\n` },
      { pull: 'always' },
    )
    expect(preview.containers).toEqual([{ name: 'app-web-1', action: 'recreate' }])
    const dir = path.dirname(bin)
    expect(fs.readFileSync(path.join(dir, 'stdin'), 'utf8')).toContain('# edited')
    expect(fs.readFileSync(path.join(dir, 'args'), 'utf8')).toContain(
      '--dry-run up -d --remove-orphans --pull always',
    )
  })

  it('explains that containers made by another compose version get recreated', async () => {
    expect((await svc.preview('app', {})).composeMismatch).toEqual({
      deployedWith: ['2.29.1'],
      current: '5.6.0',
    })
    containers = [container('b', { 'com.docker.compose.version': '5.6.0' })]
    await st.refreshNow()
    expect((await svc.preview('app', {})).composeMismatch).toBeUndefined()
  })
})
