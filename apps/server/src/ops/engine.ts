import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { desc, eq } from 'drizzle-orm'
import type { OperationSummary } from '@stacky/shared'
import type { Db } from '../db'
import { operations } from '../db/schema'
import type { Logger } from '../lib/logger'
import { displayCommand, type Step } from './compose'
import { classifyFailure } from './errors'

const MAX_LIVE_OUTPUT = 2 * 1024 * 1024
const PERSISTED_OUTPUT = 256 * 1024
const LIVE_RETENTION_MS = 10 * 60 * 1000
const KILL_GRACE_MS = 5000

export interface OperationRequest {
  stack: string
  action: string
  services?: string[]
  /** Working directory for docker commands. */
  cwd: string
  steps: Step[]
}

interface LiveOperation {
  summary: OperationSummary
  chunks: string[]
  size: number
  child?: ChildProcess
  cancelled: boolean
  done: Promise<OperationSummary>
}

interface EngineEvents {
  update: [OperationSummary]
  output: [id: string, chunk: string]
}

/**
 * Runs operations: one at a time per stack (queued), each a sequence of
 * `docker` commands and in-process tasks. Output is buffered for late
 * subscribers, streamed as events, and persisted with the result.
 */
export class OperationEngine extends EventEmitter<EngineEvents> {
  private live = new Map<string, LiveOperation>()
  private queues = new Map<string, Promise<unknown>>()

  constructor(
    private readonly db: Db,
    private readonly logger: Logger,
    private readonly dockerBin = 'docker',
  ) {
    super()
    this.markInterruptedOperations()
  }

  enqueue(req: OperationRequest): OperationSummary {
    const summary: OperationSummary = {
      id: `op_${randomUUID()}`,
      stack: req.stack,
      action: req.action,
      services: req.services ?? [],
      state: 'queued',
      commands: req.steps.map(displayCommand),
      createdAt: Date.now(),
    }
    this.db
      .insert(operations)
      .values({ ...summary, output: '' })
      .run()

    let resolveDone!: (s: OperationSummary) => void
    const live: LiveOperation = {
      summary,
      chunks: [],
      size: 0,
      cancelled: false,
      done: new Promise((r) => (resolveDone = r)),
    }
    this.live.set(summary.id, live)

    const previous = this.queues.get(req.stack) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this.run(live, req))
      .then(resolveDone)
    this.queues.set(req.stack, next)
    void next.finally(() => {
      if (this.queues.get(req.stack) === next) this.queues.delete(req.stack)
    })

    this.emit('update', summary)
    return summary
  }

  get(id: string): OperationSummary | undefined {
    const live = this.live.get(id)
    if (live) return live.summary
    const row = this.db.select().from(operations).where(eq(operations.id, id)).get()
    return row ? toSummary(row) : undefined
  }

  output(id: string): string {
    const live = this.live.get(id)
    if (live) return live.chunks.join('')
    const row = this.db
      .select({ output: operations.output })
      .from(operations)
      .where(eq(operations.id, id))
      .get()
    return row?.output ?? ''
  }

  list({ stack, limit = 50 }: { stack?: string; limit?: number } = {}): OperationSummary[] {
    const q = this.db.select().from(operations)
    const rows = (stack ? q.where(eq(operations.stack, stack)) : q)
      .orderBy(desc(operations.createdAt))
      .limit(limit)
      .all()
    return rows.map((r) => this.live.get(r.id)?.summary ?? toSummary(r))
  }

  /** The operation currently queued or running for a stack, if any. */
  active(stack: string): OperationSummary | undefined {
    for (const live of this.live.values()) {
      const s = live.summary
      if (s.stack === stack && (s.state === 'queued' || s.state === 'running')) return s
    }
    return undefined
  }

  async wait(id: string): Promise<OperationSummary | undefined> {
    return this.live.get(id)?.done ?? this.get(id)
  }

  cancel(id: string): boolean {
    const live = this.live.get(id)
    if (!live || (live.summary.state !== 'queued' && live.summary.state !== 'running')) return false
    live.cancelled = true
    const child = live.child
    if (child?.pid) {
      killGroup(child.pid, 'SIGTERM')
      setTimeout(
        () => child.exitCode === null && killGroup(child.pid!, 'SIGKILL'),
        KILL_GRACE_MS,
      ).unref()
    }
    return true
  }

  private async run(live: LiveOperation, req: OperationRequest): Promise<OperationSummary> {
    const s = live.summary
    if (live.cancelled) return this.finish(live, 'cancelled')
    s.state = 'running'
    s.startedAt = Date.now()
    this.persist(live)
    this.emit('update', s)

    for (const step of req.steps) {
      this.write(live, `\x1b[2m$ ${displayCommand(step)}\x1b[0m\r\n`)
      if (step.kind === 'task') {
        try {
          await step.run()
        } catch (err) {
          this.write(live, `\x1b[31m${String(err)}\x1b[0m\r\n`)
          s.error = {
            code: 'task_failed',
            message: err instanceof Error ? err.message : String(err),
          }
          return this.finish(live, 'failed')
        }
        continue
      }
      const code = await this.exec(live, step.args, req.cwd)
      if (live.cancelled) return this.finish(live, 'cancelled')
      if (code !== 0) {
        s.exitCode = code
        s.error = classifyFailure(live.chunks.join('').slice(-64 * 1024), code)
        return this.finish(live, 'failed')
      }
    }
    s.exitCode = 0
    return this.finish(live, 'succeeded')
  }

  private exec(live: LiveOperation, args: string[], cwd: string): Promise<number> {
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(this.dockerBin, args, {
          cwd,
          // Own process group so cancel can stop compose and anything it spawned.
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, COMPOSE_MENU: 'false' },
        })
      } catch (err) {
        this.write(live, `\x1b[31m${String(err)}\x1b[0m\r\n`)
        resolve(127)
        return
      }
      live.child = child
      const onData = (buf: Buffer) => this.write(live, buf.toString('utf8'))
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.on('error', (err) => {
        this.write(live, `\x1b[31m${err.message}\x1b[0m\r\n`)
        resolve((err as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 1)
      })
      child.on('close', (code, signal) => {
        live.child = undefined
        resolve(code ?? (signal ? 128 : 1))
      })
    })
  }

  private write(live: LiveOperation, chunk: string) {
    live.chunks.push(chunk)
    live.size += chunk.length
    while (live.size > MAX_LIVE_OUTPUT && live.chunks.length > 1) {
      live.size -= live.chunks.shift()!.length
    }
    this.emit('output', live.summary.id, chunk)
  }

  private finish(live: LiveOperation, state: OperationSummary['state']): OperationSummary {
    const s = live.summary
    s.state = state
    s.finishedAt = Date.now()
    if (state === 'cancelled') this.write(live, '\r\n\x1b[33mcancelled\x1b[0m\r\n')
    this.persist(live)
    this.emit('update', s)
    setTimeout(() => this.live.delete(s.id), LIVE_RETENTION_MS).unref()
    this.logger.info('operation finished', {
      id: s.id,
      stack: s.stack,
      action: s.action,
      state,
      ms: s.finishedAt - (s.startedAt ?? s.createdAt),
    })
    return s
  }

  private persist(live: LiveOperation) {
    const s = live.summary
    this.db
      .update(operations)
      .set({
        state: s.state,
        exitCode: s.exitCode ?? null,
        error: s.error ?? null,
        startedAt: s.startedAt ?? null,
        finishedAt: s.finishedAt ?? null,
        output: live.chunks.join('').slice(-PERSISTED_OUTPUT),
      })
      .where(eq(operations.id, s.id))
      .run()
  }

  /** Operations still marked queued/running belonged to a previous process that died. */
  private markInterruptedOperations() {
    const rows = this.db.select().from(operations).all()
    for (const r of rows) {
      if (r.state === 'queued' || r.state === 'running') {
        this.db
          .update(operations)
          .set({
            state: 'failed',
            finishedAt: Date.now(),
            error: {
              code: 'interrupted',
              message: 'Stacky restarted while this operation was running',
            },
          })
          .where(eq(operations.id, r.id))
          .run()
      }
    }
  }
}

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  }
}

function toSummary(r: typeof operations.$inferSelect): OperationSummary {
  return {
    id: r.id,
    stack: r.stack,
    action: r.action,
    services: r.services,
    state: r.state as OperationSummary['state'],
    commands: r.commands,
    exitCode: r.exitCode ?? undefined,
    error: r.error ?? undefined,
    createdAt: r.createdAt,
    startedAt: r.startedAt ?? undefined,
    finishedAt: r.finishedAt ?? undefined,
  }
}
