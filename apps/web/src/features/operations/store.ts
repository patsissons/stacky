import { useSyncExternalStore } from 'react'

/**
 * The operations the output drawer shows (one tab each when there are several), the selected
 * one, plus operations this tab is waiting on.
 */
interface State {
  openIds: string[]
  openId: string | undefined
  watching: Set<string>
}

let state: State = { openIds: [], openId: undefined, watching: new Set() }
const listeners = new Set<() => void>()

function set(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export const operationStore = {
  open: (id: string) => set({ openIds: [id], openId: id }),
  openAll: (ids: string[]) => {
    if (ids.length > 0) set({ openIds: ids, openId: ids[0] })
  },
  select: (id: string) => set({ openId: id }),
  close: () => set({ openIds: [], openId: undefined }),
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
