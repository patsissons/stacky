import { useSyncExternalStore } from 'react'

/** The container (or service) whose compose definition the bottom sheet shows. */
export interface ServiceSheetTarget {
  stack: string
  managed: boolean
  service: string
  /** The clicked container, when there is one. */
  containerId?: string
}

let target: ServiceSheetTarget | undefined
const listeners = new Set<() => void>()

export const serviceSheetStore = {
  open: (next: ServiceSheetTarget) => {
    target = next
    for (const l of listeners) l()
  },
  close: () => {
    target = undefined
    for (const l of listeners) l()
  },
  get: () => target,
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export function useServiceSheet() {
  return useSyncExternalStore(serviceSheetStore.subscribe, serviceSheetStore.get)
}

/**
 * Opens the sheet for a click on a row or card, unless the click was meant for a link,
 * button, menu or field inside it.
 */
export function openFromClick(e: React.MouseEvent, next: ServiceSheetTarget) {
  const el = e.target as HTMLElement
  // React bubbles events out of portals (menus, dialogs) into the row; ignore those
  if (!(e.currentTarget as HTMLElement).contains(el)) return
  if (el.closest('a,button,input,select,textarea,label,[role="menuitem"],[role="switch"]')) return
  // selecting text is not a click
  if (window.getSelection()?.toString()) return
  serviceSheetStore.open(next)
}
