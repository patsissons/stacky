import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Docker from 'dockerode'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ContainerLister } from '../docker/containers'
import { silentLogger } from '../lib/logger'
import { StackRepository } from './repository'
import { StackState } from './state'

let tmp: string
let state: StackState

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-state-'))
})

afterEach(() => {
  state?.stop()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('StackState.refreshNow', () => {
  it('waits for a refresh that sees changes made while one was running', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let calls = 0
    // the first listing blocks, as a slow docker call would
    const lister = {
      list: async () => {
        if (calls++ === 0) await gate
        return []
      },
    } as unknown as ContainerLister
    const repo = new StackRepository(tmp)
    state = new StackState(repo, {} as Docker, lister, silentLogger)

    const first = state.refreshNow()
    // let the first refresh read the (empty) stacks dir before the stack appears
    await new Promise((r) => setTimeout(r, 50))
    await repo.create('app', 'services: {}\n', '')
    const second = state.refreshNow()
    release()
    await second
    expect(state.get('app')).toBeDefined()
    await first
    expect(calls).toBe(2)
  })
})
