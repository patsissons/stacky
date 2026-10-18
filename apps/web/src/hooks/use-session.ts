import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Session {
  authDisabled: boolean
  needsSetup: boolean
  user: { id: string; username: string; name: string } | null
}

export const sessionQuery = {
  queryKey: ['session'] as const,
  queryFn: () => api.get<Session>('/api/session'),
  staleTime: 60_000,
}

export function useSession() {
  return useQuery(sessionQuery)
}
