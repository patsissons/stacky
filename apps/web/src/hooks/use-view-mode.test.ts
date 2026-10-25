import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveView, useViewMode } from './use-view-mode'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('resolveView', () => {
  it('prefers the URL, then the saved view, then the default', () => {
    expect(resolveView('cards', 'table', 'table')).toBe('cards')
    expect(resolveView(undefined, 'cards', 'table')).toBe('cards')
    expect(resolveView(undefined, null, 'table')).toBe('table')
  })

  it('ignores values that are not a view', () => {
    expect(resolveView('grid', 'list', 'cards')).toBe('cards')
  })
})

describe('useViewMode', () => {
  it('remembers the chosen view across mounts and reports the change', () => {
    const onChange = vi.fn()
    const first = renderHook(() => useViewMode('test:view', 'table', undefined, onChange))
    expect(first.result.current[0]).toBe('table')
    act(() => first.result.current[1]('cards'))
    expect(first.result.current[0]).toBe('cards')
    expect(onChange).toHaveBeenCalledWith('cards')

    const second = renderHook(() => useViewMode('test:view', 'table', undefined))
    expect(second.result.current[0]).toBe('cards')
    const linked = renderHook(() => useViewMode('test:view', 'table', 'table'))
    expect(linked.result.current[0]).toBe('table')
  })

  it('still switches when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useViewMode('test:view', 'cards', undefined))
    expect(result.current[0]).toBe('cards')
    act(() => result.current[1]('table'))
    expect(result.current[0]).toBe('table')
  })
})
