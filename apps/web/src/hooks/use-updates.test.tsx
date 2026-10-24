import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '@stacky/shared'
import { selfQuery } from './use-self'
import { updatesQuery, useLiveUpdatesBridge } from './use-updates'

const handlers = vi.hoisted(() => [] as ((m: ServerMessage) => void)[])
vi.mock('@/lib/ws', () => ({
  liveSocket: {
    subscribe: (_topic: string, handler: (m: ServerMessage) => void) => {
      handlers.push(handler)
      return () => {}
    },
  },
}))

describe('useLiveUpdatesBridge', () => {
  it('stores update results and refetches self info when the stacky release changes', () => {
    const qc = new QueryClient()
    qc.setQueryData(selfQuery.queryKey, { version: '0.1.0' } as never)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    renderHook(() => useLiveUpdatesBridge(), { wrapper })
    const summary = { updates: [], checking: false }
    handlers.forEach((h) => h({ type: 'updates', topic: 'updates', summary }))
    expect(qc.getQueryData(updatesQuery.queryKey)).toEqual(summary)
    expect(qc.getQueryState(selfQuery.queryKey)?.isInvalidated).toBe(false)
    handlers.forEach((h) => h({ type: 'self', topic: 'updates' }))
    expect(qc.getQueryState(selfQuery.queryKey)?.isInvalidated).toBe(true)
  })
})
