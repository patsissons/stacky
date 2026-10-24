import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { ServerMessage } from '@stacky/shared'
import { silentLogger } from '../lib/logger'
import { Hub } from './hub'

describe('Hub updates topic', () => {
  it('tells subscribers when the newer stacky release changes, until they leave', () => {
    const updates = Object.assign(new EventEmitter(), {
      summary: () => ({ updates: [], checking: false }),
    })
    const releases = new EventEmitter()
    const hub = new Hub(
      {} as never,
      {} as never,
      {} as never,
      silentLogger,
      updates as never,
      releases as never,
    )
    const sent: ServerMessage[] = []
    const conn = hub.connect({ send: (m) => sent.push(m) })
    conn.receive(JSON.stringify({ type: 'sub', topic: 'updates' }))
    expect(sent.map((m) => m.type)).toEqual(['updates'])
    releases.emit('change', { version: '0.2.0', url: 'https://x' })
    expect(sent.at(-1)).toEqual({ type: 'self', topic: 'updates' })
    conn.close()
    releases.emit('change', undefined)
    expect(sent).toHaveLength(2)
    expect(releases.listenerCount('change')).toBe(0)
    expect(updates.listenerCount('change')).toBe(0)
  })
})
