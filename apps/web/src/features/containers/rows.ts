import type { ContainerState, ImageUpdate, PortMapping, StackSummary } from '@stacky/shared'
import { isActionable } from '@/hooks/use-updates'
import { parseImageRef } from '@/lib/format'

export interface ContainerRow {
  id: string
  name: string
  service: string
  number: number
  stack: string
  managed: boolean
  isSelf: boolean
  state: ContainerState
  statusText: string
  image: string
  registry: string
  repository: string
  tag: string
  ports: PortMapping[]
  createdAt: number
  icon?: string
}

export type StatusFilter = 'all' | 'running' | 'problems' | 'stopped' | 'updates'

const PROBLEMS: ReadonlySet<ContainerState> = new Set(['unhealthy', 'error', 'restarting'])
const RUNNING: ReadonlySet<ContainerState> = new Set(['running', 'healthy', 'starting', 'paused'])

export function matchesStatus(state: ContainerState, filter: StatusFilter): boolean {
  if (filter === 'all' || filter === 'updates') return true
  if (filter === 'problems') return PROBLEMS.has(state)
  if (filter === 'running') return RUNNING.has(state) || state === 'unhealthy'
  return !RUNNING.has(state) && !PROBLEMS.has(state)
}

/** One row per container across all stacks, with the image split for display. */
export function buildRows(stacks: StackSummary[]): ContainerRow[] {
  const rows: ContainerRow[] = []
  for (const stack of stacks) {
    for (const service of stack.services) {
      for (const c of service.containers) {
        // Prefer the reference from the compose file; the engine may report a bare id.
        const ref = c.image.startsWith('sha256:') ? (service.image ?? c.image) : c.image
        const { registry, repository, tag } = parseImageRef(ref)
        rows.push({
          id: c.id,
          name: c.name,
          service: service.name,
          number: c.number,
          stack: stack.name,
          managed: stack.managed,
          isSelf: stack.isSelf,
          state: c.state,
          statusText: c.statusText,
          image: ref,
          registry,
          repository,
          tag,
          ports: c.ports,
          createdAt: c.createdAt,
          icon: c.icon,
        })
      }
    }
  }
  return rows
}

/** The distinct image references a stack's containers run, as the update checker keys them. */
export function stackImageRefs(stack: StackSummary): string[] {
  return [...new Set(buildRows([stack]).map((r) => r.image))]
}

/** Base URL for a published port on `host` (see `useDockerHost`). */
export function portUrl(port: PortMapping, host = window.location.hostname): string | undefined {
  if (!port.hostPort) return undefined
  const scheme = port.containerPort === 443 || port.hostPort === 443 ? 'https' : 'http'
  return `${scheme}://${host}:${port.hostPort}`
}

/** One service to move to a newer image: a new tag (rewrites compose.yaml) or a re-pull. */
export interface UpdateStep {
  stack: string
  service: string
  kind: 'bump' | 'pull'
  tag: string
  newerTag?: string
}

export interface UpdatePlan {
  steps: UpdateStep[]
  skipped: { stack: string; service: string; reason: string }[]
}

/** What "Update all" will do: one step per service with an actionable update. */
export function planUpdates(rows: ContainerRow[], byRef: Map<string, ImageUpdate>): UpdatePlan {
  const plan: UpdatePlan = { steps: [], skipped: [] }
  const seen = new Set<string>()
  for (const row of rows) {
    const update = byRef.get(row.image)
    if (!isActionable(update)) continue
    const key = `${row.managed}:${row.stack}/${row.service}`
    if (seen.has(key)) continue
    seen.add(key)
    const at = { stack: row.stack, service: row.service }
    if (!row.managed) plan.skipped.push({ ...at, reason: 'outside the stacks directory' })
    else if (row.isSelf) plan.skipped.push({ ...at, reason: 'stacky updates itself separately' })
    else if (update.newerTag)
      plan.steps.push({ ...at, kind: 'bump', tag: update.tag, newerTag: update.newerTag })
    else if (update.digestChanged) plan.steps.push({ ...at, kind: 'pull', tag: update.tag })
  }
  return plan
}

/** The plan's services per stack, in plan order: each stack runs as one operation. */
export function groupByStack(steps: UpdateStep[]): { stack: string; services: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const step of steps) {
    const services = groups.get(step.stack) ?? []
    services.push(step.service)
    groups.set(step.stack, services)
  }
  return [...groups].map(([stack, services]) => ({ stack, services }))
}
