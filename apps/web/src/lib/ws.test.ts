import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerMessage } from '@stacky/shared'
import { LiveSocket } from './ws'

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  sent: unknown[] = []
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LiveSocket', () => {
  it('subscribes on open and routes messages by topic', () => {
    const socket = new LiveSocket(() => 'ws://x/ws')
    const got: ServerMessage[] = []
    socket.subscribe('op:1', (m) => got.push(m))
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    expect(ws.sent).toContainEqual({ type: 'sub', topic: 'op:1' })
    ws.receive({ type: 'output', topic: 'op:1', data: 'hello' })
    ws.receive({ type: 'output', topic: 'op:2', data: 'ignored' })
    expect(got).toEqual([{ type: 'output', topic: 'op:1', data: 'hello' }])
    socket.disconnect()
  })

  it('replays history to handlers that join an existing topic', async () => {
    const socket = new LiveSocket(() => 'ws://x/ws')
    socket.subscribe('op:1', () => {})
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    ws.receive({ type: 'output', topic: 'op:1', data: 'early' })
    const late: ServerMessage[] = []
    socket.subscribe('op:1', (m) => late.push(m))
    await Promise.resolve()
    expect(late).toEqual([{ type: 'output', topic: 'op:1', data: 'early' }])
    socket.disconnect()
  })

  it('unsubscribes when the last handler leaves', () => {
    const socket = new LiveSocket(() => 'ws://x/ws')
    const off = socket.subscribe('stacks', () => {})
    const ws = FakeWebSocket.instances[0]!
    ws.open()
    off()
    expect(ws.sent).toContainEqual({ type: 'unsub', topic: 'stacks' })
    socket.disconnect()
  })
})
