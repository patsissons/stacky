import { PassThrough } from 'node:stream'
import type Docker from 'dockerode'
import type { LogLine } from '@stacky/shared'

export interface LogTarget {
  id: string
  name: string
  service: string
}

export interface LogStreamOptions {
  tail?: number
  /** epoch seconds */
  since?: number
  follow?: boolean
}

/**
 * Streams logs from several containers, merged and batched. Each line carries
 * docker's timestamp so the client can sort and filter by time.
 */
export function streamLogs(
  docker: Docker,
  targets: LogTarget[],
  options: LogStreamOptions,
  onLines: (lines: LogLine[]) => void,
  onError: (message: string) => void,
): () => void {
  let pending: LogLine[] = []
  let closed = false
  const streams: NodeJS.ReadableStream[] = []
  const flush = () => {
    if (pending.length === 0) return
    const batch = pending.sort((a, b) => a.ts - b.ts)
    pending = []
    onLines(batch)
  }
  const timer = setInterval(flush, 100)

  for (const target of targets) {
    void (async () => {
      try {
        const container = docker.getContainer(target.id)
        const info = await container.inspect()
        const raw = (await container.logs({
          follow: (options.follow ?? true) as true,
          stdout: true,
          stderr: true,
          timestamps: true,
          tail: options.tail ?? 200,
          since: options.since,
        })) as unknown as NodeJS.ReadableStream
        if (closed) {
          ;(raw as unknown as { destroy?: () => void }).destroy?.()
          return
        }
        streams.push(raw)
        const push = (stream: 'stdout' | 'stderr') => {
          let rest = ''
          return (chunk: Buffer) => {
            const text = rest + chunk.toString('utf8')
            const parts = text.split('\n')
            rest = parts.pop() ?? ''
            for (const part of parts) pending.push(parseLine(part, target, stream))
          }
        }
        if (info.Config?.Tty) {
          raw.on('data', push('stdout'))
        } else {
          const out = new PassThrough()
          const err = new PassThrough()
          out.on('data', push('stdout'))
          err.on('data', push('stderr'))
          docker.modem.demuxStream(raw, out, err)
        }
      } catch (e) {
        onError(`${target.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }

  return () => {
    closed = true
    clearInterval(timer)
    for (const s of streams) (s as unknown as { destroy?: () => void }).destroy?.()
  }
}

export function parseLine(raw: string, target: LogTarget, stream: 'stdout' | 'stderr'): LogLine {
  const line = raw.replace(/\r$/, '')
  const space = line.indexOf(' ')
  const ts = space > 0 ? Date.parse(line.slice(0, space)) : NaN
  return {
    container: target.name,
    service: target.service,
    stream,
    ts: Number.isNaN(ts) ? Date.now() : ts,
    text: Number.isNaN(ts) ? line : line.slice(space + 1),
  }
}
