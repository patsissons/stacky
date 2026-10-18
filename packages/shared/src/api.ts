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
