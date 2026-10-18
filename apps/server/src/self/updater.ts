import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type Docker from 'dockerode'
import type { OperationSummary, SelfInfo } from '@stacky/shared'
import type { Config } from '../config'
import { AppError, conflict } from '../lib/errors'
import type { Logger } from '../lib/logger'
import type { Step } from '../ops/compose'
import type { OperationEngine } from '../ops/engine'
import { parseDocument } from 'yaml'
import { composeTags } from '../stacks/compose-file'
import { setServiceImage } from './compose-edit'
import { projectArgs } from './helper'
import type { SelfIdentity } from './identity'
import { isMovingTag, splitRef, withTag } from './image-ref'
import { FINAL_STATES, JobStore, type SelfUpdateJob } from './jobs'
import type { ReleaseChecker } from './release'

export const UPDATER_LABEL = 'dev.stacky.updater'
const STALE_MS = 60 * 60 * 1000

export type SelfAction = 'update' | 'deploy' | 'restart'

/**
 * Updates, redeploys or restarts stacky's own compose service. Stacky pulls
 * the image itself (streamed like any operation), then hands the container
 * swap to a short-lived updater container (see `helper.ts`) because a process
 * can't recreate the container it runs in.
 */
export class SelfUpdater {
  readonly jobs: JobStore

  constructor(
    private readonly docker: Docker,
    private readonly engine: OperationEngine,
    private readonly config: Config,
    private readonly self: SelfIdentity | undefined,
    private readonly version: string,
    private readonly releases: ReleaseChecker,
    private readonly logger: Logger,
    private readonly dockerBin = 'docker',
  ) {
    this.jobs = new JobStore(path.join(config.dataDir, 'self-update'))
  }

  unavailableReason(): string | undefined {
    const self = this.self
    if (!self) return 'Stacky is not running in a container.'
    if (!self.project || !self.service || !self.workingDir || !self.configFiles?.length) {
      return 'Stacky was not started with docker compose. Run it from a compose file to enable self-update.'
    }
    return undefined
  }

  async info(): Promise<SelfInfo> {
    const reason = this.unavailableReason()
    const last = await this.jobs.latest()
    const release = await this.releases.available(this.version)
    return {
      available: !reason,
      reason,
      version: this.version,
      image: this.self?.image,
      imageId: this.self?.imageId,
      project: this.self?.project,
      service: this.self?.service,
      movingTag: this.self ? isMovingTag(splitRef(this.self.image).tag) : undefined,
      latestRelease: release ? { version: release.version, url: release.url } : undefined,
      lastJob: last && {
        id: last.id,
        operationId: last.operationId,
        action: last.action,
        state: last.state,
        from: last.from,
        to: last.to,
        createdAt: last.createdAt,
        finishedAt: last.finishedAt,
        error: last.error,
      },
    }
  }

  async run(
    action: SelfAction,
    { targetVersion }: { targetVersion?: string } = {},
  ): Promise<OperationSummary> {
    const reason = this.unavailableReason()
    if (reason) throw new AppError(409, 'self_update_unavailable', reason)
    const self = this.self!
    const last = await this.jobs.latest()
    if (
      last &&
      !FINAL_STATES.has(last.state) &&
      last.state !== 'applied' &&
      Date.now() - last.createdAt < STALE_MS
    ) {
      throw conflict('A stacky update is already in progress')
    }
    if (targetVersion !== undefined && !/^[\w][\w.-]{0,127}$/.test(targetVersion)) {
      throw new AppError(400, 'bad_request', `invalid version "${targetVersion}"`)
    }

    const fromRef = self.image
    const toRef = targetVersion ? withTag(fromRef, targetVersion) : fromRef
    const job: SelfUpdateJob = {
      id: `job_${Date.now()}_${randomUUID().slice(0, 8)}`,
      operationId: '',
      action,
      state: 'pending',
      project: self.project!,
      service: self.service!,
      workingDir: self.workingDir!,
      configFiles: self.configFiles!,
      envFiles: self.envFiles?.filter(Boolean) ?? [],
      from: { ref: fromRef, imageId: self.imageId, version: this.version },
      to: { ref: toRef },
      createdAt: Date.now(),
    }

    job.composeBackups = await this.knownGood(job.configFiles)
    const base = await projectArgs(job)
    const steps: Step[] = []
    if (toRef !== fromRef) {
      steps.push({
        kind: 'task',
        label: `set ${job.service} image to ${toRef}`,
        run: () => this.pinImage(job),
      })
    }
    if (action === 'update') steps.push({ kind: 'docker', args: [...base, 'pull', job.service] })
    steps.push({
      kind: 'task',
      label: 'hand over to the stacky updater',
      run: async ({ write }) => {
        const target = await this.docker.getImage(toRef).inspect()
        job.to.imageId = target.Id
        if (action === 'update' && target.Id === self.imageId && toRef === fromRef) {
          write('\x1b[32mstacky is already running the latest image; nothing to do\x1b[0m')
          return
        }
        await this.startHelper(job)
        write(
          '\x1b[36mstacky is restarting with the new version; this page reconnects when it is back\x1b[0m',
        )
      },
    })

    const op = this.engine.enqueue({
      stack: self.project!,
      action: `${action} stacky`,
      services: [job.service],
      cwd: job.workingDir,
      steps,
    })
    job.operationId = op.id
    return op
  }

  /** Records the change of tag in the compose file (with a backup for rollback). */
  private async pinImage(job: SelfUpdateJob) {
    // the last file that sets the image wins in compose, so edit that one
    for (const file of [...job.configFiles].reverse()) {
      const content = await fs.readFile(file, 'utf8').catch(() => undefined)
      if (content === undefined) continue
      const doc = parseDocument(content, { customTags: composeTags })
      if (doc.getIn(['services', job.service, 'image']) === undefined) continue
      if (!job.composeBackups?.some((b) => b.file === file)) {
        job.composeBackups = [...(job.composeBackups ?? []), { file, content }]
      }
      await fs.writeFile(file, setServiceImage(content, job.service, job.to.ref))
      return
    }
    throw new Error(`no compose file sets an image for service "${job.service}"`)
  }

  private async startHelper(job: SelfUpdateJob) {
    const self = this.self!
    await this.jobs.write(job)
    const mounts: Docker.MountSettings[] = []
    const addBind = (source: string, target = source) => {
      if (!mounts.some((m) => m.Target === target))
        mounts.push({ Type: 'bind', Source: source, Target: target })
    }

    // the Docker socket and the data dir exactly as stacky has them
    for (const m of self.mounts) {
      if (m.destination === '/var/run/docker.sock' || m.destination === this.config.dataDir) {
        if (m.type === 'volume' && m.name) {
          mounts.push({ Type: 'volume', Source: m.name, Target: m.destination })
        } else addBind(m.source, m.destination)
      }
    }
    // compose files, env files and the stacks dir at the same paths as on the host
    addBind(this.config.stacksDir)
    for (const dir of new Set([
      job.workingDir,
      ...job.configFiles.map(path.dirname),
      ...job.envFiles.map(path.dirname),
    ])) {
      if (!isWithin(this.config.stacksDir, dir)) addBind(dir)
    }

    const dockerHost = process.env.DOCKER_HOST
    const container = await this.docker.createContainer({
      name: `stacky-updater-${Date.now()}`,
      Image: self.imageId,
      Cmd: ['node', '/app/server/dist/cli.js', 'self-update', 'apply', job.id],
      Env: [
        `STACKY_DATA_DIR=${this.config.dataDir}`,
        ...(dockerHost ? [`DOCKER_HOST=${dockerHost}`] : []),
      ],
      Labels: { [UPDATER_LABEL]: 'true', 'dev.stacky.job': job.id },
      User: '0:0',
      HostConfig: {
        Mounts: mounts,
        NetworkMode: dockerHost?.startsWith('tcp://') ? undefined : 'none',
        SecurityOpt: self.securityOpt,
        AutoRemove: false,
      },
    })
    await container.start()
    this.logger.info('started stacky updater', {
      job: job.id,
      container: container.id.slice(0, 12),
    })
  }

  private get knownGoodFile() {
    return path.join(this.jobs.dir, 'known-good.json')
  }

  /** The compose files as of the last healthy start, falling back to their current content. */
  private async knownGood(files: string[]) {
    let saved: Record<string, string> = {}
    try {
      saved = JSON.parse(await fs.readFile(this.knownGoodFile, 'utf8')) as Record<string, string>
    } catch {
      // no snapshot yet
    }
    const out: { file: string; content: string }[] = []
    for (const file of files) {
      const content = saved[file] ?? (await fs.readFile(file, 'utf8').catch(() => undefined))
      if (content !== undefined) out.push({ file, content })
    }
    return out
  }

  /** Stacky is up, so its compose files work: remember them for rollbacks. */
  private async snapshotKnownGood() {
    if (this.unavailableReason()) return
    const files: Record<string, string> = {}
    for (const file of this.self!.configFiles!) {
      const content = await fs.readFile(file, 'utf8').catch(() => undefined)
      if (content !== undefined) files[file] = content
    }
    await fs.mkdir(this.jobs.dir, { recursive: true })
    await fs.writeFile(this.knownGoodFile, JSON.stringify(files, null, 2))
  }

  /**
   * Runs on boot: the new instance confirms (or not) the update that replaced
   * the previous one, and removes finished updater containers.
   */
  async reconcile() {
    await this.confirmJobs()
    await this.jobs.prune()
    const latest = await this.jobs.latest()
    if (!latest || FINAL_STATES.has(latest.state)) {
      await this.snapshotKnownGood()
      await this.removeFinishedHelpers()
      return
    }
    // The updater only records its result after this instance is healthy, so keep
    // checking for a while after boot.
    const started = Date.now()
    const timer = setInterval(() => {
      void (async () => {
        await this.confirmJobs()
        const job = await this.jobs.latest()
        if (!job || FINAL_STATES.has(job.state) || Date.now() - started > 15 * 60_000) {
          clearInterval(timer)
          await this.snapshotKnownGood()
          await this.removeFinishedHelpers()
        }
      })().catch((err) => this.logger.warn('self-update reconcile failed', { err: String(err) }))
    }, 2000)
    timer.unref()
  }

  private async confirmJobs() {
    for (const job of (await this.jobs.list()).slice(0, 5)) {
      if (job.state === 'applied') {
        await this.jobs.write({
          ...job,
          state: 'succeeded',
          finishedAt: job.finishedAt ?? Date.now(),
        })
        this.logger.info('self-update succeeded', { job: job.id, version: this.version })
      } else if (job.state === 'pending' && Date.now() - job.createdAt > STALE_MS) {
        await this.jobs.write({ ...job, state: 'stale', finishedAt: Date.now() })
      }
    }
  }

  private async removeFinishedHelpers() {
    try {
      const helpers = await this.docker.listContainers({
        all: true,
        filters: { label: [UPDATER_LABEL], status: ['exited', 'dead', 'created'] },
      })
      for (const h of helpers) await this.docker.getContainer(h.Id).remove({ force: true })
    } catch (err) {
      this.logger.debug('could not clean up updater containers', { err: String(err) })
    }
  }
}

function isWithin(parent: string, child: string) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
