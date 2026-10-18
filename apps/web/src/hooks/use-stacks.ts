import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { StackSummary } from '@stacky/shared'
import { api } from '@/lib/api'
import { liveSocket } from '@/lib/ws'

export const stacksQuery = {
  queryKey: ['stacks'] as const,
  queryFn: () => api.get<StackSummary[]>('/api/stacks'),
  staleTime: Infinity,
}

/** Keeps the `stacks` query in sync with the live websocket topic. Mount once. */
export function useLiveStacksBridge() {
  const qc = useQueryClient()
  useEffect(
    () =>
      liveSocket.subscribe('stacks', (msg) => {
        if (msg.type === 'stacks') qc.setQueryData(stacksQuery.queryKey, msg.stacks)
      }),
    [qc],
  )
}

export function useStacks() {
  return useQuery(stacksQuery)
}

export function useStack(name: string) {
  const query = useStacks()
  const stack =
    query.data?.find((s) => s.name === name && s.managed) ??
    query.data?.find((s) => s.name === name)
  return { ...query, stack }
}
