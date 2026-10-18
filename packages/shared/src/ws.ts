import type { OperationSummary } from './operations'
import type { StackSummary } from './stacks'

/**
 * One multiplexed WebSocket per browser tab. Topics:
 *
 * - `stacks`                     → full stack list snapshot on every change
 * - `op:<id>`                    → operation output (replayed from the start) and state changes
 * - `logs:<stack>[:<service>]`   → container log lines
 * - `stats:<stack>`              → per-container CPU/memory samples
 * - `exec:<containerId>`         → interactive shell (bidirectional)
 */
export type ClientMessage =
  | { type: 'sub'; topic: string; params?: Record<string, string | number | boolean> }
  | { type: 'unsub'; topic: string }
  | { type: 'input'; topic: string; data: string }
  | { type: 'resize'; topic: string; cols: number; rows: number }
  | { type: 'ping' }

export type ServerMessage =
  | { type: 'stacks'; stacks: StackSummary[] }
  | { type: 'op'; topic: string; operation: OperationSummary }
  | { type: 'output'; topic: string; data: string }
  | { type: 'log'; topic: string; lines: LogLine[] }
  | { type: 'stats'; topic: string; samples: StatsSample[] }
  | { type: 'exit'; topic: string; code?: number; reason?: string }
  | { type: 'error'; topic?: string; message: string }
  | { type: 'pong' }

export interface LogLine {
  /** container name */
  container: string
  service: string
  stream: 'stdout' | 'stderr'
  /** epoch ms from docker's timestamp */
  ts: number
  text: string
}

export interface StatsSample {
  containerId: string
  service: string
  ts: number
  cpuPercent: number
  memoryBytes: number
  memoryLimitBytes: number
}
