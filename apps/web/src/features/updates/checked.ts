import type { ImageUpdate } from '@stacky/shared'
import { formatRelative } from '@/lib/format'

/** How long ago an image was checked for updates; undefined when it never is (local builds). */
export function checkedLabel(update: ImageUpdate | undefined, now = Date.now()) {
  if (!update) return 'not checked yet'
  if (update.status === 'skipped') return undefined
  return `checked ${formatRelative(update.checkedAt, now)}`
}
