import {
  notifyLabelAliases,
  scopedNotifyEvents,
  type NotifyPolicySettings,
  type ScopedNotifyEvent,
  type StackNotifyOverride,
} from '@stacky/shared'
import type { SettingsStore } from '../db/settings'
import type { ComposeContainer } from '../docker/containers'
import type { Logger } from '../lib/logger'

/** Container label that turns all of a container's notifications on or off. */
export const NOTIFY_LABEL = 'stacky.notify'
/** Prefix of the labels on stacky's own container that set a stack's defaults. */
export const STACK_NOTIFY_PREFIX = 'stacky.notify.stack.'
const DEFAULTS_KEY = 'notifications.defaults'
/** The single on/off default from before per-event defaults; read until they're saved. */
const LEGACY_CONTAINERS_KEY = 'notifications.containers'

const ON = new Set(['true', 'on', 'yes', '1'])
const OFF = new Set(['false', 'off', 'no', '0'])

const EVENT_BY_ALIAS = new Map(
  scopedNotifyEvents.map((event) => [notifyLabelAliases[event], event] as const),
)
/** Failures are about a whole stack, so container labels can't turn them off. */
const CONTAINER_EVENTS = new Set<ScopedNotifyEvent>(['update_available', 'container_unhealthy'])

/** `true`/`on`/`yes`/`1` or `false`/`off`/`no`/`0`; anything else is no answer. */
export function parseSwitch(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase()
  if (v === undefined) return undefined
  return ON.has(v) ? true : OFF.has(v) ? false : undefined
}

interface ContainerSource {
  allContainers(): ComposeContainer[]
  selfContainerId: string | undefined
}

/**
 * Decides which stacks and containers send each event. The most specific setting wins: a
 * container's `stacky.notify.<alias>` label, then its `stacky.notify` label, then
 * `stacky.notify.stack.<stack>.<alias>` and `stacky.notify.stack.<stack>` labels on stacky's own
 * container, then the event's global default. Failed operations skip the container labels.
 */
export class NotifyPolicy {
  private warned = new Set<string>()

  constructor(
    private readonly settings: SettingsStore,
    private readonly state: ContainerSource,
    private readonly logger: Logger,
    /** Names of the containers that run an image, from the update checker. */
    private readonly containersUsing: (ref: string) => string[] = () => [],
  ) {}

  /** Whether each event is sent unless a label says otherwise. */
  defaults(): Record<ScopedNotifyEvent, boolean> {
    const saved = this.settings.get<Partial<Record<ScopedNotifyEvent, boolean>>>(DEFAULTS_KEY)
    const legacy = this.settings.get<boolean>(LEGACY_CONTAINERS_KEY) ?? true
    return {
      operation_failed: saved?.operation_failed ?? true,
      update_available: saved?.update_available ?? legacy,
      container_unhealthy: saved?.container_unhealthy ?? legacy,
    }
  }

  setDefaults(changes: Partial<Record<ScopedNotifyEvent, boolean>>) {
    this.settings.set(DEFAULTS_KEY, { ...this.defaults(), ...changes })
    this.settings.delete(LEGACY_CONTAINERS_KEY)
  }

  view(): NotifyPolicySettings {
    return { defaults: this.defaults(), stacks: this.stackOverrides() }
  }

  /** Per-stack overrides from the labels on stacky's own container, by stack name. */
  stackOverrides(): StackNotifyOverride[] {
    const id = this.state.selfContainerId
    const self = id && this.state.allContainers().find((c) => c.id === id)
    if (!self) return []
    const stacks = new Map<string, StackNotifyOverride>()
    for (const [key, value] of Object.entries(self.labels)) {
      if (!key.startsWith(STACK_NOTIFY_PREFIX) || !value.trim()) continue
      // stack names can't contain dots, so anything after one is the event
      const [stack, alias, ...rest] = key.slice(STACK_NOTIFY_PREFIX.length).split('.')
      if (!stack) continue
      const event = alias === undefined ? undefined : EVENT_BY_ALIAS.get(alias)
      if (rest.length > 0 || (alias !== undefined && !event)) {
        this.warnOnce(key, `unknown ${key} label; expected ${STACK_NOTIFY_PREFIX}<stack>[.<event>]`)
        continue
      }
      const enabled = this.switch(key, value)
      if (enabled === undefined) continue
      const entry = stacks.get(stack) ?? { stack, events: {} }
      if (event) entry.events[event] = enabled
      else entry.all = enabled
      stacks.set(stack, entry)
    }
    return [...stacks.values()].sort((a, b) => a.stack.localeCompare(b.stack))
  }

  /** Whether a stack sends an event, from the labels on stacky and the default. */
  stackEnabled(stack: string, event: ScopedNotifyEvent): boolean {
    const o = this.stackOverrides().find((x) => x.stack === stack)
    return o?.events[event] ?? o?.all ?? this.defaults()[event]
  }

  /** Whether a container (by id or name) sends an event. Unknown containers follow the default. */
  containerEnabled(idOrName: string, event: ScopedNotifyEvent): boolean {
    const c = this.state.allContainers().find((x) => x.id === idOrName || x.name === idOrName)
    if (!c) return this.defaults()[event]
    return this.containerOverride(c, event) ?? this.stackEnabled(c.project, event)
  }

  /** An image update notifies if any container running the image does. */
  imageEnabled(ref: string): boolean {
    const names = this.containersUsing(ref)
    if (names.length === 0) return this.defaults().update_available
    return names.some((name) => this.containerEnabled(name, 'update_available'))
  }

  /** The container's own answer for an event: its per-event label, then `stacky.notify`. */
  private containerOverride(c: ComposeContainer, event: ScopedNotifyEvent) {
    let all: boolean | undefined
    let own: boolean | undefined
    for (const [key, value] of Object.entries(c.labels)) {
      if (!value.trim()) continue
      if (key === NOTIFY_LABEL) {
        all = this.switch(key, value)
        continue
      }
      if (!key.startsWith(`${NOTIFY_LABEL}.`) || key.startsWith(STACK_NOTIFY_PREFIX)) continue
      const labelEvent = EVENT_BY_ALIAS.get(key.slice(NOTIFY_LABEL.length + 1))
      if (!labelEvent || !CONTAINER_EVENTS.has(labelEvent)) {
        this.warnOnce(
          key,
          `unknown ${key} label on ${c.name}; expected stacky.notify.updates or stacky.notify.unhealthy`,
        )
        continue
      }
      if (labelEvent === event) own = this.switch(key, value)
    }
    return own ?? all
  }

  private switch(label: string, value: string): boolean | undefined {
    const parsed = parseSwitch(value)
    if (parsed === undefined) {
      this.warnOnce(`${label}=${value}`, `invalid ${label} label; expected true or false`, {
        value,
      })
    }
    return parsed
  }

  private warnOnce(key: string, message: string, meta?: Record<string, unknown>) {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.logger.warn(message, meta)
  }
}
