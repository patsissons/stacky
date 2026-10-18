import type { ClientMessage, ServerMessage } from '@stacky/shared'

type Handler = (message: ServerMessage) => void
export type SocketStatus = 'connecting' | 'open' | 'closed'

interface Subscription {
  params?: Record<string, string | number | boolean>
  handlers: Set<Handler>
  /** Messages so far, replayed to handlers that join an existing topic. */
  history: ServerMessage[]
}

const MAX_HISTORY = 5000

/**
 * One multiplexed WebSocket per tab. Topics are reference counted and
 * re-subscribed automatically after a reconnect.
 */
export class LiveSocket {
  private ws: WebSocket | undefined
  private subs = new Map<string, Subscription>()
  private statusListeners = new Set<(s: SocketStatus) => void>()
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private heartbeat: ReturnType<typeof setInterval> | undefined
  status: SocketStatus = 'closed'

  constructor(private readonly url: () => string = defaultUrl) {}

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return
    clearTimeout(this.timer)
    this.setStatus('connecting')
    const ws = new WebSocket(this.url())
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setStatus('open')
      for (const [topic, sub] of this.subs) {
        // the server replays current state on subscribe, so start the history over
        sub.history = []
        this.send({ type: 'sub', topic, params: sub.params })
      }
      clearInterval(this.heartbeat)
      this.heartbeat = setInterval(() => this.send({ type: 'ping' }), 25_000)
    }
    ws.onmessage = (e) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(e.data as string) as ServerMessage
      } catch {
        return
      }
      const topic = msg.type === 'stacks' ? 'stacks' : 'topic' in msg ? msg.topic : undefined
      if (!topic) return
      const sub = this.subs.get(topic)
      if (!sub) return
      if (msg.type === 'stacks') sub.history = [msg]
      else {
        sub.history.push(msg)
        if (sub.history.length > MAX_HISTORY)
          sub.history.splice(0, sub.history.length - MAX_HISTORY)
      }
      for (const h of sub.handlers) h(msg)
    }
    ws.onclose = () => {
      clearInterval(this.heartbeat)
      if (this.ws !== ws) return
      this.ws = undefined
      this.setStatus('closed')
      const delay = Math.min(1000 * 2 ** this.retry, 15_000)
      this.retry++
      this.timer = setTimeout(() => this.connect(), delay)
    }
  }

  disconnect() {
    clearTimeout(this.timer)
    clearInterval(this.heartbeat)
    const ws = this.ws
    this.ws = undefined
    ws?.close()
    this.setStatus('closed')
  }

  subscribe(
    topic: string,
    handler: Handler,
    params?: Record<string, string | number | boolean>,
  ): () => void {
    let sub = this.subs.get(topic)
    if (!sub) {
      sub = { params, handlers: new Set(), history: [] }
      this.subs.set(topic, sub)
      this.send({ type: 'sub', topic, params })
    } else if (sub.history.length > 0) {
      const replay = [...sub.history]
      queueMicrotask(() => {
        if (sub?.handlers.has(handler)) for (const m of replay) handler(m)
      })
    }
    sub.handlers.add(handler)
    this.connect()
    return () => {
      const s = this.subs.get(topic)
      if (!s) return
      s.handlers.delete(handler)
      if (s.handlers.size === 0) {
        this.subs.delete(topic)
        this.send({ type: 'unsub', topic })
      }
    }
  }

  send(message: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  onStatus(listener: (s: SocketStatus) => void) {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private setStatus(status: SocketStatus) {
    this.status = status
    for (const l of this.statusListeners) l(status)
  }
}

function defaultUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

export const liveSocket = new LiveSocket()
