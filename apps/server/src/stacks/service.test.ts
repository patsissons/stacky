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

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-svc-'))
  const { db, sqlite } = openDatabase(':memory:')
  close = () => sqlite.close()
  const repo = new StackRepository(tmp)
  const lister = { list: async () => [] } as never
  state = new StackState(repo, {} as never, lister, silentLogger)
  engine = new OperationEngine(db, silentLogger, '/bin/true')
  new StackService(repo, state, engine, '/bin/true')
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
