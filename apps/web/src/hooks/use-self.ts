import { useQuery } from '@tanstack/react-query'
import type { SelfInfo } from '@stacky/shared'
import { api } from '@/lib/api'

export const selfQuery = {
  queryKey: ['self'] as const,
  queryFn: () => api.get<SelfInfo>('/api/self'),
  staleTime: 5 * 60_000,
}

export function useSelf() {
  return useQuery(selfQuery)
}
