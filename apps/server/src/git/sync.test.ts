import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { SettingsStore } from '../db/settings'
import { silentLogger } from '../lib/logger'
import { StackRepository } from '../stacks/repository'
import { GitSync, type GitSettings } from './sync'

let tmp: string
let stacksDir: string
let remote: string
let repo: StackRepository
let sync: GitSync
let deployed: string[]
let close: () => void

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim()

const settings = (over: Partial<GitSettings> = {}) => ({
  enabled: true,
  includeEnv: false,
  push: true,
  pull: { enabled: true, intervalMinutes: 5, autoDeploy: true },
  remote: { url: remote, branch: 'main' },
  ...over,
})

/** Lets queued git work finish. */
const settle = async () => {
  await sync.push().catch(() => {})
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stacky-git-'))
  stacksDir = path.join(tmp, 'stacks')
  remote = path.join(tmp, 'remote.git')
  git(tmp, 'init', '--quiet', '--bare', '-b', 'main', remote)
  const { db, sqlite } = openDatabase(':memory:')
  close = () => sqlite.close()
  repo = new StackRepository(stacksDir)
  deployed = []
  sync = new GitSync(repo, new SettingsStore(db), silentLogger, async (s) => {
    deployed.push(s)
  })
  repo.onChange = (paths, msg) => sync.onChange(paths, msg)
})

afterEach(() => {
  sync.stop()
  close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('GitSync', () => {
  it('commits compose files (not .env) when enabled and on every change, and pushes', async () => {
    await repo.create('app', 'services: {}\n', 'SECRET=1\n')
    await sync.configure(settings())
    await settle()
    expect(git(stacksDir, 'ls-files')).toBe('app/compose.yaml')

    await repo.write('app', { compose: 'services:\n  web:\n    image: nginx\n', env: 'SECRET=2\n' })
    await settle()
    expect(git(stacksDir, 'log', '--format=%s')).toBe('update app\ntrack stacks managed by stacky')
    expect(git(remote, 'log', '--format=%s', 'main')).toContain('update app')
    expect((await sync.status()).lastPush?.ok).toBe(true)
  })

  it('includes env files when asked', async () => {
    await repo.create('app', 'services: {}\n', 'A=1\n')
    await sync.configure(settings({ includeEnv: true, push: false }))
    await settle()
    expect(git(stacksDir, 'ls-files').split('\n').sort()).toEqual(['app/.env', 'app/compose.yaml'])
  })

  it('pulls upstream changes and redeploys the stacks that changed', async () => {
    await repo.create('app', 'services: {}\n')
    await repo.create('other', 'services: {}\n')
    await sync.configure(settings())
    await settle()

    // someone pushes a change to "app" from another clone
    const clone = path.join(tmp, 'clone')
    git(tmp, 'clone', '--quiet', remote, clone)
    fs.writeFileSync(
      path.join(clone, 'app/compose.yaml'),
      'services:\n  web:\n    image: nginx:1.28\n',
    )
    git(clone, 'commit', '--quiet', '-am', 'bump nginx')
    git(clone, 'push', '--quiet', 'origin', 'main')

    const result = await sync.pull()
    expect(result).toMatchObject({ ok: true, stacks: ['app'] })
    expect(deployed).toEqual(['app'])
    expect(fs.readFileSync(path.join(stacksDir, 'app/compose.yaml'), 'utf8')).toContain(
      'nginx:1.28',
    )
  })

  it('refuses to pull over diverged local history', async () => {
    await repo.create('app', 'services: {}\n')
    await sync.configure(settings({ push: false }))
    await settle()
    git(stacksDir, 'push', '--quiet', 'origin', 'main')
    const clone = path.join(tmp, 'clone')
    git(tmp, 'clone', '--quiet', remote, clone)
    fs.writeFileSync(path.join(clone, 'app/compose.yaml'), 'services: {x: {image: a}}\n')
    git(clone, 'commit', '--quiet', '-am', 'remote change')
    git(clone, 'push', '--quiet', 'origin', 'main')
    await repo.write('app', { compose: 'services: {y: {image: b}}\n' })
    await settle()

    const result = await sync.pull()
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/cannot fast-forward/)
    expect(deployed).toEqual([])
  })

  it('bootstraps an empty stacks dir from the remote (GitOps)', async () => {
    const clone = path.join(tmp, 'seed')
    git(tmp, 'clone', '--quiet', remote, clone)
    fs.mkdirSync(path.join(clone, 'media'))
    fs.writeFileSync(path.join(clone, 'media/compose.yaml'), 'services: {}\n')
    git(clone, 'add', '.')
    git(clone, 'commit', '--quiet', '-m', 'seed')
    git(clone, 'push', '--quiet', 'origin', 'main')

    await sync.configure(settings({ push: false }))
    const result = await sync.pull()
    expect(result).toMatchObject({ ok: true, stacks: ['media'] })
    expect(await repo.exists('media')).toBe(true)
    expect(deployed).toEqual(['media'])
  })

  it('keeps tokens out of .git/config and verifies webhook secrets', async () => {
    await sync.configure(settings({ remote: { url: remote, branch: 'main', token: 'sekret' } }))
    expect(fs.readFileSync(path.join(stacksDir, '.git/config'), 'utf8')).not.toContain('sekret')
    const secret = sync.config().webhookSecret
    expect(sync.verifyWebhook(secret)).toBe(true)
    expect(sync.verifyWebhook('nope')).toBe(false)
  })
})
