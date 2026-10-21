import { describe, expect, it } from 'vitest'
import { intervalSchedule, MAX_JITTER_MS, nextRun, parseSchedule, ScheduleError } from './schedule'

const NOW = new Date(2026, 9, 20, 12, 0).getTime() // a Tuesday, local time
const HOUR = 3_600_000

describe('parseSchedule', () => {
  it('understands presets, intervals, cron and never', () => {
    expect(parseSchedule(' Nightly ')).toMatchObject({
      kind: 'cron',
      text: 'nightly',
      jitter: true,
    })
    expect(parseSchedule('6h')).toMatchObject({ kind: 'interval', ms: 6 * HOUR })
    expect(parseSchedule('30m')).toMatchObject({ kind: 'interval', ms: 30 * 60_000 })
    expect(parseSchedule('2d')).toMatchObject({ kind: 'interval', ms: 48 * HOUR })
    expect(parseSchedule('1w')).toMatchObject({ kind: 'interval', ms: 7 * 24 * HOUR })
    expect(parseSchedule('0 */4 * * *')).toMatchObject({ kind: 'cron', jitter: false })
    expect(parseSchedule('0 0 */4 * * *')).toMatchObject({ kind: 'cron' })
    for (const off of ['never', 'off', '0', '0h']) expect(parseSchedule(off).kind).toBe('never')
  })

  it('rejects nonsense, bad cron and too-short intervals', () => {
    expect(() => parseSchedule('sometimes')).toThrow(ScheduleError)
    expect(() => parseSchedule('99 * * * *')).toThrow(/invalid cron pattern/)
    expect(() => parseSchedule('1m')).toThrow(/shortest interval is 5m/)
    expect(() => parseSchedule('')).toThrow(ScheduleError)
  })
})

describe('nextRun', () => {
  it('is due now for never-checked images, and never for never', () => {
    expect(nextRun(parseSchedule('weekly'), undefined, NOW)).toBe(NOW)
    expect(nextRun(parseSchedule('never'), undefined, NOW)).toBeUndefined()
  })

  it('counts intervals from the last check', () => {
    expect(nextRun(parseSchedule('6h'), NOW, NOW)).toBe(NOW + 6 * HOUR)
    // jitter is at most a tenth of the interval
    expect(nextRun(parseSchedule('30m'), NOW, NOW, MAX_JITTER_MS)).toBe(NOW + 33 * 60_000)
  })

  it('finds the next cron occurrence after the last check', () => {
    expect(nextRun(parseSchedule('nightly'), NOW, NOW)).toBe(new Date(2026, 9, 21, 3, 0).getTime())
    expect(nextRun(parseSchedule('weekly'), NOW, NOW)).toBe(new Date(2026, 9, 25, 3, 0).getTime())
    expect(nextRun(parseSchedule('monthly'), NOW, NOW)).toBe(new Date(2026, 10, 1, 3, 0).getTime())
    // a missed run (stacky was down) is due straight away
    const lastWeek = NOW - 8 * 24 * HOUR
    expect(nextRun(parseSchedule('weekly'), lastWeek, NOW)!).toBeLessThan(NOW)
  })

  it('only delays presets, not explicit cron patterns', () => {
    const at = new Date(2026, 9, 21, 3, 0).getTime()
    expect(nextRun(parseSchedule('nightly'), NOW, NOW, 1000)).toBe(at + 1000)
    expect(nextRun(parseSchedule('0 3 * * *'), NOW, NOW, 1000)).toBe(at)
  })
})

describe('intervalSchedule', () => {
  it('maps STACKY_UPDATE_INTERVAL hours to a schedule', () => {
    expect(intervalSchedule(6)).toBe('6h')
    expect(intervalSchedule(0.5)).toBe('30m')
    expect(intervalSchedule(0)).toBe('never')
  })
})
