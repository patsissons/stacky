import type { useStackStats } from '@/hooks/use-stats'

export type Stats = ReturnType<typeof useStackStats>

/**
 * Latest CPU/memory totals across the given containers, and their summed history for sparklines.
 * Histories are summed aligned from the newest sample: the server flushes every container in one
 * message, so they grow in step, and a container that started later adds nothing to older points.
 */
export function totalStats(containerIds: string[], stats: Stats) {
  const histories = containerIds.map((id) => stats[id] ?? []).filter((h) => h.length > 0)
  const length = Math.max(0, ...histories.map((h) => h.length))
  const at = (i: number) => histories.map((h) => h[i - (length - h.length)]).filter((s) => !!s)
  const points = Array.from({ length }, (_, i) => at(i))
  const cpuHistory = points.map((p) => p.reduce((a, s) => a + s.cpuPercent, 0))
  const memHistory = points.map((p) => p.reduce((a, s) => a + s.memoryBytes, 0))
  return {
    cpu: cpuHistory.at(-1) ?? 0,
    mem: memHistory.at(-1) ?? 0,
    cpuHistory,
    memHistory,
    /** How many of the containers have reported a sample yet. */
    sampled: histories.length,
  }
}
