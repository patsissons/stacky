import { useState } from 'react'

export type ViewMode = 'cards' | 'table'

export const isViewMode = (v: unknown): v is ViewMode => v === 'cards' || v === 'table'

/** The view to show: `?view=` in the URL, then the one saved in this browser, then the default. */
export function resolveView(url: unknown, stored: unknown, fallback: ViewMode): ViewMode {
  if (isViewMode(url)) return url
  if (isViewMode(stored)) return stored
  return fallback
}

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * A page's card or table view, remembered per browser (localStorage). A `?view=` search param
 * wins, so links can ask for one; `onChange` lets the page drop it once the user picks.
 */
export function useViewMode(
  key: string,
  fallback: ViewMode,
  url: ViewMode | undefined,
  onChange?: (view: ViewMode) => void,
) {
  const [stored, setStored] = useState(() => read(key))
  const view = resolveView(url, stored, fallback)
  const setView = (next: ViewMode) => {
    setStored(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // storage unavailable: kept until reload
    }
    onChange?.(next)
  }
  return [view, setView] as const
}
