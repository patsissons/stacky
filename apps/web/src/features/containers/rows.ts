import type { ContainerState, PortMapping, StackSummary } from '@stacky/shared'
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
        })
      }
    }
  }
  return rows
}

/** Base URL for a published port: the configured host, else the host stacky is served from. */
export function portUrl(port: PortMapping, host = window.location.hostname): string | undefined {
  if (!port.hostPort) return undefined
  const scheme = port.containerPort === 443 || port.hostPort === 443 ? 'https' : 'http'
  return `${scheme}://${host}:${port.hostPort}`
}
