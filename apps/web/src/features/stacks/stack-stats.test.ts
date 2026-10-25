import { describe, expect, it } from 'vitest'
import type { StatsSample } from '@stacky/shared'
import { totalStats } from './stack-stats'

const sample = (containerId: string, cpuPercent: number, memoryBytes: number): StatsSample => ({
  containerId,
  service: 'app',
  ts: 0,
  cpuPercent,
  memoryBytes,
  memoryLimitBytes: 0,
})

describe('totalStats', () => {
  it('sums the latest sample of every container', () => {
    const totals = totalStats(['a', 'b'], {
      a: [sample('a', 1, 100), sample('a', 2, 200)],
      b: [sample('b', 10, 1000), sample('b', 20, 2000)],
    })
    expect(totals.cpu).toBe(22)
    expect(totals.mem).toBe(2200)
    expect(totals.cpuHistory).toEqual([11, 22])
    expect(totals.memHistory).toEqual([1100, 2200])
    expect(totals.sampled).toBe(2)
  })

  it('aligns histories of different lengths on their newest sample', () => {
    const totals = totalStats(['a', 'b'], {
      a: [sample('a', 1, 1), sample('a', 2, 2), sample('a', 3, 3)],
      b: [sample('b', 10, 10)],
    })
    expect(totals.cpuHistory).toEqual([1, 2, 13])
    expect(totals.memHistory).toEqual([1, 2, 13])
    expect(totals.cpu).toBe(13)
  })

  it('ignores containers without samples and ones it was not asked about', () => {
    const totals = totalStats(['a', 'missing'], {
      a: [sample('a', 5, 50)],
      other: [sample('other', 99, 999)],
    })
    expect(totals.cpu).toBe(5)
    expect(totals.mem).toBe(50)
    expect(totals.sampled).toBe(1)
  })

  it('is empty before the first sample', () => {
    expect(totalStats(['a'], {})).toEqual({
      cpu: 0,
      mem: 0,
      cpuHistory: [],
      memHistory: [],
      sampled: 0,
    })
  })
})
