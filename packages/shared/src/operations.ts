import { z } from 'zod'

export const stackActions = [
  'deploy',
  'start',
  'stop',
  'restart',
  'down',
  'pull',
  'update',
  'delete',
  /** Prefetches the newer images the update checker found; compose.yaml is untouched. */
  'pull-updates',
  /** Writes the newer tags to compose.yaml, then pulls and recreates those services. */
  'deploy-updates',
] as const
export type StackAction = (typeof stackActions)[number]

export const serviceActions = ['start', 'stop', 'restart', 'recreate', 'pull', 'update'] as const
export type ServiceAction = (typeof serviceActions)[number]

export const actionOptionsSchema = z
  .object({
    /** Pass `--build` to `up` (Dockerfile-based stacks). */
    build: z.boolean().optional(),
    /** `--pull` policy for `up`. */
    pull: z.enum(['always', 'missing', 'never']).optional(),
    forceRecreate: z.boolean().optional(),
    /** `down -v`: also remove named volumes. */
    removeVolumes: z.boolean().optional(),
    /** Remove dangling images after an update. */
    prune: z.boolean().optional(),
    /** Restrict to these services. */
    services: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type ActionOptions = z.infer<typeof actionOptionsSchema>

export type OperationState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface OperationError {
  code: string
  message: string
  hint?: string
}

export interface OperationSummary {
  id: string
  stack: string
  action: string
  services: string[]
  state: OperationState
  /** The compose command lines this operation ran, for display. */
  commands: string[]
  exitCode?: number
  error?: OperationError
  createdAt: number
  startedAt?: number
  finishedAt?: number
}
