import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  StackFiles,
  ActionOptions,
  OperationError,
  OperationSummary,
  ServiceAction,
  StackAction,
  StackSummary,
  ValidationResult,
} from '@stacky/shared'
import { AppError, badRequest, notFound } from '../lib/errors'
import type { ComposeTarget, Step } from '../ops/compose'
import { planServiceAction, planStackAction } from '../ops/compose'
import type { OperationEngine } from '../ops/engine'
import { GLOBAL_ENV_FILE, type StackRepository } from './repository'
import type { RevisionStore } from './revisions'
import type { StackState } from './state'
import type { UpdateChecker } from '../updates/checker'
import { setServiceImage } from '../self/compose-edit'
import { withTag } from '../self/image-ref'
import { parseDocument } from 'yaml'
import { composeTags } from './compose-file'
import { validateCompose } from './validate'

const UP_STATES: ReadonlySet<string> = new Set([
  'running',
  'healthy',
  'unhealthy',
  'starting',
  'restarting',
  'paused',
])

/** Actions that would stop or recreate stacky's own container. */
const SELF_DISRUPTIVE: ReadonlySet<string> = new Set([
  'deploy',
  'start',
  'stop',
  'restart',
  'down',
  'update',
  'delete',
  'recreate',
])

export interface SelfUpdateHook {
  /** Called instead of running a disruptive action against stacky's own stack. */
  (stack: StackSummary, action: string, options: ActionOptions): Promise<OperationSummary>
}

/** Application logic for stacks: ties files on disk, live state and operations together. */
const REFRESHES_IMAGES = /^(deploy|update|pull)( |$)/

/** Actions that apply the compose files; their files become a revision when they succeed. */
const APPLIES_CONFIG = /^(deploy|start|update|recreate)( |$)/

export class StackService {
  selfUpdate: SelfUpdateHook | undefined
  /** When set, successfully deployed files are recorded for history and rollback. */
  revisions: RevisionStore | undefined
  private pendingRevisions = new Map<string, StackFiles>()
  /** When set, images are re-checked after operations that may have changed them. */
  updates: UpdateChecker | undefined

  constructor(
    private readonly repo: StackRepository,
    private readonly state: StackState,
    private readonly engine: OperationEngine,
    private readonly dockerBin = 'docker',
  ) {
    engine.on('update', (op) => {
      const active = op.state === 'queued' || op.state === 'running'
      // Uses the state's own marker, not the (possibly not yet refreshed) snapshot,
      // so an operation that finishes very quickly can't leave the stack marked busy.
      if (active) state.setActiveOperation(op.stack, op.id)
      else state.clearActiveOperation(op.stack, op.id, engine.active(op.stack)?.id)
      if (!active) state.schedule(0)
      const snapshot = this.pendingRevisions.get(op.id)
      if (snapshot && !active) {
        this.pendingRevisions.delete(op.id)
        if (op.state === 'succeeded') this.revisions?.record(op.stack, snapshot, op.id)
      }
      if (op.state === 'succeeded' && REFRESHES_IMAGES.test(op.action) && this.updates) {
        const refs = this.imageRefs(op.stack)
        setTimeout(() => void this.updates?.checkAll(refs), 2000).unref()
      }
    })
    engine.enrichError = (error) => this.enrichError(error)
  }

  /** Names the container that already holds a port, so the hint is actionable. */
  private enrichError(error: OperationError): OperationError {
    if (error.code !== 'port_in_use') return error
    const port = Number(/Port (\d+)/.exec(error.message)?.[1])
    const holder = this.state
      .allContainers()
      .find((c) => c.ports.some((p) => p.hostPort === port) && UP_STATES.has(c.state))
    if (!holder) return error
    return {
      ...error,
      hint: `Container "${holder.name}" (stack "${holder.project}") already publishes port ${port}. Change the host port in this stack, or stop that container.`,
    }
  }

  async target(name: string): Promise<ComposeTarget> {
    const files = await this.repo.read(name)
    const globalEnv = path.join(this.repo.stacksDir, GLOBAL_ENV_FILE)
    const hasGlobal = await fs
      .access(globalEnv)
      .then(() => true)
      .catch(() => false)
    return {
      dir: this.repo.dir(name),
      composeFile: files.composeFile,
      hasEnv: files.hasEnv,
      globalEnv: hasGlobal ? globalEnv : undefined,
    }
  }

  async validate(name: string, compose: string, env?: string): Promise<ValidationResult> {
    const globalEnvPath = path.join(this.repo.stacksDir, GLOBAL_ENV_FILE)
    const hasGlobal = await fs
      .access(globalEnvPath)
      .then(() => true)
      .catch(() => false)
    return validateCompose({
      dir: this.repo.dir(name),
      compose,
      env,
      globalEnv: hasGlobal ? globalEnvPath : undefined,
      dockerBin: this.dockerBin,
    })
  }

  async create(name: string, compose: string, env = '') {
    await this.repo.ensureStacksDir()
    await this.repo.create(name, compose, env)
    await this.state.refreshNow()
  }

  async save(name: string, files: { compose?: string; env?: string }) {
    this.requireManaged(name)
    await this.repo.write(name, files)
    await this.state.refreshNow()
  }

  async stackAction(
    name: string,
    action: StackAction,
    options: ActionOptions = {},
  ): Promise<OperationSummary> {
    const stack = this.requireManaged(name)
    if (stack.isSelf && SELF_DISRUPTIVE.has(action)) return this.routeSelf(stack, action, options)

    const target = await this.target(name)
    let steps: Step[]
    if (action === 'delete') {
      steps = []
      if (stack.status !== 'inactive') {
        steps.push(
          ...planStackAction(
            target,
            'down',
            { removeVolumes: options.removeVolumes },
            { running: true },
          ),
        )
      }
      steps.push({
        kind: 'task',
        label: `remove ${target.dir}`,
        run: async () => {
          await this.repo.remove(name)
          await this.state.refreshNow()
        },
      })
    } else {
      const running = stack.services.some((s) => s.containers.some((c) => UP_STATES.has(c.state)))
      steps = planStackAction(target, action, options, { running })
    }
    const files = await this.filesForRevision(name, action)
    const op = this.engine.enqueue({
      stack: name,
      action,
      services: options.services,
      cwd: target.dir,
      steps,
    })
    // set synchronously after enqueue: the operation can't finish before this runs
    if (files) this.pendingRevisions.set(op.id, files)
    return op
  }

  /** The files an operation applies; recorded as a revision if it succeeds. */
  private async filesForRevision(name: string, action: string) {
    if (!this.revisions || !APPLIES_CONFIG.test(action)) return undefined
    return this.repo.read(name).catch(() => undefined)
  }

  /** Writes an earlier revision's files back and deploys them. */
  async restoreRevision(name: string, id: number): Promise<OperationSummary> {
    const revision = this.revisions?.get(name, id)
    if (!revision) throw notFound(`revision ${id} of stack "${name}"`)
    const validation = await this.validate(name, revision.compose, revision.env)
    if (!validation.ok) {
      throw new AppError(
        422,
        'invalid_compose',
        'That revision no longer validates',
        validation.issues[0]?.message,
        validation,
      )
    }
    await this.save(name, { compose: revision.compose, env: revision.env ?? '' })
    return this.stackAction(name, 'deploy')
  }

  async serviceAction(name: string, service: string, action: ServiceAction) {
    const stack = this.requireManaged(name)
    if (!stack.services.some((s) => s.name === service)) {
      throw notFound(`service "${service}" in stack "${name}"`)
    }
    if (stack.isSelf && SELF_DISRUPTIVE.has(action)) {
      return this.routeSelf(stack, action, { services: [service] })
    }
    const target = await this.target(name)
    const files = await this.filesForRevision(name, action)
    const op = this.engine.enqueue({
      stack: name,
      action: `${action} ${service}`,
      services: [service],
      cwd: target.dir,
      steps: planServiceAction(target, action, [service]),
    })
    if (files) this.pendingRevisions.set(op.id, files)
    return op
  }

  private imageRefs(name: string): string[] {
    const stack = this.state.get(name)
    return [
      ...new Set(
        stack?.services
          .flatMap((s) => [s.image, ...s.containers.map((c) => c.image)])
          .filter((x): x is string => !!x) ?? [],
      ),
    ]
  }

  /**
   * Moves a service to another tag of its image with a targeted edit of the
   * `image:` line (comments and formatting stay), then pulls and recreates it.
   */
  async bumpImage(name: string, service: string, tag: string): Promise<OperationSummary> {
    if (!/^[\w][\w.-]{0,127}$/.test(tag)) throw badRequest(`invalid tag "${tag}"`)
    const stack = this.requireManaged(name)
    if (stack.isSelf && this.selfUpdate) {
      // stacky's own image goes through the self-update flow
      return this.selfUpdate(stack, 'update-to', { services: [tag] })
    }
    const files = await this.repo.read(name)
    const doc = parseDocument(files.compose, { customTags: composeTags })
    const current = doc.getIn(['services', service, 'image'])
    if (typeof current !== 'string') throw notFound(`image for service "${service}"`)
    if (current.includes('$')) {
      throw new AppError(
        409,
        'image_uses_variable',
        `The image of "${service}" is set from a variable (${current})`,
        'Change the variable in the .env file instead.',
      )
    }
    await this.save(name, {
      compose: setServiceImage(files.compose, service, withTag(current, tag)),
    })
    return this.serviceAction(name, service, 'update')
  }

  private routeSelf(stack: StackSummary, action: string, options: ActionOptions) {
    if (this.selfUpdate) return this.selfUpdate(stack, action, options)
    throw new AppError(
      409,
      'self_stack',
      `"${action}" would stop stacky itself`,
      'Update stacky from the self-update banner instead.',
    )
  }

  private requireManaged(name: string): StackSummary {
    const stack = this.state.get(name)
    if (!stack) throw notFound(`stack "${name}"`)
    if (!stack.managed) {
      throw new AppError(
        409,
        'external_stack',
        `"${name}" is not in the stacks directory`,
        'Move its folder into the stacks directory (after `docker compose down`) to manage it from stacky.',
      )
    }
    return stack
  }
}
