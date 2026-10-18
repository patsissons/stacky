/** How big an available update is; `digest` means the same tag was rebuilt. */
export type UpdateKind = 'major' | 'minor' | 'patch' | 'prerelease' | 'digest'

export type UpdateStatus = 'up_to_date' | 'update_available' | 'error' | 'skipped'

/** Result of checking one image reference for updates. */
export interface ImageUpdate {
  /** Image reference as used by the containers, e.g. `nginx:1.27`. */
  ref: string
  registry: string
  repository: string
  tag: string
  status: UpdateStatus
  checkedAt: number
  /** Where the result came from. */
  source: 'native' | 'wud'
  /** The registry has a new image for the same tag. */
  digestChanged?: boolean
  /** A newer version tag with the same shape (e.g. 1.27.3 -> 1.28.0). */
  newerTag?: string
  kind?: UpdateKind
  localDigest?: string
  remoteDigest?: string
  /** Why the check failed or was skipped (local build, pinned digest, rate limit...). */
  message?: string
  /** The user chose to ignore this specific update. */
  ignored?: boolean
}

export interface UpdatesSummary {
  updates: ImageUpdate[]
  checking: boolean
  lastCheckAt?: number
  nextCheckAt?: number
}
