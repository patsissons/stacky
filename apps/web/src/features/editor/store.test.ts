import { describe, expect, it, vi } from 'vitest'
import { editorStore } from './store'

describe('editorStore', () => {
  it('exposes the registered editor and clears it on unregister', () => {
    const deploy = vi.fn()
    const listener = vi.fn()
    const unsubscribe = editorStore.subscribe(listener)

    editorStore.register({ stack: 'demo', dirty: true, deploy })
    expect(editorStore.get()?.stack).toBe('demo')
    expect(listener).toHaveBeenCalledTimes(1)

    editorStore.get()?.deploy({ pull: 'always' })
    expect(deploy).toHaveBeenCalledWith({ pull: 'always' })

    // another stack's unregister must not clear it
    editorStore.unregister('other')
    expect(editorStore.get()?.stack).toBe('demo')
    expect(listener).toHaveBeenCalledTimes(1)

    editorStore.unregister('demo')
    expect(editorStore.get()).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })
})
