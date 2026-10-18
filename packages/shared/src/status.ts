import type { ContainerState, ServiceState, StackStatus } from './stacks'

export interface RawContainerState {
  /** Docker's `State`: created | running | paused | restarting | removing | exited | dead */
  state: string
  /** Docker's `Status`, e.g. "Up 2 hours (healthy)" or "Exited (1) 3 minutes ago". */
  status: string
  /** Restart policy name from HostConfig, when known. */
  restartPolicy?: string
}

/** Exit codes produced by `docker stop` (graceful or after the kill timeout). */
const STOP_EXIT_CODES = new Set([0, 137, 143])

export function parseExitCode(status: string): number | undefined {
  const match = /^Exited \((-?\d+)\)/i.exec(status.trim())
  return match ? Number(match[1]) : undefined
}

/**
 * Normalises a container's raw engine state. One-shot containers (restart
 * policy `no`/`on-failure`) that exited 0 are `completed`, not `exited`, so a
 * finished init container doesn't make its stack look broken.
 */
export function containerState({
  state,
  status,
  restartPolicy,
}: RawContainerState): ContainerState {
  switch (state) {
    case 'running': {
      if (/\(unhealthy\)/i.test(status)) return 'unhealthy'
      if (/\(health: starting\)/i.test(status)) return 'starting'
      if (/\(healthy\)/i.test(status)) return 'healthy'
      return 'running'
    }
    case 'restarting':
      return 'restarting'
    case 'paused':
      return 'paused'
    case 'created':
      return 'created'
    case 'dead':
      return 'error'
    case 'removing':
    case 'exited': {
      const code = parseExitCode(status)
      const policy = restartPolicy ?? ''
      if (code === 0 && (policy === '' || policy === 'no' || policy === 'on-failure')) {
        return 'completed'
      }
      if (code !== undefined && !STOP_EXIT_CODES.has(code)) return 'error'
      return 'exited'
    }
    default:
      return 'exited'
  }
}

const UP: ReadonlySet<ServiceState> = new Set([
  'running',
  'healthy',
  'unhealthy',
  'starting',
  'restarting',
  'paused',
])
const OK: ReadonlySet<ServiceState> = new Set(['running', 'healthy', 'completed'])
const SEVERITY: ServiceState[] = [
  'error',
  'unhealthy',
  'restarting',
  'starting',
  'paused',
  'exited',
  'created',
  'not_created',
  'completed',
  'running',
  'healthy',
]

/** A service's state is its worst container state (replicas can differ). */
export function serviceState(containerStates: ContainerState[]): ServiceState {
  if (containerStates.length === 0) return 'not_created'
  for (const s of SEVERITY) if (containerStates.includes(s as ContainerState)) return s
  return containerStates[0]!
}

/**
 * Rolls service states up into one stack status.
 *
 * - `inactive`: no containers at all (never deployed, or `down`)
 * - `stopped` / `error`: containers exist but none are up
 * - `unhealthy`: something is up but at least one service is unhealthy, crashing or errored
 * - `starting`: something is still starting (healthcheck pending)
 * - `running`: every service is running, healthy or completed
 * - `partial`: some services are up and others are stopped or not created
 */
export function stackStatus(services: ServiceState[]): StackStatus {
  const created = services.filter((s) => s !== 'not_created')
  if (created.length === 0) return 'inactive'

  const anyError = services.includes('error')
  const anyUp = services.some((s) => UP.has(s))
  if (!anyUp) return anyError ? 'error' : 'stopped'

  if (anyError || services.includes('unhealthy') || services.includes('restarting')) {
    return 'unhealthy'
  }
  if (services.includes('starting')) return 'starting'
  if (services.every((s) => OK.has(s))) return 'running'
  return 'partial'
}
