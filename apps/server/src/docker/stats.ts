import type Docker from 'dockerode'
import type { StatsSample } from '@stacky/shared'

interface RawStats {
  read: string
  cpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number; online_cpus?: number }
  precpu_stats: { cpu_usage: { total_usage: number }; system_cpu_usage?: number }
  memory_stats: { usage?: number; limit?: number; stats?: Record<string, number> }
}

/** CPU% and memory the way `docker stats` computes them (cache excluded from memory). */
export function computeSample(raw: RawStats, containerId: string, service: string): StatsSample {
  const cpuDelta = raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage
  const sysDelta = (raw.cpu_stats.system_cpu_usage ?? 0) - (raw.precpu_stats.system_cpu_usage ?? 0)
  const cpus = raw.cpu_stats.online_cpus ?? 1
  const cpuPercent = sysDelta > 0 && cpuDelta > 0 ? (cpuDelta / sysDelta) * cpus * 100 : 0
  const usage = raw.memory_stats.usage ?? 0
  const cache = raw.memory_stats.stats?.inactive_file ?? raw.memory_stats.stats?.cache ?? 0
  return {
    containerId,
    service,
    ts: Date.parse(raw.read) || Date.now(),
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryBytes: Math.max(0, usage - cache),
    memoryLimitBytes: raw.memory_stats.limit ?? 0,
  }
}

/** Streams stats for running containers; emits roughly every 2 seconds per container. */
export function streamStats(
  docker: Docker,
  targets: { id: string; service: string }[],
  onSamples: (samples: StatsSample[]) => void,
): () => void {
  let closed = false
  const streams: NodeJS.ReadableStream[] = []
  const latest = new Map<string, StatsSample>()
  const timer = setInterval(() => {
    if (latest.size > 0) onSamples([...latest.values()])
    latest.clear()
  }, 2000)

  for (const t of targets) {
    void (async () => {
      try {
        const stream = (await docker
          .getContainer(t.id)
          .stats({ stream: true })) as unknown as NodeJS.ReadableStream
        if (closed) return (stream as unknown as { destroy?: () => void }).destroy?.()
        streams.push(stream)
        let rest = ''
        stream.on('data', (chunk: Buffer) => {
          const parts = (rest + chunk.toString('utf8')).split('\n')
          rest = parts.pop() ?? ''
          for (const part of parts) {
            if (!part.trim()) continue
            try {
              latest.set(t.id, computeSample(JSON.parse(part) as RawStats, t.id, t.service))
            } catch {
              // partial / malformed frame
            }
          }
        })
      } catch {
        // container stopped between listing and streaming
      }
    })()
  }

  return () => {
    closed = true
    clearInterval(timer)
    for (const s of streams) (s as unknown as { destroy?: () => void }).destroy?.()
  }
}
