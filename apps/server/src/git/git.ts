import { runCapture, type RunResult } from '../lib/run'

export interface GitAuth {
  /** HTTPS token (GitHub/GitLab/Gitea PAT); sent as basic auth, never written to .git/config. */
  token?: string
  username?: string
}

export class GitError extends Error {}

/** Thin wrapper around the git CLI for one working tree. */
export class Git {
  constructor(
    readonly dir: string,
    private readonly bin = process.env.STACKY_GIT_BIN ?? 'git',
  ) {}

  async run(
    args: string[],
    { auth, allowFail = false }: { auth?: GitAuth; allowFail?: boolean } = {},
  ): Promise<RunResult> {
    const pre = [
      '-c',
      'core.quotepath=off',
      '-c',
      'user.name=stacky',
      '-c',
      'user.email=stacky@localhost',
      // the stacks dir is often owned by another user than stacky's
      '-c',
      `safe.directory=${this.dir}`,
    ]
    if (auth?.token) {
      const basic = Buffer.from(`${auth.username ?? 'x-access-token'}:${auth.token}`).toString(
        'base64',
      )
      pre.push('-c', `http.extraHeader=Authorization: Basic ${basic}`)
    }
    const res = await runCapture(this.bin, [...pre, ...args], {
      cwd: this.dir,
      timeoutMs: 120_000,
    })
    if (res.code !== 0 && !allowFail) {
      const msg = (res.stderr || res.stdout).trim().split('\n').slice(-3).join(' ')
      throw new GitError(redact(msg || `git ${args[0]} failed`, auth))
    }
    return res
  }

  async isRepo(): Promise<boolean> {
    const res = await this.run(['rev-parse', '--is-inside-work-tree'], { allowFail: true })
    return res.code === 0 && res.stdout.trim() === 'true'
  }

  async head(): Promise<string | undefined> {
    const res = await this.run(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true })
    return res.code === 0 ? res.stdout.trim() : undefined
  }

  /** Commits exactly these paths (nothing else that might be staged). Returns false if unchanged. */
  async commitPaths(paths: string[], message: string): Promise<boolean> {
    if (paths.length === 0) return false
    await this.run(['add', '--all', '--', ...paths])
    const staged = await this.run(['diff', '--cached', '--quiet', '--', ...paths], {
      allowFail: true,
    })
    if (staged.code === 0) return false
    await this.run(['commit', '--quiet', '--no-verify', '-m', message, '--', ...paths])
    return true
  }

  async changedBetween(from: string, to: string): Promise<string[]> {
    const res = await this.run(['diff', '--name-only', from, to])
    return res.stdout.split('\n').filter(Boolean)
  }

  async log(path: string | undefined, limit = 50) {
    const args = ['log', `-n${limit}`, '--format=%H%x1f%ct%x1f%an%x1f%s']
    if (path) args.push('--', path)
    const res = await this.run(args, { allowFail: true })
    if (res.code !== 0) return []
    return res.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, ts, author, subject] = line.split('\x1f')
        return { hash: hash!, ts: Number(ts) * 1000, author: author!, subject: subject! }
      })
  }
}

/** Removes credentials from git output before it is shown or logged. */
export function redact(text: string, auth?: GitAuth): string {
  let out = text.replace(/(https?:\/\/)[^@/\s]+@/g, '$1***@')
  if (auth?.token) out = out.split(auth.token).join('***')
  return out
}
