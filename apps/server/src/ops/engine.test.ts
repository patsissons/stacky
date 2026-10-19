import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { silentLogger } from '../lib/logger'
import { OperationEngine } from './engine'

// A fake `docker` binary: echoes its args, fails when told to, sleeps when told to.
const FAKE_DOCKER = `#!/bin/sh
case "$1" in
  fail) echo "Bind for 0.0.0.0:8080 failed: port is already allocated" >&2; exit 1 ;;
  sleep) sleep 30 ;;
  *) echo "ran: $*" ;;
esac
`

let tmp: string
let engine: OperationEngine
let close: () => void

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-engine-'))
  const bin = path.join(tmp, 'docker')
  fs.writeFileSync(bin, FAKE_DOCKER, { mode: 0o755 })
  const { db, sqlite } = openDatabase(':memory:')
  close = () => sqlite.close()
  engine = new OperationEngine(db, silentLogger, bin)
})

afterEach(() => {
  close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const docker = (...args: string[]) => ({ kind: 'docker' as const, args })

describe('OperationEngine', () => {
  it('runs steps in order and records success with output', async () => {
    const op = engine.enqueue({
      stack: 'app',
      action: 'deploy',
      cwd: tmp,
      steps: [docker('one'), docker('two')],
    })
    const done = await engine.wait(op.id)
    expect(done?.state).toBe('succeeded')
    expect(done?.exitCode).toBe(0)
    const out = engine.output(op.id)
    expect(out.indexOf('ran: one')).toBeLessThan(out.indexOf('ran: two'))
    expect(engine.list({ stack: 'app' })[0]?.id).toBe(op.id)
  })

  it('stops at the first failing step and classifies the error', async () => {
    const op = engine.enqueue({
      stack: 'app',
      action: 'deploy',
      cwd: tmp,
      steps: [docker('fail'), docker('never')],
    })
    const done = await engine.wait(op.id)
    expect(done?.state).toBe('failed')
    expect(done?.error?.code).toBe('port_in_use')
    expect(engine.output(op.id)).not.toContain('ran: never')
  })

  it('serialises operations per stack but not across stacks', async () => {
    const order: string[] = []
    engine.on('update', (s) => s.state === 'running' && order.push(`${s.stack}:${s.action}`))
    const a1 = engine.enqueue({ stack: 'a', action: 'first', cwd: tmp, steps: [docker('x')] })
    const a2 = engine.enqueue({ stack: 'a', action: 'second', cwd: tmp, steps: [docker('y')] })
    expect(engine.get(a2.id)?.state).toBe('queued')
    await Promise.all([engine.wait(a1.id), engine.wait(a2.id)])
    expect(order).toEqual(['a:first', 'a:second'])
  })

  it('cancels a running operation', async () => {
    const op = engine.enqueue({ stack: 'app', action: 'pull', cwd: tmp, steps: [docker('sleep')] })
    await new Promise((r) => setTimeout(r, 200))
    expect(engine.cancel(op.id)).toBe(true)
    const done = await engine.wait(op.id)
    expect(done?.state).toBe('cancelled')
  })

  it('waits for an operation up to a timeout', async () => {
    const quick = engine.enqueue({ stack: 'a', action: 'pull', cwd: tmp, steps: [docker('x')] })
    expect((await engine.waitFor(quick.id, 5000))?.state).toBe('succeeded')
    // finished operations come straight back, even without waiting
    expect((await engine.waitFor(quick.id, 0))?.state).toBe('succeeded')

    const slow = engine.enqueue({ stack: 'b', action: 'pull', cwd: tmp, steps: [docker('sleep')] })
    const started = Date.now()
    const snapshot = await engine.waitFor(slow.id, 150)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(['queued', 'running']).toContain(snapshot?.state)
    expect(await engine.waitFor('op_missing', 10)).toBeUndefined()
    engine.cancel(slow.id)
    await engine.wait(slow.id)
  })

  it('clears finished operations of one stack but keeps a running one', async () => {
    const done = engine.enqueue({ stack: 'app', action: 'pull', cwd: tmp, steps: [docker('x')] })
    await engine.wait(done.id)
    const other = engine.enqueue({ stack: 'b', action: 'pull', cwd: tmp, steps: [docker('x')] })
    await engine.wait(other.id)
    const running = engine.enqueue({
      stack: 'app',
      action: 'pull',
      cwd: tmp,
      steps: [docker('sleep')],
    })
    await new Promise((r) => setTimeout(r, 200))
    expect(engine.clear('app')).toBe(1)
    expect(engine.list({ stack: 'app' }).map((o) => o.id)).toEqual([running.id])
    expect(engine.get(done.id)).toBeUndefined()
    expect(engine.list({ stack: 'b' })).toHaveLength(1)
    engine.cancel(running.id)
    await engine.wait(running.id)
  })

  it('runs in-process tasks and reports their failures', async () => {
    const op = engine.enqueue({
      stack: 'app',
      action: 'delete',
      cwd: tmp,
      steps: [
        {
          kind: 'task',
          label: 'remove files',
          run: async () => {
            throw new Error('disk on fire')
          },
        },
      ],
    })
    const done = await engine.wait(op.id)
    expect(done?.state).toBe('failed')
    expect(done?.error).toEqual({ code: 'task_failed', message: 'disk on fire' })
  })

  it('reports a missing docker binary clearly', async () => {
    const { db, sqlite } = openDatabase(':memory:')
    const broken = new OperationEngine(db, silentLogger, path.join(tmp, 'nope'))
    const op = broken.enqueue({ stack: 'app', action: 'pull', cwd: tmp, steps: [docker('x')] })
    const done = await broken.wait(op.id)
    expect(done?.state).toBe('failed')
    expect(done?.exitCode).toBe(127)
    sqlite.close()
  })
})
