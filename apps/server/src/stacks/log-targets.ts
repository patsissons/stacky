import type { StackSummary } from '@stacky/shared'
import type { LogTarget } from '../docker/logs'

/** The containers whose logs make up a stack's (or one service's) log view. */
export function logTargets(stack: StackSummary, service?: string): LogTarget[] {
  return stack.services
    .filter((s) => !service || s.name === service)
    .flatMap((s) => s.containers.map((c) => ({ id: c.id, name: c.name, service: s.name })))
}
