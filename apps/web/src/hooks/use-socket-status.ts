import { useSyncExternalStore } from 'react'
import { liveSocket } from '@/lib/ws'

export function useSocketStatus() {
  return useSyncExternalStore(
    (cb) => liveSocket.onStatus(cb),
    () => liveSocket.status,
  )
}
