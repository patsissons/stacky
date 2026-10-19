import { useSyncExternalStore } from 'react'
import type { ActionOptions } from '@stacky/shared'

/** The mounted stack editor, so other deploy buttons can go through its review dialog. */
export interface EditorHandle {
  stack: string
  dirty: boolean
  /** Opens the review dialog when there are unsaved edits, otherwise deploys straight away. */
  deploy: (options?: ActionOptions) => void
}

let handle: EditorHandle | undefined
const listeners = new Set<() => void>()
function emit() {
  for (const l of listeners) l()
}

export const editorStore = {
  register(next: EditorHandle) {
    handle = next
    emit()
  },
  unregister(stack: string) {
    if (handle?.stack !== stack) return
    handle = undefined
    emit()
  },
  get: () => handle,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

/** The editor for `stack` when it is open with unsaved edits; deploys must then go through it. */
export function useDirtyEditor(stack: string): EditorHandle | undefined {
  const current = useSyncExternalStore(editorStore.subscribe, editorStore.get)
  return current && current.stack === stack && current.dirty ? current : undefined
}
