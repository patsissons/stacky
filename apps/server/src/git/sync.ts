import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { SettingsStore } from '../db/settings'
import type { Logger } from '../lib/logger'
import { isValidStackName } from '../stacks/paths'
import type { StackRepository } from '../stacks/repository'
import { Git, GitError, redact, type GitAuth } from './git'

export const GIT_KEY = 'git'

export interface GitSettings {
  enabled: boolean
  /** Also commit `.env` files and global.env (they usually hold secrets). */
  includeEnv: boolean
  remote?: { url: string; branch: string; token?: string; username?: string }
  /** Push after every commit. */
  push: boolean
  pull: { enabled: boolean; intervalMinutes: number; autoDeploy: boolean }
  webhookSecret: string
}

export interface GitResult {
  at: number
  ok: boolean
  error?: string
  /** For pulls: stacks whose files changed (and were deployed when auto-deploy is on). */
  stacks?: string[]
}

export interface GitStatus {
  enabled: boolean
  isRepo: boolean
  head?: string
  lastCommit?: { hash: string; ts: number; subject: string }
  lastPush?: GitResult
  lastPull?: GitResult
}

const DEFAULTS: GitSettings = {
  enabled: false,
  includeEnv: false,
  push: false,
  pull: { enabled: false, intervalMinutes: 5, autoDeploy: true },
  webhookSecret: '',
}

const ENV_FILE = /(^|\/)\.env$|^global\.env$/

interface Events {
  change: [GitStatus]
}

/**
 * Keeps the stacks directory in a git repository: commits changes made through
 * stacky, optionally pushes them, and optionally pulls (GitOps) and redeploys
 * the stacks that changed upstream.
 */
export class GitSync extends EventEmitter<Events> {
  readonly git: Git
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | undefined
  private lastPush: GitResult | undefined
  private lastPull: GitResult | undefined

  constructor(
    private readonly repo: StackRepository,
    private readonly settings: SettingsStore,
    private readonly logger: Logger,
    private readonly deploy: (stack: string) => Promise<unknown>,
  ) {
    super()
    this.git = new Git(repo.stacksDir)
  }

  config(): GitSettings {
    const saved = this.settings.get<Partial<GitSettings>>(GIT_KEY) ?? {}
    const merged = { ...DEFAULTS, ...saved, pull: { ...DEFAULTS.pull, ...saved.pull } }
    if (!merged.webhookSecret) {
      merged.webhookSecret = randomBytes(24).toString('base64url')
      this.settings.set(GIT_KEY, merged)
    }
    return merged
  }

  private get auth(): GitAuth | undefined {
    const r = this.config().remote
    return r?.token ? { token: r.token, username: r.username } : undefined
  }

  /** Runs git work one job at a time. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn)
    this.queue = next.catch(() => {})
    return next
  }

  async status(): Promise<GitStatus> {
    const cfg = this.config()
    const isRepo = await this.git.isRepo()
    const [last] = isRepo ? await this.git.log(undefined, 1) : []
    return {
      enabled: cfg.enabled,
      isRepo,
      head: isRepo ? await this.git.head() : undefined,
      lastCommit: last && { hash: last.hash, ts: last.ts, subject: last.subject },
      lastPush: this.lastPush,
      lastPull: this.lastPull,
    }
  }

  /** Saves settings; enabling initialises the repository and commits the current stacks. */
  async configure(next: Omit<GitSettings, 'webhookSecret'> & { regenerateSecret?: boolean }) {
    const current = this.config()
    const remote = next.remote?.url
      ? {
          url: next.remote.url,
          branch: next.remote.branch || 'main',
          username: next.remote.username || undefined,
          // an omitted token keeps the saved one
          token:
            next.remote.token === undefined
              ? current.remote?.token
              : next.remote.token || undefined,
        }
      : undefined
    const saved: GitSettings = {
      enabled: next.enabled,
      includeEnv: next.includeEnv,
      remote,
      push: next.push,
      pull: next.pull,
      webhookSecret: next.regenerateSecret
        ? randomBytes(24).toString('base64url')
        : current.webhookSecret,
    }
    this.settings.set(GIT_KEY, saved)
    if (saved.enabled) await this.serial(() => this.ensureRepo())
    this.schedule()
    this.emit('change', await this.status())
  }

  private async ensureRepo() {
    const cfg = this.config()
    await this.repo.ensureStacksDir()
    if (!(await this.git.isRepo())) {
      await this.git.run(['init', '--quiet', '-b', cfg.remote?.branch ?? 'main'])
    }
    if (cfg.remote) {
      const has = await this.git.run(['remote', 'get-url', 'origin'], { allowFail: true })
      // credentials never go into the URL in .git/config
      const url = redact(cfg.remote.url)
      await this.git.run(
        has.code === 0 ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url],
      )
    }
    if (
      !(await this.git.head()) &&
      cfg.remote &&
      cfg.pull.enabled &&
      (await this.repo.list()).length === 0
    ) {
      // GitOps into an empty stacks dir: the first pull checks out the remote
      return
    }
    await this.commitAll('track stacks managed by stacky')
  }

  /** Paths stacky versions: compose files (and env files when enabled). */
  private async trackedPaths(): Promise<string[]> {
    const cfg = this.config()
    const paths: string[] = []
    for (const s of await this.repo.list()) {
      paths.push(`${s.name}/${s.composeFile}`)
      if (cfg.includeEnv) paths.push(`${s.name}/.env`)
    }
    if (cfg.includeEnv) paths.push('global.env')
    return paths
  }

  private async commitAll(message: string) {
    const existing: string[] = []
    for (const p of await this.trackedPaths()) {
      const r = await this.git.run(
        ['ls-files', '--error-unmatch', '--others', '--cached', '--', p],
        { allowFail: true },
      )
      if (r.stdout.trim()) existing.push(p)
    }
    if (await this.git.commitPaths(existing, message)) await this.afterCommit()
  }

  /**
   * Records a change made through stacky. `paths` are relative to the stacks dir.
   * Env files are skipped unless `includeEnv` is on.
   */
  onChange(paths: string[], message: string) {
    const cfg = this.config()
    if (!cfg.enabled) return
    const wanted = paths.filter((p) => cfg.includeEnv || !ENV_FILE.test(p))
    if (wanted.length === 0) return
    void this.serial(async () => {
      try {
        if (!(await this.git.isRepo())) await this.ensureRepo()
        if (await this.git.commitPaths(wanted, message)) await this.afterCommit()
      } catch (err) {
        this.logger.warn('git commit failed', { err: String(err) })
      }
    })
  }

  private async afterCommit() {
    const cfg = this.config()
    if (cfg.push && cfg.remote) await this.pushNow()
    this.emit('change', await this.status())
  }

  private async pushNow() {
    const cfg = this.config()
    try {
      if (!cfg.remote) throw new GitError('no remote is configured')
      await this.git.run(['push', '--quiet', 'origin', `HEAD:${cfg.remote.branch}`], {
        auth: this.auth,
      })
      this.lastPush = { at: Date.now(), ok: true }
    } catch (err) {
      this.lastPush = {
        at: Date.now(),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }
      this.logger.warn('git push failed', { err: this.lastPush.error })
    }
  }

  push(): Promise<GitResult> {
    return this.serial(async () => {
      await this.pushNow()
      this.emit('change', await this.status())
      return this.lastPush!
    })
  }

  /** Fast-forwards to the remote branch and redeploys the stacks whose files changed. */
  pull(): Promise<GitResult> {
    return this.serial(async () => {
      const cfg = this.config()
      try {
        if (!cfg.remote) throw new GitError('no remote is configured')
        if (!(await this.git.isRepo())) await this.ensureRepo()
        const branch = cfg.remote.branch
        await this.git.run(['fetch', '--quiet', 'origin', branch], { auth: this.auth })
        const before = await this.git.head()
        if (!before) {
          // first pull into a new repository
          await this.git.run(['checkout', '--quiet', '-B', branch, 'FETCH_HEAD'])
        } else {
          const merge = await this.git.run(['merge', '--ff-only', '--quiet', 'FETCH_HEAD'], {
            allowFail: true,
          })
          if (merge.code !== 0) {
            throw new GitError(
              'the local stacks have commits or changes that are not on the remote, so stacky cannot fast-forward. Push them, or reset the stacks directory to the remote.',
            )
          }
        }
        const after = await this.git.head()
        const files =
          before && after && before !== after ? await this.git.changedBetween(before, after) : []
        const changed = [
          ...new Set(
            (before ? files : (await this.git.run(['ls-files'])).stdout.split('\n'))
              .map((f) => f.split('/')[0]!)
              .filter((s) => s && isValidStackName(s)),
          ),
        ]
        if (cfg.pull.autoDeploy) {
          for (const stack of changed) {
            if (!(await this.repo.exists(stack))) continue
            await this.deploy(stack).catch((err) =>
              this.logger.warn('auto-deploy after git pull failed', { stack, err: String(err) }),
            )
          }
        }
        this.lastPull = { at: Date.now(), ok: true, stacks: changed }
      } catch (err) {
        this.lastPull = {
          at: Date.now(),
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
        this.logger.warn('git pull failed', { err: this.lastPull.error })
      }
      this.emit('change', await this.status())
      return this.lastPull
    })
  }

  /** Starts (or restarts) scheduled pulls. */
  schedule() {
    clearInterval(this.timer)
    const cfg = this.config()
    if (!cfg.enabled || !cfg.remote || !cfg.pull.enabled) return
    this.timer = setInterval(() => void this.pull(), Math.max(1, cfg.pull.intervalMinutes) * 60_000)
    this.timer.unref()
  }

  stop() {
    clearInterval(this.timer)
  }

  verifyWebhook(secret: string | undefined): boolean {
    const cfg = this.config()
    return cfg.enabled && cfg.pull.enabled && !!secret && secret === cfg.webhookSecret
  }

  async history(stack: string, limit = 50) {
    if (!(await this.git.isRepo())) return []
    return this.git.log(path.posix.join(stack, '/'), limit)
  }
}
