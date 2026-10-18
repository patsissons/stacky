import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
