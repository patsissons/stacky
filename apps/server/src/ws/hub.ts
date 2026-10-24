import type Docker from 'dockerode'
import type { ClientMessage, ServerMessage, StackSummary } from '@stacky/shared'
import { openExec, type ExecSession } from '../docker/exec'
import { streamLogs } from '../docker/logs'
import { streamStats } from '../docker/stats'
import type { Logger } from '../lib/logger'
import type { ReleaseChecker } from '../self/release'
import type { OperationEngine } from '../ops/engine'
import { logTargets } from '../stacks/log-targets'
import type { StackState } from '../stacks/state'
import type { UpdateChecker } from '../updates/checker'

export interface Peer {
  send(message: ServerMessage): void
}

type Dispose = () => void

interface Connection {
  peer: Peer
  subs: Map<string, Dispose>
  execs: Map<string, ExecSession>
}

const UP = new Set(['running', 'healthy', 'unhealthy', 'starting', 'restarting', 'paused'])

/**
 * Multiplexes live topics over one WebSocket per browser tab (see
 * `@stacky/shared` ws.ts for the topic list).
 */
export class Hub {
  private connections = new Set<Connection>()

  constructor(
    private readonly state: StackState,
    private readonly engine: OperationEngine,
    private readonly docker: Docker,
    private readonly logger: Logger,
    private readonly updates?: UpdateChecker,
    private readonly releases?: ReleaseChecker,
  ) {}

  connect(peer: Peer) {
    const conn: Connection = { peer, subs: new Map(), execs: new Map() }
    this.connections.add(conn)
    return {
      receive: (raw: string) => this.receive(conn, raw),
      close: () => {
        for (const dispose of conn.subs.values()) dispose()
        conn.subs.clear()
        this.connections.delete(conn)
      },
    }
  }

  get size() {
    return this.connections.size
  }

  private receive(conn: Connection, raw: string) {
    let msg: ClientMessage
    try {
      msg = JSON.parse(raw) as ClientMessage
    } catch {
      return conn.peer.send({ type: 'error', message: 'invalid message' })
    }
    switch (msg.type) {
      case 'ping':
        return conn.peer.send({ type: 'pong' })
      case 'sub':
        return this.subscribe(conn, msg.topic, msg.params ?? {})
      case 'unsub': {
        conn.subs.get(msg.topic)?.()
        conn.subs.delete(msg.topic)
        return
      }
      case 'input':
        return conn.execs.get(msg.topic)?.write(msg.data)
      case 'resize':
        return conn.execs.get(msg.topic)?.resize(msg.cols, msg.rows)
    }
  }

  private subscribe(conn: Connection, topic: string, params: Record<string, unknown>) {
    if (conn.subs.has(topic)) return
    const send = (m: ServerMessage) => conn.peer.send(m)
    const [kind, ...rest] = topic.split(':')
    let dispose: Dispose | undefined

    try {
      if (kind === 'stacks') dispose = this.subStacks(send)
      else if (kind === 'updates') dispose = this.subUpdates(send)
      else if (kind === 'op' && rest[0]) dispose = this.subOperation(topic, rest[0], send)
      else if (kind === 'logs' && rest[0])
        dispose = this.subLogs(topic, rest[0], rest[1], params, send)
      else if (kind === 'stats' && rest[0]) dispose = this.subStats(topic, rest[0], send)
      else if (kind === 'exec' && rest[0])
        dispose = this.subExec(conn, topic, rest[0], params, send)
      else send({ type: 'error', topic, message: `unknown topic "${topic}"` })
    } catch (err) {
      send({ type: 'error', topic, message: err instanceof Error ? err.message : String(err) })
    }
    if (dispose) conn.subs.set(topic, dispose)
  }

  private subStacks(send: (m: ServerMessage) => void): Dispose {
    send({ type: 'stacks', stacks: this.state.list() })
    const onChange = (stacks: StackSummary[]) => send({ type: 'stacks', stacks })
    this.state.on('change', onChange)
    return () => this.state.off('change', onChange)
  }

  private subUpdates(send: (m: ServerMessage) => void): Dispose {
    const updates = this.updates
    if (!updates) return () => {}
    send({ type: 'updates', topic: 'updates', summary: updates.summary() })
    const onChange = (summary: ReturnType<UpdateChecker['summary']>) =>
      send({ type: 'updates', topic: 'updates', summary })
    updates.on('change', onChange)
    // the newer stacky release changed: the UI fetches `/api/self` again
    const onRelease = () => send({ type: 'self', topic: 'updates' })
    this.releases?.on('change', onRelease)
    return () => {
      updates.off('change', onChange)
      this.releases?.off('change', onRelease)
    }
  }

  private subOperation(topic: string, id: string, send: (m: ServerMessage) => void): Dispose {
    const op = this.engine.get(id)
    if (!op) {
      send({ type: 'error', topic, message: 'operation not found' })
      return () => {}
    }
    send({ type: 'op', topic, operation: op })
    const replay = this.engine.output(id)
    if (replay) send({ type: 'output', topic, data: replay })
    const onOutput = (opId: string, data: string) =>
      opId === id && send({ type: 'output', topic, data })
    const onUpdate = (s: typeof op) => s.id === id && send({ type: 'op', topic, operation: s })
    this.engine.on('output', onOutput)
    this.engine.on('update', onUpdate)
    return () => {
      this.engine.off('output', onOutput)
      this.engine.off('update', onUpdate)
    }
  }

  private subLogs(
    topic: string,
    stackName: string,
    service: string | undefined,
    params: Record<string, unknown>,
    send: (m: ServerMessage) => void,
  ): Dispose {
    const stack = this.state.get(stackName)
    if (!stack) throw new Error(`stack "${stackName}" not found`)
    const targets = logTargets(stack, service)
    if (targets.length === 0) {
      send({ type: 'exit', topic, reason: 'no containers' })
      return () => {}
    }
    return streamLogs(
      this.docker,
      targets,
      {
        tail: typeof params.tail === 'number' ? params.tail : 300,
        since: typeof params.since === 'number' ? params.since : undefined,
      },
      (lines) => send({ type: 'log', topic, lines }),
      (message) => send({ type: 'error', topic, message }),
    )
  }

  private subStats(topic: string, stackName: string, send: (m: ServerMessage) => void): Dispose {
    const stack = this.state.get(stackName)
    if (!stack) throw new Error(`stack "${stackName}" not found`)
    const targets = stack.services.flatMap((s) =>
      s.containers.filter((c) => UP.has(c.state)).map((c) => ({ id: c.id, service: s.name })),
    )
    return streamStats(this.docker, targets, (samples) => send({ type: 'stats', topic, samples }))
  }

  private subExec(
    conn: Connection,
    topic: string,
    containerId: string,
    params: Record<string, unknown>,
    send: (m: ServerMessage) => void,
  ): Dispose {
    // Only containers stacky manages (compose containers) can be opened.
    const known = this.state.allContainers().find((c) => c.id === containerId)
    if (!known) throw new Error('container not found')
    let closed = false
    const cols = typeof params.cols === 'number' ? params.cols : 80
    const rows = typeof params.rows === 'number' ? params.rows : 24
    const shell = typeof params.shell === 'string' ? params.shell : undefined

    openExec(
      this.docker,
      containerId,
      shell,
      { cols, rows },
      (data) => send({ type: 'output', topic, data }),
      (code) => {
        conn.execs.delete(topic)
        send({ type: 'exit', topic, code })
      },
    )
      .then((session) => {
        if (closed) return session.close()
        conn.execs.set(topic, session)
      })
      .catch((err: unknown) => {
        this.logger.debug('exec failed', { err: String(err) })
        send({
          type: 'exit',
          topic,
          reason: err instanceof Error ? err.message : 'could not start a shell',
        })
      })

    return () => {
      closed = true
      conn.execs.get(topic)?.close()
      conn.execs.delete(topic)
    }
  }
}
