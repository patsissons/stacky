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

export const ACTION_LABELS: Record<string, { running: string; done: string }> = {
  deploy: { running: 'Deploying', done: 'Deployed' },
  start: { running: 'Starting', done: 'Started' },
  stop: { running: 'Stopping', done: 'Stopped' },
  restart: { running: 'Restarting', done: 'Restarted' },
  down: { running: 'Taking down', done: 'Took down' },
  pull: { running: 'Pulling', done: 'Pulled' },
  update: { running: 'Updating', done: 'Updated' },
  delete: { running: 'Deleting', done: 'Deleted' },
}

export function actionLabel(action: string, done: boolean) {
  const [verb, ...rest] = action.split(' ')
  const labels = ACTION_LABELS[verb ?? '']
  const word = labels ? (done ? labels.done : labels.running) : verb
  return [word, ...rest].join(' ')
}
