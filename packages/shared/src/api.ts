/** Shape of every non-2xx JSON response from the API. */
export interface ApiErrorBody {
  error: {
    code: string
    message: string
    hint?: string
    details?: unknown
    operationId?: string
  }
}

export interface ValidationIssue {
  message: string
  line?: number
  column?: number
  severity: 'error' | 'warning'
  source: 'yaml' | 'compose'
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

/** What `docker compose up` would do to one container (from a `--dry-run`). */
export type PreviewAction = 'create' | 'recreate' | 'start' | 'remove' | 'unchanged'

export interface DeployPreview {
  ok: boolean
  containers: { name: string; action: PreviewAction }[]
  /** Why the dry run failed; a failed preview never blocks a deploy. */
  message?: string
  /**
   * Set when the stack's containers were created by another Docker Compose version: compose
   * then can't match their config hashes, so it recreates them even if nothing changed.
   */
  composeMismatch?: { deployedWith: string[]; current: string }
}

export interface PreflightCheck {
  id: string
  ok: boolean
  severity: 'error' | 'warning' | 'info'
  message: string
  hint?: string
}

export interface SystemInfo {
  version: string
  stacksDir: string
  authDisabled: boolean
  /** Host published container ports are reachable on, when it differs from the UI's host. */
  dockerHost?: string
  docker?: {
    version: string
    apiVersion: string
    os: string
    arch: string
    composeVersion?: string
  }
  self?: {
    containerId: string
    project?: string
    service?: string
    image: string
  }
  preflight: PreflightCheck[]
}

export type SelfJobState = 'pending' | 'applied' | 'rolled_back' | 'failed' | 'succeeded' | 'stale'

/** `GET /api/self`: stacky's own deployment and its last self-update. */
export interface SelfInfo {
  available: boolean
  reason?: string
  version: string
  image?: string
  imageId?: string
  project?: string
  service?: string
  /** The image tag follows releases (latest, edge, 1) rather than pinning one. */
  movingTag?: boolean
  latestRelease?: { version: string; url: string }
  lastJob?: {
    id: string
    operationId: string
    action: string
    state: SelfJobState
    from: { ref: string; imageId: string; version: string }
    to: { ref: string; imageId?: string }
    createdAt: number
    finishedAt?: number
    error?: string
  }
}

/** A stack's files as they were when a deploy succeeded. */
export interface StackRevision {
  id: number
  stack: string
  operationId?: string
  composeFile: string
  compose: string
  env?: string
  createdAt: number
}

export const notifyEvents = [
  'operation_failed',
  'update_available',
  'container_unhealthy',
  'self_update',
] as const
export type NotifyEvent = (typeof notifyEvents)[number]

export const channelTypes = ['ntfy', 'gotify', 'pushover', 'discord', 'webhook', 'apprise'] as const
export type ChannelType = (typeof channelTypes)[number]

/** Pushover's message endpoint; Pushover channels always post here. */
export const PUSHOVER_URL = 'https://api.pushover.net/1/messages.json'

/** Events that can be turned on or off per stack (and, except failures, per container). */
export const scopedNotifyEvents = [
  'operation_failed',
  'update_available',
  'container_unhealthy',
] as const
export type ScopedNotifyEvent = (typeof scopedNotifyEvents)[number]

/** The short names used in `stacky.notify.<alias>` labels. */
export const notifyLabelAliases: Record<ScopedNotifyEvent, string> = {
  operation_failed: 'failures',
  update_available: 'updates',
  container_unhealthy: 'unhealthy',
}

/** A stack's overrides from labels on stacky's own container. */
export interface StackNotifyOverride {
  stack: string
  /** From `stacky.notify.stack.<stack>`: every event. */
  all?: boolean
  /** From `stacky.notify.stack.<stack>.<alias>`: one event. */
  events: Partial<Record<ScopedNotifyEvent, boolean>>
}

/** Which events stacky sends, before each channel picks the events it wants. */
export interface NotifyPolicySettings {
  /** The default for each event when no label overrides it. */
  defaults: Record<ScopedNotifyEvent, boolean>
  stacks: StackNotifyOverride[]
}

/** A notification channel as the API returns it (secrets are never sent back). */
export interface NotificationChannel {
  id: string
  name: string
  type: ChannelType
  url: string
  /** Who receives the message, for channels that need it (the Pushover user or group key). */
  recipient?: string
  hasToken: boolean
  events: NotifyEvent[]
  enabled: boolean
}
