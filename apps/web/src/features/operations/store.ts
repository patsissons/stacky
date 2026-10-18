import { useSyncExternalStore } from 'react'

/** Which operation the output drawer shows, plus operations this tab is waiting on. */
interface State {
  openId: string | undefined
  watching: Set<string>
}

let state: State = { openId: undefined, watching: new Set() }
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export const operationStore = {
  open: (id: string) => set({ openId: id }),
  close: () => set({ openId: undefined }),
  watch: (id: string) => set({ watching: new Set([...state.watching, id]) }),
  unwatch: (id: string) => {
    const watching = new Set(state.watching)
    watching.delete(id)
    set({ watching })
  },
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useOperationStore() {
  return useSyncExternalStore(operationStore.subscribe, operationStore.get)
}
