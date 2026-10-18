import { describe, expect, it } from 'vitest'
import { parseLine } from './logs'
import { computeSample } from './stats'
import { shellCommand } from './exec'

describe('parseLine', () => {
  const target = { id: '1', name: 'app-web-1', service: 'web' }

  it('splits docker timestamps from the text', () => {
    expect(parseLine('2026-10-18T12:00:00.123456789Z hello world\r', target, 'stdout')).toEqual({
      container: 'app-web-1',
      service: 'web',
      stream: 'stdout',
      ts: Date.parse('2026-10-18T12:00:00.123Z'),
      text: 'hello world',
    })
  })

  it('keeps lines without a timestamp intact', () => {
    expect(parseLine('no timestamp here', target, 'stderr').text).toBe('no timestamp here')
  })
})

describe('computeSample', () => {
  it('matches docker stats CPU and memory math', () => {
    const sample = computeSample(
      {
        read: '2026-10-18T12:00:00Z',
        cpu_stats: { cpu_usage: { total_usage: 2_000 }, system_cpu_usage: 20_000, online_cpus: 4 },
        precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
        memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 100 } },
      },
      'c1',
      'web',
    )
    expect(sample.cpuPercent).toBe(40)
    expect(sample.memoryBytes).toBe(200)
    expect(sample.memoryLimitBytes).toBe(1000)
  })
})

describe('shellCommand', () => {
  it('defaults to bash-or-sh and rejects injection', () => {
    expect(shellCommand(undefined)[0]).toBe('/bin/sh')
    expect(shellCommand('/bin/zsh')).toEqual(['/bin/zsh'])
    expect(() => shellCommand('sh; rm -rf /')).toThrow()
  })
})
