import type Docker from 'dockerode'
import { describe, expect, it } from 'vitest'
import { demuxLogs, parseLine, readLogs } from './logs'
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

const frame = (stream: 1 | 2, text: string) => {
  const body = Buffer.from(text)
  const header = Buffer.alloc(8)
  header[0] = stream
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

describe('demuxLogs', () => {
  it('splits multiplexed frames into stdout and stderr', () => {
    const buf = Buffer.concat([frame(1, 'out\n'), frame(2, 'err\n')])
    expect(demuxLogs(buf, false)).toEqual([
      { stream: 'stdout', text: 'out\n' },
      { stream: 'stderr', text: 'err\n' },
    ])
  })

  it('passes TTY output through as stdout', () => {
    expect(demuxLogs(Buffer.from('raw\n'), true)).toEqual([{ stream: 'stdout', text: 'raw\n' }])
  })
})

describe('readLogs', () => {
  it('merges the containers of a stack into one time-ordered list', async () => {
    const logs: Record<string, Buffer> = {
      a: Buffer.concat([
        frame(1, '2026-10-18T12:00:00Z first\n2026-10-18T12:00:02Z th'),
        frame(1, 'ird\n'),
      ]),
      b: frame(2, '2026-10-18T12:00:01Z second'),
    }
    const docker = {
      getContainer: (id: string) => ({
        inspect: async () => ({ Config: { Tty: false } }),
        logs: async (opts: { follow: boolean; tail: number }) => {
          expect(opts).toMatchObject({ follow: false, tail: 50 })
          return logs[id]
        },
      }),
    } as unknown as Docker
    const lines = await readLogs(
      docker,
      [
        { id: 'a', name: 'app-web-1', service: 'web' },
        { id: 'b', name: 'app-db-1', service: 'db' },
      ],
      { tail: 50 },
    )
    expect(lines.map((l) => [l.service, l.stream, l.text])).toEqual([
      ['web', 'stdout', 'first'],
      ['db', 'stderr', 'second'],
      ['web', 'stdout', 'third'],
    ])
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
