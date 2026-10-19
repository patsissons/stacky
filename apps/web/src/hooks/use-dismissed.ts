import { useState } from 'react'

/** A notice the user closed for good in this browser (kept in localStorage). */
export function useDismissed(key: string) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(key, '1')
    } catch {
      // storage unavailable: stays dismissed until reload
    }
  }
  return [dismissed, dismiss] as const
}
