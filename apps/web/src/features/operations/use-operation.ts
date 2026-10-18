import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OperationSummary } from '@stacky/shared'
import { liveSocket } from '@/lib/ws'

/** Live operation state; `onOutput` receives the full replay and then each new chunk. */
export function useOperation(id: string | undefined, onOutput?: (chunk: string) => void) {
  const [state, setState] = useState<{ id?: string; operation?: OperationSummary }>({})
  const outputRef = useRef(onOutput)
  useLayoutEffect(() => {
    outputRef.current = onOutput
  })

  useEffect(() => {
    if (!id) return
    return liveSocket.subscribe(`op:${id}`, (msg) => {
      if (msg.type === 'op') setState({ id, operation: msg.operation })
      else if (msg.type === 'output') outputRef.current?.(msg.data)
    })
  }, [id])

  // state from a previous id is never shown for the current one
  return state.id === id ? state.operation : undefined
}

export function isFinished(op: OperationSummary | undefined) {
  return !!op && (op.state === 'succeeded' || op.state === 'failed' || op.state === 'cancelled')
}
