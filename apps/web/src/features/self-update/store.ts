import { useSyncExternalStore } from 'react'

/** The self-update the overlay is following, if any. */
let current: { operationId: string; startedAt: number } | undefined
const listeners = new Set<() => void>()

export const selfUpdateStore = {
  begin(operationId: string) {
    current = { operationId, startedAt: Date.now() }
    listeners.forEach((l) => l())
  },
  end() {
    current = undefined
    listeners.forEach((l) => l())
  },
  get: () => current,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useSelfUpdate() {
  return useSyncExternalStore(selfUpdateStore.subscribe, selfUpdateStore.get)
}

/** Operations against stacky's own stack are named "<action> stacky". */
export function isSelfOperation(action: string) {
  return / stacky$/.test(action)
}
