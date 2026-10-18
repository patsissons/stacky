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
