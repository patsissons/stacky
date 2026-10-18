import { useEffect, useState } from 'react'
import type { StatsSample } from '@stacky/shared'
import { liveSocket } from '@/lib/ws'

const HISTORY = 30
type History = Record<string, StatsSample[]>

/** Live CPU/memory per container for a stack, with a short history for sparklines. */
export function useStackStats(stack: string, enabled = true, key = '') {
  // `key` changes when the set of running containers changes, forcing a resubscribe.
  const subKey = `${stack}|${enabled}|${key}`
  const [state, setState] = useState<{ subKey: string; history: History }>({ subKey, history: {} })

  useEffect(() => {
    if (!enabled) return
    return liveSocket.subscribe(`stats:${stack}`, (msg) => {
      if (msg.type !== 'stats') return
      setState((prev) => {
        const history = prev.subKey === subKey ? { ...prev.history } : {}
        for (const s of msg.samples) {
          history[s.containerId] = [...(history[s.containerId] ?? []), s].slice(-HISTORY)
        }
        return { subKey, history }
      })
    })
  }, [stack, enabled, subKey])

  return state.subKey === subKey ? state.history : {}
}
