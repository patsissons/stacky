import { Cron } from 'croner'

/** Container label that overrides how often the container's image is checked. */
export const SCHEDULE_LABEL = 'stacky.update.schedule'

/** Shorter intervals would hammer registries for little gain. */
export const MIN_INTERVAL_MS = 5 * 60_000
/** Presets and intervals start up to this much late, so instances don't all check at once. */
export const MAX_JITTER_MS = 5 * 60_000

const PRESETS: Record<string, string> = {
  hourly: '0 * * * *',
  daily: '0 3 * * *',
  nightly: '0 3 * * *',
  weekly: '0 3 * * 0',
  monthly: '0 3 1 * *',
}
const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }

export type Schedule =
  | { kind: 'never'; text: string }
  | { kind: 'interval'; text: string; ms: number }
  | { kind: 'cron'; text: string; cron: Cron; jitter: boolean }

export class ScheduleError extends Error {}

/**
 * Parses an update-check schedule: `hourly`, `daily`/`nightly`, `weekly`, `monthly`, an interval
 * such as `30m`, `6h`, `2d` or `1w`, a 5- or 6-field cron pattern, or `never`/`off`/`0`.
 * Cron patterns use the server's local time zone (`TZ`).
 */
export function parseSchedule(input: string): Schedule {
  const text = input.trim().toLowerCase()
  if (text === 'never' || text === 'off' || text === '0') return { kind: 'never', text }
  const preset = PRESETS[text]
  if (preset) return { kind: 'cron', text, cron: cron(preset), jitter: true }
  const interval = /^(\d+)\s*([mhdw])$/.exec(text)
  if (interval) {
    const ms = Number(interval[1]) * UNITS[interval[2]!]!
    if (ms === 0) return { kind: 'never', text }
    if (ms < MIN_INTERVAL_MS) throw new ScheduleError('the shortest interval is 5m')
    return { kind: 'interval', text, ms }
  }
  if (text.split(/\s+/).length < 5 && !text.startsWith('@')) {
    throw new ScheduleError(
      `"${input.trim()}" is not a schedule; use hourly, nightly, weekly, monthly, an interval like 6h, a cron pattern or never`,
    )
  }
  try {
    return { kind: 'cron', text, cron: cron(text), jitter: false }
  } catch (err) {
    throw new ScheduleError(
      `invalid cron pattern "${input.trim()}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function cron(pattern: string) {
  return new Cron(pattern, { paused: true, mode: '5-or-6-parts' })
}

/**
 * When an image last checked at `lastCheckedAt` is due again. Images that were never checked are
 * due now; `undefined` means never. `jitterMs` delays presets and intervals (not explicit cron).
 */
export function nextRun(
  schedule: Schedule,
  lastCheckedAt: number | undefined,
  now: number,
  jitterMs = 0,
): number | undefined {
  if (schedule.kind === 'never') return undefined
  if (lastCheckedAt === undefined) return now
  if (schedule.kind === 'interval') {
    return lastCheckedAt + schedule.ms + Math.min(jitterMs, schedule.ms / 10)
  }
  const next = schedule.cron.nextRun(new Date(lastCheckedAt))
  if (!next) return undefined
  return next.getTime() + (schedule.jitter ? jitterMs : 0)
}

/** The schedule `STACKY_UPDATE_INTERVAL` (hours) stood for. */
export function intervalSchedule(hours: number): string {
  if (hours <= 0) return 'never'
  return Number.isInteger(hours) ? `${hours}h` : `${Math.round(hours * 60)}m`
}
