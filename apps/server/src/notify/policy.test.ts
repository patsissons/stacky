import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db'
import { SettingsStore } from '../db/settings'
import type { ComposeContainer } from '../docker/containers'
import { silentLogger } from '../lib/logger'
import { NotifyPolicy, parseSwitch } from './policy'

function container(id: string, project: string, labels: Record<string, string> = {}) {
  return { id, name: `${project}-${id}-1`, project, labels } as ComposeContainer
}

function policy(containers: ComposeContainer[], using: Record<string, string[]> = {}) {
  const { db } = openDatabase(':memory:')
  const state = { allContainers: () => containers, selfContainerId: 'self' }
  return new NotifyPolicy(new SettingsStore(db), state, silentLogger, (ref) => using[ref] ?? [])
}

describe('parseSwitch', () => {
  it('reads common spellings of on and off', () => {
    expect(['true', 'On', ' yes ', '1'].map(parseSwitch)).toEqual([true, true, true, true])
    expect(['false', 'OFF', 'no', '0'].map(parseSwitch)).toEqual([false, false, false, false])
    expect(parseSwitch('maybe')).toBeUndefined()
    expect(parseSwitch(undefined)).toBeUndefined()
  })
})

describe('NotifyPolicy', () => {
  const self = container('self', 'stacky', {
    'stacky.notify.stack.media': 'false',
    'stacky.notify.stack.infra': 'on',
    'stacky.notify.stack.bad': 'sometimes',
    'stacky.update.schedule': 'weekly',
  })

  it('lets the container label win over the stack label and the default', () => {
    const p = policy([
      self,
      container('plex', 'media'),
      container('arr', 'media', { 'stacky.notify': 'true' }),
      container('dns', 'infra'),
      container('db', 'infra', { 'stacky.notify': 'no' }),
      container('web', 'app'),
    ])
    expect(p.containerEnabled('plex')).toBe(false)
    expect(p.containerEnabled('arr')).toBe(true)
    expect(p.containerEnabled('dns')).toBe(true)
    expect(p.containerEnabled('db')).toBe(false)
    expect(p.containerEnabled('web')).toBe(true)
    p.setDefault(false)
    expect(p.containerEnabled('web')).toBe(false)
    expect(p.containerEnabled('dns')).toBe(true)
    // by name too, and unknown containers follow the default
    expect(p.containerEnabled('media-arr-1')).toBe(true)
    expect(p.containerEnabled('gone')).toBe(false)
  })

  it('lists the stack overrides on stacky, skipping invalid values', () => {
    expect(policy([self]).view()).toEqual({
      enabled: true,
      stacks: [
        { stack: 'infra', enabled: true },
        { stack: 'media', enabled: false },
      ],
    })
    expect(policy([container('x', 'app')]).stackOverrides()).toEqual([])
  })

  it('ignores an invalid container label', () => {
    const p = policy([self, container('plex', 'media', { 'stacky.notify': 'loud' })])
    expect(p.containerEnabled('plex')).toBe(false)
  })

  it('notifies about an image if any container running it notifies', () => {
    const p = policy([self, container('plex', 'media'), container('web', 'app')], {
      'nginx:1': ['media-plex-1', 'app-web-1'],
      'plex:1': ['media-plex-1'],
    })
    expect(p.imageEnabled('nginx:1')).toBe(true)
    expect(p.imageEnabled('plex:1')).toBe(false)
    expect(p.imageEnabled('unknown:1')).toBe(true)
  })
})
