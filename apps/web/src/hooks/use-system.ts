import { useQuery } from '@tanstack/react-query'
import type { SystemInfo } from '@stacky/shared'
import { api } from '@/lib/api'

export function useSystem() {
  return useQuery({
    queryKey: ['system'],
    queryFn: () => api.get<SystemInfo>('/api/system'),
    staleTime: 60_000,
  })
}

/** Host for published-port links: the configured Docker host, else the host stacky is served from. */
export function useDockerHost() {
  const { data } = useSystem()
  return data?.dockerHost ?? window.location.hostname
}
