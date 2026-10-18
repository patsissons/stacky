import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyJob, upArgs } from './helper'
import { JobStore, type SelfUpdateJob } from './jobs'

let tmp: string
let store: JobStore

// Fake docker: logs every call; `up` fails while $tmp/fail-up exists (removed after one failure).
const FAKE = (dir: string) => `#!/bin/sh
echo "$*" >> ${dir}/calls.log
case "$*" in
  *" up "*)
    if [ -f ${dir}/fail-up ]; then rm ${dir}/fail-up; echo "container stacky is unhealthy" >&2; exit 1; fi ;;
esac
exit 0
`

function job(over: Partial<SelfUpdateJob> = {}): SelfUpdateJob {
  return {
    id: 'job1',
    operationId: 'op1',
    action: 'update',
    state: 'pending',
    project: 'stacky',
    service: 'stacky',
    workingDir: path.join(tmp, 'stacks/stacky'),
    configFiles: [path.join(tmp, 'stacks/stacky/compose.yaml')],
    envFiles: [path.join(tmp, 'stacks/global.env'), path.join(tmp, 'missing.env')],
    from: { ref: 'ghcr.io/patsissons/stacky:latest', imageId: 'sha256:old', version: '0.1.0' },
    to: { ref: 'ghcr.io/patsissons/stacky:latest', imageId: 'sha256:new' },
    createdAt: Date.now(),
    ...over,
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-helper-'))
  fs.mkdirSync(path.join(tmp, 'stacks/stacky'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'stacks/stacky/compose.yaml'), 'services: {}\n')
  fs.writeFileSync(path.join(tmp, 'stacks/global.env'), 'TZ=UTC\n')
  fs.writeFileSync(path.join(tmp, 'docker'), FAKE(tmp), { mode: 0o755 })
  store = new JobStore(path.join(tmp, 'jobs'))
})

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const calls = () => fs.readFileSync(path.join(tmp, 'calls.log'), 'utf8').trim().split('\n')
const opts = () => ({ dockerBin: path.join(tmp, 'docker'), log: () => {} })

describe('upArgs', () => {
  it('targets only stacky’s service in its original project and waits for health', async () => {
    const args = await upArgs(job())
    expect(args).toEqual([
      'compose',
      '--ansi',
      'never',
      '-p',
      'stacky',
      '--project-directory',
      path.join(tmp, 'stacks/stacky'),
      '-f',
      path.join(tmp, 'stacks/stacky/compose.yaml'),
      '--env-file',
      path.join(tmp, 'stacks/global.env'),
      'up',
      '--detach',
      '--no-deps',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '180',
      'stacky',
    ])
    expect(args).not.toContain('--remove-orphans')
  })
})

describe('applyJob', () => {
  it('marks the job applied when the new version comes up', async () => {
    await store.write(job())
    expect(await applyJob(store, 'job1', opts())).toBe(0)
    expect((await store.read('job1'))?.state).toBe('applied')
    expect(calls()).toHaveLength(1)
  })

  it('restores the compose file and old image, then rolls back when the new version fails', async () => {
    const composePath = path.join(tmp, 'stacks/stacky/compose.yaml')
    fs.writeFileSync(composePath, 'services:\n  stacky:\n    image: x:new\n')
    fs.writeFileSync(path.join(tmp, 'fail-up'), '')
    await store.write(
      job({
        composeBackups: [
          { file: composePath, content: 'services:\n  stacky:\n    image: x:old\n' },
        ],
      }),
    )

    expect(await applyJob(store, 'job1', opts())).toBe(1)
    const result = await store.read('job1')
    expect(result?.state).toBe('rolled_back')
    expect(result?.error).toContain('unhealthy')
    expect(fs.readFileSync(composePath, 'utf8')).toContain('x:old')
    const log = calls()
    expect(log[1]).toBe('tag sha256:old ghcr.io/patsissons/stacky:latest')
    expect(log[2]).toContain(' up ')
  })

  it('ignores jobs that are not pending', async () => {
    await store.write(job({ state: 'succeeded' }))
    expect(await applyJob(store, 'job1', opts())).toBe(0)
    expect(fs.existsSync(path.join(tmp, 'calls.log'))).toBe(false)
  })
})
