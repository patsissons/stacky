import fs from 'node:fs/promises'
import path from 'node:path'
import type { SelfJobState } from '@stacky/shared'

/**
 * - pending: written by stacky, the updater has not finished
 * - applied: the updater recreated stacky and it came up healthy
 * - rolled_back: the new version failed; the previous one was restored
 * - failed: the updater could not restore the previous version either
 * - succeeded: the new instance confirmed the update
 * - stale: nobody finished the job in time
 */
export type JobState = SelfJobState

export interface SelfUpdateJob {
  id: string
  /** Operation shown in the UI for this job. */
  operationId: string
  action: string
  state: JobState
  project: string
  service: string
  workingDir: string
  configFiles: string[]
  envFiles: string[]
  from: { ref: string; imageId: string; version: string }
  to: { ref: string; imageId?: string }
  /** Compose files as they were when stacky last started successfully; restored on rollback. */
  composeBackups?: { file: string; content: string }[]
  createdAt: number
  finishedAt?: number
  error?: string
  /** Tail of the helper's output. */
  log?: string
}

export const FINAL_STATES: ReadonlySet<JobState> = new Set([
  'rolled_back',
  'failed',
  'succeeded',
  'stale',
])

/** Self-update jobs live as JSON files in the data dir so the helper and the new instance can read them. */
export class JobStore {
  constructor(readonly dir: string) {}

  private file(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error(`invalid job id "${id}"`)
    return path.join(this.dir, `${id}.json`)
  }

  async write(job: SelfUpdateJob) {
    await fs.mkdir(this.dir, { recursive: true })
    const tmp = `${this.file(job.id)}.tmp`
    await fs.writeFile(tmp, JSON.stringify(job, null, 2))
    await fs.rename(tmp, this.file(job.id))
  }

  async read(id: string): Promise<SelfUpdateJob | undefined> {
    const file = this.file(id)
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as SelfUpdateJob
    } catch {
      return undefined
    }
  }

  async list(): Promise<SelfUpdateJob[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.dir)
    } catch {
      return []
    }
    const jobs = await Promise.all(
      names.filter((n) => n.endsWith('.json')).map((n) => this.read(n.slice(0, -5))),
    )
    return jobs.filter((j): j is SelfUpdateJob => !!j).sort((a, b) => b.createdAt - a.createdAt)
  }

  async latest() {
    return (await this.list())[0]
  }

  /** Keeps the newest `keep` jobs. */
  async prune(keep = 20) {
    const jobs = await this.list()
    for (const job of jobs.slice(keep)) await fs.rm(this.file(job.id), { force: true })
  }
}
