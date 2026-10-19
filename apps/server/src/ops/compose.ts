import path from 'node:path'
import type { ActionOptions, ServiceAction, StackAction } from '@stacky/shared'
import { planServices, type StackUpdatePlan } from '../stacks/update-plan'

export interface ComposeTarget {
  /** Absolute stack directory (the compose project directory). */
  dir: string
  composeFile: string
  /** Absolute path of `global.env` when it exists. */
  globalEnv?: string
  hasEnv: boolean
}

/**
 * Global `docker compose` arguments for a stack.
 *
 * Compose reads `<project dir>/.env` automatically, but only as long as no
 * `--env-file` is given. So when `global.env` exists both files are passed,
 * global first so the stack's own `.env` wins (fixes Dockge's layering bug).
 */
export function composeArgs(target: ComposeTarget): string[] {
  const args = [
    'compose',
    '--ansi',
    'always',
    '--progress',
    'tty',
    '--project-directory',
    target.dir,
    '-f',
    path.join(target.dir, target.composeFile),
  ]
  if (target.globalEnv) {
    args.push('--env-file', target.globalEnv)
    if (target.hasEnv) args.push('--env-file', path.join(target.dir, '.env'))
  }
  return args
}

export interface PlanContext {
  /** Whether any container of the stack is currently up (affects `update`). */
  running: boolean
}

/** A step is either `docker <args>` or an in-process action (e.g. deleting files). */
export type Step =
  | { kind: 'docker'; args: string[] }
  | { kind: 'task'; label: string; run: (ctx: TaskContext) => Promise<void> }

export interface TaskContext {
  /** Appends a line to the operation output. */
  write(text: string): void
}

function upArgs(options: ActionOptions): string[] {
  const args = ['up', '-d', '--remove-orphans']
  if (options.build) args.push('--build')
  if (options.pull) args.push('--pull', options.pull)
  if (options.forceRecreate) args.push('--force-recreate')
  return args
}

/** The docker commands each stack action runs. */
export function planStackAction(
  target: ComposeTarget,
  action: Exclude<StackAction, 'delete' | 'pull-updates' | 'deploy-updates'>,
  options: ActionOptions,
  ctx: PlanContext,
): Step[] {
  const base = composeArgs(target)
  const svc = options.services ?? []
  const docker = (...args: string[]): Step => ({ kind: 'docker', args: [...base, ...args] })

  switch (action) {
    case 'deploy':
      return [docker('config', '--quiet'), docker(...upArgs(options), ...svc)]
    case 'start':
      return [docker(...upArgs(options), ...svc)]
    case 'stop':
      return [docker('stop', ...svc)]
    case 'restart':
      return [docker('restart', ...svc)]
    case 'down': {
      const args = ['down', '--remove-orphans']
      if (options.removeVolumes) args.push('--volumes')
      return [docker(...args)]
    }
    case 'pull':
      return [docker('pull', ...svc)]
    case 'update': {
      const steps = [docker('pull', ...svc)]
      // Like Dockge: pulling a stopped stack must not start it.
      if (ctx.running) steps.push(docker(...upArgs(options), ...svc))
      if (options.prune) steps.push({ kind: 'docker', args: ['image', 'prune', '--force'] })
      return steps
    }
  }
}

/**
 * Applies the update checker's results. `pull` only prefetches the newer images (compose.yaml
 * and the containers stay as they are); `deploy` runs after the new tags were written to
 * compose.yaml, and pulls and recreates the affected services.
 */
export function planUpdateAction(
  target: ComposeTarget,
  mode: 'pull' | 'deploy',
  plan: StackUpdatePlan,
  options: ActionOptions,
): Step[] {
  const base = composeArgs(target)
  const docker = (...args: string[]): Step => ({ kind: 'docker', args: [...base, ...args] })
  const lines = [
    ...plan.bumps.filter((b) => b.from !== b.to).map((b) => `${b.service}: ${b.from} → ${b.to}`),
    ...plan.skipped.map((s) => `${s.service}: skipped (${s.reason})`),
  ]
  const steps: Step[] = []
  if (lines.length) {
    steps.push({
      kind: 'task',
      label: mode === 'pull' ? 'newer images' : 'set image tags',
      run: async (ctx) => lines.forEach((line) => ctx.write(line)),
    })
  }

  if (mode === 'pull') {
    // pulled by reference: compose would pull the tags it already has
    for (const ref of new Set(plan.bumps.map((b) => b.to))) {
      steps.push({ kind: 'docker', args: ['pull', ref] })
    }
    if (plan.rebuilt.length) steps.push(docker('pull', ...plan.rebuilt))
    return steps
  }

  const svc = planServices(plan)
  steps.push(docker('config', '--quiet'), docker('pull', ...svc), docker(...upArgs({}), ...svc))
  if (options.prune) steps.push({ kind: 'docker', args: ['image', 'prune', '--force'] })
  return steps
}

/** The docker commands each per-service action runs. */
export function planServiceAction(
  target: ComposeTarget,
  action: ServiceAction,
  services: string[],
): Step[] {
  const base = composeArgs(target)
  const docker = (...args: string[]): Step => ({ kind: 'docker', args: [...base, ...args] })
  switch (action) {
    case 'start':
      return [docker('up', '-d', '--no-deps', ...services)]
    case 'stop':
      return [docker('stop', ...services)]
    case 'restart':
      return [docker('restart', ...services)]
    case 'recreate':
      return [docker('up', '-d', '--no-deps', '--force-recreate', ...services)]
    case 'pull':
      return [docker('pull', ...services)]
    case 'update':
      return [docker('pull', ...services), docker('up', '-d', '--no-deps', ...services)]
  }
}

/** Human readable command line for display (drops the noisy global flags). */
export function displayCommand(step: Step): string {
  if (step.kind === 'task') return step.label
  const args = [...step.args]
  if (args[0] === 'compose') {
    const shown = ['compose']
    for (let i = 1; i < args.length; i++) {
      const a = args[i]!
      if (['--ansi', '--progress', '--project-directory', '-f', '--env-file'].includes(a)) {
        i++
        continue
      }
      shown.push(a)
    }
    return ['docker', ...shown].join(' ')
  }
  return ['docker', ...args].join(' ')
}
