import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDismissed } from './use-dismissed'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('useDismissed', () => {
  it('remembers a dismissal across mounts', () => {
    const first = renderHook(() => useDismissed('test:notice'))
    expect(first.result.current[0]).toBe(false)
    act(() => first.result.current[1]())
    expect(first.result.current[0]).toBe(true)

    const second = renderHook(() => useDismissed('test:notice'))
    expect(second.result.current[0]).toBe(true)
  })

  it('still dismisses when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useDismissed('test:notice'))
    expect(result.current[0]).toBe(false)
    act(() => result.current[1]())
    expect(result.current[0]).toBe(true)
  })
})
