import { describe, expect, it } from 'vitest'
import { formatBytes, formatDuration, formatRelative, parseImageRef } from './format'

describe('formatBytes', () => {
  it('formats with sensible precision', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
  })
})

describe('formatRelative / formatDuration', () => {
  it('formats times', () => {
    expect(formatRelative(1000, 1000)).toBe('just now')
    expect(formatRelative(0, 90_000)).toBe('2m ago')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(125_000)).toBe('2m 5s')
  })
})

describe('parseImageRef', () => {
  it('normalises Docker Hub shorthand', () => {
    expect(parseImageRef('nginx')).toEqual({
      registry: 'docker.io',
      repository: 'library/nginx',
      tag: 'latest',
    })
    expect(parseImageRef('louislam/dockge:1')).toEqual({
      registry: 'docker.io',
      repository: 'louislam/dockge',
      tag: '1',
    })
  })

  it('keeps explicit registries and ports', () => {
    expect(parseImageRef('ghcr.io/patsissons/stacky:edge')).toEqual({
      registry: 'ghcr.io',
      repository: 'patsissons/stacky',
      tag: 'edge',
    })
    expect(parseImageRef('localhost:5000/app:1.0').registry).toBe('localhost:5000')
    expect(parseImageRef('lscr.io/linuxserver/heimdall:v2.8.3-ls364').tag).toBe('v2.8.3-ls364')
  })
})
