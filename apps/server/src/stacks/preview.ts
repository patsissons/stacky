import type { ActionOptions, DeployPreview, PreviewAction } from '@stacky/shared'
import { upArgs } from '../ops/compose'
import { stripAnsi } from '../ops/errors'
import { runComposeInput, type ValidateInput } from './validate'

/** Container states in compose's progress output, mapped to what happens to the container. */
const ACTIONS: Record<string, PreviewAction> = {
  Recreate: 'recreate',
  Recreated: 'recreate',
  Creating: 'create',
  Created: 'create',
  Starting: 'start',
  Started: 'start',
  Stopping: 'remove',
  Stopped: 'remove',
  Removing: 'remove',
  Removed: 'remove',
  Running: 'unchanged',
}

/** A container that goes through several states reports the most disruptive one. */
const RANK: Record<PreviewAction, number> = {
  unchanged: 0,
  start: 1,
  create: 2,
  recreate: 3,
  remove: 4,
}

/**
 * Reads `docker compose --dry-run --progress plain up` output into one action per container.
 * A recreated container is restarted under a temporary `<id>_<name>`; that prefix is dropped so
 * it folds into the original container.
 */
export function parseDryRun(output: string): DeployPreview['containers'] {
  const actions = new Map<string, PreviewAction>()
  for (const line of stripAnsi(output).split(/\r?\n/)) {
    const m = /^\s*(?:DRY-RUN MODE -\s*)?Container (\S+)\s+(\w+)\s*$/.exec(line)
    const action = m && ACTIONS[m[2]!]
    if (!action) continue
    const name = m[1]!.replace(/^[0-9a-f]{12}_/, '')
    const seen = actions.get(name)
    if (!seen || RANK[action] > RANK[seen]) actions.set(name, action)
  }
  return [...actions].map(([name, action]) => ({ name, action }))
}

/** Dry-runs the deploy of (possibly unsaved) files, so the user sees what it would disrupt. */
export async function previewDeploy(
  input: ValidateInput & { options?: ActionOptions },
): Promise<DeployPreview> {
  const result = await runComposeInput(
    input,
    ['--progress', 'plain', '--dry-run', ...upArgs(input.options ?? {})],
    30_000,
  )
  const output = `${result.stdout}\n${result.stderr}`
  if (result.code !== 0) {
    const message = stripAnsi(output).trim().split('\n').filter(Boolean).at(-1)
    return { ok: false, containers: [], message: message ?? 'docker compose failed' }
  }
  return { ok: true, containers: parseDryRun(output) }
}

/** The compose versions that created a stack's containers, when any differ from the current one. */
export function composeMismatch(
  deployedWith: (string | undefined)[],
  current: string | undefined,
): DeployPreview['composeMismatch'] {
  if (!current) return undefined
  const versions = [...new Set(deployedWith.filter((v): v is string => !!v))]
  const others = versions.filter((v) => normalize(v) !== normalize(current))
  return others.length ? { deployedWith: others.sort(), current } : undefined
}

const normalize = (v: string) => v.trim().replace(/^v/, '')
