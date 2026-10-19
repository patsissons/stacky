import type { ActionOptions, OperationSummary, ServiceAction, StackAction } from '@stacky/shared'
import { api } from '@/lib/api'
import { isSelfOperation, selfUpdateStore } from '@/features/self-update/store'
import { operationStore } from './store'

/** Starts a stack action, opens its output drawer and watches it for a result toast. */
export async function runStackAction(
  stack: string,
  action: StackAction,
  options: ActionOptions = {},
  files?: { compose?: string; env?: string },
  { openDrawer = true }: { openDrawer?: boolean } = {},
): Promise<OperationSummary> {
  const op = await api.post<OperationSummary>(`/api/stacks/${stack}/actions/${action}`, {
    options,
    ...files,
  })
  if (isSelfOperation(op.action)) {
    // stacky is about to restart itself: the overlay follows it instead of the drawer
    selfUpdateStore.begin(op.id)
    return op
  }
  operationStore.watch(op.id)
  if (openDrawer) operationStore.open(op.id)
  return op
}

/** Updates, redeploys or restarts stacky itself. */
export async function runSelfAction(
  action: 'update' | 'deploy' | 'restart',
  targetVersion?: string,
): Promise<OperationSummary> {
  const op = await api.post<OperationSummary>(`/api/self/${action}`, { targetVersion })
  selfUpdateStore.begin(op.id)
  return op
}

export async function runServiceAction(
  stack: string,
  service: string,
  action: ServiceAction,
): Promise<OperationSummary> {
  const op = await api.post<OperationSummary>(
    `/api/stacks/${stack}/services/${encodeURIComponent(service)}/${action}`,
  )
  if (isSelfOperation(op.action)) {
    selfUpdateStore.begin(op.id)
    return op
  }
  operationStore.watch(op.id)
  return op
}

/** Moves a service to a newer image tag (edits its `image:` line), then updates it. */
export async function bumpServiceImage(
  stack: string,
  service: string,
  tag: string,
): Promise<OperationSummary> {
  const op = await api.post<OperationSummary>(
    `/api/stacks/${stack}/services/${encodeURIComponent(service)}/image`,
    { tag },
  )
  if (isSelfOperation(op.action)) {
    selfUpdateStore.begin(op.id)
    return op
  }
  operationStore.watch(op.id)
  return op
}

export const ACTION_LABELS: Record<string, { verb: string; running: string; done: string }> = {
  deploy: { verb: 'Deploy', running: 'Deploying', done: 'Deployed' },
  start: { verb: 'Start', running: 'Starting', done: 'Started' },
  stop: { verb: 'Stop', running: 'Stopping', done: 'Stopped' },
  restart: { verb: 'Restart', running: 'Restarting', done: 'Restarted' },
  down: { verb: 'Take down', running: 'Taking down', done: 'Took down' },
  pull: { verb: 'Pull', running: 'Pulling', done: 'Pulled' },
  update: { verb: 'Update', running: 'Updating', done: 'Updated' },
  delete: { verb: 'Delete', running: 'Deleting', done: 'Deleted' },
  'pull-updates': { verb: 'Pull updates', running: 'Pulling updates', done: 'Pulled updates' },
  'deploy-updates': {
    verb: 'Deploy updates',
    running: 'Deploying updates',
    done: 'Deployed updates',
  },
}

export type ActionTense = 'verb' | 'running' | 'done'

/**
 * Label for an operation: `done` once it succeeded, `running` while it runs and the bare
 * `verb` when it failed or was cancelled ("Deploy demo failed", not "Deployed demo failed").
 * `true`/`false` are kept as shorthands for done/running.
 */
export function actionLabel(action: string, tense: ActionTense | boolean) {
  const [verb, ...rest] = action.split(' ')
  const labels = ACTION_LABELS[verb ?? '']
  const key = tense === true ? 'done' : tense === false ? 'running' : tense
  const word = labels ? labels[key] : verb
  return [word, ...rest].join(' ')
}

/** The tense that matches an operation's state. */
export function operationTense(state: OperationSummary['state']): ActionTense {
  if (state === 'succeeded') return 'done'
  if (state === 'queued' || state === 'running') return 'running'
  return 'verb'
}
