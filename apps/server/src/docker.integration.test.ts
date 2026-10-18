import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StackStatus } from '@stacky/shared'
import { loadConfig } from './config'
import { silentLogger } from './lib/logger'
import { createRuntime, type Runtime } from './runtime'

// Runs against a real Docker engine; enabled in CI with STACKY_DOCKER_TESTS=1.
const enabled = process.env.STACKY_DOCKER_TESTS === '1'
const name = `itest-${process.pid}`
const IMAGE = process.env.STACKY_IT_IMAGE ?? 'alpine:3'

const COMPOSE = `services:
  init:
    image: ${IMAGE}
    command: ["sh", "-c", "echo init done"]
    restart: "no"
  app:
    image: ${IMAGE}
    command: ["sleep", "300"]
    init: true
    depends_on:
      init:
        condition: service_completed_successfully
`

describe.runIf(enabled)('docker integration', () => {
  let tmp: string
  let runtime: Runtime

  beforeAll(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-it-')))
    const config = loadConfig({
      STACKY_STACKS_DIR: path.join(tmp, 'stacks'),
      STACKY_DATA_DIR: path.join(tmp, 'data'),
      STACKY_AUTH_DISABLED: 'true',
    })
    runtime = await createRuntime(config, silentLogger)
  })

  afterAll(async () => {
    if (runtime?.state.get(name)) {
      const op = await runtime.stacks.stackAction(name, 'delete').catch(() => undefined)
      if (op) await runtime.engine.wait(op.id)
    }
    runtime?.stop()
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  async function run(action: Parameters<Runtime['stacks']['stackAction']>[1]) {
    const op = await runtime.stacks.stackAction(name, action)
    const done = await runtime.engine.wait(op.id)
    expect(done?.state, runtime.engine.output(op.id)).toBe('succeeded')
  }

  async function waitFor(status: StackStatus) {
    for (let i = 0; i < 60; i++) {
      await runtime.state.refreshNow()
      if (runtime.state.get(name)?.status === status) return
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(runtime.state.get(name)?.status).toBe(status)
  }

  it('runs the full stack lifecycle', { timeout: 180_000 }, async () => {
    await runtime.stacks.create(name, COMPOSE)
    expect(runtime.state.get(name)?.status).toBe('inactive')

    await run('deploy')
    await waitFor('running')
    const services = Object.fromEntries(
      runtime.state.get(name)!.services.map((s) => [s.name, s.state]),
    )
    expect(services).toEqual({ init: 'completed', app: 'running' })

    await run('stop')
    await waitFor('stopped')

    await run('start')
    await waitFor('running')

    await run('down')
    await waitFor('inactive')

    await run('delete')
    await runtime.state.refreshNow()
    expect(runtime.state.get(name)).toBeUndefined()
    expect(fs.existsSync(path.join(tmp, 'stacks', name))).toBe(false)
  })

  it('classifies a failing deploy', { timeout: 60_000 }, async () => {
    const bad = `${name}-bad`
    await runtime.stacks.create(
      bad,
      `services:\n  app:\n    image: ${IMAGE}\n    env_file: missing.env\n`,
    )
    const op = await runtime.stacks.stackAction(bad, 'deploy')
    const done = await runtime.engine.wait(op.id)
    expect(done?.state).toBe('failed')
    expect(done?.error?.code).toBe('env_file_missing')
    const del = await runtime.stacks.stackAction(bad, 'delete')
    await runtime.engine.wait(del.id)
  })
})
