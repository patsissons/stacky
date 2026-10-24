import type { ContainerNotifySettings } from '@stacky/shared'
import type { SettingsStore } from '../db/settings'
import type { ComposeContainer } from '../docker/containers'
import { firstLabel } from '../docker/labels'
import type { Logger } from '../lib/logger'

/** Container label that turns a container's notifications on or off. */
export const NOTIFY_LABEL = 'stacky.notify'
/** Prefix of the labels on stacky's own container that set a stack's default. */
export const STACK_NOTIFY_PREFIX = 'stacky.notify.stack.'
const CONTAINERS_KEY = 'notifications.containers'

const ON = new Set(['true', 'on', 'yes', '1'])
const OFF = new Set(['false', 'off', 'no', '0'])

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
 * Decides which containers send notifications (unhealthy containers, image updates). The most
 * specific setting wins: a container's `stacky.notify` label, then a
 * `stacky.notify.stack.<stack>` label on stacky's own container, then the global default.
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

  /** Whether containers notify unless a label says otherwise. */
  defaultEnabled(): boolean {
    return this.settings.get<boolean>(CONTAINERS_KEY) ?? true
  }

  setDefault(enabled: boolean) {
    this.settings.set(CONTAINERS_KEY, enabled)
  }

  view(): ContainerNotifySettings {
    return { enabled: this.defaultEnabled(), stacks: this.stackOverrides() }
  }

  /** Per-stack defaults from the labels on stacky's own container, by stack name. */
  stackOverrides(): { stack: string; enabled: boolean }[] {
    const id = this.state.selfContainerId
    const self = id && this.state.allContainers().find((c) => c.id === id)
    if (!self) return []
    return Object.entries(self.labels)
      .filter(([key]) => key.startsWith(STACK_NOTIFY_PREFIX))
      .map(([key, value]) => ({
        stack: key.slice(STACK_NOTIFY_PREFIX.length),
        enabled: this.switch(key, value),
      }))
      .filter((o): o is { stack: string; enabled: boolean } => !!o.stack && o.enabled !== undefined)
      .sort((a, b) => a.stack.localeCompare(b.stack))
  }

  /** Whether a container (by id or name) notifies. Unknown containers follow the default. */
  containerEnabled(idOrName: string): boolean {
    const c = this.state.allContainers().find((x) => x.id === idOrName || x.name === idOrName)
    if (!c) return this.defaultEnabled()
    const own = firstLabel(c.labels, [NOTIFY_LABEL])
    return (
      (own === undefined ? undefined : this.switch(NOTIFY_LABEL, own)) ??
      this.stackOverrides().find((o) => o.stack === c.project)?.enabled ??
      this.defaultEnabled()
    )
  }

  /** An image update notifies if any container running the image does. */
  imageEnabled(ref: string): boolean {
    const names = this.containersUsing(ref)
    if (names.length === 0) return this.defaultEnabled()
    return names.some((name) => this.containerEnabled(name))
  }

  private switch(label: string, value: string): boolean | undefined {
    const parsed = parseSwitch(value)
    const key = `${label}=${value}`
    if (parsed === undefined && !this.warned.has(key)) {
      this.warned.add(key)
      this.logger.warn(`invalid ${label} label; expected true or false`, { value })
    }
    return parsed
  }
}
