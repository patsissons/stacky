import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import type { ImageUpdate, UpdatesSummary } from '@stacky/shared'
import { api } from '@/lib/api'
import { liveSocket } from '@/lib/ws'

export const updatesQuery = {
  queryKey: ['updates'] as const,
  queryFn: () => api.get<UpdatesSummary>('/api/updates'),
  staleTime: Infinity,
}

/** Keeps the `updates` query in sync with the live websocket topic. Mount once. */
export function useLiveUpdatesBridge() {
  const qc = useQueryClient()
  useEffect(
    () =>
      liveSocket.subscribe('updates', (msg) => {
        if (msg.type === 'updates') qc.setQueryData(updatesQuery.queryKey, msg.summary)
      }),
    [qc],
  )
}

export function useUpdates() {
  const query = useQuery(updatesQuery)
  const byRef = useMemo(
    () => new Map((query.data?.updates ?? []).map((u) => [u.ref, u])),
    [query.data],
  )
  return { ...query, byRef }
}

/** An update that should be shown (available and not ignored). */
export function isActionable(u: ImageUpdate | undefined): u is ImageUpdate {
  return !!u && u.status === 'update_available' && !u.ignored
}

export function checkForUpdates(refs?: string[]) {
  return api.post<UpdatesSummary>('/api/updates/check', { refs })
}
