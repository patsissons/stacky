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
  /** The `stacky.update.schedule` label that decides how often this image is checked, if any. */
  scheduleLabel?: string
  /** Why a `stacky.update.schedule` label was ignored in favour of the global schedule. */
  scheduleError?: string
  /** The `stacky.tag.include` regex newer tags had to match in this check, if any. */
  tagInclude?: string
  /** The `stacky.tag.exclude` regex that ruled tags out in this check, if any. */
  tagExclude?: string
  /** Why a `stacky.tag.include` or `stacky.tag.exclude` label was ignored. */
  tagFilterError?: string
  /** The `stacky.link.template` label release links are built from, if any. */
  linkTemplate?: string
  /** Why the `stacky.link.template` label gave no links. */
  linkTemplateError?: string
  /** Release link for `tag`, from the link template. */
  currentLink?: string
  /** Release link for `newerTag`, from the link template. */
  newerLink?: string
}

/** The global image update check schedule, as `GET /api/settings/updates` returns it. */
export interface UpdateScheduleSettings {
  /** The schedule in effect: saved in Settings, else `default`. */
  schedule: string
  /** From `STACKY_UPDATE_SCHEDULE` (or the legacy `STACKY_UPDATE_INTERVAL`). */
  default: string
  saved: boolean
  nextCheckAt?: number
}

export interface UpdatesSummary {
  updates: ImageUpdate[]
  checking: boolean
  lastCheckAt?: number
  nextCheckAt?: number
}
