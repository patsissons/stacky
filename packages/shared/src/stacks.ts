import { z } from 'zod'

/** Stack directory names: lowercase, digits, `-` and `_`, not starting with a separator. */
export const STACK_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

export const stackNameSchema = z
  .string()
  .regex(STACK_NAME_RE, 'use lowercase letters, digits, "-" and "_" (max 63 chars)')

/** Compose file names stacky recognises, in priority order (same as Dockge / compose). */
export const COMPOSE_FILE_NAMES = [
  'compose.yaml',
  'docker-compose.yaml',
  'docker-compose.yml',
  'compose.yml',
] as const

/** Per-container state, normalised from the Docker engine. */
export const containerStates = [
  'running',
  'healthy',
  'unhealthy',
  'starting',
  'restarting',
  'paused',
  'completed',
  'exited',
  'error',
  'created',
] as const
export type ContainerState = (typeof containerStates)[number]

/** Per-service state: a container state, or `not_created` when compose defines it but no container exists. */
export type ServiceState = ContainerState | 'not_created'

export const stackStatuses = [
  'running',
  'starting',
  'partial',
  'unhealthy',
  'stopped',
  'error',
  'inactive',
] as const
export type StackStatus = (typeof stackStatuses)[number]

export interface PortMapping {
  hostIp?: string
  hostPort?: number
  containerPort: number
  protocol: 'tcp' | 'udp' | 'sctp'
}

export interface ContainerSummary {
  id: string
  name: string
  project: string
  service: string
  /** Replica number from `com.docker.compose.container-number`. */
  number: number
  image: string
  imageId: string
  state: ContainerState
  /** Docker's human readable status, e.g. "Up 2 hours (healthy)". */
  statusText: string
  exitCode?: number
  createdAt: number
  ports: PortMapping[]
}

export interface ServiceSummary {
  name: string
  /** Image reference from the compose file, when known. */
  image?: string
  state: ServiceState
  containers: ContainerSummary[]
}

export interface StackSummary {
  name: string
  /** true when the stack lives in the stacks directory; false for external compose projects. */
  managed: boolean
  status: StackStatus
  /** Absolute path of the stack directory (managed) or compose working dir (external). */
  path?: string
  composeFile?: string
  services: ServiceSummary[]
  /** The stack that contains stacky itself. */
  isSelf: boolean
  /** Extra links declared via `x-stacky.urls` / `x-dockge.urls`. */
  urls: string[]
  /** Error parsing the compose file, if any. */
  parseError?: string
  /** Id of the operation currently running on this stack. */
  activeOperationId?: string
}

export interface StackFiles {
  name: string
  composeFile: string
  compose: string
  /** Contents of the stack's `.env`, or empty string when there is none. */
  env: string
  hasEnv: boolean
}
