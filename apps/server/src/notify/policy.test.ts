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
    'stacky.notify.stack.media.unhealthy': 'true',
    'stacky.notify.stack.infra': 'on',
    'stacky.notify.stack.infra.failures': 'off',
    'stacky.notify.stack.bad': 'sometimes',
    'stacky.notify.stack.typo.updatez': 'true',
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
    const updates = (name: string) => p.containerEnabled(name, 'update_available')
    expect(updates('plex')).toBe(false)
    expect(updates('arr')).toBe(true)
    expect(updates('dns')).toBe(true)
    expect(updates('db')).toBe(false)
    expect(updates('web')).toBe(true)
    p.setDefaults({ update_available: false })
    expect(updates('web')).toBe(false)
    expect(updates('dns')).toBe(true)
    // by name too, and unknown containers follow the default
    expect(updates('media-arr-1')).toBe(true)
    expect(updates('gone')).toBe(false)
    expect(p.containerEnabled('gone', 'container_unhealthy')).toBe(true)
  })

  it('resolves each event on its own, most specific label first', () => {
    const p = policy([
      self,
      container('plex', 'media', { 'stacky.notify.updates': 'yes' }),
      container('arr', 'media', { 'stacky.notify': 'on', 'stacky.notify.unhealthy': 'off' }),
      container('sonarr', 'media'),
      container('web', 'app', { 'stacky.notify.updates': 'true' }),
      container('api', 'app'),
    ])
    p.setDefaults({ update_available: false })
    // container event label > container label > stack event label > stack label > default
    expect(p.containerEnabled('plex', 'update_available')).toBe(true)
    expect(p.containerEnabled('plex', 'container_unhealthy')).toBe(true)
    expect(p.containerEnabled('arr', 'update_available')).toBe(true)
    expect(p.containerEnabled('arr', 'container_unhealthy')).toBe(false)
    expect(p.containerEnabled('sonarr', 'update_available')).toBe(false)
    expect(p.containerEnabled('sonarr', 'container_unhealthy')).toBe(true)
    expect(p.containerEnabled('web', 'update_available')).toBe(true)
    expect(p.containerEnabled('api', 'update_available')).toBe(false)
    expect(p.containerEnabled('api', 'container_unhealthy')).toBe(true)
  })

  it('decides failures per stack, ignoring container labels', () => {
    const p = policy([self, container('db', 'infra', { 'stacky.notify.failures': 'on' })])
    expect(p.stackEnabled('infra', 'operation_failed')).toBe(false)
    expect(p.stackEnabled('media', 'operation_failed')).toBe(false)
    expect(p.stackEnabled('app', 'operation_failed')).toBe(true)
    p.setDefaults({ operation_failed: false })
    expect(p.stackEnabled('app', 'operation_failed')).toBe(false)
    expect(p.containerEnabled('db', 'container_unhealthy')).toBe(true)
  })

  it('lists the stack overrides on stacky, skipping invalid labels', () => {
    expect(policy([self]).view()).toEqual({
      defaults: { operation_failed: true, update_available: true, container_unhealthy: true },
      stacks: [
        { stack: 'infra', all: true, events: { operation_failed: false } },
        { stack: 'media', all: false, events: { container_unhealthy: true } },
      ],
    })
    expect(policy([container('x', 'app')]).stackOverrides()).toEqual([])
  })

  it('ignores invalid container labels', () => {
    const p = policy([
      self,
      container('plex', 'media', { 'stacky.notify': 'loud', 'stacky.notify.updatez': 'true' }),
    ])
    expect(p.containerEnabled('plex', 'update_available')).toBe(false)
  })

  it('reads the old single default until per-event defaults are saved', () => {
    const { db } = openDatabase(':memory:')
    const settings = new SettingsStore(db)
    settings.set('notifications.containers', false)
    const p = new NotifyPolicy(
      settings,
      { allContainers: () => [], selfContainerId: undefined },
      silentLogger,
    )
    expect(p.defaults()).toEqual({
      operation_failed: true,
      update_available: false,
      container_unhealthy: false,
    })
    p.setDefaults({ container_unhealthy: true })
    expect(settings.get('notifications.containers')).toBeUndefined()
    expect(p.defaults()).toEqual({
      operation_failed: true,
      update_available: false,
      container_unhealthy: true,
    })
  })

  it('notifies about an image if any container running it notifies', () => {
    const p = policy(
      [
        self,
        container('plex', 'media'),
        container('web', 'app'),
        container('jelly', 'media', { 'stacky.notify.updates': 'on' }),
      ],
      {
        'nginx:1': ['media-plex-1', 'app-web-1'],
        'plex:1': ['media-plex-1'],
        'jelly:1': ['media-jelly-1'],
      },
    )
    expect(p.imageEnabled('nginx:1')).toBe(true)
    expect(p.imageEnabled('plex:1')).toBe(false)
    expect(p.imageEnabled('jelly:1')).toBe(true)
    expect(p.imageEnabled('unknown:1')).toBe(true)
    p.setDefaults({ update_available: false })
    expect(p.imageEnabled('nginx:1')).toBe(false)
    expect(p.imageEnabled('unknown:1')).toBe(false)
  })
})
